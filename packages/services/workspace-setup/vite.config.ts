import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only package, two entries: `index` (server sync + asset seeding, uses
// node:fs + import.meta.url) and `slug` (browser-safe isPresetSlug). ESM-only —
// import.meta.url (asset resolution) isn't available under CJS, and both hosts run
// the server as ESM. Node built-ins are externalized; assets ship as files (see
// package.json `files`), resolved at runtime relative to dist via import.meta.url.
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
      entry: { index: "src/index.ts", slug: "src/slug.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^node:/],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
