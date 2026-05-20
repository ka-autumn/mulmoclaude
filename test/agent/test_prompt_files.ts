// Guards the server/prompts/*.md extraction (plans/refactor-prompts-to-files.md).
//
// The literals these files replaced were byte-identical to the file
// contents (verified at extraction time). These tests catch a
// missing-file or stray-whitespace regression in CI rather than in
// production, and pin the load-bearing sentinel substrings so a
// truncated / wrong file fails loudly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_PROMPT,
  TOPIC_MEMORY_MANAGEMENT,
  ATOMIC_MEMORY_MANAGEMENT,
  NEWS_CONCIERGE_PROMPT,
  SANDBOX_TOOLS_HINT,
  JOURNAL_POINTER,
  SOURCES_CONTEXT,
} from "../../server/prompts/index.js";

describe("server/prompts file loader", () => {
  it("loads every block as a non-empty string", () => {
    for (const [name, value] of Object.entries({
      SYSTEM_PROMPT,
      TOPIC_MEMORY_MANAGEMENT,
      ATOMIC_MEMORY_MANAGEMENT,
      NEWS_CONCIERGE_PROMPT,
      SANDBOX_TOOLS_HINT,
      JOURNAL_POINTER,
      SOURCES_CONTEXT,
    })) {
      assert.equal(typeof value, "string", `${name} is a string`);
      assert.ok(value.length > 100, `${name} is non-trivially long (got ${value.length})`);
    }
  });

  it("preserves the load-bearing opening lines verbatim", () => {
    assert.ok(SYSTEM_PROMPT.startsWith("You are MulmoClaude, a versatile assistant app with rich visual output."), "SYSTEM_PROMPT opening");
    assert.ok(TOPIC_MEMORY_MANAGEMENT.startsWith("## Memory Management"), "TOPIC opening");
    assert.ok(ATOMIC_MEMORY_MANAGEMENT.startsWith("## Memory Management"), "ATOMIC opening");
    assert.ok(NEWS_CONCIERGE_PROMPT.startsWith("## News Concierge"), "NEWS opening");
    assert.ok(SANDBOX_TOOLS_HINT.startsWith("## Sandbox Tools"), "SANDBOX opening");
    assert.ok(JOURNAL_POINTER.startsWith("<journal-context>"), "JOURNAL_POINTER opening");
    assert.ok(JOURNAL_POINTER.endsWith("</journal-context>"), "JOURNAL_POINTER closing tag");
    assert.ok(SOURCES_CONTEXT.startsWith("## Information sources (news feeds)"), "SOURCES opening");
  });

  it("preserves trailing-newline shape per source block", () => {
    // system / topic / atomic closed with a backtick on its own line
    // → trailing "\n"; the rest closed inline / are .join("\n") output
    // → no trailing "\n". buildSystemPrompt joins on "\n\n" and
    // prependJournalPointer does [JOURNAL_POINTER, "", message].join,
    // so this shape is load-bearing for byte-identity.
    assert.ok(SYSTEM_PROMPT.endsWith("\n"), "SYSTEM_PROMPT trailing newline");
    assert.ok(TOPIC_MEMORY_MANAGEMENT.endsWith("\n"), "TOPIC trailing newline");
    assert.ok(ATOMIC_MEMORY_MANAGEMENT.endsWith("\n"), "ATOMIC trailing newline");
    assert.ok(!NEWS_CONCIERGE_PROMPT.endsWith("\n"), "NEWS no trailing newline");
    assert.ok(!SANDBOX_TOOLS_HINT.endsWith("\n"), "SANDBOX no trailing newline");
    assert.ok(!JOURNAL_POINTER.endsWith("\n"), "JOURNAL_POINTER no trailing newline");
    assert.ok(!SOURCES_CONTEXT.endsWith("\n"), "SOURCES no trailing newline");
  });

  it("unescaped inline-code backticks correctly (no stray backslashes)", () => {
    // The .ts literals had \` escapes; the .md files must carry real
    // backticks. `pip install` appears in sandbox-tools.md.
    assert.ok(SANDBOX_TOOLS_HINT.includes("`pip install`"), "literal backticks in sandbox hint");
    assert.ok(!SANDBOX_TOOLS_HINT.includes("\\`"), "no leftover escaped backticks");
  });
});
