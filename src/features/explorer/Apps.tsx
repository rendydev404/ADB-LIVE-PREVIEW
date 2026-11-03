import type { Adb } from "@yume-chan/adb";
import { PackageManager, type PackageManagerListPackagesResult } from "@yume-chan/android-bin";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { Icon } from "../../ui/Icon";
import { fileStream } from "../../ui/fileStream";
import { Transfers, useTransfers } from "./transfers";

interface AppRow extends PackageManagerListPackagesResult {
    system: boolean;
}

export default function Apps(props: { adb: Adb }) {
    const [apps, setApps] = createSignal<AppRow[]>([]);
    const [showSystem, setShowSystem] = createSignal(false);
    const [search, setSearch] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [message, setMessage] = createSignal<{ text: string; error?: boolean }>();
    const [dragOver, setDragOver] = createSignal(false);
    const transfers = useTransfers();

    const pm = createMemo(() => new PackageManager(props.adb));

    const load = async () => {
        setLoading(true);
        try {
            // Third-party list first (fast path); system list only when asked for.
            const thirdParty = new Set<string>();
            for await (const item of pm().listPackages({ listThirdParty: true })) thirdParty.add(item.packageName);
            const list: AppRow[] = [];
            for await (const item of pm().listPackages(showSystem() ? { showVersionCode: true } : { listThirdParty: true, showVersionCode: true })) {
                list.push({ ...item, system: !thirdParty.has(item.packageName) });
            }
            list.sort((a, b) => a.packageName.localeCompare(b.packageName));
            setApps(list);
        } catch (e) {
            setMessage({ text: (e as Error).message, error: true });
        } finally {
            setLoading(false);
        }
    };

    createEffect(on([() => props.adb, showSystem], () => void load()));

    const filtered = createMemo(() => {
        const q = search().toLowerCase();
        return q ? apps().filter((app) => app.packageName.toLowerCase().includes(q)) : apps();
    });

    const run = async (label: string, args: string[]) => {
        const output = (await props.adb.subprocess.noneProtocol.spawnWaitText(args)).trim();
        setMessage({ text: `${label}: ${output || "OK"}`, error: /error|fail|exception/i.test(output) });
    };

    const install = async (files: Iterable<File>) => {
        for (const file of files) {
            if (!file.name.toLowerCase().endsWith(".apk")) {
                setMessage({ text: `${file.name} bukan file .apk`, error: true });
                continue;
            }
            const task = transfers.start(`Install ${file.name}`, file.size);
            try {
                const stream = () => fileStream(file, (bytes) => transfers.progress(task, bytes));
                try {
                    // Streams straight into the package installer (Android 7+), no temp file.
                    await pm().installStream(file.size, stream(), { requestDowngrade: true, allowTest: true });
                } catch (e) {
                    if (!/not supported|unknown option|-S/i.test((e as Error).message)) throw e;
                    await pm().pushAndInstallStream(stream(), { requestDowngrade: true, allowTest: true });
                }
                transfers.finish(task);
                setMessage({ text: `${file.name} terpasang` });
            } catch (e) {
                transfers.fail(task, (e as Error).message);
            }
        }
        await load();
    };

    const uninstall = async (app: AppRow) => {
        if (!confirm(`Uninstall ${app.packageName}?`)) return;
        try {
            await pm().uninstall(app.packageName);
            setMessage({ text: `${app.packageName} di-uninstall` });
            await load();
        } catch (e) {
            setMessage({ text: (e as Error).message, error: true });
        }
    };

    let fileInput!: HTMLInputElement;

    return (
        <div
            class="apps"
            classList={{ dragover: dragOver() }}
            onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer?.files.length) void install(e.dataTransfer.files);
            }}
        >
            <div class="panel-toolbar">
                <button title="Refresh" onClick={() => void load()}>
                    <Icon name="refresh" />
                </button>
                <input class="grow" placeholder="cari package" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
                <label class="check">
                    <input type="checkbox" checked={showSystem()} onChange={(e) => setShowSystem(e.currentTarget.checked)} />
                    System
                </label>
                <button class="primary" title="Install APK" onClick={() => fileInput.click()}>
                    <Icon name="upload" /> Install APK
                </button>
                <input
                    ref={fileInput}
                    type="file"
                    accept=".apk"
                    multiple
                    hidden
                    onChange={(e) => {
                        if (e.currentTarget.files) void install([...e.currentTarget.files]);
                        e.currentTarget.value = "";
                    }}
                />
            </div>
            <Show when={message()}>
                <div class="hint" classList={{ error: message()!.error }}>
                    {message()!.text}
                </div>
            </Show>
            <div class="table-scroll">
                <table class="files">
                    <thead>
                        <tr>
                            <th>Package</th>
                            <th class="num">Versi</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        <For each={filtered()}>
                            {(app) => (
                                <tr>
                                    <td class="name mono">
                                        {app.packageName}
                                        <Show when={app.system}>
                                            <span class="badge">system</span>
                                        </Show>
                                    </td>
                                    <td class="num muted">{app.versionCode ?? ""}</td>
                                    <td class="actions">
                                        <button
                                            title="Buka"
                                            onClick={() => void run("Launch", ["monkey", "-p", app.packageName, "-c", "android.intent.category.LAUNCHER", "1"])}
                                        >
                                            <Icon name="launch" size={16} />
                                        </button>
                                        <button title="Force stop" onClick={() => void run("Force stop", ["am", "force-stop", app.packageName])}>
                                            <Icon name="stop" size={16} />
                                        </button>
                                        <button
                                            title="Clear data"
                                            onClick={() => confirm(`Hapus data ${app.packageName}?`) && void run("Clear data", ["pm", "clear", app.packageName])}
                                        >
                                            <Icon name="clear" size={16} />
                                        </button>
                                        <button title="Uninstall" onClick={() => void uninstall(app)}>
                                            <Icon name="trash" size={16} />
                                        </button>
                                    </td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
                <Show when={!loading() && !filtered().length}>
                    <div class="hint">Tidak ada aplikasi. Seret file .apk ke sini untuk install.</div>
                </Show>
            </div>
            <Transfers state={transfers} />
        </div>
    );
}
