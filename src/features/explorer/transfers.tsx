import { createSignal, For, Show } from "solid-js";
import { formatBytes } from "../../ui/download";

interface Task {
    id: number;
    label: string;
    total: number;
    done: number;
    error?: string;
    finished: boolean;
}

export function useTransfers() {
    const [tasks, setTasks] = createSignal<Task[]>([]);
    let nextId = 0;
    // Progress callbacks fire per chunk; only repaint once per frame.
    const progressMap = new Map<number, number>();
    let frame = 0;

    const update = (id: number, patch: Partial<Task>) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const removeLater = (id: number, ms: number) => setTimeout(() => setTasks((list) => list.filter((t) => t.id !== id)), ms);

    return {
        tasks,
        start(label: string, total: number) {
            const id = nextId++;
            setTasks((list) => [...list, { id, label, total, done: 0, finished: false }]);
            return id;
        },
        progress(id: number, done: number) {
            progressMap.set(id, done);
            frame ||= requestAnimationFrame(() => {
                frame = 0;
                setTasks((list) => list.map((t) => (progressMap.has(t.id) ? { ...t, done: progressMap.get(t.id)! } : t)));
                progressMap.clear();
            });
        },
        finish(id: number) {
            update(id, { finished: true });
            removeLater(id, 1500);
        },
        fail(id: number, error: string) {
            update(id, { finished: true, error });
            removeLater(id, 8000);
        },
    };
}

export type TransfersState = ReturnType<typeof useTransfers>;

export function Transfers(props: { state: TransfersState }) {
    return (
        <Show when={props.state.tasks().length}>
            <div class="transfers">
                <For each={props.state.tasks()}>
                    {(task) => (
                        <div class="transfer" classList={{ error: !!task.error }}>
                            <span class="label">{task.label}</span>
                            <Show when={!task.error} fallback={<span class="muted">{task.error}</span>}>
                                <progress max={task.total || 1} value={task.finished ? task.total || 1 : task.done} />
                                <span class="muted">
                                    {formatBytes(task.done)}
                                    {task.total ? ` / ${formatBytes(task.total)}` : ""}
                                </span>
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </Show>
    );
}
