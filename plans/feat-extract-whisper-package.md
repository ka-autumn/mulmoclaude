# Extract voice input into `@mulmoclaude/whisper` (shared with MulmoTerminal)

**Goal:** Move the reusable core of the local voice-input feature out of MulmoClaude's
host tree into a published package, `@mulmoclaude/whisper`, so MulmoTerminal can consume
it too. Nothing else — no behavior change for MulmoClaude users.

**Status:** In progress
**Last updated:** 2026-06-24

---

## 1. Why `@mulmoclaude/whisper` (not `@mulmobridge/whisper`)

`@mulmobridge/*` is the messaging/transport/protocol substrate (`protocol`, `client`,
`chat-service`, bridges). `@mulmoclaude/*` under `packages/services/` is the set of
**MulmoClaude application services that MulmoTerminal also consumes, sharing one
`~/mulmoclaude/` workspace** — `scheduler`, `notifier`, `skill-bridge`, `workspace-setup`,
`collection-watchers`, `file-change-publisher`. Voice input is exactly that category
(an app capability that shares the workspace `models/` dir), so it belongs beside them.

Consequences (verified):
- Auto-discovered by `build:packages` (`build-workspaces.mjs packages/services @mulmoclaude`) —
  no `package.json` enumeration edit.
- Covered by the `@mulmoclaude/*` version-bump guard (`scripts/check-shared-pkg-bumps.mjs`),
  which exists for this exact cross-app/shared-workspace case.

## 2. What moves vs what stays

**Moves into the package (host-agnostic via injection):**
- Server core: model registry + download (stall watchdog, integrity), sidecar lifecycle
  (spawn/warm/health/timeout/single-flight/duplicate-guard), ffmpeg webm→WAV conversion,
  `transcribe()`. From `server/system/whisper/{models,sidecar,index}.ts` +
  `server/utils/audio/ffmpeg.ts`.
- Client core: the MediaRecorder + VAD + pause-segmentation + ordered-send-queue +
  generation/single-flight capture controller. From `src/composables/useVoiceInput.ts`.

**Stays host-side (app-specific glue, ~thin):**
- `POST /api/transcribe` + model status/download route (`server/api/routes/transcribe.ts`).
- `/api/health` voiceInput block.
- `AppSettings.voiceInput` (`server/system/config.ts`).
- `optionalDeps` whisper/ffmpeg probing + boot bell (capability detection).
- The Vue `useVoiceInput` composable (thin wrapper over the package controller).
- Mic button (`ChatInput.vue`), `SettingsVoiceTab.vue`, i18n.

## 3. Package API

`packages/services/whisper/`, name `@mulmoclaude/whisper`, two entry points via `exports`:

### `.` (server, Node)
```ts
export const WHISPER_MODELS; export const DEFAULT_WHISPER_MODEL;
export type WhisperModelName, ModelStatus, ModelDownloadState;
export function isWhisperModelName(v): v is WhisperModelName;
export function resolveModelName(name?: string): WhisperModelName;

export interface WhisperLogger { info; warn; error }      // minimal; default no-op
export interface WhisperOptions {
  modelsDir: string;                 // injected (host passes WORKSPACE_PATHS.models)
  logger?: WhisperLogger;
  serverBinary?: string;             // default "whisper-server"
  ffmpegBinary?: string;             // default "ffmpeg"
}
export interface Whisper {
  isModelReady(name): boolean;
  getModelStatus(name): ModelStatus;
  ensureModelDownloaded(name): Promise<void>;   // fire-and-forget friendly, never throws
  warmup(model): Promise<void>;
  transcribe(req: { base64; mimeType; language; model }): Promise<{ text: string }>;
  shutdown(): void;
}
export function createWhisper(opts: WhisperOptions): Whisper;
```
- Capability detection (platform + which) is NOT here — the host gates that via its
  `optionalDeps`. The package assumes the binaries exist when called; the host only
  calls it once it's gated ready. Keeps the package dependency-free of `which`.
- Module-level singletons (sidecar, download-status map) become instance state captured
  in the `createWhisper` closure.

### `./client` (browser, framework-neutral TS — no Vue)
```ts
export function localeToWhisperLanguage(locale: string): string;
export interface VoiceCaptureTransport {
  transcribe(dataUrl: string, language: string): Promise<{ text: string }>;  // throws on failure
  getStatus(): Promise<{ ready: boolean; downloading: boolean }>;
}
export interface VoiceCaptureCallbacks {
  onTranscript(text: string): void;
  onEmpty?(): void;
  onError?(message: string): void;
  onState?(s: { available: boolean; listening: boolean; transcribing: boolean }): void;
}
export interface VoiceCapture {
  refreshAvailability(): Promise<void>;
  start(): Promise<boolean>;
  stop(): void;
  dispose(): void;
}
export function createVoiceCapture(
  transport: VoiceCaptureTransport,
  language: () => string,
  callbacks: VoiceCaptureCallbacks,
): VoiceCapture;
```
- Framework-neutral so MulmoTerminal can wrap it regardless of its UI stack. State is
  pushed via `onState`; the host maps it into Vue refs.

## 4. Host adapter shape (MulmoClaude)

- `server/system/whisper/index.ts` becomes a thin adapter: builds one
  `createWhisper({ modelsDir: WORKSPACE_PATHS.models, logger })` singleton, and keeps the
  host-only helpers (`isVoiceInputCapable` via `depStatus`, `getVoiceInputStatus`,
  `isVoiceInputReady`, `selectedModel`, `startModelDownload`, `warmupVoiceInput`,
  `transcribeAudio`) delegating to it. Re-exports `WHISPER_MODELS` etc. for the settings UI.
- Delete `server/system/whisper/{models,sidecar}.ts` and `server/utils/audio/ffmpeg.ts`.
- `src/composables/useVoiceInput.ts` becomes a thin Vue wrapper: `createVoiceCapture(...)`
  with transport backed by `apiPost`/`apiGet` + `API_ROUTES.transcribe.*`, language from
  i18n locale, state mirrored into refs. Keeps the SAME returned shape so `ChatInput.vue`
  and `SettingsVoiceTab.vue` are unchanged (re-export `VoiceInputStatusResponse` for the tab).

## 5. Tests

- Package: `packages/services/whisper/test/` — model registry + ffmpeg-args + (where
  feasible) capture-queue logic.
- Host: keep `AppSettings.voiceInput` validation + the data-URI parser test. Repoint
  `test/server/system/whisper/test_voice_input.ts` model-registry assertions at the package
  (or drop the moved-helper assertions, keeping the host config test).

## 6. Build / verification order

1. Scaffold package; `yarn workspace @mulmoclaude/whisper run build`.
2. Refactor host to consume it.
3. `yarn build:packages` (auto-discovers it) → `yarn format` → `yarn lint` →
   `yarn typecheck` → `yarn build` → `yarn test`.

New package starts at `0.1.0`; the bump guard compares changed published packages vs base —
a brand-new package has no base entry, so it passes.
