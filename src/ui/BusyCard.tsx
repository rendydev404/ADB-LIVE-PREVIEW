import { createSignal } from "solid-js";
import { reconnect } from "../device/store";
import { Icon } from "./Icon";

// Full path, because Android Studio does not add platform-tools to PATH.
const KILL_COMMAND = String.raw`& "$env:LOCALAPPDATAAndroidSdkplatform-toolsdb.exe" kill-server`;

export function BusyCard() {
    const [copied, setCopied] = createSignal(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(KILL_COMMAND);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard blocked; the command is still visible to copy by hand.
        }
    };

    return (
        <div class="busy">
            <div class="busy-card">
                <span class="busy-icon">
                    <Icon name="usb" size={26} />
                </span>
                <h2>HP terdeteksi, tapi USB-nya sedang dipakai program lain</h2>
                <p class="busy-lead">
                    Di Windows, satu HP hanya bisa dipegang oleh satu program. Biasanya yang memegangnya adalah <b>ADB server</b> dari Android Studio, scrcpy,
                    atau PC Suite bawaan HP.
                </p>

                <div class="busy-options">
                    <section>
                        <h3>
                            <span class="tag-ok">Cara 1</span> Lepaskan USB dari ADB
                        </h3>
                        <ol>
                            <li>Tutup Android Studio, scrcpy, Vysor, atau PC Suite.</li>
                            <li>
                                Hentikan proses <b>adb.exe</b>. Cara termudah: buka <b>Task Manager</b> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd>) →
                                tab <b>Details</b> → pilih <code>adb.exe</code> → <b>End task</b>.
                                <span class="muted small block-line">Atau jalankan ini di PowerShell:</span>
                                <div class="cmd">
                                    <code>{KILL_COMMAND}</code>
                                    <button title="Salin perintah" onClick={copy}>
                                        {copied() ? "Tersalin ✓" : "Salin"}
                                    </button>
                                </div>
                            </li>
                            <li>
                                Klik <b>Coba lagi</b> di bawah.
                            </li>
                        </ol>
                        <p class="muted small">Android Studio yang masih terbuka akan menyalakan ADB lagi secara otomatis, jadi pastikan sudah ditutup.</p>
                    </section>
                    <section>
                        <h3>
                            <span class="tag-info">Cara 2</span> Tetap pakai Android Studio
                        </h3>
                        <p>
                            Jalankan versi lokal dari source code (<code>npm start</code>), lalu buka <code>http://localhost:8087</code>. Versi lokal memakai ADB
                            server yang sama dengan Android Studio, jadi keduanya bisa dipakai bersamaan.
                        </p>
                    </section>
                </div>

                <button class="primary big" onClick={reconnect}>
                    <Icon name="refresh" /> Coba lagi
                </button>
            </div>
        </div>
    );
}
