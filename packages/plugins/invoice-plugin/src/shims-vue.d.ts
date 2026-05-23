// Vite/Vue plugin SFC shim — tells `tsc --noEmit` that `.vue` imports
// resolve to a Vue Component. The actual SFC parsing happens at build
// time via `@vitejs/plugin-vue`.

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<object, object, unknown>;
  export default component;
}
