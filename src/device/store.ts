import type { Adb } from "@yume-chan/adb";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { detectSource, type DeviceEntry, type DeviceSource, type TransportMode } from "../transport";

export interface DeviceInfo {
    model: string;
    manufacturer: string;
    release: string;
    sdk: number;
}

const [mode, setMode] = createSignal<TransportMode | "detecting">("detecting");
const [source, setSource] = createSignal<DeviceSource>();
const [devices, setDevices] = createSignal<DeviceEntry[]>([]);
const [selectedId, setSelectedId] = createSignal<string>();
const [adb, setAdb] = createSignal<Adb>();
const [info, setInfo] = createSignal<DeviceInfo>();
const [connecting, setConnecting] = createSignal(false);
const [error, setError] = createSignal<string>();

export { mode, source, devices, selectedId, setSelectedId, adb, info, connecting, error, setError };

// One live connection per device, shared by every panel.
const connections = new Map<string, Promise<Adb>>();

function dropConnection(id: string) {
    const pending = connections.get(id);
    connections.delete(id);
    void pending?.then((value) => value.close()).catch(() => {});
}

function connect(entry: DeviceEntry): Promise<Adb> {
    let pending = connections.get(entry.id);
    if (!pending) {
        pending = entry.open();
        connections.set(entry.id, pending);
        pending.then(
            (value) => {
                void value.disconnected.then(() => {
                    if (connections.get(entry.id) === pending) connections.delete(entry.id);
                    if (adb() === value) setAdb(undefined);
                });
            },
            () => connections.delete(entry.id),
        );
    }
    return pending;
}

async function readInfo(device: Adb): Promise<DeviceInfo> {
    const [model, manufacturer, release, sdk] = await Promise.all([
        device.getProp("ro.product.model"),
        device.getProp("ro.product.manufacturer"),
        device.getProp("ro.build.version.release"),
        device.getProp("ro.build.version.sdk"),
    ]);
    return { model, manufacturer, release, sdk: Number(sdk) };
}

export async function requestUsbDevice() {
    try {
        await source()?.request?.();
    } catch (e) {
        // Closing the browser's picker without choosing a device is not an error.
        if ((e as Error).name !== "NotFoundError") setError((e as Error).message);
    }
}

export function reconnect() {
    const id = selectedId();
    if (id) dropConnection(id);
    setAdb(undefined);
    setSelectedId(undefined);
    queueMicrotask(() => setSelectedId(id));
}

createRoot(() => {
    void (async () => {
        const detected = await detectSource();
        if (!detected) {
            setMode("none");
            return;
        }
        setSource(detected);
        setMode(detected.mode);
        try {
            await detected.watch(
                (list) => {
                    setDevices(list);
                    for (const id of connections.keys()) {
                        if (!list.some((d) => d.id === id && d.state === "device")) dropConnection(id);
                    }
                    const current = selectedId();
                    if (!current || !list.some((d) => d.id === current)) {
                        setSelectedId(list.find((d) => d.state === "device")?.id ?? list[0]?.id);
                    }
                },
                (e) => setError(e.message),
            );
        } catch (e) {
            setError((e as Error).message);
        }
    })();

    // Re-connect when the selected device (or its state) changes.
    createEffect(
        on(
            () => {
                const entry = devices().find((d) => d.id === selectedId());
                return entry ? `${entry.id}|${entry.state}` : undefined;
            },
            async (key) => {
                setAdb(undefined);
                setInfo(undefined);
                setError(undefined);
                const entry = devices().find((d) => d.id === selectedId());
                if (!key || !entry || entry.state !== "device") return;
                setConnecting(true);
                try {
                    const value = await connect(entry);
                    if (selectedId() !== entry.id) return;
                    setAdb(value);
                    setInfo(await readInfo(value));
                } catch (e) {
                    if (selectedId() === entry.id) setError((e as Error).message);
                } finally {
                    setConnecting(false);
                }
            },
        ),
    );
});
