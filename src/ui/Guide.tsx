import { For, Show, type JSX } from "solid-js";
import { mode, requestUsbDevice } from "../device/store";
import { Icon, type IconName } from "./Icon";

const webUsbAvailable = typeof navigator !== "undefined" && "usb" in navigator;

interface Check {
    label: string;
    ok: boolean;
    detail: string;
}

function checks(): Check[] {
    return [
        {
            label: "Browser mendukung WebUSB",
            ok: webUsbAvailable,
            detail: webUsbAvailable ? "Chrome / Edge terdeteksi." : "Buka halaman ini di Google Chrome atau Microsoft Edge versi desktop.",
        },
        {
            label: "Koneksi aman (HTTPS)",
            ok: window.isSecureContext,
            detail: window.isSecureContext ? "WebUSB diizinkan di halaman ini." : "WebUSB hanya berjalan di HTTPS atau localhost.",
        },
    ];
}

interface Requirement {
    icon: IconName;
    title: string;
    body: JSX.Element;
}

const REQUIREMENTS: Requirement[] = [
    {
        icon: "screen",
        title: "Browser Chrome atau Edge (desktop)",
        body: <>Firefox dan Safari belum mendukung WebUSB.</>,
    },
    {
        icon: "phone",
        title: "USB debugging aktif di HP",
        body: <>Wajib, sama seperti di Android Studio. Caranya ada di langkah 1 di bawah.</>,
    },
    {
        icon: "stop",
        title: "Tidak ada program lain yang memakai ADB",
        body: (
            <>
                Android Studio, scrcpy, atau PC Suite bawaan HP harus ditutup. Di PC developer, hentikan juga proses <code>adb.exe</code> lewat Task
                Manager. Di PC biasa, syarat ini otomatis terpenuhi.
            </>
        ),
    },
    {
        icon: "usb",
        title: "Driver USB Windows",
        body: (
            <>
                Windows 10/11 biasanya sudah memasang driver ADB otomatis. Sebagian kecil HP atau driver bawaan merek tidak cocok dengan WebUSB, dan perlu
                satu kali install <b>Google USB Driver</b> (lihat Pemecahan masalah).
            </>
        ),
    },
];

interface Step {
    title: string;
    body: JSX.Element;
}

const FIRST_TIME: Step[] = [
    {
        title: "Aktifkan USB debugging",
        body: (
            <>
                Di HP buka <b>Setelan → Tentang ponsel</b>, ketuk <b>Nomor bentukan</b> (Build number) 7 kali sampai muncul "Anda sekarang developer".
                Lalu buka <b>Setelan → Sistem → Opsi pengembang</b> dan nyalakan <b>USB debugging</b>.
            </>
        ),
    },
    {
        title: "Colok HP ke PC",
        body: <>Pakai kabel data, bukan kabel charge saja. Kalau HP bertanya mode USB, pilih <b>Transfer file</b>.</>,
    },
    {
        title: "Klik “Tambah device USB”",
        body: <>Jendela browser akan muncul dan menampilkan daftar perangkat USB. Klik pertama ini wajib karena aturan keamanan browser.</>,
    },
    {
        title: "Pilih HP lalu klik Sambungkan",
        body: <>Nama yang muncul biasanya model HP (misalnya "V2333") atau nama mereknya.</>,
    },
    {
        title: "Tap “Izinkan” di HP",
        body: (
            <>
                Muncul dialog <b>Izinkan USB debugging?</b> di HP. Centang <b>Selalu izinkan dari komputer ini</b>, lalu tap <b>Izinkan</b>. Layar HP
                akan langsung tampil di sini.
            </>
        ),
    },
];

interface Faq {
    q: string;
    a: JSX.Element;
}

const TROUBLESHOOTING: Faq[] = [
    {
        q: "Muncul pesan “USB sedang dipakai program lain”",
        a: (
            <>
                Ada program lain yang sedang memegang koneksi ADB. Tutup Android Studio, scrcpy, Vysor, atau PC Suite (vivo, Xiaomi, Samsung Smart Switch),
                lalu hentikan proses <code>adb.exe</code> lewat <b>Task Manager → Details → End task</b>. Setelah itu cabut-colok HP dan klik{" "}
                <b>Coba lagi</b>.
            </>
        ),
    },
    {
        q: "HP tidak muncul di jendela pilihan browser",
        a: (
            <>
                <ol>
                    <li>Pastikan USB debugging menyala dan kabelnya kabel data (coba kabel atau port USB lain).</li>
                    <li>Buka notifikasi USB di HP, lalu pilih mode <b>Transfer file</b>.</li>
                    <li>
                        Kalau masih tidak muncul, driver Windows belum cocok. Unduh <b>Google USB Driver</b> dari situs developer.android.com, lalu di
                        Device Manager klik kanan perangkat HP → <b>Update driver</b> → arahkan ke folder driver tersebut.
                    </li>
                </ol>
            </>
        ),
    },
    {
        q: "Dialog “Izinkan USB debugging” tidak muncul di HP",
        a: (
            <>
                Cabut lalu colok ulang kabelnya, dan pastikan layar HP menyala dan tidak terkunci. Kalau tetap tidak muncul, buka <b>Opsi pengembang</b> →{" "}
                <b>Cabut otorisasi USB debugging</b>, lalu ulangi dari langkah 3.
            </>
        ),
    },
    {
        q: "Layar tampil tapi sentuhan / keyboard tidak berfungsi",
        a: (
            <>
                Beberapa merek mengunci input dari USB. Di <b>Xiaomi / POCO / Redmi</b>, aktifkan juga <b>USB debugging (Setelan keamanan)</b>. Di{" "}
                <b>OPPO / realme</b>, aktifkan <b>Nonaktifkan pemantauan izin</b>. Setelah itu klik <b>Hubungkan ulang</b>.
            </>
        ),
    },
    {
        q: "Layar hitam atau video tidak jalan",
        a: (
            <>
                Perbarui Chrome / Edge ke versi terbaru dan pastikan <b>Akselerasi hardware</b> menyala (Setelan browser → Sistem). Kamu juga bisa
                menurunkan resolusi atau memakai codec H.264 lewat tombol pengaturan stream.
            </>
        ),
    },
    {
        q: "Suara HP tidak terdengar",
        a: <>Audio membutuhkan Android 11 ke atas. Klik sekali di area layar HP, karena browser baru mengizinkan suara setelah ada interaksi.</>,
    },
];

export function Guide(props: { compact?: boolean }) {
    return (
        <div class="guide" classList={{ compact: props.compact }}>
            <header class="guide-hero">
                <h1>Mirror & debug HP Android langsung dari browser</h1>
                <p>Tidak perlu install aplikasi di PC maupun di HP. Colok kabel USB, izinkan sekali, dan layar HP tampil di sini.</p>
                <Show when={mode() === "webusb"}>
                    <button class="primary big" onClick={requestUsbDevice}>
                        <Icon name="usb" /> Tambah device USB
                    </button>
                </Show>
                <Show when={mode() === "server"}>
                    <p class="note ok">
                        <Icon name="phone" size={16} /> Mode server lokal aktif: memakai ADB yang sama dengan Android Studio, jadi bisa dipakai bersamaan.
                        Colok HP dan HP akan tersambung otomatis.
                    </p>
                </Show>
            </header>

            <Show when={mode() !== "server"}>
                <section class="guide-section">
                    <ul class="checks">
                        <For each={checks()}>
                            {(check) => (
                                <li classList={{ ok: check.ok, bad: !check.ok }}>
                                    <span class="dot">{check.ok ? "✓" : "!"}</span>
                                    <span>
                                        <b>{check.label}</b>
                                        <small>{check.detail}</small>
                                    </span>
                                </li>
                            )}
                        </For>
                    </ul>
                </section>
            </Show>

            <section class="guide-section">
                <h2>Syarat di PC pengguna</h2>
                <div class="req-grid">
                    <For each={REQUIREMENTS}>
                        {(req) => (
                            <div class="req">
                                <span class="req-icon">
                                    <Icon name={req.icon} />
                                </span>
                                <div>
                                    <h3>{req.title}</h3>
                                    <p>{req.body}</p>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </section>

            <section class="guide-section">
                <h2>Pertama kali memakai</h2>
                <ol class="steps">
                    <For each={FIRST_TIME}>
                        {(step, i) => (
                            <li>
                                <span class="step-num">{i() + 1}</span>
                                <div>
                                    <h3>{step.title}</h3>
                                    <p>{step.body}</p>
                                </div>
                            </li>
                        )}
                    </For>
                </ol>
            </section>

            <section class="guide-section">
                <h2>Kunjungan berikutnya</h2>
                <p class="lead">
                    HP yang sudah pernah diizinkan <b>tersambung otomatis</b> begitu halaman ini dibuka dan HP dicolok. Tidak perlu klik apa pun lagi.
                </p>
            </section>

            <section class="guide-section">
                <h2>Kontrol</h2>
                <table class="keys">
                    <tbody>
                        <tr>
                            <td>Klik / seret</td>
                            <td>Tap / swipe</td>
                        </tr>
                        <tr>
                            <td>Ctrl + seret</td>
                            <td>Pinch zoom</td>
                        </tr>
                        <tr>
                            <td>Klik kanan</td>
                            <td>Back</td>
                        </tr>
                        <tr>
                            <td>Klik tengah</td>
                            <td>Home</td>
                        </tr>
                        <tr>
                            <td>Scroll mouse</td>
                            <td>Scroll</td>
                        </tr>
                        <tr>
                            <td>Ketik / Ctrl+V</td>
                            <td>Teks ke HP / tempel clipboard PC</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section class="guide-section">
                <h2>Pemecahan masalah</h2>
                <div class="faq">
                    <For each={TROUBLESHOOTING}>
                        {(item) => (
                            <details>
                                <summary>{item.q}</summary>
                                <div class="faq-body">{item.a}</div>
                            </details>
                        )}
                    </For>
                </div>
            </section>

            <section class="guide-section privacy">
                <Icon name="usb" size={16} />
                <p>
                    <b>Privasi:</b> layar, log, dan file HP mengalir langsung dari kabel USB ke browser kamu. Tidak ada data HP yang lewat atau tersimpan di
                    server. Tiap orang hanya bisa mengontrol HP yang dicolok ke PC-nya sendiri.
                </p>
            </section>
        </div>
    );
}
