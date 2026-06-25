// Client-side seeding of a presentCollection card. When a chat is started from
// a collection view, its seed message carries the collection's slash command
// (`/<slug> …`). We show the collection in the canvas immediately — a stand-in
// for the presentCollection call the agent makes moments later — so the user
// isn't staring at an empty canvas during the round trip. The placeholder is
// reconciled away when the real tool result arrives (see eventDispatch).
//
// Kept out of the generic session helpers so `sessionHelpers.ts` stays free of
// any plugin coupling; the collection-specific knowledge lives here.

import { v4 as uuidv4 } from "uuid";
import { TOOL_NAME as PRESENT_COLLECTION_TOOL_NAME, type PresentCollectionData } from "@mulmoclaude/collection-plugin";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ActiveSession } from "../../types/session";

export interface CollectionSlashSeed {
  slug: string;
  itemId?: string;
}

/** Parse a collection slash-command chat seed (`/<slug> …` or
 *  `/<slug> id=<itemId> …`, the shapes built by CollectionView's
 *  `buildChatSeed`) into the addressing a synthetic presentCollection card
 *  needs. The slug must not contain `/`, so a path-like input isn't mistaken
 *  for a collection. Returns null when the message is not a slash command.
 *  Pure; token-split rather than one regex to avoid a ReDoS-flagged pattern. */
export function parseCollectionSlashSeed(message: string): CollectionSlashSeed | null {
  const trimmed = message.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const [slug, second] = trimmed.slice(1).split(/\s+/);
  if (!slug || slug.includes("/")) return null;
  const itemId = second?.startsWith("id=") ? second.slice(3) : "";
  return itemId ? { slug, itemId } : { slug };
}

// Marker stashed on a client-seeded placeholder so the agent's real
// presentCollection result supersedes it instead of stacking. Client-only;
// never sent to the server.
type SyntheticCollectionResult = ToolResultComplete<PresentCollectionData, PresentCollectionData> & {
  syntheticCollection: true;
};

function isSyntheticCollection(result: ToolResultComplete): result is SyntheticCollectionResult {
  return (result as Partial<SyntheticCollectionResult>).syntheticCollection === true;
}

function collectionSlugOf(result: ToolResultComplete): string | undefined {
  const data = (result.data ?? result.jsonData) as PresentCollectionData | undefined;
  return data?.collectionSlug;
}

/** True when the session already holds the agent's *real* presentCollection
 *  result for `slug`. Guards the seeding path against the race where the
 *  collection-list validation fetch resolves after the real result has already
 *  arrived: by then {@link reconcileSyntheticCollection} has run with nothing to
 *  remove, so inserting the placeholder would leave a stale duplicate card. */
export function hasRealCollectionResult(session: ActiveSession, slug: string): boolean {
  return session.toolResults.some(
    (result) => result.toolName === PRESENT_COLLECTION_TOOL_NAME && !isSyntheticCollection(result) && collectionSlugOf(result) === slug,
  );
}

/** Build the placeholder presentCollection card shown the instant a chat is
 *  started from a collection view. Same render contract as the real tool
 *  result — the View self-fetches from `collectionSlug` — but flagged so
 *  {@link reconcileSyntheticCollection} drops it once the agent's real result
 *  lands. */
export function makeSyntheticCollectionResult(collectionSlug: string, itemId?: string): ToolResultComplete {
  const data: PresentCollectionData = itemId ? { collectionSlug, itemId } : { collectionSlug };
  const target = itemId ? `${collectionSlug} / ${itemId}` : collectionSlug;
  const result: SyntheticCollectionResult = {
    uuid: uuidv4(),
    toolName: PRESENT_COLLECTION_TOOL_NAME,
    message: `Presented collection ${target}`,
    data,
    jsonData: data,
    syntheticCollection: true,
  };
  return result;
}

/** Option-2 reconcile: drop the client-seeded placeholder for the collection
 *  that `incoming` (the agent's real presentCollection result) presents, so the
 *  two don't stack. No-op unless `incoming` is a real presentCollection result
 *  with a matching placeholder. Call BEFORE the result is applied. */
export function reconcileSyntheticCollection(session: ActiveSession, incoming: ToolResultComplete): void {
  if (incoming.toolName !== PRESENT_COLLECTION_TOOL_NAME || isSyntheticCollection(incoming)) return;
  const slug = collectionSlugOf(incoming);
  if (!slug) return;
  const idx = session.toolResults.findIndex((candidate) => isSyntheticCollection(candidate) && collectionSlugOf(candidate) === slug);
  if (idx < 0) return;
  const [removed] = session.toolResults.splice(idx, 1);
  session.resultTimestamps.delete(removed.uuid);
  // The placeholder held the canvas selection; clear it so the real result's
  // insert (applyToolResultToSession) re-selects and the canvas doesn't blink
  // to a different card in between.
  if (session.selectedResultUuid === removed.uuid) session.selectedResultUuid = null;
}
