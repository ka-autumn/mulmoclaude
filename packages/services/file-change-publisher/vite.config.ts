import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only package: one entry, no Vue. Dual ESM+CJS (no import.meta.url, so CJS is
// safe). Node built-ins externalized; no runtime deps.
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
