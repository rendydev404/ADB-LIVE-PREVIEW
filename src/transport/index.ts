import { Adb, AdbDaemonTransport, AdbServerClient } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { WebSocketServerConnector } from "./serverConnector";

declare global {
    interface Window {
        __ALP__?: { token: string; adbPort: number };
    }
}

export type TransportMode = "server" | "webusb" | "none";

export interface DeviceEntry {
    id: string;
    serial: string;
    name: string;
    state: AdbServerClient.ConnectionState;
    mode: Exclude<TransportMode, "none">;
    open(): Promise<Adb>;
}

export interface DeviceSource {
    mode: Exclude<TransportMode, "none">;
    /** Calls `onChange` with the full list whenever it changes. Returns a stop function. */
    watch(onChange: (devices: DeviceEntry[]) => void, onError: (error: Error) => void): Promise<() => void>;
    /** WebUSB only: shows the browser's device picker. */
    request?(): Promise<void>;
}

async function serverAvailable(): Promise<boolean> {
    if (!window.__ALP__) return false;
    try {
        const response = await fetch("/api/health", { cache: "no-store" });
        return response.ok;
    } catch {
        return false;
    }
}

function createServerSource(token: string): DeviceSource {
    const client = new AdbServerClient(new WebSocketServerConnector(token));
    const toEntry = (device: AdbServerClient.Device): DeviceEntry => ({
        id: `server:${device.serial}`,
        serial: device.serial,
        name: device.model?.replace(/_/g, " ") ?? device.serial,
        state: device.state,
        mode: "server",
        open: () => client.createAdb({ serial: device.serial }),
    });

    return {
        mode: "server",
        async watch(onChange, onError) {
            const observer = await client.trackDevices({ includeStates: ["device", "unauthorized", "offline"] });
            onChange(observer.current.map(toEntry));
            observer.onListChange((list) => onChange(list.map(toEntry)));
            observer.onError(onError);
            return () => void observer.stop();
        },
    };
}

const credentialStore = new AdbWebCredentialStore("Android Live Preview");

function createWebUsbSource(manager: AdbDaemonWebUsbDeviceManager): DeviceSource {
    const toEntry = (device: AdbDaemonWebUsbDevice): DeviceEntry => ({
        id: `usb:${device.serial}`,
        serial: device.serial,
        name: device.name || device.serial,
        state: "device",
        mode: "webusb",
        async open() {
            let connection;
            try {
                connection = await device.connect();
            } catch (e) {
                if (e instanceof AdbDaemonWebUsbDevice.DeviceBusyError || /claim|access denied|in use/i.test((e as Error).message)) {
                    throw new Error(
                        "USB sedang dipakai program lain (Android Studio / adb). Tutup Android Studio atau jalankan `adb kill-server`, atau pakai mode server (`npm start`).",
                    );
                }
                throw e;
            }
            const transport = await AdbDaemonTransport.authenticate({
                serial: device.serial,
                connection,
                credentialStore,
            });
            return new Adb(transport);
        },
    });

    let refresh: (() => Promise<void>) | undefined;

    return {
        mode: "webusb",
        async watch(onChange) {
            refresh = async () => onChange((await manager.getDevices()).map(toEntry));
            // getDevices() also sees devices granted through request(), unlike a fixed observer list.
            const handler = () => void refresh?.();
            navigator.usb.addEventListener("connect", handler);
            navigator.usb.addEventListener("disconnect", handler);
            await refresh();
            return () => {
                navigator.usb.removeEventListener("connect", handler);
                navigator.usb.removeEventListener("disconnect", handler);
            };
        },
        async request() {
            await manager.requestDevice();
            await refresh?.();
        },
    };
}

export async function detectSource(): Promise<DeviceSource | undefined> {
    if (await serverAvailable()) return createServerSource(window.__ALP__!.token);
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (manager) return createWebUsbSource(manager);
    return undefined;
}
