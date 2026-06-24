// @mulmoclaude/whisper — server entry. Local voice-input core shared by
// MulmoClaude and MulmoTerminal: whisper-server sidecar + GGML model download +
// ffmpeg→WAV transcription, parameterized by the host (models dir, logger). The
// host owns capability gating, the HTTP route, settings, and UI.
//
// The browser capture controller is a separate entry: `@mulmoclaude/whisper/client`.

export { createWhisper } from "./whisper.ts";
export type { Whisper, WhisperOptions, TranscribeRequest } from "./whisper.ts";
export type { WhisperLogger } from "./internal.ts";
export {
  WHISPER_MODELS,
  DEFAULT_WHISPER_MODEL,
  isWhisperModelName,
  resolveModelName,
  type WhisperModelName,
  type WhisperModelSpec,
  type ModelStatus,
  type ModelDownloadState,
} from "./models.ts";
export { buildWav16kArgs } from "./ffmpeg.ts";
