import { describe, it } from "node:test";
import assert from "node:assert";
import { RoleSchema, BUILTIN_ROLES } from "../../src/config/roles.js";

describe("RoleSchema", () => {
  it("accepts a valid role with all fields", () => {
    const valid = {
      id: "test",
      name: "Test Role",
      icon: "star",
      prompt: "You are a test assistant.",
      availablePlugins: ["presentMulmoScript", "generateImage"],
      queries: ["hello"],
    };
    const result = RoleSchema.parse(valid);
    assert.deepStrictEqual(result, valid);
  });

  it("preserves every non-empty string in availablePlugins (lenient parse — #951 + runtime plugins)", () => {
    // The schema preserves any non-empty string. Two reasons we no
    // longer filter to `TOOL_NAMES` membership:
    //   - User-installed runtime plugins publish their `toolName`
    //     only at process start; a role file references those names
    //     statically, but they aren't in compile-time `TOOL_NAMES`.
    //   - A persisted legacy role may reference a tool that was
    //     removed in a later release (e.g. `manageRoles` post-#951).
    //     Keeping the entry preserves user intent visually in
    //     `/roles` rather than making it disappear; the actual
    //     gating happens later in `getActiveToolDescriptors` which
    //     intersects with the live tool registry.
    const input = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: ["presentMulmoScript", "presentHTML", "generateImage"],
    };
    const result = RoleSchema.parse(input);
    assert.deepStrictEqual(result.availablePlugins, ["presentMulmoScript", "presentHTML", "generateImage"]);
  });

  it("preserves a legacy role file that references the removed `manageRoles` tool", () => {
    // Before #951 a role with `manageRoles` validated and the role
    // loaded. After #951 the tool name is gone from TOOL_NAMES. The
    // current lenient parse keeps the entry alive — the runtime
    // gating layer (`getActiveToolDescriptors`) silently no-ops on
    // dead references when the tool isn't loaded, so the role still
    // works for everything else and the user can clean up
    // `manageRoles` from the list at their leisure.
    const legacyRole = {
      id: "my-role",
      name: "My Role",
      icon: "star",
      prompt: "prompt",
      availablePlugins: ["manageRoles", "presentMulmoScript", "generateImage"],
    };
    const result = RoleSchema.parse(legacyRole);
    assert.deepStrictEqual(result.availablePlugins, ["manageRoles", "presentMulmoScript", "generateImage"]);
  });

  it("drops empty strings from availablePlugins (only valid non-empty names survive)", () => {
    const input = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: ["presentMulmoScript", "", "generateImage"],
    };
    const result = RoleSchema.parse(input);
    assert.deepStrictEqual(result.availablePlugins, ["presentMulmoScript", "generateImage"]);
  });

  it("accepts a valid role without optional queries", () => {
    const valid = {
      id: "test",
      name: "Test Role",
      icon: "star",
      prompt: "You are a test assistant.",
      availablePlugins: [],
    };
    const result = RoleSchema.parse(valid);
    assert.strictEqual(result.queries, undefined);
  });

  it("rejects when id is missing", () => {
    const invalid = {
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when name is missing", () => {
    const invalid = {
      id: "test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when prompt is missing", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when availablePlugins is missing", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when id is not a string", () => {
    const invalid = {
      id: 123,
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when availablePlugins contains non-string", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [123],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when queries contains non-string", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
      queries: [42],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("strips unknown properties", () => {
    const withExtra = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
      unknownField: "should be stripped",
    };
    const result = RoleSchema.parse(withExtra);
    assert.strictEqual("unknownField" in result, false, "unknown field should be stripped");
  });
});

describe("BUILTIN_ROLES", () => {
  it("all built-in roles pass schema validation", () => {
    BUILTIN_ROLES.forEach((role) => {
      assert.doesNotThrow(() => RoleSchema.parse(role), `Built-in role "${role.id}" failed validation`);
    });
  });

  it("all built-in roles have unique ids", () => {
    const ids = BUILTIN_ROLES.map((role) => role.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(ids.length, uniqueIds.size, "Role ids must be unique");
  });
});

describe("General role isolation", () => {
  // Hard regression: the default (General) role must never expose
  // manageAccounting. The accounting plugin is opt-in via the
  // built-in Accounting role or any user-defined custom role; if a
  // refactor of the General role's plugin list silently picked up
  // the tool name, the original "no built-in default surfaces
  // accounting" invariant from plans/done/feat-accounting.md would be
  // gone. This test is the precise gate that the e2e isolation
  // spec's text-search proxy was meant to capture (the e2e check
  // happens to pass for incidental reasons because /roles only
  // renders custom roles on a fresh workspace).
  const role = BUILTIN_ROLES.find((entry) => entry.id === "general");

  it("exists in BUILTIN_ROLES", () => {
    assert.ok(role, "expected a general role in BUILTIN_ROLES");
  });

  it("does not list manageAccounting in availablePlugins", () => {
    assert.ok(role);
    assert.equal(
      role.availablePlugins.includes("manageAccounting" as never),
      false,
      "general.availablePlugins must not include manageAccounting (use the Accounting role instead)",
    );
  });
});

describe("Accounting role", () => {
  // Pins the exact plugin set so a future change has to come through
  // a deliberate edit to this test, not slip in via a routine "add
  // one more tool" change. The role exposes:
  // - manageAccounting (the bookkeeping engine)
  // - presentForm (every user prompt and pre-post confirmation)
  // - presentDocument (longer narrative outputs like month-end notes)
  // - presentSpreadsheet / presentChart / presentHtml (rich report
  //   surfaces for B/S, P&L, ratio analysis, dashboards)
  const role = BUILTIN_ROLES.find((entry) => entry.id === "accounting");

  it("exists in BUILTIN_ROLES", () => {
    assert.ok(role, "expected an accounting role in BUILTIN_ROLES");
  });

  it("exposes manageAccounting + the form/document/spreadsheet/chart/html present-* surfaces", () => {
    assert.ok(role);
    assert.deepStrictEqual([...role.availablePlugins].sort(), [
      "manageAccounting",
      "manageClient",
      "manageInvoice",
      "manageWorklog",
      "presentChart",
      "presentDocument",
      "presentForm",
      "presentHtml",
      "presentSpreadsheet",
    ]);
  });

  it("system prompt names the インボイス制度 / T-number requirement", () => {
    // The agent's job hinges on asking for the supplier's
    // tax-registration ID on input-tax lines. If a refactor ever
    // strips this guidance the agent will silently start posting
    // 14xx (Input Tax Receivable / 仮払消費税) lines without
    // taxRegistrationId — this test makes that a build-time
    // failure.
    assert.ok(role);
    assert.match(role.prompt, /インボイス制度/u);
    assert.match(role.prompt, /T-number|taxRegistrationId/u);
  });
});
