<template>
  <!-- Shared 50/50 split layout for the Marp source editor + live
       preview. Used both by the markdown plugin's chat view
       (`src/plugins/markdown/View.vue`, #1658) and by the File
       Explorer (`src/components/FileContentRenderer.vue`, #1663).
       The layout-critical sizing is set inline because the markdown
       plugin renders under `.stack-natural` (StackView), which
       neutralises `.h-full`, `.overflow-hidden`, and
       `.flex-col > .flex-1` via `:deep(...) { ... !important }`. Inline
       styles aren't matched by those class-targeted rules. -->
  <div style="height: min(80vh, 720px); display: flex; overflow: hidden">
    <div style="display: flex; flex-direction: column; flex: 1 1 50%; min-width: 0; min-height: 0; border-right: 1px solid #e0e0e0">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
        <span class="text-xs text-gray-500 mr-auto">{{ editorLabel }}</span>
        <slot name="actions" />
      </div>
      <slot name="error" />
      <textarea
        :value="modelValue"
        :aria-label="editorLabel"
        class="marp-split-textarea"
        style="flex: 1 1 0; min-height: 0"
        spellcheck="false"
        @input="onInput"
      ></textarea>
    </div>
    <div style="flex: 1 1 50%; min-width: 0; min-height: 0; overflow-y: auto">
      <MarpView :markdown="modelValue" :pdf-filename="pdfFilename" :base-dir="baseDir">
        <template #toolbar>
          <slot name="preview-toolbar" />
        </template>
      </MarpView>
    </div>
  </div>
</template>

<script setup lang="ts">
import MarpView from "./MarpView.vue";

defineProps<{
  modelValue: string;
  pdfFilename: string;
  baseDir?: string;
  editorLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}
</script>

<style scoped>
.marp-split-textarea {
  width: 100%;
  padding: 1rem;
  background: #ffffff;
  border: none;
  border-radius: 0;
  color: #333;
  font-family: "Courier New", monospace;
  font-size: 0.9rem;
  resize: none;
  line-height: 1.5;
}

.marp-split-textarea:focus {
  outline: none;
}
</style>
