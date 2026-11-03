export function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function timestamp() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function formatBytes(value: number) {
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB"];
    let unit = -1;
    do {
        value /= 1024;
        unit += 1;
    } while (value >= 1024 && unit < units.length - 1);
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
