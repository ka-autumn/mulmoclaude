// `listTickets` handler — UI-only listing of live tickets. Reached
// from the dashboard's bell button (`/encore` landing) so it can
// show which obligations have an outstanding notification, NOT
// exposed in the LLM-facing tool schema.
//
// Why a separate kind rather than extending `query`:
//   - The LLM never needs ticket details for its day-to-day work
//     (it learns about pending work through the obligation cycle
//     state + the dispatch envelope echoed back by `markStepDone`
//     / etc.). Tickets are bell-side cache that exists to bind a
//     notification entry to a future chat seed.
//   - Keeping the LLM schema slim avoids feeding it data it would
//     have to learn to ignore.
//
// On-disk source of truth: `tickets/*.json` files written by
// `reconcile.ts`. Each ticket includes a `notificationId` (the
// host bell-entry id) so the dashboard can construct a URL
// equivalent to clicking the bell itself.

import { z } from "zod";
import path from "node:path";

import { TICKETS_DIRNAME, ticketPath } from "../paths.js";
import { readDir, readTextOrNull } from "../../utils/files/encore-io.js";
import { log } from "../../system/logger/index.js";
import type { Ticket } from "../tick.js";
import type { EncoreDispatchResult } from "./shared.js";

export const ListTicketsArgs = z.object({
  kind: z.literal("listTickets"),
});

/** Wire shape — a strict subset of `Ticket` (omits seedPrompt /
 *  severity baseline / chatSessionId, which the UI doesn't need). */
export interface TicketSummary {
  pendingId: string;
  obligationId: string;
  cycleId: string;
  notificationId: string;
  stepId: string;
  createdAt: string;
}

function toSummary(ticket: Ticket): TicketSummary {
  return {
    pendingId: ticket.pendingId,
    obligationId: ticket.obligationId,
    cycleId: ticket.cycleId,
    notificationId: ticket.notificationId,
    stepId: ticket.stepId,
    createdAt: ticket.createdAt,
  };
}

/** Validate the parsed JSON has the string fields we project into
 *  `TicketSummary`. A malformed ticket file (manual edit gone wrong,
 *  truncated write, format drift) would otherwise leak `undefined`
 *  values to the client and break the bell-click URL. We don't
 *  validate every `Ticket` field — only what `toSummary` reads. */
function isWellFormed(parsed: unknown): parsed is Ticket {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  return (
    typeof obj.pendingId === "string" &&
    typeof obj.obligationId === "string" &&
    typeof obj.cycleId === "string" &&
    typeof obj.notificationId === "string" &&
    typeof obj.stepId === "string" &&
    typeof obj.createdAt === "string"
  );
}

export async function handleListTickets(__args: z.infer<typeof ListTicketsArgs>): Promise<EncoreDispatchResult> {
  const entries = await readDir(TICKETS_DIRNAME);
  const summaries: TicketSummary[] = [];
  for (const filename of entries) {
    if (!filename.endsWith(".json")) continue;
    const pendingId = filename.replace(/\.json$/, "");
    const rel = ticketPath(pendingId);
    const raw = await readTextOrNull(rel);
    if (raw === null) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isWellFormed(parsed)) {
        log.warn("encore", "listTickets: skipping malformed ticket (shape mismatch)", {
          filename,
          relPath: path.posix.normalize(rel),
        });
        continue;
      }
      summaries.push(toSummary(parsed));
    } catch (err) {
      // Tolerate a single corrupt ticket — log and skip, same shape
      // as `query`'s tolerance for an unparseable index.
      log.warn("encore", "listTickets: skipping unparseable ticket", {
        filename,
        relPath: path.posix.normalize(rel),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    ok: true,
    message: `Encore: ${summaries.length} live ticket(s).`,
    tickets: summaries,
  };
}
