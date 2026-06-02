import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLocale } from "../../src/lang/index.js";

describe("resolveLocale", () => {
  it("returns exact match for supported locale", () => {
    assert.equal(resolveLocale("en"), "en");
    assert.equal(resolveLocale("ja"), "ja");
    assert.equal(resolveLocale("pt-BR"), "pt-BR");
  });

  it("matches case-insensitively", () => {
    assert.equal(resolveLocale("PT-BR"), "pt-BR");
    assert.equal(resolveLocale("pt-br"), "pt-BR");
    assert.equal(resolveLocale("EN"), "en");
  });

  it("collapses regional tag to primary subtag when primary is supported", () => {
    assert.equal(resolveLocale("ja-JP"), "ja");
    assert.equal(resolveLocale("en-US"), "en");
    assert.equal(resolveLocale("ko-KR"), "ko");
    assert.equal(resolveLocale("es-MX"), "es");
    assert.equal(resolveLocale("fr-FR"), "fr");
    assert.equal(resolveLocale("de-AT"), "de");
    assert.equal(resolveLocale("zh-TW"), "zh");
  });

  it("maps bare primary subtag to regional variant (pt → pt-BR)", () => {
    assert.equal(resolveLocale("pt"), "pt-BR");
  });

  it("maps regional variant to supported regional variant (pt-PT → pt-BR)", () => {
    assert.equal(resolveLocale("pt-PT"), "pt-BR");
  });

  it("returns null for completely unsupported locale", () => {
    assert.equal(resolveLocale("sw"), null);
    assert.equal(resolveLocale("ar-SA"), null);
    assert.equal(resolveLocale("th"), null);
  });
});
