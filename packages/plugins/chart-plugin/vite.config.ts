import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        core: resolve(__dirname, "src/core/index.ts"),
        vue: resolve(__dirname, "src/vue/index.ts"),
      },
      name: "GUIChatPluginChart",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      // Externalized so the plugin and host share ONE instance: `vue` +
      // `gui-chat-protocol/vue` for the injected PLUGIN_RUNTIME_KEY Symbol,
      // and `echarts` so the host's single charting engine is reused.
      external: ["vue", "gui-chat-protocol", "gui-chat-protocol/vue", "echarts"],
      output: {
        exports: "named",
        globals: {
          vue: "Vue",
          echarts: "echarts",
        },
        assetFileNames: "style.[ext]",
      },
    },
    cssCodeSplit: false,
  },
});
