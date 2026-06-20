// @mulmoclaude/notifier — host-agnostic notification engine shared by
// MulmoClaude and MulmoTerminal. The engine owns the two-file
// (active + history) persistence, the write coordinator, lifecycle
// validation, and the in-process + pub-sub fan-out; the host injects
// file paths, an atomic JSON writer, the pub-sub event sink, and a
// logger. The plugin-runtime API, the HTTP route, and the macOS push
// adapter stay host-side — they bind this engine to host specifics.
export * from "./types.js";
export * from "./engine.js";
export type { WriteJson } from "./store.js";
