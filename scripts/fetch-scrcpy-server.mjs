// Downloads the scrcpy server binary that matches @yume-chan/scrcpy's latest options.
// It is pushed to /data/local/tmp at runtime — nothing is installed on the device.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRCPY_VERSION = "3.3.3";
const SHA256 = "7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", `scrcpy-server-v${SCRCPY_VERSION}`);

if (existsSync(target) && readFileSync(target).length > 0) {
    console.log(`scrcpy-server v${SCRCPY_VERSION} already present`);
    process.exit(0);
}

const url = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`;
console.log(`Downloading ${url}`);
const response = await fetch(url);
if (!response.ok) {
    console.error(`Download failed: HTTP ${response.status}`);
    process.exit(1);
}
const data = Buffer.from(await response.arrayBuffer());
const hash = createHash("sha256").update(data).digest("hex");
if (hash !== SHA256) {
    console.error(`Checksum mismatch: ${hash}`);
    process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, data);
console.log(`Saved ${data.length} bytes (sha256 verified)`);
