// Host adapter for local voice input. The reusable core (sidecar, model
// download, ffmpeg, transcription) lives in `@mulmoclaude/whisper`, shared with
// MulmoTerminal. This file owns only the host-specific glue: capability gating
// (platform + optional-dep probe), settings/status shaping, and a single
// process-wide service instance pointed at the workspace models dir.
// See plans/feat-extract-whisper-package.md.

import { createWhisper, resolveModelName, type ModelStatus, type WhisperModelName, type WhisperLogger } from "@mulmoclaude/whisper";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { depStatus } from "../optionalDeps.js";
import { log } from "../logger/index.js";
import type { AppSettings } from "../config.js";

export { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, isWhisperModelName, type WhisperModelName } from "@mulmoclaude/whisper";

// Adapt the host's prefixed logger to the package's minimal logger interface.
const whisperLogger: WhisperLogger = {
  info: (message, data) => log.info("whisper", message, data as Record<string, unknown> | undefined),
  warn: (message, data) => log.warn("whisper", message, data as Record<string, unknown> | undefined),
  error: (message, data) => log.error("whisper", message, data as Record<string, unknown> | undefined),
};

// One service instance for the process, pointed at the workspace models dir.
const whisper = createWhisper({ modelsDir: WORKSPACE_PATHS.models, logger: whisperLogger });

export function stopWhisperSidecar(): void {
  whisper.shutdown();
}

/** Whisper.cpp local transcription needs macOS (Metal) + the whisper-server
 *  binary AND ffmpeg on PATH — every transcription shells out to ffmpeg
 *  (webm→WAV) before the sidecar, so ffmpeg must be in the capability gate or
 *  the mic shows available and each request 500s. `depStatus` returns undefined
 *  until the boot probe completes — treat that as not-yet-capable. */
export function isVoiceInputCapable(): boolean {
  return process.platform === "darwin" && depStatus("whisper")?.available === true && depStatus("ffmpeg")?.available === true;
}

export interface VoiceInputStatus {
  /** Platform + binary present: the Settings enable toggle is offerable. */
  capable: boolean;
  /** User opted in via Settings. */
  enabled: boolean;
  /** Selected model + its download/readiness state. */
  model: { name: WhisperModelName } & ModelStatus;
}

export function selectedModel(settings: AppSettings): WhisperModelName {
  return resolveModelName(settings.voiceInput?.model);
}

export function getVoiceInputStatus(settings: AppSettings): VoiceInputStatus {
  const name = selectedModel(settings);
  return {
    capable: isVoiceInputCapable(),
    enabled: settings.voiceInput?.enabled === true,
    model: { name, ...whisper.getModelStatus(name) },
  };
}

/** The mic button gates on all three: capable + enabled + model ready. */
export function isVoiceInputReady(settings: AppSettings): boolean {
  return isVoiceInputCapable() && settings.voiceInput?.enabled === true && whisper.isModelReady(selectedModel(settings));
}

/** Start downloading the selected model (fire-and-forget; idempotent). Once the
 *  download completes and the feature is enabled, pre-warm the sidecar so the
 *  user's first transcription after enabling is fast. */
export function startModelDownload(settings: AppSettings): WhisperModelName {
  const name = selectedModel(settings);
  whisper
    .ensureModelDownloaded(name)
    .then(() => warmupVoiceInput(settings))
    .catch(() => undefined);
  return name;
}

/** Pre-spawn the sidecar at boot when voice input is already enabled + ready, so
 *  the first transcription of the session doesn't pay the model-load cost inside
 *  the request. No-op otherwise. */
export function warmupVoiceInput(settings: AppSettings): void {
  if (!isVoiceInputReady(settings)) return;
  whisper.warmup(selectedModel(settings)).catch(() => undefined);
}

export interface TranscribeRequest {
  base64: string;
  mimeType: string;
  language: string;
  model: WhisperModelName;
}

/** Decode → ffmpeg → whisper sidecar → normalized text (delegated to the
 *  package; temp files are cleaned up there). */
export function transcribeAudio(req: TranscribeRequest): Promise<{ text: string }> {
  return whisper.transcribe(req);
}
