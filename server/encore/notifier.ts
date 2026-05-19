// Encore-scoped notifier wrapper.
//
// Closes over:
//   - `pluginPkg`: a constant identity string so every Encore-owned
//     bell entry is tagged uniformly, and `clearForPlugin` can
//     enforce plugin-scoped clearing.
//   - lifecycle: every Encore bell entry uses `lifecycle: "action"`
//     so the host's NotificationBell.vue does NOT auto-clear on
//     user click — clearing is owned by the LLM (markStepDone /
//     markTargetSkipped close the underlying step which clears the
//     bell). The host's `validateActionCoherence` rejects
//     `action` + `info`, so the wrapper also maps DSL `info` (and
//     `warning`) severities to host `nudge` at the publish
//     boundary.
//
// Pure passthrough otherwise — no caching, no batching, no other
// semantics. Tick + handlers import this module rather than
// reaching for the raw host engine.

import * as engine from "../notifier/engine.js";
import type { Severity } from "../../src/types/encore-dsl/schema.js";

/** Identity string used as `pluginPkg` on every Encore bell entry.
 *  Stable across versions; lives next to the apiNamespace ("encore")
 *  and the tool name ("manageEncore") as part of the plugin's
 *  identity. */
export const ENCORE_PLUGIN_PKG = "encore" as const;

export interface PublishArgs {
  severity: Severity;
  title: string;
  body?: string;
  navigateTarget: string;
  pluginData?: unknown;
}

/** Map Encore's DSL-facing severity vocabulary
 *  (`info | warning | urgent`, picked for clarity in plain-language
 *  prompts the LLM composes against) to the host notifier's
 *  vocabulary (`info | nudge | urgent`).
 *
 *  We deliberately avoid the host's `info` severity entirely:
 *  Encore always uses `lifecycle: "action"` so the LLM (not the
 *  bell) owns when the entry goes away — the user clicks the
 *  bell, lands in a chat, talks with the LLM, and the LLM calls
 *  `markStepDone` / `markTargetSkipped` to clear. The host's
 *  publish-time coherence check rejects `action` + `info`, so we
 *  map DSL `info` to host `nudge` (the mid-intensity bucket). We
 *  lose the visual distinction between info and warning at the
 *  bell level; the LLM still differentiates them in title / body /
 *  conversation tone. */
function toHostSeverity(severity: Severity): "nudge" | "urgent" {
  if (severity === "urgent") return "urgent";
  return "nudge";
}

/** Publish an Encore notification. Always emits
 *  `lifecycle: "action"` so the host's bell does NOT auto-clear on
 *  click — Encore owns the clear via markStepDone /
 *  markTargetSkipped. Returns the host-assigned notification id. */
export async function publish(args: PublishArgs): Promise<{ id: string }> {
  return engine.publish({
    pluginPkg: ENCORE_PLUGIN_PKG,
    severity: toHostSeverity(args.severity),
    lifecycle: "action",
    title: args.title,
    body: args.body,
    navigateTarget: args.navigateTarget,
    pluginData: args.pluginData,
  });
}

/** In-place update of an Encore notification's presentation —
 *  same id, same `pluginPkg`, same `lifecycle`, same `createdAt`,
 *  new severity / title / body. The reconciler's trim path uses
 *  this to flush DSL-driven content drift (an `amendDefinition`
 *  edited a `displayName`, the bundle shrunk so the body's member
 *  count changed, the cadence pushed us into a higher-severity
 *  phase) without flickering the bell entry through a clear +
 *  publish — which would litter history with `cleared` records
 *  and assign a fresh id every time. Mirrors the DSL → host
 *  vocabulary mapping in `publish` so a phase escalation from
 *  `info` to `urgent` ends up at host `nudge` → `urgent` rather
 *  than confusing the validator.
 *
 *  No-op on unknown / cross-plugin ids, and on patches that would
 *  invalidate the entry (e.g. info severity on the action
 *  lifecycle we always use). Caller treats the failure modes
 *  uniformly — same isolation property as `clear`. */
export async function update(
  entryId: string,
  patch: {
    severity?: Severity;
    title?: string;
    body?: string;
  },
): Promise<void> {
  await engine.updateForPlugin(ENCORE_PLUGIN_PKG, entryId, {
    ...(patch.severity !== undefined ? { severity: toHostSeverity(patch.severity) } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
  });
}

/** Clear an Encore notification. No-ops on unknown / cross-plugin
 *  ids — matches host `clearForPlugin` semantics, plugin can't
 *  dismiss another plugin's entries. */
export async function clear(entryId: string): Promise<void> {
  await engine.clearForPlugin(ENCORE_PLUGIN_PKG, entryId);
}

/** True iff a live bell with this id still exists in the notifier
 *  AND belongs to Encore. Used by the reconciler to detect "ghost
 *  tickets" — a ticket whose bell was dismissed out-of-band by the
 *  host UI (or wiped by a crashed active.json) so that the next
 *  tick republishes instead of trusting ticket-existence as proof
 *  of bell-existence. Cross-plugin entries (theoretically
 *  impossible since the notifier ids are namespaced, but defense
 *  in depth) read as not-ours. */
export async function bellExists(entryId: string): Promise<boolean> {
  const entry = await engine.get(entryId);
  return entry !== undefined && entry.pluginPkg === ENCORE_PLUGIN_PKG;
}
