import type { Adb } from "@yume-chan/adb";
import { deserializeAndroidLogEntry, Logcat, type AndroidLogEntry } from "@yume-chan/android-bin";
import { BufferedTransformStream, WrapReadableStream } from "@yume-chan/stream-extra";

export interface LogRow {
    id: number;
    time: string;
    pid: number;
    tid: number;
    priority: number;
    tag: string;
    message: string;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const pad3 = (n: number) => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`);

function formatTime(entry: AndroidLogEntry) {
    const date = new Date(entry.seconds * 1000);
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
        date.getSeconds(),
    )}.${pad3(Math.floor(entry.nanoseconds / 1_000_000))}`;
}

let nextId = 0;

// Only the most recent entries are replayed on start instead of the whole device buffer.
const INITIAL_TAIL = 1000;
// Batches are flushed on a timer (rAF stops in background tabs and would let the queue grow).
const FLUSH_MS = 100;

/**
 * Streams logcat in binary format and delivers rows in batches.
 * Entries below `minPriority` are dropped before they are stored, so they cost no memory.
 */
export function streamLogcat(
    adb: Adb,
    minPriority: number,
    maxPending: number,
    onBatch: (rows: LogRow[]) => void,
    onEnd: (error?: Error) => void,
) {
    // `Logcat.binary({ tail })` uses `-t`, which exits after the dump; `-T` keeps following.
    const reader = new WrapReadableStream(async () => {
        const process = await adb.subprocess.noneProtocol.spawn(["logcat", "-B", "-T", String(INITIAL_TAIL)]);
        return process.output;
    })
        .pipeThrough(new BufferedTransformStream((stream) => deserializeAndroidLogEntry(stream)))
        .getReader();
    let pending: LogRow[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const flush = () => {
        timer = undefined;
        const batch = pending;
        pending = [];
        if (batch.length) onBatch(batch);
    };

    void (async () => {
        try {
            while (!stopped) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value.priority < minPriority) continue;
                pending.push({
                    id: nextId++,
                    time: formatTime(value),
                    pid: value.pid,
                    tid: value.tid,
                    priority: value.priority,
                    tag: value.tag,
                    message: value.message,
                });
                if (pending.length > maxPending * 2) pending = pending.slice(-maxPending);
                timer ??= setTimeout(flush, FLUSH_MS);
            }
            if (!stopped) onEnd();
        } catch (e) {
            if (!stopped) onEnd(e as Error);
        }
    })();

    return () => {
        stopped = true;
        clearTimeout(timer);
        void reader.cancel().catch(() => {});
    };
}

export async function clearLogcat(adb: Adb) {
    await new Logcat(adb).clear();
}

export async function pidsOf(adb: Adb, packageName: string): Promise<Set<number>> {
    const output = await adb.subprocess.noneProtocol.spawnWaitText(["pidof", packageName]);
    return new Set(output.trim().split(/\s+/).filter(Boolean).map(Number));
}
