import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
    plugins: [solid()],
    build: {
        target: "es2022",
        // The ADB stack is one cohesive dependency graph; keep it out of the app chunk
        // so app updates don't invalidate the cached library.
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("@yume-chan")) return "adb";
                },
            },
        },
    },
});
