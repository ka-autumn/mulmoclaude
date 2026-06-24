// Toggle voice capture with pause-based segmentation for the chat input.
// Click to start listening; click again to stop. While listening, a Web
// Audio VAD watches the mic level — each time you pause (sustained
// silence after speech), the current segment is finalized and sent to
// the local /api/transcribe endpoint, and its transcript is appended to
// the input for review. Mac-only — the mic button is hidden unless the
// backend reports voice input ready. See plans/feat-voice-input.md.

import { onScopeDispose, ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPost } from "../utils/api";

export interface VoiceModelStatus {
  name: string;
  state: "idle" | "downloading" | "ready" | "error";
  progress?: number;
  error?: string;
}

export interface VoiceInputStatusResponse {
  capable: boolean;
  enabled: boolean;
  model: VoiceModelStatus;
}

// Map a UI locale (vue-i18n) to a Whisper language code. UI language is
// a strong prior for the spoken language; "auto" lets Whisper detect it
// from the audio when there's no confident mapping.
const LOCALE_TO_WHISPER: Record<string, string> = {
  en: "en",
  ja: "ja",
  zh: "zh",
  ko: "ko",
  es: "es",
  "pt-BR": "pt",
  fr: "fr",
  de: "de",
};

export function localeToWhisperLanguage(locale: string): string {
  return LOCALE_TO_WHISPER[locale] ?? "auto";
}

// VAD tuning. RMS over [-1,1] float samples; speech is well above room
// noise. A pause is SILENCE_MS of sub-threshold level after speech.
// MAX_SEGMENT_MS force-cuts a long unbroken utterance so no single clip
// exceeds Whisper's 30s window or the server's size cap.
const SPEECH_RMS = 0.015;
const SILENCE_MS = 800;
const MAX_SEGMENT_MS = 20_000;
const MONITOR_INTERVAL_MS = 100;

function pickRecorderMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.sqrt(sum / buffer.length);
}

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
  /** Begin listening. Resolves false if the mic is unavailable or
   *  permission was denied (the caller should drop its session intent
   *  so it doesn't retry every turn). */
  start: () => Promise<boolean>;
  stop: () => void;
}

export function useVoiceInput(opts: UseVoiceInputOptions): UseVoiceInput {
  const available = ref(false);
  const listening = ref(false);
  const transcribing = ref(false);
  const error = ref<string | null>(null);

  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let vadBuffer = new Float32Array(0);
  let monitorHandle: number | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let mimeType = "";
  let segmentHasSpeech = false;
  let silenceStart: number | null = null;
  let segmentStart = 0;
  let pending = 0;
  let queue: Promise<void> = Promise.resolve();

  async function refreshAvailability(): Promise<void> {
    const result = await apiGet<VoiceInputStatusResponse>(API_ROUTES.transcribe.model);
    available.value = result.ok && result.data.capable && result.data.enabled && result.data.model.state === "ready";
  }

  function setPending(delta: number): void {
    pending += delta;
    transcribing.value = pending > 0;
  }

  async function sendSegment(blob: Blob): Promise<void> {
    try {
      const dataUrl = await blobToDataUrl(blob);
      const result = await apiPost<{ text: string }>(API_ROUTES.transcribe.run, {
        dataUrl,
        language: localeToWhisperLanguage(opts.locale()),
      });
      if (!result.ok) {
        error.value = result.error || "transcription failed";
        return;
      }
      const text = result.data.text.trim();
      if (text.length === 0) opts.onEmpty?.();
      else opts.onTranscript(text);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  // Serialize sends so transcripts append in capture order even though
  // requests are async. `pending` keeps `transcribing` true from enqueue
  // until the send resolves, covering time spent queued.
  function enqueue(blob: Blob): void {
    setPending(1);
    queue = queue
      .then(() => sendSegment(blob))
      .catch(() => undefined)
      .finally(() => setPending(-1));
  }

  function containerType(): string {
    return mimeType.split(";")[0] || "audio/webm";
  }

  function onSegmentStop(): void {
    const hadSpeech = segmentHasSpeech;
    const blob = new Blob(chunks, { type: containerType() });
    // Begin the next segment immediately if still listening; the stop
    // was a pause boundary, not the user toggling off.
    if (listening.value) startRecorder();
    if (hadSpeech && blob.size > 0) enqueue(blob);
  }

  function startRecorder(): void {
    if (!stream) return;
    chunks = [];
    segmentHasSpeech = false;
    silenceStart = null;
    segmentStart = Date.now();
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = onSegmentStop;
    recorder.start();
  }

  function cutSegment(): void {
    if (recorder && recorder.state === "recording") recorder.stop();
  }

  function monitorTick(): void {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(vadBuffer);
    const rms = computeRms(vadBuffer);
    const now = Date.now();
    if (rms > SPEECH_RMS) {
      segmentHasSpeech = true;
      silenceStart = null;
    } else if (segmentHasSpeech) {
      if (silenceStart === null) silenceStart = now;
      else if (now - silenceStart > SILENCE_MS) cutSegment();
    }
    // Force-cut an over-long unbroken utterance regardless of pauses.
    if (segmentHasSpeech && now - segmentStart > MAX_SEGMENT_MS) cutSegment();
  }

  async function start(): Promise<boolean> {
    error.value = null;
    mimeType = pickRecorderMime() ?? "";
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      error.value = "unsupported";
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      error.value = "permission-denied";
      return false;
    }
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    vadBuffer = new Float32Array(analyser.fftSize);
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    listening.value = true;
    startRecorder();
    monitorHandle = window.setInterval(monitorTick, MONITOR_INTERVAL_MS);
    return true;
  }

  function stop(): void {
    // Clearing `listening` first means onSegmentStop won't restart — the
    // final flush below sends the last segment if it contained speech.
    listening.value = false;
    if (monitorHandle !== null) {
      window.clearInterval(monitorHandle);
      monitorHandle = null;
    }
    if (recorder && recorder.state === "recording") recorder.stop();
    recorder = null;
    if (audioCtx) {
      audioCtx.close().catch(() => undefined);
      audioCtx = null;
    }
    analyser = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  onScopeDispose(stop);

  return { available, listening, transcribing, error, refreshAvailability, start, stop };
}
