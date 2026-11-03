import { download } from "../../ui/download";

const MIME_CANDIDATES = [
    "video/mp4;codecs=avc1.640028,opus",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
];

export class ScreenRecorder {
    readonly #recorder: MediaRecorder;
    readonly #chunks: Blob[] = [];
    readonly #done: Promise<Blob>;

    constructor(canvas: HTMLCanvasElement, audio: MediaStream | undefined, bitRate: number) {
        const stream = canvas.captureStream(60);
        audio?.getAudioTracks().forEach((track) => stream.addTrack(track));
        const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
        this.#recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitRate });
        this.#recorder.ondataavailable = (event) => {
            if (event.data.size) this.#chunks.push(event.data);
        };
        this.#done = new Promise((resolve) => {
            this.#recorder.onstop = () => resolve(new Blob(this.#chunks, { type: this.#recorder.mimeType }));
        });
        // Flush every second so a long recording doesn't sit in one giant buffer.
        this.#recorder.start(1000);
    }

    async stop(name: string) {
        this.#recorder.stop();
        const blob = await this.#done;
        download(blob, `${name}.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
    }
}
