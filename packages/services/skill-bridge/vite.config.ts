import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only package: one entry, no Vue. Mirrors x-plugin's build. Node built-ins
// and the @mulmoclaude/collection-plugin peer (for isSafeActionTemplatePath) are
// externalized — they're provided by the host at runtime.
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
      entry: { index: "src/index.ts" },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [/^node:/, /^@mulmoclaude\/collection-plugin/],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
