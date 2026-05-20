# File-drop visual affordance (#1289 Step 1)

## Goal

Show the user that drag-and-drop is recognised by the chat input. Before this PR, the textarea wrapper silently accepted drops but nothing on screen confirmed the target was a drop zone — a near miss often ended with the browser navigating to the file. Per the user's direction, this PR delivers **only the visual cue on the existing drop zone**; widening the drop zone to the full chat panel + window-wide default suppression (the rest of #1289) is the next step.

## Approach

1. Add `isDragging` state in `ChatInput.vue`, driven by a counter pattern.
2. Wire `@dragenter` / `@dragleave` on the existing wrapper, guarded so only file drags (`dataTransfer.types.includes("Files")`) flip the state — text-selection drags inside the page must NOT show the overlay.
3. When `isDragging`, render an absolute-inset overlay with a dashed border, soft background tint, and a centred hint pill. `pointer-events-none` so it never absorbs the drop — the real handler stays on the wrapper.
4. Force `dragEnterCount` back to zero in `onDropFile` so a drop never leaves a stuck overlay.
5. Add `chatInput.dropHint` to all 8 locales (en / ja / zh / ko / es / pt-BR / fr / de) — kept short ("Drop file to attach" / "ファイルをドロップして添付" / …).

## Why the counter pattern

`dragenter` and `dragleave` fire on the bubbling target, not just the wrapper. Moving the pointer between the textarea, send button, and attach button inside the wrapper fires a flurry of pairs (enter on the new child + leave from the old). A naive boolean toggle flickers the overlay. The standard fix is a counter — every enter increments, every leave decrements; the overlay stays visible while the count is positive.

## What this does NOT do (Step 2, deferred)

- Widen the drop zone to the entire chat panel (messages + input).
- Add a `window` `dragover`/`drop` listener with `preventDefault` to stop the browser from opening the file when the user misses the panel.
- Move the overlay above the messages region.

Per user direction, those changes ride a follow-up after we confirm the visual cue lands well. Issue #1289 stays open for Step 2.

## Test plan

- [x] e2e: dragenter with a File shows the overlay; drop clears it (`chat-drop-overlay` testid).
- [x] e2e: a text-selection drag (`text/plain` only, no `Files` type) does NOT show the overlay.
- [x] e2e: child-element enter/leave pairs don't flicker the overlay (counter pattern verified by sending an enter on the wrapper, then an enter+leave pair on the textarea, then asserting the overlay is still visible).
- [x] `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- [ ] Manual: open the chat, drag a file from Finder/Explorer/Files — overlay should appear when the pointer enters the input panel and disappear after drop or when the file leaves the panel.

## Acceptance

- Overlay appears the instant a file enters the chat input wrapper.
- Overlay disappears on drop (success or failure paths).
- Overlay stays open while the pointer moves between child elements inside the wrapper.
- Text-selection drags do not trigger the overlay.
- All 8 locales carry the hint string.
- Issue #1289 remains open with Step 2 (panel-wide drop zone + window-level default suppression) as the remaining scope.
