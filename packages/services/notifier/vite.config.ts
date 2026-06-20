import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only package: node:crypto + node:fs reads, plus an injected atomic writer.
// Dual ESM+CJS (no import.meta.url). Node built-ins externalized; no runtime deps.
export default defineConfig({
  plugins: [dts({ include: ["src/**/*.ts"], outDir: "dist", compilerOptions: { rootDir: "src" } })],
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: { external: [/^node:/], output: { exports: "named" } },
    minify: false,
    sourcemap: true,
  },
});
