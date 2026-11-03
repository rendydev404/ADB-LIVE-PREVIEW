import type { Adb } from "@yume-chan/adb";
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import { ScrcpyInstanceId } from "@yume-chan/scrcpy";
import { ReadableStream } from "@yume-chan/stream-extra";

export const SCRCPY_VERSION = "3.3.3";
// Pushed to the device's temp dir and started with app_process: no APK is installed.
const DEVICE_PATH = `/data/local/tmp/alp-scrcpy-server-${SCRCPY_VERSION}.jar`;

export interface MirrorSettings {
    codec: "h264" | "h265";
    maxSize: number;
    bitRate: number;
    maxFps: number;
    audio: boolean;
}

export const DEFAULT_SETTINGS: MirrorSettings = {
    codec: "h264",
    maxSize: 1920,
    bitRate: 8_000_000,
    maxFps: 60,
    audio: true,
};

let binary: Promise<Uint8Array> | undefined;

function getServerBinary(): Promise<Uint8Array> {
    binary ??= fetch(`/scrcpy-server-v${SCRCPY_VERSION}`)
        .then((response) => {
            if (!response.ok) throw new Error(`scrcpy-server tidak ditemukan (HTTP ${response.status})`);
            return response.arrayBuffer();
        })
        .then((buffer) => new Uint8Array(buffer));
    binary.catch(() => (binary = undefined));
    return binary;
}

async function ensureServer(adb: Adb) {
    const data = await getServerBinary();
    const sync = await adb.sync();
    try {
        try {
            // Skip the ~90 KB push when this exact version is already there.
            const stat = await sync.stat(DEVICE_PATH);
            if (stat.size === BigInt(data.length)) return;
        } catch {
            // Not on the device yet.
        }
        await sync.write({
            filename: DEVICE_PATH,
            file: new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(data);
                    controller.close();
                },
            }),
        });
    } finally {
        await sync.dispose();
    }
}

export async function startScrcpy(adb: Adb, settings: MirrorSettings, sdk: number) {
    await ensureServer(adb);
    const options = new AdbScrcpyOptionsLatest(
        {
            scid: ScrcpyInstanceId.random(),
            videoCodec: settings.codec,
            maxSize: settings.maxSize,
            videoBitRate: settings.bitRate,
            maxFps: settings.maxFps,
            // Audio capture needs Android 11+.
            audio: settings.audio && sdk >= 30,
            tunnelForward: true,
            control: true,
            clipboardAutosync: true,
            stayAwake: true,
            logLevel: "info",
        },
        { version: SCRCPY_VERSION },
    );
    return AdbScrcpyClient.start(adb, DEVICE_PATH, options);
}

export type ScrcpySession = Awaited<ReturnType<typeof startScrcpy>>;
