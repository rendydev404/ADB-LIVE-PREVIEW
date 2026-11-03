import type { Adb } from "@yume-chan/adb";
import { createEffect, createMemo, createSignal, Index, on, onCleanup, onMount, Show } from "solid-js";
import { download, timestamp } from "../../ui/download";
import { Icon } from "../../ui/Icon";
import { clearLogcat, pidsOf, streamLogcat, type LogRow } from "./logcatStream";

// ~430 B of text per row on a busy device, so 10k rows stay around 5 MB.
const MAX_ROWS = 10_000;
const TRIM_SLACK = 1_000;
const ROW_HEIGHT = 20;
const OVERSCAN = 10;
const LEVELS = ["V", "D", "I", "W", "E", "A"] as const;
// AndroidLogPriority: Verbose = 2 … Fatal = 7
const PRIORITY_CHAR: Record<number, string> = { 2: "V", 3: "D", 4: "I", 5: "W", 6: "E", 7: "A" };

interface Filter {
    minPriority: number;
    pids: Set<number> | undefined;
    tag: string;
    text: RegExp | string;
}

function matches(row: LogRow, filter: Filter) {
    if (row.priority < filter.minPriority) return false;
    if (filter.pids && !filter.pids.has(row.pid)) return false;
    if (filter.tag && !row.tag.toLowerCase().includes(filter.tag)) return false;
    if (filter.text) {
        if (typeof filter.text === "string") {
            if (!row.message.toLowerCase().includes(filter.text) && !row.tag.toLowerCase().includes(filter.text)) return false;
        } else if (!filter.text.test(row.message) && !filter.text.test(row.tag)) {
            return false;
        }
    }
    return true;
}

function formatRow(row: LogRow) {
    return `${row.time} ${row.pid} ${row.tid} ${PRIORITY_CHAR[row.priority] ?? "?"} ${row.tag}: ${row.message}`;
}

export default function LogcatPanel(props: { adb: Adb }) {
    let viewport!: HTMLDivElement;

    // Rows live outside the reactive system; `version` tells the view to re-read them.
    let rows: LogRow[] = [];
    let filtered: LogRow[] = [];
    const [version, setVersion] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [height, setHeight] = createSignal(0);
    const [follow, setFollow] = createSignal(true);
    const [paused, setPaused] = createSignal(false);
    const [streamError, setStreamError] = createSignal<string>();

    // Info by default: Verbose/Debug is mostly framework noise and the bulk of the volume.
    const [level, setLevel] = createSignal(4);
    const [packageName, setPackageName] = createSignal("");
    const [pids, setPids] = createSignal<Set<number>>();
    const [tag, setTag] = createSignal("");
    const [query, setQuery] = createSignal("");
    const [regex, setRegex] = createSignal(false);
    const [regexError, setRegexError] = createSignal(false);

    const filter = createMemo<Filter>(() => {
        let text: RegExp | string = query().toLowerCase();
        setRegexError(false);
        if (regex() && query()) {
            try {
                text = new RegExp(query(), "i");
            } catch {
                setRegexError(true);
                text = "";
            }
        }
        return { minPriority: level(), pids: packageName() ? (pids() ?? new Set()) : undefined, tag: tag().toLowerCase(), text };
    });

    const refilter = () => {
        const current = filter();
        filtered = rows.filter((row) => matches(row, current));
        setVersion((v) => v + 1);
    };

    createEffect(on(filter, refilter, { defer: true }));

    // Resolve the package to its process ids, and keep following restarts of the app.
    createEffect(() => {
        const name = packageName().trim();
        setPids(undefined);
        if (!name) return;
        let alive = true;
        const resolve = async () => {
            try {
                const next = await pidsOf(props.adb, name);
                if (alive) setPids(next);
            } catch {
                // Device busy; retry on next tick.
            }
        };
        void resolve();
        const timer = setInterval(resolve, 2000);
        onCleanup(() => {
            alive = false;
            clearInterval(timer);
        });
    });

    const append = (batch: LogRow[]) => {
        rows.push(...batch);
        const current = filter();
        for (const row of batch) if (matches(row, current)) filtered.push(row);
        if (rows.length > MAX_ROWS + TRIM_SLACK) {
            rows = rows.slice(rows.length - MAX_ROWS);
            const firstId = rows[0].id;
            let start = 0;
            while (start < filtered.length && filtered[start].id < firstId) start += 1;
            filtered = filtered.slice(start);
        }
        if (!paused()) setVersion((v) => v + 1);
    };

    createEffect(
        on(
            // Level is applied at ingest, so changing it restarts the stream (replaying the recent tail).
            () => [props.adb, level()] as const,
            ([adb, minPriority]) => {
                rows = [];
                filtered = [];
                setVersion((v) => v + 1);
                setStreamError(undefined);
                const stop = streamLogcat(adb, minPriority, MAX_ROWS, append, (e) => setStreamError(e ? e.message : "Logcat berhenti"));
                onCleanup(stop);
            },
        ),
    );

    onMount(() => {
        const observer = new ResizeObserver(() => setHeight(viewport.clientHeight));
        observer.observe(viewport);
        onCleanup(() => observer.disconnect());
    });

    const total = createMemo(() => (version(), filtered.length));

    // Stick to the bottom while following, like Android Studio.
    createEffect(
        on(total, () => {
            if (follow()) queueMicrotask(() => (viewport.scrollTop = viewport.scrollHeight));
        }),
    );

    const visible = createMemo(() => {
        version();
        const start = Math.max(0, Math.floor(scrollTop() / ROW_HEIGHT) - OVERSCAN);
        const end = Math.min(filtered.length, Math.ceil((scrollTop() + height()) / ROW_HEIGHT) + OVERSCAN);
        return { start, items: filtered.slice(start, end) };
    });

    const onScroll = () => {
        setScrollTop(viewport.scrollTop);
        setFollow(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - ROW_HEIGHT * 2);
    };

    const clear = async () => {
        rows = [];
        filtered = [];
        setVersion((v) => v + 1);
        await clearLogcat(props.adb).catch(() => {});
    };

    const exportLog = () => {
        download(new Blob([filtered.map(formatRow).join("\n")], { type: "text/plain" }), `logcat-${timestamp()}.txt`);
    };

    return (
        <div class="logcat">
            <div class="panel-toolbar">
                <button title={paused() ? "Lanjutkan" : "Pause"} classList={{ active: paused() }} onClick={() => {
                    setPaused(!paused());
                    if (!paused()) setVersion((v) => v + 1);
                }}>
                    <Icon name={paused() ? "play" : "pause"} />
                </button>
                <button title="Clear logcat" onClick={clear}>
                    <Icon name="trash" />
                </button>
                <button title="Export" onClick={exportLog}>
                    <Icon name="download" />
                </button>
                <select title="Level minimum" value={level()} onChange={(e) => setLevel(Number(e.currentTarget.value))}>
                    <Index each={LEVELS}>{(char, i) => <option value={i + 2}>{char()}</option>}</Index>
                </select>
                <input class="w-pkg" placeholder="package (com.example.app)" value={packageName()} onChange={(e) => setPackageName(e.currentTarget.value)} />
                <input class="w-tag" placeholder="tag" value={tag()} onInput={(e) => setTag(e.currentTarget.value)} />
                <input
                    class="grow"
                    classList={{ invalid: regexError() }}
                    placeholder={regex() ? "regex" : "cari pesan / tag"}
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                />
                <button title="Regex" classList={{ active: regex() }} onClick={() => setRegex(!regex())}>
                    .*
                </button>
                <span class="muted count">{total().toLocaleString()} baris</span>
            </div>
            <Show when={packageName() && pids()?.size === 0}>
                <div class="hint">Proses {packageName()} belum berjalan, menunggu…</div>
            </Show>
            <Show when={streamError()}>
                <div class="hint error">{streamError()}</div>
            </Show>
            <div class="log-viewport" ref={viewport} onScroll={onScroll}>
                <div style={{ height: `${total() * ROW_HEIGHT}px`, position: "relative" }}>
                    <div class="log-window" style={{ transform: `translateY(${visible().start * ROW_HEIGHT}px)` }}>
                        <Index each={visible().items}>
                            {(row) => (
                                <div class={`log-row p${row().priority}`} title={row().message} onDblClick={() => void navigator.clipboard.writeText(formatRow(row()))}>
                                    <span class="t">{row().time}</span>
                                    <span class="pid">{row().pid}-{row().tid}</span>
                                    <span class="lv">{PRIORITY_CHAR[row().priority] ?? "?"}</span>
                                    <span class="tag">{row().tag}</span>
                                    <span class="msg">{row().message}</span>
                                </div>
                            )}
                        </Index>
                    </div>
                </div>
            </div>
            <Show when={!follow()}>
                <button class="jump" onClick={() => {
                    setFollow(true);
                    viewport.scrollTop = viewport.scrollHeight;
                }}>
                    ↓ Ke log terbaru
                </button>
            </Show>
        </div>
    );
}
