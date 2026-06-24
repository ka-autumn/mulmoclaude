import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isAppSettings, isAppSettingsPatch } from "../../../../server/system/config.ts";

// The whisper model registry / ffmpeg / capture logic moved to the
// `@mulmoclaude/whisper` package (tested there). This host test covers the
// MulmoClaude-owned glue: the `voiceInput` settings shape.
describe("AppSettings voiceInput validation", () => {
  it("accepts a well-formed voiceInput block", () => {
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { enabled: true, model: "small" } }), true);
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { enabled: false } }), true);
  });

  it("rejects a malformed voiceInput block", () => {
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { enabled: "yes" } }), false);
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { model: 7 } }), false);
  });

  it("patch validator accepts a partial voiceInput", () => {
    assert.equal(isAppSettingsPatch({ voiceInput: { enabled: true } }), true);
    assert.equal(isAppSettingsPatch({ voiceInput: { enabled: 1 } }), false);
  });
});
