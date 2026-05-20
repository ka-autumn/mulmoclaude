# Widen file drop to chat panel + window default guard (#1289 Step 2)

## Goal

Step 1 (#1327) showed a dashed overlay when a file enters the chat **input** wrapper. Step 2 widens that drop zone to the whole **chat panel** (messages + thinking indicator + input) and installs a window-level guard so a near-miss outside the panel doesn't navigate the browser to the dropped file. This closes the original UX problem in #1289 — losing the in-progress conversation because the drop zone was too small.

## Approach

1. **New composable `useFileDropZone`** owns the drag state + handlers + window guard:
   - `isDragging` ref + counter pattern (already established in Step 1).
   - `dataTransfer.types.includes("Files")` guard so text-selection drags inside the page never trigger.
   - **Window-level guard** (lazy, install-once across all consumers): `window.addEventListener("dragover"/"drop", preventDefault)` for file drags only. Without this, missing the drop zone leaves the browser to navigate away and lose the conversation.
   - Returns `{ isDragging, onDragenter, onDragover, onDragleave, onDrop }` for the consumer to wire onto the target element.
2. **New component `FileDropOverlay.vue`** — the visual cue (dashed border + hint pill). Same i18n key `chatInput.dropHint` as Step 1; no new locale strings. `pointer-events-none` so it never absorbs the drop.
3. **Strip the Step 1 drop machinery from `ChatInput.vue`**:
   - Remove the wrapper-level dragenter/dragover/dragleave/drop handlers.
   - Remove `isDragging` + counter + overlay markup.
   - Expose `readFile(file)` (alias for the existing `readAttachmentFile`) so the parent can route a panel-level drop into ChatInput's validation + emit pipeline.
4. **`App.vue`** wires the composable for both layouts using the same `chatInputRef`:
   - **Single layout** — handlers on the `data-testid="chat-sidebar"` div (already `relative`); overlay rendered inside. Drop anywhere over sessions list + thinking + input attaches the file.
   - **Stack layout** — handlers on the canvas column (where the stack chat lives). Conditional via `v-on="canvasDropHandlers"` so single-mode plugin pages (Files / Wiki / …) inside the canvas don't get hijacked. Overlay gated on `isPanelDragging && isStackLayout && isChatPage`.

## Why a window-level guard

`event.preventDefault()` on `dragover` AND `drop` is what blocks the browser's default "open the file" behaviour. Without listeners on `window`, a drop outside the chat panel navigates the browser to `file:///…`, killing the in-progress conversation. The guard is install-once (`windowGuardInstalled` flag) so multiple consumers don't double-bind. Only Files-type drags are suppressed — text-selection drags within the page keep their default behaviour.

## What this does NOT do

- Multi-file drops — still picks `files[0]` (`MAX_ATTACH_BYTES` and `pastedFile` are single-file by design).
- Drag-and-drop on plugin pages (Files / Wiki / …) — those handle their own input on their own terms; widening the chat-panel drop to cover them would be surprising.

## Test plan

- [x] Existing Step 1 e2e tests still pass — they dispatch DragEvents on `[data-testid=user-input]`'s grandparent (the `p-2` div). Step 1 had the listener on the ChatInput wrapper one level up; Step 2 moves it further up to the chat-sidebar / canvas column. The dispatched DragEvents bubble (`bubbles: true`) so the move is transparent to the tests.
- [x] `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- [ ] Manual single layout: drag a real file from Finder/Explorer over the sidebar — overlay appears anywhere within the panel (sessions / thinking / input). Drop attaches the file.
- [ ] Manual stack layout: same flow in the canvas column.
- [ ] Manual near-miss: drag over the panel, then RELEASE outside the panel — browser does NOT navigate to the file, conversation remains intact.

## Acceptance

- Drop anywhere inside the chat panel (single + stack) attaches the file via the existing `pastedFile` flow.
- Drop OUTSIDE the panel does nothing (browser does not navigate).
- Overlay covers the whole panel during a file drag and only during a file drag.
- Text-selection drags do not show the overlay.
- All 8 locales still carry the existing `chatInput.dropHint` (no new keys).
- `#1289` can be closed.
