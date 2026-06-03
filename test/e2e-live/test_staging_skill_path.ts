import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CONTAINER_WORKSPACE_PATH, stagingSkillSlugFromWritePath } from "../../e2e-live/fixtures/staging-skill-path.ts";

// Regression net for the L-31 "skill 化して" bridge-dispatch canary.
// Under Docker the agent runs inside the sandbox, so its `Write`
// `file_path` is rooted at the container mount, not the host workspace.
// The matcher must accept either root (see stagingSkillSlugFromWritePath)
// while still rejecting writes that land outside both.

// Arbitrary stable host root — only used to distinguish the Docker-off
// branch from the Docker-on (sandbox) branch.
const HOST_ROOT = "/Users/qa/mulmoclaude";
// The Docker sandbox mount root — where the agent's Write landing was
// dropped (the L-31 Docker-on regression). Imported from the fixture so
// the literal lives in one place within the test layer (Sourcery review
// on this PR).
const SANDBOX_ROOT = CONTAINER_WORKSPACE_PATH;
const SLUG = "e2e-live-l31-chromium-1780000000000-ab12cd";

describe("stagingSkillSlugFromWritePath", () => {
  it("matches a host-absolute staging write (Docker off)", () => {
    assert.equal(stagingSkillSlugFromWritePath(`${HOST_ROOT}/data/skills/${SLUG}/SKILL.md`, HOST_ROOT), SLUG);
  });

  it("matches a sandbox-absolute staging write (Docker on) — the L-31 regression", () => {
    assert.equal(stagingSkillSlugFromWritePath(`${SANDBOX_ROOT}/data/skills/${SLUG}/SKILL.md`, HOST_ROOT), SLUG);
  });

  it("matches a workspace-relative staging write", () => {
    assert.equal(stagingSkillSlugFromWritePath(`data/skills/${SLUG}/SKILL.md`, HOST_ROOT), SLUG);
  });

  it("matches a ./-prefixed cwd-relative staging write", () => {
    assert.equal(stagingSkillSlugFromWritePath(`./data/skills/${SLUG}/SKILL.md`, HOST_ROOT), SLUG);
  });

  it("matches a ../-traversal write that resolves back into the workspace", () => {
    assert.equal(stagingSkillSlugFromWritePath(`sub/../data/skills/${SLUG}/SKILL.md`, HOST_ROOT), SLUG);
  });

  it("rejects a write to .claude/skills (the permission path the bridge bypasses)", () => {
    assert.equal(stagingSkillSlugFromWritePath(`${SANDBOX_ROOT}/.claude/skills/${SLUG}/SKILL.md`, HOST_ROOT), null);
  });

  it("rejects a non-SKILL.md file under the staging dir", () => {
    assert.equal(stagingSkillSlugFromWritePath(`${SANDBOX_ROOT}/data/skills/${SLUG}/schema.json`, HOST_ROOT), null);
  });

  it("rejects a staging write outside both known workspace roots (false-positive guard)", () => {
    assert.equal(stagingSkillSlugFromWritePath(`/some/other/root/data/skills/${SLUG}/SKILL.md`, HOST_ROOT), null);
  });

  it("rejects a slug that exceeds the canonical isValidSlug length bound", () => {
    const tooLong = "a".repeat(121);
    assert.equal(stagingSkillSlugFromWritePath(`${HOST_ROOT}/data/skills/${tooLong}/SKILL.md`, HOST_ROOT), null);
  });

  it("returns null for a backslash-separated path on a POSIX host (native separators only)", () => {
    // The `[/\\]` regex tolerance lets this match the SHAPE, but path.resolve
    // keeps backslashes literal on POSIX so it equals neither expected root —
    // backslash-form paths deliberately fall through to null (we never run a
    // Windows agent in this suite). Pins the documented separator behavior.
    const backslashPath = `\\home\\node\\mulmoclaude\\data\\skills\\${SLUG}\\SKILL.md`;
    assert.equal(stagingSkillSlugFromWritePath(backslashPath, HOST_ROOT), null);
  });
});
