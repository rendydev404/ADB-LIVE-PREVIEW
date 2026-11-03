// Local helper: serves the web app and bridges WebSocket <-> the ADB server (tcp:5037).
// Sharing the ADB server is what lets this run side by side with Android Studio.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, createReadStream } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { delimiter, extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV = process.argv.includes("--dev");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 8087;
const ADB_PORT = Number(process.env.ADB_SERVER_PORT) || 5037;
const TOKEN = randomBytes(24).toString("hex");
const ALLOWED_ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);

// Pause the TCP side when the browser falls this far behind.
const HIGH_WATER = 8 * 1024 * 1024;

function findAdb() {
    const exe = process.platform === "win32" ? "adb.exe" : "adb";
    const candidates = [];
    if (process.env.ADB_PATH) candidates.push(process.env.ADB_PATH);
    for (const key of ["ANDROID_HOME", "ANDROID_SDK_ROOT"]) {
        if (process.env[key]) candidates.push(join(process.env[key], "platform-tools", exe));
    }
    if (process.env.LOCALAPPDATA) {
        candidates.push(join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", exe));
    }
    if (process.env.HOME) {
        candidates.push(join(process.env.HOME, "Library", "Android", "sdk", "platform-tools", exe));
        candidates.push(join(process.env.HOME, "Android", "Sdk", "platform-tools", exe));
    }
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
        if (dir) candidates.push(join(dir, exe));
    }
    return candidates.find((path) => existsSync(path));
}

function startAdbServer(adb) {
    return new Promise((resolve) => {
        // No-op when Android Studio (or anything else) already started it.
        execFile(adb, ["-P", String(ADB_PORT), "start-server"], { windowsHide: true }, (error, _stdout, stderr) => {
            if (error) console.warn(`adb start-server failed: ${stderr || error.message}`);
            resolve(!error);
        });
    });
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
};

function injectConfig(html) {
    const config = JSON.stringify({ token: TOKEN, adbPort: ADB_PORT });
    return html.replace("<!--ALP_CONFIG-->", `<script>window.__ALP__=${config}</script>`);
}

const adbPath = findAdb();
if (adbPath) {
    await startAdbServer(adbPath);
} else {
    console.warn("adb not found. Install Android SDK platform-tools or set ADB_PATH. The ADB server must already be running.");
}

let vite;
const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);

    if (url.pathname === "/api/health") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true, adb: !!adbPath }));
        return;
    }

    if (DEV) {
        vite.middlewares(req, res, async () => {
            const html = readFileSync(join(ROOT, "index.html"), "utf8");
            const transformed = await vite.transformIndexHtml(url.pathname, html);
            res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
            res.end(injectConfig(transformed));
        });
        return;
    }

    const dist = join(ROOT, "dist");
    let file = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist)) {
        res.writeHead(403).end();
        return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
    if (!existsSync(file)) {
        res.writeHead(500, { "content-type": "text/plain" }).end("Run `npm run build` first.");
        return;
    }

    const ext = extname(file);
    if (ext === ".html") {
        res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
        res.end(injectConfig(readFileSync(file, "utf8")));
        return;
    }
    // Vite emits content-hashed names under /assets, safe to cache forever.
    const immutable = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/scrcpy-server-");
    res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-length": statSync(file).size,
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    createReadStream(file).pipe(res);
});

if (DEV) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
        root: ROOT,
        appType: "custom",
        server: { middlewareMode: true, hmr: { server: httpServer } },
    });
}

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (url.pathname !== "/adb") return; // Vite HMR handles its own upgrades in dev.

    // Without these checks any website could drive ADB through ws://localhost.
    if (!ALLOWED_ORIGINS.has(req.headers.origin ?? "") || url.searchParams.get("token") !== TOKEN) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => bridge(ws));
});

function bridge(ws) {
    const tcp = connect({ host: HOST, port: ADB_PORT });
    tcp.setNoDelay(true);
    let paused = false;

    tcp.on("data", (chunk) => {
        ws.send(chunk, { binary: true }, () => {
            if (paused && ws.bufferedAmount < HIGH_WATER / 2) {
                paused = false;
                tcp.resume();
            }
        });
        if (!paused && ws.bufferedAmount > HIGH_WATER) {
            paused = true;
            tcp.pause();
        }
    });

    ws.on("message", (data) => {
        if (!tcp.write(data)) {
            ws.pause();
            tcp.once("drain", () => ws.resume());
        }
    });

    const closeBoth = () => {
        tcp.destroy();
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
    };
    tcp.on("close", closeBoth);
    tcp.on("error", closeBoth);
    ws.on("close", closeBoth);
    ws.on("error", closeBoth);
}

httpServer.listen(PORT, HOST, () => {
    console.log(`Android Live Preview: http://localhost:${PORT}`);
    console.log(adbPath ? `Using ADB server on :${ADB_PORT} (${adbPath})` : `Using ADB server on :${ADB_PORT}`);
});
