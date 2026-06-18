import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// `.` = isomorphic core (schema + pure engine), imported by the host frontend
// AND server. `./server` = node-only storage engine (fs/path), imported only by
// the host server — kept out of `.` so the frontend bundle never pulls in
// node:fs. `./vue` = browser UI layer (composition API + SFCs), imported only by
// the host frontend. Dual ESM + CJS so the Docker CJS server build can `require`
// the core/server entries.
//
// Vue SFCs need @vitejs/plugin-vue; their Tailwind utility classes compile into
// a single dist/style.css (via @tailwindcss/vite, scanning this package's own
// sources) which the host imports — node_modules isn't in the host's Tailwind
// content scan, so the package must ship its own classes. `.d.ts` is emitted by
// vue-tsc (see the build script), not vite-plugin-dts, because the latter can't
// type SFCs.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    lib: {
      entry: { index: "src/index.ts", server: "src/server/index.ts", vue: "src/vue/index.ts" },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      // node built-ins + zod + gui-chat-protocol(/vue) + vue + vue-i18n stay
      // external (resolved from node_modules at runtime); only the package's own
      // modules are bundled. `gui-chat-protocol/vue` is externalized so plugin
      // and host share ONE injected PLUGIN_RUNTIME_KEY Symbol instance.
      external: [/^node:/, "zod", "gui-chat-protocol", "gui-chat-protocol/vue", "vue", "vue-i18n", "vuedraggable"],
      output: {
        exports: "named",
        globals: { vue: "Vue" },
        assetFileNames: "style.[ext]",
      },
    },
    cssCodeSplit: false,
    minify: false,
    sourcemap: true,
  },
});
