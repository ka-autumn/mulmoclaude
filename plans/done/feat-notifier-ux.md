# Plan: Notifier UX design

Status: design / discussion. **UX-only** — this document fixes the user-facing surface for the notifier migration. The implementation strategy ("how the engine emits events", "where the wrapper lives", file layout) is the job of `feat-encore.md` PR 3; the decisions below feed into that PR's scope but stay framed as user experience here.

## Why this document

`feat-encore.md` PR 2 shipped the notifier engine itself (active-only `publish` / `clear` / `cancel`). PR 3 will migrate the existing `publishNotification()` notification system onto the new engine. The migration changes the *user experience model*, not just the wiring underneath:

- **Old model** — bell panel = "stream of the last 50 events", with a read/unread flag. Acknowledged items linger; the panel doubles as "what happened recently?"
- **New model** — bell panel = "currently pending obligations", with explicit `clear` / `cancel` verbs. Cleared and cancelled items leave the active view and move to a capped history.

These are not just two skins on the same data — they answer different questions. Old answers "tell me what fired"; new answers "tell me what's still on me." A migration that ignores the gap leaves users wondering where their history went; a migration that bridges it has to be designed UX-first, not code-first.

## Lifecycle

Two notification types, distinguished by who is responsible for the close call:

- **fyi** — informational ("Backup completed", "Build #42 finished"). Closed when the user dismisses it from the bell panel. No deep-link target.
- **action** — pending obligation ("Pay property tax", "News digest ready"). **Requires** a `navigateTarget` — the engine and the HTTP layer reject `action` publishes that omit it (an `action` with no link is a degraded fyi: clicking it does nothing, and the plugin has no landing page to react to). **Cannot use `info` severity** for the same coherence reason: a low-priority obligation is a contradiction — if it's just a ping, use fyi; if it's a real obligation worth a landing page, use `nudge` or `urgent`. The *plugin* owns the close call, fired when the underlying domain state changes (the user paid the tax, the user marked the digest read, etc.). Whether the plugin clears on landing-page mount (read-once) or only after an explicit user action is the plugin's choice — both patterns are first-class.

The engine never reads `lifecycle` for routing; it's stored on the entry for the UI to render rows differently and validated only at publish time. Once published, lifecycle is documentation as far as the data flow is concerned.

## Bell panel layout

One scrollable popup with two stacked sections — Active on top, History below. **No tabs.**

```
┌────────────────────────────┐
│ Notifications              │
├────────────────────────────┤
│ Active (N)                 │
│  ●  Pay property tax  [×]  │   ← action row (click body → navigate, × → cancel)
│  ●  Build #42 finished [×] │   ← fyi row    (× → clear)
│  ●  News digest ready [×]  │   ← action row
├────────────────────────────┤
│ History (≤ 50)             │
│  ✓  Backup completed       │
│  ✗  Old reminder           │
│  ✓  Build #41 finished     │
│  …                         │
└────────────────────────────┘
```

- **One scroll region** for the whole popup (Active and History share it). When Active is short and History is long, History fills the visible space; when Active is long, History is one scroll away. Single-scroll is a simpler mental model than per-section scroll, and the worst-case ergonomic — long Active pushing History off-screen — is the same direction the user naturally cares about (handle pending things first, then look back).
- **Section headers** are plain non-sticky headers. Sticky would buy little for the cost.
- **Empty Active** — the section shows the grey placeholder "No active notifications" and History remains below.

## Bell badge

- **Count** = active entries only. History does not contribute. Capped at `99+`.
- **Color** — worst-severity-wins:
  - any `urgent` → red
  - else any `nudge` → amber
  - else gray
- One glance answers "is anything on fire?" without opening the panel. Severity color is the user's primary at-a-distance signal — meaningful precisely because there is no toast (see below).

## Row behaviour

Active rows share one visual layout — severity dot + title/body/meta + trailing `×` button. Click semantics differ by `lifecycle`:

### fyi rows

- Body click does nothing (fyi has no `navigateTarget` by construction).
- Trailing `×` calls `clear` — the only verb that applies, since fyi has no `cancel` notion ("the user acknowledges" IS the close). Entry moves to History marked `cleared`.

### action rows

- Body click closes the panel and routes the user to `navigateTarget` with `?notificationId=<uuid>` appended. The landing page can recover the entry, highlight the relevant item, and decide when to clear.
- Trailing `×` calls `cancel` ("the user has decided this is no longer relevant"). Entry moves to History marked `cancelled`.
- Clicking-and-immediately-leaving the landing page does *not* clear the entry — the plugin waits for the underlying state change. This is what makes the model "obligations, not events."

An earlier draft gave fyi rows a leading checkbox and a footer "Acknowledge selected" button for bulk ack. Dropped: the unified single-`×` UI is faster for the typical case (dismiss one row) and the bulk-catch-up case (acknowledge N rows at once) is rare enough not to warrant a separate UI mode.

### History rows

- Read-only display, with one important capability: rows whose original entry had a `navigateTarget` stay clickable — clicking re-routes to that target. This is the primary "what happened earlier?" recall mechanism, the migration's answer to the old "last 50 events" stream. The user can find a previous build report or an article they archived without scrolling chat.
- Visual marker for terminal type: `✓` for cleared, `✗` for cancelled. Severity color persists from the original entry.
- History caps at **50 entries**, FIFO eviction.

## No toast

The right-corner toast popup that fires on every legacy `publishNotification()` is removed. Reasoning:

- Toasts interrupt the user mid-task without consent. Most fyi notifications (`Backup completed`, `Build #42 finished`) are information, not emergencies — the cost of interruption outweighs the benefit of immediacy.
- The bell badge already provides at-a-distance signalling via worst-severity color. A glance answers "is anything urgent waiting?" without disrupting flow.
- If a future urgent-class category proves to need more aggressive surfacing, that's a follow-up conversation. Start without it.

## Pending UX decisions

These remain open. Each is small enough that the migration PR can land with a default and the choice can be revised by feel.

- **Empty History text.** Default proposal: "No recent activity." Keeps the section header so the structure stays consistent across states. Alternative: hide the section header entirely on empty.
- **Undo for accidental dismiss.** A user might mis-tap the `×` on the wrong row. Options:
  - Snackbar with "Undo" for N seconds.
  - No undo — the row lands in History, the user re-reads or re-acts from there.
  - No undo and no recovery.
  - Default proposal: no undo. The History row stays clickable; if the user actually wanted to act, they re-navigate from History. The `cancel` × button on action rows is the more error-prone surface, and that one *should* probably get an undo — TBD.
- **Badge flash on new entry.** With no toast, urgent notifications only signal via badge color and number. If the user is looking elsewhere, would a brief flash animation on increment help discoverability? Default proposal: ship without it, add if real-use feedback shows users miss notifications.
- **Bulk-ack interaction with cancel.** Should `cancel` (the action-row × button) and `acknowledge` (fyi bulk button) ever coexist on one selection? Currently they don't — checkboxes are fyi-only, × is action-only — but if a user wants to clear out a mixed batch, no single gesture covers it. Default proposal: live with the asymmetry; mixed clearing happens by doing each side in turn.

## Hyperlink behaviours (validated under PR 3 of `feat-encore.md`)

`action`-lifecycle entries with a `navigateTarget` exercise two distinct close-call patterns from the plugin side. Both are first-class citizens of the model — the engine doesn't distinguish them — but they're worth flagging because they cover the full range of plugin-driven `clear` timing:

- **Clear on open** (read-once). The user clicks the row, the panel closes, the deep-link target opens, and the landing page calls `notifier.clear` on mount. Useful for "your daily digest is ready" or "we drafted a summary" — the act of viewing is the close. The notification stays in Active until the user actually navigates; clicking and abandoning the navigation does not clear.
- **Clear on Done** (act-on). The user clicks the row, the panel closes, the deep-link target opens, the landing page renders a UI for the underlying obligation, and the user has to take an explicit action ("Done", "Mark paid", "Archive") for the plugin to call `notifier.clear`. Useful for "Pay property tax" or "Approve this PR" — opening the page does not by itself satisfy the obligation.

Both patterns share one URL contract: the panel appends `&notificationId=<uuid>` to the `navigateTarget`, and the landing page reads it from the route to know which entry to clear.

## Out of scope

- **Snooze / re-surface** — the engine doesn't yet support time-based scheduling (PR 3 of `feat-encore.md` adds it). When it lands, the panel will need a per-row snooze affordance, but the layout above doesn't preclude that — a snooze button can sit alongside `×`.
- **Per-plugin filtering inside the panel.** The panel shows one global queue. If the user wants to see only Encore items, they go to the Encore page, not the bell.
- **Cross-device delivery, mobile push, digest summaries.** All deferred per `feat-encore.md` Notifier v1 scope.
