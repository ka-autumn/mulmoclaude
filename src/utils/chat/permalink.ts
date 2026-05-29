// Build the chat-message permalink string shown in RightSidebar's
// debug pane. The output is intended for users to paste into a chat
// when asking Claude to investigate a specific message — it is NOT
// pushed to the browser URL bar (commit 179587b1 removed `?result=`
// URL persistence because per-click writes turned the back button
// into an "undo panel selection" anti-pattern).
//
// Returns null when either the session or the result identifier is
// missing. A session-only URL (no `?result=`) is intentionally NOT
// produced — the section is hidden in that case because pointing at
// "a session with no selected message" has no debug value.

export function buildMessagePermalink(origin: string, sessionId: string | null, resultUuid: string | null): string | null {
  if (!sessionId || !resultUuid) return null;
  // Encode the dynamic segments defensively: UUIDs don't contain reserved
  // URL characters today, but the helper signature accepts arbitrary
  // strings — escaping keeps the contract honest if a future caller
  // passes a non-UUID id (slugs, kebab-ids, etc.).
  return `${origin}/chat/${encodeURIComponent(sessionId)}?result=${encodeURIComponent(resultUuid)}`;
}
