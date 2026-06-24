// @mulmoclaude/whisper/client — framework-neutral browser capture controller.
// Records one utterance at a time with MediaRecorder, segments on pauses via a
// Web Audio VAD, and sends each segment through an injected transport. State is
// pushed via `onState`; the host wraps this into its own reactivity (Vue refs,
// React state, …). No framework dependency. See plans/feat-extract-whisper-package.md.

// Map a UI locale to a Whisper language code. UI language is a strong prior for
// the spoken language; "auto" lets Whisper detect it from the audio.
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

// VAD tuning. RMS over [-1,1] float samples; a pause is SILENCE_MS of
// sub-threshold level after speech. MAX_SEGMENT_MS force-cuts a long unbroken
// utterance so no clip exceeds Whisper's 30s window or the server's size cap.
const SPEECH_RMS = 0.015;
const SILENCE_MS = 800;
const MAX_SEGMENT_MS = 20_000;
const MONITOR_INTERVAL_MS = 100;
const AVAILABILITY_POLL_MS = 2_000;

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

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface VoiceCaptureTransport {
  /** Transcribe one segment. Throws on failure. */
  transcribe: (dataUrl: string, language: string) => Promise<{ text: string }>;
  /** Current readiness. `downloading` true keeps the controller polling so it
   *  flips to ready as soon as a model download finishes. */
  getStatus: () => Promise<{ ready: boolean; downloading: boolean }>;
}

export interface VoiceCaptureState {
  available: boolean;
  listening: boolean;
  transcribing: boolean;
}

export interface VoiceCaptureCallbacks {
  /** A recognized (non-empty) segment transcript. */
  onTranscript: (text: string) => void;
  /** A segment produced no speech. */
  onEmpty?: () => void;
  /** A recoverable error message (transport failure, permission denied, etc.). */
  onError?: (message: string) => void;
  /** Pushed whenever available/listening/transcribing changes. */
  onState?: (state: VoiceCaptureState) => void;
}

export interface VoiceCapture {
  refreshAvailability: () => Promise<void>;
  start: () => Promise<boolean>;
  stop: () => void;
  dispose: () => void;
}

export function createVoiceCapture(transport: VoiceCaptureTransport, language: () => string, callbacks: VoiceCaptureCallbacks): VoiceCapture {
  let available = false;
  let listening = false;
  let transcribing = false;

  function emit(): void {
    callbacks.onState?.({ available, listening, transcribing });
  }
  function setAvailable(value: boolean): void {
    if (available !== value) {
      available = value;
      emit();
    }
  }
  function setListening(value: boolean): void {
    if (listening !== value) {
      listening = value;
      emit();
    }
  }

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
  let availabilityPollHandle: number | null = null;
  // Bumped on stop(). Segments captured / sends resolved under an older
  // generation are dropped, so a late transcript never leaks across sessions.
  let generation = 0;
  let segmentGeneration = 0;
  // Single-flight guard for start(): true between entry and the moment capture
  // is set up (or the attempt aborts), so a second start can't race the first.
  let startInFlight = false;

  function setPending(delta: number): void {
    pending += delta;
    const next = pending > 0;
    if (transcribing !== next) {
      transcribing = next;
      emit();
    }
  }

  function stopAvailabilityPoll(): void {
    if (availabilityPollHandle !== null) {
      window.clearInterval(availabilityPollHandle);
      availabilityPollHandle = null;
    }
  }

  async function refreshAvailability(): Promise<void> {
    let status: { ready: boolean; downloading: boolean };
    try {
      status = await transport.getStatus();
    } catch {
      setAvailable(false);
      stopAvailabilityPoll();
      return;
    }
    setAvailable(status.ready);
    if (status.downloading) {
      if (availabilityPollHandle === null) {
        availabilityPollHandle = window.setInterval(() => {
          void refreshAvailability();
        }, AVAILABILITY_POLL_MS);
      }
    } else {
      stopAvailabilityPoll();
    }
  }

  async function sendSegment(blob: Blob, gen: number): Promise<void> {
    if (gen !== generation) return;
    try {
      const dataUrl = await blobToDataUrl(blob);
      const result = await transport.transcribe(dataUrl, language());
      if (gen !== generation) return;
      const text = result.text.trim();
      if (text.length === 0) callbacks.onEmpty?.();
      else callbacks.onTranscript(text);
    } catch (err) {
      callbacks.onError?.(toMessage(err));
    }
  }

  // Serialize sends so transcripts append in capture order; `pending` keeps
  // `transcribing` true from enqueue until the send resolves.
  function enqueue(blob: Blob, gen: number): void {
    setPending(1);
    queue = queue
      .then(() => sendSegment(blob, gen))
      .catch(() => undefined)
      .finally(() => setPending(-1));
  }

  function containerType(): string {
    return mimeType.split(";")[0] || "audio/webm";
  }

  function onSegmentStop(): void {
    const hadSpeech = segmentHasSpeech;
    const gen = segmentGeneration;
    const blob = new Blob(chunks, { type: containerType() });
    if (listening) startRecorder();
    if (hadSpeech && blob.size > 0 && gen === generation) enqueue(blob, gen);
  }

  function startRecorder(): void {
    if (!stream) return;
    chunks = [];
    segmentHasSpeech = false;
    silenceStart = null;
    segmentStart = Date.now();
    segmentGeneration = generation;
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
    if (segmentHasSpeech && now - segmentStart > MAX_SEGMENT_MS) cutSegment();
  }

  async function start(): Promise<boolean> {
    // Single-flight: `listening` only flips true AFTER getUserMedia resolves, so
    // a benign skip returns true (a start is already active / in progress).
    if (startInFlight || listening) return true;
    startInFlight = true;
    const startGen = generation;
    try {
      mimeType = pickRecorderMime() ?? "";
      if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
        callbacks.onError?.("unsupported");
        return false;
      }
      let acquired: MediaStream;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        callbacks.onError?.("permission-denied");
        return false;
      }
      // stop() bumps the generation; if it fired while we awaited permission
      // this start is stale — release the mic and abort.
      if (startGen !== generation) {
        acquired.getTracks().forEach((track) => track.stop());
        return false;
      }
      stream = acquired;
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      vadBuffer = new Float32Array(analyser.fftSize);
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      setListening(true);
      startRecorder();
      monitorHandle = window.setInterval(monitorTick, MONITOR_INTERVAL_MS);
      return true;
    } finally {
      startInFlight = false;
    }
  }

  function stop(): void {
    // Bump the generation so any in-flight/queued segment is dropped rather than
    // applied after the user stops or switches sessions.
    generation += 1;
    setListening(false);
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

  function dispose(): void {
    stopAvailabilityPoll();
    stop();
  }

  return { refreshAvailability, start, stop, dispose };
}
