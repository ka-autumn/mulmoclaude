// `defineEncore` handler — unified entry point for DSL composition.
//
// Discriminates by `obligationId` presence so the LLM never has to
// also pick between "kind: setup" vs "kind: amendDefinition" — the
// parameter shape carries the intent. See plans/done/feat-encore-define-tool.md.
//
// `manageEncore`'s setup / amendDefinition kinds are kept on the wire
// for backward compat but no longer surfaced in `LLM_ENCORE_KINDS`.

import { z } from "zod";

import { handleAmend } from "./amend.js";
import { handleSetup } from "./setup.js";
import type { EncoreDispatchResult } from "./shared.js";

export const DefineArgs = z.object({
  kind: z.literal("defineEncore"),
  dsl: z.unknown(),
  /** Present → amend the named obligation; absent → setup a new one.
   *  Discriminator chosen so the LLM never has to also pass a `kind`
   *  inside the tool — "I have an id" / "I don't" is the intent.
   *
   *  `.trim().min(1)` rejects `""` AND whitespace-only ids at parse
   *  time with a clear 400 — without it, those would pass the
   *  `!== undefined` check in `handleDefineEncore` and route to
   *  amend, where `obligationIndexPath("")` /
   *  `obligationIndexPath("   ")` would throw from
   *  `assertSafeSegment` and surface as an opaque 500. */
  obligationId: z.string().trim().min(1).optional(),
});

export async function handleDefineEncore(args: z.infer<typeof DefineArgs>): Promise<EncoreDispatchResult> {
  if (args.obligationId !== undefined) {
    // Amend path. EncoreDslInput.partial() validates each provided
    // field individually; handleAmend merges onto the existing DSL
    // and runs the full (non-partial) validator on the result.
    return handleAmend({ kind: "amendDefinition", obligationId: args.obligationId, definition: args.dsl });
  }
  // Setup path. handleSetup will require the full DSL via
  // EncoreDslInput.parse and 409 on slug collision.
  return handleSetup({ kind: "setup", definition: args.dsl });
}
