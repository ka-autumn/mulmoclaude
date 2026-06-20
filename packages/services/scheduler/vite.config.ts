import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only package: node:fs + @receptron/task-scheduler (externalized — the
// host provides it). Dual ESM+CJS; no import.meta.url.
export default defineConfig({
  plugins: [dts({ include: ["src/**/*.ts"], outDir: "dist", compilerOptions: { rootDir: "src" } })],
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: { external: [/^node:/, /^@receptron\//], output: { exports: "named" } },
    minify: false,
    sourcemap: true,
  },
});
