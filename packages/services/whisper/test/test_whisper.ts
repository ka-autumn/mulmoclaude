import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS, isWhisperModelName, resolveModelName } from "../src/models.ts";
import { buildWav16kArgs } from "../src/ffmpeg.ts";
import { localeToWhisperLanguage } from "../src/client.ts";

describe("whisper model registry", () => {
  it("recognizes registered model names and rejects others", () => {
    assert.equal(isWhisperModelName("large-v3-turbo"), true);
    assert.equal(isWhisperModelName("small"), true);
    assert.equal(isWhisperModelName("nonsense"), false);
    assert.equal(isWhisperModelName(42), false);
    assert.equal(isWhisperModelName(undefined), false);
  });

  it("resolves unknown / missing names to the default", () => {
    assert.equal(resolveModelName("base"), "base");
    assert.equal(resolveModelName("nonsense"), DEFAULT_WHISPER_MODEL);
    assert.equal(resolveModelName(undefined), DEFAULT_WHISPER_MODEL);
  });

  it("default model is present with a sane size floor + HF url", () => {
    const spec = WHISPER_MODELS[DEFAULT_WHISPER_MODEL];
    assert.ok(spec.url.startsWith("https://"));
    assert.ok(spec.file.endsWith(".bin"));
    assert.ok(spec.minBytes > 0);
  });
});

describe("ffmpeg wav args", () => {
  it("targets 16 kHz mono pcm_s16le with input/output in place", () => {
    const args = buildWav16kArgs("/work/in.webm", "/work/out.wav");
    assert.deepEqual(args, ["-y", "-loglevel", "error", "-i", "/work/in.webm", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "/work/out.wav"]);
  });
});

describe("localeToWhisperLanguage", () => {
  it("maps known UI locales and falls back to auto", () => {
    assert.equal(localeToWhisperLanguage("ja"), "ja");
    assert.equal(localeToWhisperLanguage("pt-BR"), "pt");
    assert.equal(localeToWhisperLanguage("sw"), "auto");
  });
});
