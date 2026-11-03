import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import { WritableStream, type ReadableStream } from "@yume-chan/stream-extra";

// Keep at most this much audio queued; anything beyond is dropped to stay in sync with video.
const MAX_QUEUE_SECONDS = 0.15;
const START_DELAY_SECONDS = 0.03;

export class OpusPlayer {
    readonly context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    /** Tap for the screen recorder. */
    readonly destination = this.context.createMediaStreamDestination();
    readonly #gain = this.context.createGain();
    readonly #decoder: AudioDecoder;
    #nextTime = 0;
    #muted = false;

    constructor(stream: ReadableStream<ScrcpyMediaStreamPacket>) {
        this.#gain.connect(this.context.destination);
        this.#gain.connect(this.destination);

        this.#decoder = new AudioDecoder({
            output: (data) => this.#play(data),
            error: (e) => console.warn("Audio decoder error", e),
        });
        this.#decoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2 });

        void stream
            .pipeTo(
                new WritableStream<ScrcpyMediaStreamPacket>({
                    write: (packet) => {
                        // The stream must keep flowing even when muted, but decoding can be skipped.
                        if (packet.type !== "data" || this.#muted || this.#decoder.state !== "configured") return;
                        this.#decoder.decode(
                            new EncodedAudioChunk({ type: "key", timestamp: Number(packet.pts ?? 0n), data: packet.data }),
                        );
                    },
                }),
            )
            .catch(() => {});
    }

    get muted() {
        return this.#muted;
    }

    set muted(value: boolean) {
        this.#muted = value;
        this.#gain.gain.value = value ? 0 : 1;
        if (!value) void this.context.resume();
    }

    /** Browsers only allow audio to start after a user gesture. */
    resume() {
        if (this.context.state !== "running") void this.context.resume();
    }

    #play(data: AudioData) {
        const { numberOfChannels, numberOfFrames, sampleRate } = data;
        const buffer = this.context.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
        for (let i = 0; i < numberOfChannels; i += 1) {
            data.copyTo(buffer.getChannelData(i), { planeIndex: i, format: "f32-planar" });
        }
        data.close();

        const now = this.context.currentTime;
        let at = Math.max(this.#nextTime, now + START_DELAY_SECONDS);
        if (at - now > MAX_QUEUE_SECONDS) at = now + START_DELAY_SECONDS;
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.#gain);
        source.start(at);
        this.#nextTime = at + buffer.duration;
    }

    close() {
        if (this.#decoder.state !== "closed") this.#decoder.close();
        void this.context.close();
    }
}
