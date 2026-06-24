import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Two entries: `index` (server, Node — whisper-server sidecar + model download +
// ffmpeg) and `client` (browser — framework-neutral capture controller). Node
// built-ins are externalized; both hosts provide the whisper-server / ffmpeg
// binaries at runtime. Mirrors the skill-bridge build, extended to two entries.
export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", client: "src/client.ts" },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [/^node:/],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
