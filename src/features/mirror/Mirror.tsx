import type { Adb } from "@yume-chan/adb";
import { AndroidKeyCode, AndroidScreenPowerMode, type ScrcpyControlMessageWriter, type ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import {
    BitmapVideoFrameRenderer,
    WebCodecsVideoDecoder,
    WebGLVideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { TransformStream, WritableStream } from "@yume-chan/stream-extra";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { download, timestamp } from "../../ui/download";
import { Icon } from "../../ui/Icon";
import { OpusPlayer } from "./audio";
import { attachInput, pressKey, type VideoSize } from "./input";
import { ScreenRecorder } from "./record";
import { DEFAULT_SETTINGS, startScrcpy, type MirrorSettings, type ScrcpySession } from "./scrcpyClient";

const SETTINGS_KEY = "alp.mirror.settings";

function loadSettings(): MirrorSettings {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

interface Stats {
    fps: number;
    skipped: number;
    mbps: number;
}

export default function Mirror(props: { adb: Adb | undefined; sdk: number | undefined; serial: string | undefined }) {
    let canvas!: HTMLCanvasElement;
    let surface!: HTMLDivElement;

    const [settings, setSettings] = createSignal(loadSettings());
    const [status, setStatus] = createSignal<"idle" | "starting" | "running" | "stopped" | "error">("idle");
    const [message, setMessage] = createSignal<string>();
    const [size, setSize] = createSignal<VideoSize>();
    const [stats, setStats] = createSignal<Stats>();
    const [showStats, setShowStats] = createSignal(true);
    const [muted, setMuted] = createSignal(false);
    const [screenOff, setScreenOff] = createSignal(false);
    const [recording, setRecording] = createSignal<ScreenRecorder>();
    const [showSettings, setShowSettings] = createSignal(false);
    const [restartKey, setRestartKey] = createSignal(0);

    let controller: ScrcpyControlMessageWriter | undefined;
    let decoder: WebCodecsVideoDecoder | undefined;
    let player: OpusPlayer | undefined;

    const updateSettings = (patch: Partial<MirrorSettings>) => {
        const next = { ...settings(), ...patch };
        setSettings(next);
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch {
            // Storage unavailable (private mode); settings stay for this session only.
        }
    };

    onMount(() => {
        const detach = attachInput(surface, canvas, () => controller, size, () => player?.resume());
        onCleanup(detach);
    });

    createEffect(
        // `sdk` arrives after the connection (device props are read later), so it must be a dependency.
        on([() => props.adb, () => props.sdk, settings, restartKey], ([adb, sdk, current]) => {
            if (!adb || sdk === undefined) {
                setStatus(adb ? "starting" : "idle");
                return;
            }
            let disposed = false;
            let session: ScrcpySession | undefined;
            let statsTimer: number | undefined;
            setStatus("starting");
            setMessage(undefined);
            setSize(undefined);
            setScreenOff(false);

            void (async () => {
                try {
                    if (!WebCodecsVideoDecoder.isSupported) throw new Error("Browser ini tidak mendukung WebCodecs. Pakai Chrome / Edge terbaru.");
                    session = await startScrcpy(adb, current, sdk);
                    if (disposed) return void session.close();
                    controller = session.controller;

                    const video = await session.videoStream;
                    if (!video) throw new Error("Video stream tidak tersedia");
                    const renderer = WebGLVideoFrameRenderer.isSupported
                        ? new WebGLVideoFrameRenderer(canvas)
                        : new BitmapVideoFrameRenderer(canvas);
                    decoder = new WebCodecsVideoDecoder({ codec: video.metadata.codec, renderer });
                    decoder.sizeChanged(({ width, height }) => setSize({ width, height }));
                    if (video.width && video.height) setSize({ width: video.width, height: video.height });

                    let bytes = 0;
                    void video.stream
                        .pipeThrough(
                            new TransformStream<ScrcpyMediaStreamPacket, ScrcpyMediaStreamPacket>({
                                transform(packet, controller) {
                                    bytes += packet.data.length;
                                    controller.enqueue(packet);
                                },
                            }),
                        )
                        .pipeTo(decoder.writable)
                        .catch(() => {});

                    let lastRendered = 0;
                    let lastSkipped = 0;
                    let lastTime = performance.now();
                    statsTimer = window.setInterval(() => {
                        if (!decoder) return;
                        const now = performance.now();
                        const seconds = (now - lastTime) / 1000;
                        setStats({
                            fps: Math.round((decoder.framesRendered - lastRendered) / seconds),
                            skipped: decoder.framesSkipped - lastSkipped,
                            mbps: (bytes * 8) / 1_000_000 / seconds,
                        });
                        lastRendered = decoder.framesRendered;
                        lastSkipped = decoder.framesSkipped;
                        lastTime = now;
                        bytes = 0;
                    }, 1000);

                    const audio = await session.audioStream;
                    if (audio?.type === "success" && audio.codec.webCodecId === "opus") {
                        player = new OpusPlayer(audio.stream);
                        player.muted = muted();
                    }

                    if (session.clipboard) {
                        void session.clipboard
                            .pipeTo(
                                new WritableStream<string>({
                                    write: (text) => void navigator.clipboard.writeText(text).catch(() => {}),
                                }),
                            )
                            .catch(() => {});
                    }

                    setStatus("running");
                    void session.exited.then(() => {
                        if (!disposed) {
                            setStatus("stopped");
                            setMessage("Mirroring berhenti (device terputus atau layar dikunci oleh sistem).");
                        }
                    });
                } catch (e) {
                    if (disposed) return;
                    setStatus("error");
                    setMessage((e as Error).message);
                }
            })();

            onCleanup(() => {
                disposed = true;
                window.clearInterval(statsTimer);
                controller = undefined;
                decoder?.dispose();
                decoder = undefined;
                player?.close();
                player = undefined;
                void session?.close().catch(() => {});
                setStats(undefined);
            });
        }),
    );

    const withController = (action: (c: ScrcpyControlMessageWriter) => unknown) => () => {
        player?.resume();
        if (controller) void action(controller);
        surface.focus({ preventScroll: true });
    };

    const screenshot = async () => {
        const blob = await decoder?.snapshot();
        if (blob) download(blob, `screenshot-${props.serial ?? "device"}-${timestamp()}.png`);
    };

    const toggleRecord = async () => {
        const current = recording();
        if (current) {
            setRecording(undefined);
            await current.stop(`record-${props.serial ?? "device"}-${timestamp()}`);
            return;
        }
        setRecording(new ScreenRecorder(canvas, player?.destination.stream, settings().bitRate));
    };

    const toggleScreen = withController((c) => {
        const off = !screenOff();
        setScreenOff(off);
        return c.setScreenPowerMode(off ? AndroidScreenPowerMode.Off : AndroidScreenPowerMode.Normal);
    });

    const toggleMute = () => {
        const next = !muted();
        setMuted(next);
        if (player) player.muted = next;
    };

    return (
        <section class="mirror">
            <div class="mirror-toolbar">
                <button title="Back (klik kanan)" onClick={withController((c) => pressKey(c, AndroidKeyCode.AndroidBack))}>
                    <Icon name="back" />
                </button>
                <button title="Home (klik tengah)" onClick={withController((c) => pressKey(c, AndroidKeyCode.AndroidHome))}>
                    <Icon name="home" />
                </button>
                <button title="Recents" onClick={withController((c) => pressKey(c, AndroidKeyCode.AndroidAppSwitch))}>
                    <Icon name="recents" />
                </button>
                <span class="sep" />
                <button title="Power" onClick={withController((c) => pressKey(c, AndroidKeyCode.Power))}>
                    <Icon name="power" />
                </button>
                <button title="Volume up" onClick={withController((c) => pressKey(c, AndroidKeyCode.VolumeUp))}>
                    <Icon name="volup" />
                </button>
                <button title="Volume down" onClick={withController((c) => pressKey(c, AndroidKeyCode.VolumeDown))}>
                    <Icon name="voldown" />
                </button>
                <button title="Rotate" onClick={withController((c) => c.rotateDevice())}>
                    <Icon name="rotate" />
                </button>
                <button title="Notifications" onClick={withController((c) => c.expandNotificationPanel())}>
                    <Icon name="bell" />
                </button>
                <span class="sep" />
                <button title="Screenshot" onClick={screenshot}>
                    <Icon name="camera" />
                </button>
                <button title={recording() ? "Stop recording" : "Record screen"} classList={{ active: !!recording() }} onClick={toggleRecord}>
                    <Icon name="record" />
                </button>
                <button title={screenOff() ? "Nyalakan layar HP" : "Matikan layar HP (mirror tetap jalan)"} classList={{ active: screenOff() }} onClick={toggleScreen}>
                    <Icon name="screen" />
                </button>
                <button title={muted() ? "Unmute" : "Mute"} classList={{ active: muted() }} onClick={toggleMute}>
                    <Icon name={muted() ? "muted" : "sound"} />
                </button>
                <span class="grow" />
                <button title="Stats" classList={{ active: showStats() }} onClick={() => setShowStats(!showStats())}>
                    <Icon name="stats" />
                </button>
                <button title="Pengaturan stream" classList={{ active: showSettings() }} onClick={() => setShowSettings(!showSettings())}>
                    <Icon name="settings" />
                </button>
                <button title="Fullscreen" onClick={() => void surface.requestFullscreen().catch(() => {})}>
                    <Icon name="fullscreen" />
                </button>
            </div>

            <Show when={showSettings()}>
                <div class="mirror-settings">
                    <label>
                        Resolusi
                        <select value={settings().maxSize} onChange={(e) => updateSettings({ maxSize: Number(e.currentTarget.value) })}>
                            <option value={0}>Native</option>
                            <option value={1920}>1920</option>
                            <option value={1600}>1600</option>
                            <option value={1280}>1280</option>
                            <option value={1024}>1024</option>
                            <option value={720}>720</option>
                        </select>
                    </label>
                    <label>
                        Bitrate
                        <select value={settings().bitRate} onChange={(e) => updateSettings({ bitRate: Number(e.currentTarget.value) })}>
                            <option value={2_000_000}>2 Mbps</option>
                            <option value={4_000_000}>4 Mbps</option>
                            <option value={8_000_000}>8 Mbps</option>
                            <option value={16_000_000}>16 Mbps</option>
                            <option value={24_000_000}>24 Mbps</option>
                        </select>
                    </label>
                    <label>
                        FPS
                        <select value={settings().maxFps} onChange={(e) => updateSettings({ maxFps: Number(e.currentTarget.value) })}>
                            <option value={30}>30</option>
                            <option value={60}>60</option>
                            <option value={90}>90</option>
                            <option value={120}>120</option>
                        </select>
                    </label>
                    <label>
                        Codec
                        <select value={settings().codec} onChange={(e) => updateSettings({ codec: e.currentTarget.value as MirrorSettings["codec"] })}>
                            <option value="h264">H.264</option>
                            <option value="h265">H.265</option>
                        </select>
                    </label>
                    <label class="check">
                        <input type="checkbox" checked={settings().audio} onChange={(e) => updateSettings({ audio: e.currentTarget.checked })} />
                        Audio (Android 11+)
                    </label>
                </div>
            </Show>

            <div class="mirror-surface" ref={surface} tabIndex={0}>
                <canvas ref={canvas} classList={{ hidden: !size() }} />
                <Show when={showStats() && stats()}>
                    <div class="mirror-stats">
                        {size()?.width}×{size()?.height} · {stats()!.fps} fps · {stats()!.mbps.toFixed(1)} Mbps
                        <Show when={stats()!.skipped > 0}> · drop {stats()!.skipped}</Show>
                    </div>
                </Show>
                <Show when={status() !== "running" || !size()}>
                    <div class="mirror-overlay">
                        <Show when={status() === "idle"}>Pilih device untuk mulai mirroring.</Show>
                        <Show when={status() === "starting" || (status() === "running" && !size())}>
                            <div class="spinner" /> Memulai mirroring…
                        </Show>
                        <Show when={status() === "error" || status() === "stopped"}>
                            <p>{message()}</p>
                            <button class="primary" onClick={() => setRestartKey(restartKey() + 1)}>
                                Coba lagi
                            </button>
                        </Show>
                    </div>
                </Show>
            </div>
        </section>
    );
}
