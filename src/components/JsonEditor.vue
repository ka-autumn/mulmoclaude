<template>
  <div class="flex flex-col min-h-0">
    <div class="shrink-0 flex items-center gap-0.5 mb-1">
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        data-testid="files-json-undo-btn"
        :disabled="!canUndo"
        :title="t('fileContentRenderer.undo')"
        :aria-label="t('fileContentRenderer.undo')"
        @click="doUndo"
      >
        <span class="material-icons text-base" aria-hidden="true">undo</span>
      </button>
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        data-testid="files-json-redo-btn"
        :disabled="!canRedo"
        :title="t('fileContentRenderer.redo')"
        :aria-label="t('fileContentRenderer.redo')"
        @click="doRedo"
      >
        <span class="material-icons text-base" aria-hidden="true">redo</span>
      </button>
    </div>
    <div ref="host" data-testid="files-json-editor" class="flex-1 min-h-0 cm-json-host border border-gray-300 rounded overflow-hidden"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { lintGutter, linter } from "@codemirror/lint";

const props = defineProps<{
  modelValue: string;
  editorLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const { t } = useI18n();

const host = ref<HTMLElement | null>(null);
// Drive the toolbar buttons' enabled state from CM6 history depth so
// it's obvious when there's nothing to undo / redo.
const canUndo = ref(false);
const canRedo = ref(false);
let view: EditorView | null = null;
// True only while we're pushing an external modelValue into the view,
// so the resulting update doesn't echo back as an emit (feedback loop).
let applyingExternal = false;
// Holds the aria-label content attribute so it can be hot-swapped via
// reconfigure when the locale (and thus editorLabel) changes while the
// editor is open — parity with the old reactive `:aria-label`.
const labelCompartment = new Compartment();

function syncHistoryDepth(state: EditorState): void {
  canUndo.value = undoDepth(state) > 0;
  canRedo.value = redoDepth(state) > 0;
}

function doUndo(): void {
  if (view) {
    undo(view);
    view.focus();
  }
}

function doRedo(): void {
  if (view) {
    redo(view);
    view.focus();
  }
}

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      json(),
      // Inline parse-error squiggle as you type — complements the
      // server-side 400 (defence in depth, faster feedback).
      linter(jsonParseLinter()),
      lintGutter(),
      // Accessible name for the contenteditable (a11y; mirrors the
      // old <textarea aria-label>). In a Compartment so a locale
      // change can reconfigure it live.
      labelCompartment.of(EditorView.contentAttributes.of({ "aria-label": props.editorLabel })),
      EditorView.theme({
        "&": { fontSize: "12px" },
        ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
        "&.cm-focused": { outline: "2px solid rgb(96 165 250)" },
        ".cm-scroller": { overflow: "auto" },
      }),
      EditorView.updateListener.of((update) => {
        // Recompute on every transaction — undo/redo availability
        // changes on history events, not only doc edits.
        syncHistoryDepth(update.state);
        if (!update.docChanged || applyingExternal) return;
        emit("update:modelValue", update.state.doc.toString());
      }),
    ],
  });
}

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({ state: createState(props.modelValue), parent: host.value });
  syncHistoryDepth(view.state);
});

// External resets (e.g. jsonDraft re-seeded on Edit / file switch).
// Only reconcile when the value genuinely differs from the editor's
// current doc, so normal typing isn't clobbered mid-keystroke.
watch(
  () => props.modelValue,
  (next) => {
    if (!view || next === view.state.doc.toString()) return;
    applyingExternal = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    applyingExternal = false;
  },
);

// Locale can change while the editor is open — keep the accessible
// name in sync (parity with the old reactive `<textarea :aria-label>`).
watch(
  () => props.editorLabel,
  (label) => {
    view?.dispatch({ effects: labelCompartment.reconfigure(EditorView.contentAttributes.of({ "aria-label": label })) });
  },
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<style scoped>
.cm-json-host :deep(.cm-editor) {
  height: 100%;
}
</style>
