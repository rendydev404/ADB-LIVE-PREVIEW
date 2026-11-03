import type { Adb, AdbSyncEntry } from "@yume-chan/adb";
import { LinuxFileType } from "@yume-chan/adb";
import { WritableStream } from "@yume-chan/stream-extra";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { download, formatBytes } from "../../ui/download";
import { Icon } from "../../ui/Icon";
import { fileStream } from "../../ui/fileStream";
import { Transfers, useTransfers } from "./transfers";

const START_PATH = "/sdcard";

const join = (dir: string, name: string) => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);
const parent = (path: string) => path.replace(/\/[^/]+\/?$/, "") || "/";

interface Row {
    name: string;
    path: string;
    isDir: boolean;
    isLink: boolean;
    size: number;
    mtime: Date;
    permission: string;
}

function permissionString(mode: number) {
    const chars = "rwxrwxrwx";
    let out = "";
    for (let i = 0; i < 9; i += 1) out += mode & (1 << (8 - i)) ? chars[i] : "-";
    return out;
}

function toRow(dir: string, entry: AdbSyncEntry): Row {
    return {
        name: entry.name,
        path: join(dir, entry.name),
        isDir: entry.type === LinuxFileType.Directory,
        isLink: entry.type === LinuxFileType.Link,
        size: Number(entry.size),
        mtime: new Date(Number(entry.mtime) * 1000),
        permission: permissionString(entry.permission),
    };
}


export default function Explorer(props: { adb: Adb }) {
    const [path, setPath] = createSignal(START_PATH);
    const [pathInput, setPathInput] = createSignal(START_PATH);
    const [rows, setRows] = createSignal<Row[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string>();
    const [selected, setSelected] = createSignal<string>();
    const [dragOver, setDragOver] = createSignal(false);
    const transfers = useTransfers();

    const load = async () => {
        const dir = path();
        setLoading(true);
        setError(undefined);
        const sync = await props.adb.sync();
        try {
            const entries = await sync.readdir(dir);
            if (dir !== path()) return;
            setRows(
                entries
                    .filter((entry) => entry.name !== "." && entry.name !== "..")
                    .map((entry) => toRow(dir, entry))
                    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)),
            );
        } catch (e) {
            setRows([]);
            setError((e as Error).message);
        } finally {
            await sync.dispose();
            setLoading(false);
        }
    };

    createEffect(on([path, () => props.adb], () => void load()));

    const open = async (row: Row) => {
        if (row.isDir) return navigate(row.path);
        if (row.isLink) {
            const sync = await props.adb.sync();
            try {
                if (await sync.isDirectory(row.path)) return navigate(row.path);
            } finally {
                await sync.dispose();
            }
        }
        await pull(row);
    };

    const navigate = (next: string) => {
        setSelected(undefined);
        setPath(next);
        setPathInput(next);
    };

    const pull = async (row: Row) => {
        const task = transfers.start(`⬇ ${row.name}`, row.size);
        const sync = await props.adb.sync();
        try {
            const source = sync.read(row.path);
            // Prefer streaming straight to disk; fall back to an in-memory Blob.
            const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
            if (picker) {
                let handle: FileSystemFileHandle;
                try {
                    handle = await picker({ suggestedName: row.name });
                } catch {
                    transfers.finish(task);
                    await source.cancel();
                    return;
                }
                const writable = await handle.createWritable();
                let received = 0;
                await source.pipeTo(
                    new WritableStream<Uint8Array>({
                        async write(chunk) {
                            received += chunk.length;
                            transfers.progress(task, received);
                            await writable.write(chunk as Uint8Array<ArrayBuffer>);
                        },
                        close: () => writable.close(),
                        abort: () => writable.abort(),
                    }),
                );
            } else {
                const chunks: Uint8Array<ArrayBuffer>[] = [];
                let received = 0;
                await source.pipeTo(
                    new WritableStream<Uint8Array>({
                        write(chunk) {
                            received += chunk.length;
                            transfers.progress(task, received);
                            chunks.push(chunk.slice() as Uint8Array<ArrayBuffer>);
                        },
                    }),
                );
                download(new Blob(chunks), row.name);
            }
            transfers.finish(task);
        } catch (e) {
            transfers.fail(task, (e as Error).message);
        } finally {
            await sync.dispose();
        }
    };

    const push = async (files: Iterable<File>) => {
        for (const file of files) {
            const target = join(path(), file.name);
            const task = transfers.start(`⬆ ${file.name}`, file.size);
            const sync = await props.adb.sync();
            try {
                await sync.write({
                    filename: target,
                    file: fileStream(file, (bytes) => transfers.progress(task, bytes)),
                    mtime: Math.floor(file.lastModified / 1000),
                });
                transfers.finish(task);
            } catch (e) {
                transfers.fail(task, (e as Error).message);
            } finally {
                await sync.dispose();
            }
        }
        await load();
    };

    const shell = (args: string[]) => props.adb.subprocess.noneProtocol.spawnWaitText(args);

    const remove = async (row: Row) => {
        if (!confirm(`Hapus ${row.path}?`)) return;
        const output = await props.adb.rm(row.path, { recursive: row.isDir, force: true });
        if (output.trim()) setError(output.trim());
        await load();
    };

    const rename = async (row: Row) => {
        const name = prompt("Nama baru", row.name);
        if (!name || name === row.name) return;
        const output = await shell(["mv", row.path, join(path(), name)]);
        if (output.trim()) setError(output.trim());
        await load();
    };

    const mkdir = async () => {
        const name = prompt("Nama folder baru");
        if (!name) return;
        const output = await shell(["mkdir", "-p", join(path(), name)]);
        if (output.trim()) setError(output.trim());
        await load();
    };

    let fileInput!: HTMLInputElement;

    return (
        <div
            class="explorer"
            classList={{ dragover: dragOver() }}
            onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer?.files.length) void push(e.dataTransfer.files);
            }}
        >
            <div class="panel-toolbar">
                <button title="Folder atas" onClick={() => navigate(parent(path()))}>
                    <Icon name="up" />
                </button>
                <button title="Refresh" onClick={() => void load()}>
                    <Icon name="refresh" />
                </button>
                <input
                    class="grow mono"
                    value={pathInput()}
                    onInput={(e) => setPathInput(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && navigate(pathInput() || "/")}
                />
                <button title="Folder baru" onClick={mkdir}>
                    <Icon name="plus" />
                </button>
                <button title="Upload file" onClick={() => fileInput.click()}>
                    <Icon name="upload" />
                </button>
                <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                        if (e.currentTarget.files) void push([...e.currentTarget.files]);
                        e.currentTarget.value = "";
                    }}
                />
            </div>
            <Show when={error()}>
                <div class="hint error">{error()}</div>
            </Show>
            <div class="table-scroll">
                <table class="files">
                    <thead>
                        <tr>
                            <th>Nama</th>
                            <th class="num">Ukuran</th>
                            <th>Diubah</th>
                            <th>Izin</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        <For each={rows()}>
                            {(row) => (
                                <tr classList={{ selected: selected() === row.path }} onClick={() => setSelected(row.path)} onDblClick={() => void open(row)}>
                                    <td class="name">
                                        <Icon name={row.isDir ? "folder" : "file"} size={16} />
                                        {row.name}
                                        {row.isLink ? " ↗" : ""}
                                    </td>
                                    <td class="num">{row.isDir ? "" : formatBytes(row.size)}</td>
                                    <td class="muted">{row.mtime.toLocaleString()}</td>
                                    <td class="mono muted">{row.permission}</td>
                                    <td class="actions">
                                        <Show when={!row.isDir}>
                                            <button title="Download" onClick={() => void pull(row)}>
                                                <Icon name="download" size={16} />
                                            </button>
                                        </Show>
                                        <button title="Rename" onClick={() => void rename(row)}>
                                            <Icon name="edit" size={16} />
                                        </button>
                                        <button title="Hapus" onClick={() => void remove(row)}>
                                            <Icon name="trash" size={16} />
                                        </button>
                                    </td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
                <Show when={!loading() && !rows().length && !error()}>
                    <div class="hint">Folder kosong. Seret file ke sini untuk upload.</div>
                </Show>
            </div>
            <Transfers state={transfers} />
        </div>
    );
}
