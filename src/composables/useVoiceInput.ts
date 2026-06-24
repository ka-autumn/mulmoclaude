// Thin Vue wrapper over the framework-neutral capture controller in
// `@mulmoclaude/whisper/client` (shared with MulmoTerminal). This file supplies
// the MulmoClaude-specific transport (api client + route constants) and language
// mapping, and mirrors the controller's pushed state into Vue refs. The capture
// logic itself (MediaRecorder + VAD + segment queue) lives in the package.
// See plans/feat-extract-whisper-package.md.

import { onScopeDispose, ref, type Ref } from "vue";
import { createVoiceCapture, localeToWhisperLanguage, type VoiceCaptureTransport } from "@mulmoclaude/whisper/client";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPost } from "../utils/api";

export interface VoiceModelStatus {
  name: string;
  state: "idle" | "downloading" | "ready" | "error";
  progress?: number;
  error?: string;
}

/** Response shape of `GET /api/transcribe/model` — host contract consumed by the
 *  Settings → Voice tab. */
export interface VoiceInputStatusResponse {
  capable: boolean;
  enabled: boolean;
  model: VoiceModelStatus;
}

export { localeToWhisperLanguage };

export interface UseVoiceInputOptions {
  /** Current vue-i18n locale (for default transcription language). */
  locale: () => string;
  /** Called with each segment's transcript once recognized (never empty). */
  onTranscript: (text: string) => void;
  /** Called when a segment produced no speech. */
  onEmpty?: () => void;
}

export interface UseVoiceInput {
  available: Ref<boolean>;
  listening: Ref<boolean>;
  transcribing: Ref<boolean>;
  error: Ref<string | null>;
  refreshAvailability: () => Promise<void>;
  start: () => Promise<boolean>;
  stop: () => void;
}

export function useVoiceInput(opts: UseVoiceInputOptions): UseVoiceInput {
  const available = ref(false);
  const listening = ref(false);
  const transcribing = ref(false);
  const error = ref<string | null>(null);

  const transport: VoiceCaptureTransport = {
    async transcribe(dataUrl, language) {
      const result = await apiPost<{ text: string }>(API_ROUTES.transcribe.run, { dataUrl, language });
      if (!result.ok) throw new Error(result.error || "transcription failed");
      return result.data;
    },
    async getStatus() {
      const result = await apiGet<VoiceInputStatusResponse>(API_ROUTES.transcribe.model);
      if (!result.ok) throw new Error(result.error || "status failed");
      const { capable, enabled, model } = result.data;
      return {
        ready: capable && enabled && model.state === "ready",
        downloading: capable && enabled && model.state === "downloading",
      };
    },
  };

  const capture = createVoiceCapture(transport, () => localeToWhisperLanguage(opts.locale()), {
    onTranscript: opts.onTranscript,
    onEmpty: opts.onEmpty,
    onError: (message) => {
      error.value = message;
    },
    onState: (state) => {
      available.value = state.available;
      listening.value = state.listening;
      transcribing.value = state.transcribing;
    },
  });

  onScopeDispose(() => capture.dispose());

  return {
    available,
    listening,
    transcribing,
    error,
    refreshAvailability: capture.refreshAvailability,
    start: capture.start,
    stop: capture.stop,
  };
}
