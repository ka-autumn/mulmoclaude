import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveClientDir } from "../../../server/utils/clientDir.ts";

// `resolveClientDir` picks between two branches based on the env
// value. Both branches matter to production behaviour:
//
//   - **default** (env unset / empty): the caller-provided
//     `defaultDir`. In production the caller passes
//     `path.join(__dirname, "../client")` (the prepared-package
//     layout `bin/prepare-dist.js` produces) — that is what every
//     `npx mulmoclaude` user actually hits.
//   - **override** (env non-empty): test spawners point at
//     `<repo-root>/dist/client/` because the source layout has no
//     `<repo-root>/client/`.
//
// L-FRESH-BOOT covers the override branch end-to-end (the spec
// helper sets MULMOCLAUDE_CLIENT_DIR). The default branch is what
// real users depend on but no integration test exercises it (the
// prepare-dist + tarball + npx flow is too heavy for a per-PR
// run), so the regression net is here: every change to the
// resolver must keep the default-passthrough semantics intact.

describe("resolveClientDir", () => {
  const DEFAULT_DIR = "/abs/repo/client";

  it("returns the env value verbatim when MULMOCLAUDE_CLIENT_DIR is non-empty", () => {
    assert.equal(resolveClientDir("/custom/client/dir", DEFAULT_DIR), "/custom/client/dir");
  });

  it("returns defaultDir verbatim when env is undefined (prepared-package default)", () => {
    // This is the path real `npx mulmoclaude` users hit. Asserting
    // it explicitly catches a regression where someone refactors
    // the resolver and accidentally rewrites the default — that
    // would silently break every production install while every
    // test (which sets the env) still passes.
    assert.equal(resolveClientDir(undefined, DEFAULT_DIR), DEFAULT_DIR);
  });

  it("returns defaultDir when env is empty string", () => {
    // A shell that exports the var without a value (`export X=`)
    // surfaces as `""`. Treating empty as "unset" preserves the
    // prepared-package default rather than 404-ing on the empty
    // path.
    assert.equal(resolveClientDir("", DEFAULT_DIR), DEFAULT_DIR);
  });

  it("uses the env value verbatim even when it points to a relative path", () => {
    // Resolver does NOT resolve to absolute; the caller (express
    // static) will resolve relative paths against cwd. Locked here
    // so a future "auto-absolutize" change is a deliberate decision,
    // not an accidental side-effect.
    assert.equal(resolveClientDir("./relative/client", DEFAULT_DIR), "./relative/client");
  });

  it("uses the env value verbatim when it is whitespace-only", () => {
    // Whitespace-only is unusual but the resolver intentionally
    // checks `length > 0`, not `trim().length > 0`. If a user sets
    // `MULMOCLAUDE_CLIENT_DIR=" "` we trust their intent (and they
    // will get a clear "failed to read index.html" log from the
    // static handler) rather than silently falling back.
    assert.equal(resolveClientDir(" ", DEFAULT_DIR), " ");
  });

  it("does not touch defaultDir when env is set (parameter is not silently ignored — caller composes the default explicitly)", () => {
    // Regression pin for the iter-4 review feedback that prompted
    // this signature: the previous shape took `baseDir` and used it
    // only in the fallback branch, so callers reading the signature
    // could not tell baseDir was discarded under override. Now the
    // caller is responsible for the default and the resolver picks
    // one of two ready values — the relationship between inputs
    // and outputs is symmetric.
    const sentinelDefault = "/should-not-appear-in-output";
    assert.equal(resolveClientDir("/from-env", sentinelDefault), "/from-env");
  });
});
