import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Two bundles, two externals strategies (#1110 / mirror of bookmarks-plugin):
//
// - `dist/index.js` (server) — self-contained. The runtime loader
//   extracts the tarball into `~/mulmoclaude/plugins/.cache/<pkg>/<ver>/`
//   and dynamic-imports it. There's no node_modules underneath, so any
//   bare import that's left as `external` will fail to resolve at load
//   time. Inline `gui-chat-protocol` (just the identity `definePlugin`
//   helper — tiny) and `zod` (~50KB) so the server module loads
//   without any module-resolution gymnastics.
//
// - `dist/vue.js` (browser) — `vue` and `gui-chat-protocol/vue` stay
//   external; the host provides Vue via the importmap and the
//   `useRuntime()` composable resolves to the host's instance through
//   `gui-chat-protocol/vue`.
export default defineConfig({
  // No `rollupTypes: true`: that would route the d.ts emit through
  // `@microsoft/api-extractor`, which (as of 7.58.7) bundles a TS
  // 5.9.3 compiler engine and silently drops every export when the
  // workspace runs on TS 6+. Per-file d.ts emit by `vite-plugin-dts`
  // uses the workspace's own tsc, so it tracks the toolchain.
  // `compilerOptions.rootDir: "src"` strips `src/` from the d.ts
  // paths so `dist/index.d.ts` matches the package.json `exports`
  // map (would otherwise emit to `dist/src/index.d.ts`).
  plugins: [
    vue(),
    dts({
      include: ["src/**/*.{ts,vue}"],
      outDir: "dist",
      entryRoot: "src",
      compilerOptions: { rootDir: "../.." },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", vue: "src/vue.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["vue", "gui-chat-protocol/vue"],
      output: {
        // Pin the CSS asset to `style.css` so the host loader's
        // `${assetBase}/dist/style.css` URL resolves regardless of
        // package name (Vite's default would name it after the pkg).
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "style.css";
          return assetInfo.name ?? "[name]";
        },
      },
    },
    minify: false,
    sourcemap: true,
  },
});
