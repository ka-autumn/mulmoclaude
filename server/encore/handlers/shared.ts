// Shared types and helpers used across encore handler modules.
//
// Each per-kind handler in this directory imports from here so that
// `dispatch.ts` stays a thin router and handlers stay focused on
// their own kind. EncoreError + the dispatch envelope types are
// re-exported from `dispatch.ts` for external callers (route adapter,
// tests).

import path from "node:path";
import { z } from "zod";

import type { EncoreDsl } from "../../../src/types/encore-dsl/schema.js";
import { parseCycleFile, serializeCycleFile, type CycleState } from "../cycle.js";
import { parseIndexFile } from "../obligation.js";
import { cycleFilePath, obligationIndexPath } from "../paths.js";
import { readTextOrNull, writeText } from "../../utils/files/encore-io.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { reconcileCycleNotifications } from "../reconcile.js";
import { log } from "../../system/logger/index.js";

// ── error types + envelope ────────────────────────────────────────

export interface EncoreDispatchBody {
  kind: string;
  [key: string]: unknown;
}

export interface EncoreDispatchResult {
  ok: boolean;
  message: string;
  [key: string]: unknown;
}

export class EncoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "EncoreError";
  }
}

// ── DSL coercion + error formatting ───────────────────────────────

export function formatZodError(err: z.ZodError): string {
  // First issue's path + message — Claude reads this and either
  // self-corrects or asks the user. The full issues list is in
  // `details` for clients that want the structured form.
  const [first] = err.issues;
  const pathStr = first.path.length > 0 ? first.path.map((segment) => String(segment)).join(".") : "(root)";
  return `DSL validation failed at ${pathStr}: ${first.message}. Read config/helps/encore-dsl.md for the full grammar.`;
}

/** Accept `definition` as either an object literal OR a JSON-encoded
 *  string of one. The LLM commonly JSON.stringify's tool-call
 *  arguments (especially for nested objects), and rejecting that
 *  shape with "expected object, received string" reads as a schema
 *  problem rather than a wire-format problem — the LLM tends to
 *  retry with the same shape. Silently coercing eliminates the
 *  whole class of mistake. The trade-off: a non-JSON string or a
 *  JSON string that decodes to a non-object surfaces with a clear
 *  400 instead of being silently dropped. */
export function coerceDefinitionToObject(value: unknown, kind: string): Record<string, unknown> {
  let coerced = value;
  if (typeof coerced === "string") {
    try {
      coerced = JSON.parse(coerced);
    } catch (err) {
      throw new EncoreError(
        400,
        `${kind}: \`definition\` was provided as a string but is not valid JSON: ${err instanceof Error ? err.message : String(err)}. Pass an object literal, or a JSON-encoded string of one.`,
      );
    }
  }
  if (!coerced || typeof coerced !== "object" || Array.isArray(coerced)) {
    const actual = Array.isArray(coerced) ? "array" : coerced === null ? "null" : typeof coerced;
    throw new EncoreError(400, `${kind}: \`definition\` must be an object (or a JSON string of one), got ${actual}.`);
  }
  return coerced as Record<string, unknown>;
}

export function workspaceRelativePath(rel: string): string {
  return path.join(WORKSPACE_DIRS.encore, rel);
}

// ── DSL / cycle loaders ───────────────────────────────────────────

export async function loadDsl(obligationId: string): Promise<EncoreDsl | null> {
  const raw = await readTextOrNull(obligationIndexPath(obligationId));
  if (raw === null) return null;
  try {
    return parseIndexFile(raw).dsl;
  } catch {
    return null;
  }
}

export async function loadCycle(obligationId: string, cycleId: string): Promise<{ rel: string; raw: string; state: CycleState; body: string }> {
  const rel = cycleFilePath(obligationId, cycleId);
  const raw = await readTextOrNull(rel);
  if (raw === null) {
    throw new EncoreError(404, `cycle file ${obligationId}/${cycleId}.md not found`);
  }
  const { state, body } = parseCycleFile(raw);
  return { rel, raw, state, body };
}

/** The mutating-handler envelope. Write the cycle file, then run
 *  the reconciler under the same per-plugin lock that wraps this
 *  dispatch. The reconciler re-derives the desired bell state from
 *  disk — it's both the trim path (closed/snoozed → out of bundle)
 *  and the publish path (un-fired in-bundle pairs → publish). */
export async function persistAndReconcile(rel: string, state: CycleState, body: string, obligationId: string, cycleId: string): Promise<void> {
  await writeText(rel, serializeCycleFile(state, body));
  await reconcileCycleNotifications({ obligationId, cycleId, now: new Date(), log });
}

/** Reject calls referencing target/step ids that don't exist in
 *  the DSL. Without this, a typo (`pat` vs `pay`) would succeed
 *  silently — writing a record under the bogus id, leaving the
 *  real step still un-closed, and surfacing as "I told the LLM
 *  I paid but the bell didn't clear". */
export function assertKnownTargetAndStep(dsl: EncoreDsl | null, args: { obligationId: string; targetId: string; stepId?: string }): void {
  if (!dsl) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  if (!dsl.targets.some((target) => target.id === args.targetId)) {
    const known = dsl.targets.map((target) => target.id).join(", ");
    throw new EncoreError(400, `unknown targetId ${JSON.stringify(args.targetId)} for obligation ${JSON.stringify(args.obligationId)}. Known: [${known}]`);
  }
  if (args.stepId !== undefined && !dsl.steps.some((step) => step.id === args.stepId)) {
    const known = dsl.steps.map((step) => step.id).join(", ");
    throw new EncoreError(400, `unknown stepId ${JSON.stringify(args.stepId)} for obligation ${JSON.stringify(args.obligationId)}. Known: [${known}]`);
  }
}
