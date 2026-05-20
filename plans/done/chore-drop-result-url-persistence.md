# Drop `?result=` URL persistence

## Tasks

1. Remove the `?result=<uuid>` URL query param wiring (`src/composables/useSelectedResult.ts` and every call site).
2. Remove reload-survival of the selected tool result entirely — let it reset on reload. Do **not** replace with `sessionStorage`.
3. On fresh load of a session (no in-memory `selectedResultUuid` yet), default the selection to the **latest result in the conversation — whether tool result or text result**. In-memory state still wins when switching between sessions within the same page load.

## Why

- MulmoClaude is local-first: the UUID is unresolvable on any other device or for any other user, so shareability is moot.
- Every result click pushes a `router.replace`, which turns the browser back button into "undo panel selection" — anti-pattern in a chat UI.
- Reload-survival itself saves ~one click on the rare reload; the conversation and result tiles are still right there. Not worth the URL churn or the composable.
