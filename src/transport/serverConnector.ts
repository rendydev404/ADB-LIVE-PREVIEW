import type { AdbServerClient } from "@yume-chan/adb";
import { MaybeConsumable, PushReadableStream } from "@yume-chan/stream-extra";

// Each ADB server connection becomes one WebSocket that the local helper pipes to tcp:5037.
export class WebSocketServerConnector implements AdbServerClient.ServerConnector {
    readonly #url: string;

    constructor(token: string) {
        const url = new URL("/adb", location.href);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("token", token);
        this.#url = url.href;
    }

    async connect(options?: AdbServerClient.ServerConnectionOptions): Promise<AdbServerClient.ServerConnection> {
        const signal = options?.signal as globalThis.AbortSignal | undefined;
        const ws = new WebSocket(this.#url);
        ws.binaryType = "arraybuffer";

        await new Promise<void>((resolve, reject) => {
            const abort = () => {
                ws.close();
                reject(signal?.reason ?? new Error("Aborted"));
            };
            signal?.addEventListener("abort", abort, { once: true });
            ws.onopen = () => {
                signal?.removeEventListener("abort", abort);
                resolve();
            };
            ws.onerror = () => reject(new Error("Tidak bisa terhubung ke server lokal"));
        });

        let resolveClosed!: (value: undefined) => void;
        const closed = new Promise<undefined>((resolve) => (resolveClosed = resolve));

        const readable = new PushReadableStream<Uint8Array>((controller) => {
            ws.onmessage = (event) => {
                void controller.enqueue(new Uint8Array(event.data as ArrayBuffer));
            };
            ws.onclose = () => {
                controller.close();
                resolveClosed(undefined);
            };
            ws.onerror = () => controller.error(new Error("WebSocket error"));
            controller.abortSignal.addEventListener("abort", () => ws.close());
        });

        const writable = new MaybeConsumable.WritableStream<Uint8Array>({
            async write(chunk) {
                if (ws.readyState !== WebSocket.OPEN) throw new Error("Socket closed");
                // `send` copies the bytes synchronously, so the chunk can be released right after.
                ws.send(chunk as Uint8Array<ArrayBuffer>);
                // Light backpressure for large pushes (file upload / APK install).
                while (ws.bufferedAmount > 4 * 1024 * 1024 && ws.readyState === WebSocket.OPEN) {
                    await new Promise((resolve) => setTimeout(resolve, 4));
                }
            },
            close() {
                ws.close();
            },
            abort() {
                ws.close();
            },
        });

        return {
            readable,
            writable,
            closed,
            close() {
                ws.close();
            },
        };
    }

    addReverseTunnel(): never {
        throw new Error("Reverse tunnel tidak didukung lewat server lokal");
    }

    removeReverseTunnel(): void {}

    clearReverseTunnels(): void {}
}
