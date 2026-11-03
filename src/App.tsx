import { createSignal, For, lazy, Match, Show, Suspense, Switch } from "solid-js";
import {
    adb,
    busy,
    connecting,
    devices,
    error,
    info,
    mode,
    reconnect,
    requestUsbDevice,
    selectedId,
    setSelectedId,
} from "./device/store";
import Mirror from "./features/mirror/Mirror";
import { BusyCard } from "./ui/BusyCard";
import { Guide } from "./ui/Guide";
import { Icon } from "./ui/Icon";

// Side panels load on first open to keep the initial bundle small.
const Logcat = lazy(() => import("./features/logcat/Logcat"));
const Explorer = lazy(() => import("./features/explorer/Explorer"));
const Apps = lazy(() => import("./features/explorer/Apps"));

type Tab = "logcat" | "files" | "apps";
const PANEL_KEY = "alp.panel";

function loadPanel(): { tab: Tab; open: boolean; width: number } {
    try {
        return { tab: "logcat", open: true, width: 640, ...JSON.parse(localStorage.getItem(PANEL_KEY) ?? "{}") };
    } catch {
        return { tab: "logcat", open: true, width: 640 };
    }
}

export default function App() {
    const saved = loadPanel();
    const [tab, setTab] = createSignal<Tab>(saved.tab);
    const [panelOpen, setPanelOpen] = createSignal(saved.open);
    const [panelWidth, setPanelWidth] = createSignal(saved.width);
    // Panels stay mounted after their first visit so Logcat keeps collecting while hidden.
    const [visited, setVisited] = createSignal<ReadonlySet<Tab>>(new Set(saved.open ? [saved.tab] : []));
    const markVisited = (next: Tab) => setVisited((set) => new Set(set).add(next));

    const persist = () => {
        try {
            localStorage.setItem(PANEL_KEY, JSON.stringify({ tab: tab(), open: panelOpen(), width: panelWidth() }));
        } catch {
            // Not persisted in private mode.
        }
    };

    let guideDialog!: HTMLDialogElement;
    const selected = () => devices().find((d) => d.id === selectedId());

    const startResize = (e: PointerEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = panelWidth();
        const move = (ev: PointerEvent) => setPanelWidth(Math.min(Math.max(startWidth + startX - ev.clientX, 320), window.innerWidth - 360));
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            persist();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const openTab = (next: Tab) => {
        if (tab() === next && panelOpen()) setPanelOpen(false);
        else {
            setTab(next);
            setPanelOpen(true);
            markVisited(next);
        }
        persist();
    };

    return (
        <div class="app">
            <aside class="sidebar">
                <div class="brand">
                    <Icon name="phone" size={20} />
                    <span>Live Preview</span>
                </div>
                <div class="mode">
                    <Switch>
                        <Match when={mode() === "detecting"}>
                            <span class="badge">mendeteksi…</span>
                        </Match>
                        <Match when={mode() === "server"}>
                            <span class="badge ok" title="Lewat ADB server yang sama dengan Android Studio">
                                Server · anti bentrok
                            </span>
                        </Match>
                        <Match when={mode() === "webusb"}>
                            <span class="badge warn" title="Langsung lewat WebUSB. Android Studio/adb harus ditutup.">
                                WebUSB
                            </span>
                        </Match>
                    </Switch>
                </div>

                <div class="devices">
                    <For each={devices()}>
                        {(device) => (
                            <button
                                class="device"
                                classList={{ selected: device.id === selectedId(), off: device.state !== "device" }}
                                onClick={() => setSelectedId(device.id)}
                            >
                                <Icon name="phone" />
                                <span class="device-text">
                                    <span class="device-name">{device.name}</span>
                                    <span class="device-sub">
                                        {device.state === "device" ? device.serial : device.state === "unauthorized" ? "Izinkan USB debugging di HP" : "offline"}
                                    </span>
                                </span>
                            </button>
                        )}
                    </For>
                    <Show when={mode() !== "detecting" && !devices().length}>
                        <p class="hint">
                            Colok HP via USB dan aktifkan <b>USB debugging</b> (Opsi pengembang). Tidak ada aplikasi yang perlu dipasang di HP.
                        </p>
                    </Show>
                    <Show when={mode() === "webusb"}>
                        <button class="primary block" onClick={requestUsbDevice}>
                            <Icon name="usb" /> Tambah device USB
                        </button>
                    </Show>
                    <Show when={mode() === "none"}>
                        <p class="hint error">
                            Server lokal tidak jalan dan browser ini tidak mendukung WebUSB. Jalankan <code>npm start</code> lalu buka http://localhost:8087, atau
                            pakai Chrome / Edge.
                        </p>
                    </Show>
                </div>

                <Show when={info()}>
                    <dl class="info">
                        <dt>Model</dt>
                        <dd>
                            {info()!.manufacturer} {info()!.model}
                        </dd>
                        <dt>Android</dt>
                        <dd>
                            {info()!.release} (API {info()!.sdk})
                        </dd>
                    </dl>
                </Show>
                <Show when={busy()}>
                    <div class="hint warn">USB sedang dipakai program lain. Lihat langkahnya di tengah layar.</div>
                </Show>
                <Show when={error()}>
                    <div class="hint error">
                        {error()}
                        <button class="block" onClick={reconnect}>
                            Hubungkan ulang
                        </button>
                    </div>
                </Show>
                <Show when={connecting()}>
                    <div class="hint">
                        <div class="spinner" /> Menghubungkan… (cek dialog izin di HP)
                    </div>
                </Show>

                <nav class="tabs">
                    <button onClick={() => guideDialog.showModal()}>
                        <Icon name="book" /> Panduan
                    </button>
                    <button classList={{ active: panelOpen() && tab() === "logcat" }} onClick={() => openTab("logcat")}>
                        <Icon name="stats" /> Logcat
                    </button>
                    <button classList={{ active: panelOpen() && tab() === "files" }} onClick={() => openTab("files")}>
                        <Icon name="folder" /> Device Explorer
                    </button>
                    <button classList={{ active: panelOpen() && tab() === "apps" }} onClick={() => openTab("apps")}>
                        <Icon name="launch" /> Aplikasi
                    </button>
                </nav>
            </aside>

            <main class="center">
                <Show
                    when={adb()}
                    fallback={
                        <Show when={!busy()} fallback={<BusyCard />}>
                        <Show when={connecting()} fallback={<Guide />}>
                            <div class="connect-wait">
                                <div class="spinner big" />
                                <h2>Menunggu izin di HP</h2>
                                <p>
                                    Tap <b>Izinkan</b> pada dialog <b>Izinkan USB debugging?</b> di HP, dan centang <b>Selalu izinkan dari komputer ini</b> supaya
                                    lain kali tersambung otomatis.
                                </p>
                            </div>
                        </Show>
                        </Show>
                    }
                >
                    <Mirror adb={adb()} sdk={info()?.sdk} serial={selected()?.serial} />
                </Show>
            </main>

            <dialog class="guide-dialog" ref={guideDialog} onClick={(e) => e.target === guideDialog && guideDialog.close()}>
                <button class="dialog-close" title="Tutup" onClick={() => guideDialog.close()}>
                    <Icon name="clear" />
                </button>
                <Guide compact />
            </dialog>

            <div class="resizer" hidden={!panelOpen()} onPointerDown={startResize} />
            <section class="panel" hidden={!panelOpen()} style={{ width: `${panelWidth()}px` }}>
                <Show when={adb()} fallback={<div class="hint">Belum ada device yang terhubung.</div>}>
                    {(device) => (
                        <Suspense fallback={<div class="hint">Memuat…</div>}>
                            <Show when={visited().has("logcat")}>
                                <div class="panel-page" hidden={tab() !== "logcat"}>
                                    <Logcat adb={device()} />
                                </div>
                            </Show>
                            <Show when={visited().has("files")}>
                                <div class="panel-page" hidden={tab() !== "files"}>
                                    <Explorer adb={device()} />
                                </div>
                            </Show>
                            <Show when={visited().has("apps")}>
                                <div class="panel-page" hidden={tab() !== "apps"}>
                                    <Apps adb={device()} />
                                </div>
                            </Show>
                        </Suspense>
                    )}
                </Show>
            </section>
        </div>
    );
}
