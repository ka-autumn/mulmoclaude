import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ["src/**/*.{ts,vue}"],
      outDir: "dist",
      entryRoot: "src",
      compilerOptions: { rootDir: "../../.." },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", vue: "src/vue.ts", shared: "src/shared.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["vue", "gui-chat-protocol/vue", "node:os", "node:path", "node:fs/promises", "node:crypto"],
      output: {
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
