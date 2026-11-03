import type { ReadableStream } from "@yume-chan/stream-extra";

// Streams `file` to the device without loading it fully into memory.
export function fileStream(file: File, onProgress: (bytes: number) => void): ReadableStream<Uint8Array> {
    let sent = 0;
    return file.stream().pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                sent += chunk.length;
                onProgress(sent);
                controller.enqueue(chunk);
            },
        }),
    ) as unknown as ReadableStream<Uint8Array>;
}
