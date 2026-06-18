<template>
  <div class="h-full overflow-x-auto overflow-y-hidden" data-testid="collection-kanban">
    <div class="flex gap-3 h-full p-1 min-w-max">
      <div
        v-for="column in columns"
        :key="column.value"
        :data-testid="`collection-kanban-column-${column.value || 'uncategorized'}`"
        class="w-72 shrink-0 flex flex-col bg-slate-100 rounded-lg"
      >
        <!-- Column header (columns are NOT draggable: order is fixed by the
             enum's declared `values`). -->
        <div class="flex items-center justify-between px-3 py-2 border-b border-slate-200">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0" :class="resolveEnumColor(schema, groupField, column.value).dot" />
            <span class="font-semibold text-xs text-slate-600 truncate" :title="column.label">{{ column.label }}</span>
          </div>
          <span class="text-[11px] text-slate-400 shrink-0">{{ itemsByColumn(column.value).length }}</span>
        </div>

        <!-- Cards. Dragging a card to another column writes the group field
             (no manual ordering within a column). -->
        <draggable
          :model-value="itemsByColumn(column.value)"
          :item-key="schema.primaryKey"
          group="collection-kanban-cards"
          class="flex-1 overflow-y-auto p-2 space-y-2 min-h-[2rem]"
          :animation="150"
          @change="(e: DragChangeEvent) => onDragChange(column.value, e)"
        >
          <template #item="{ element }: { element: CollectionItem }">
            <div
              :data-testid="`collection-kanban-card-${itemId(element)}`"
              tabindex="0"
              role="button"
              :aria-label="t('collectionsView.kanbanOpenCard', { label: itemLabel(element) })"
              class="bg-white border border-slate-200 rounded shadow-sm p-2 cursor-grab hover:shadow active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              :class="[itemId(element) === selected ? 'ring-2 ring-indigo-500 border-indigo-300' : '', notifyAccentClass(element)]"
              @click="emit('select', itemId(element))"
              @keydown.enter.prevent.self="(e) => !e.repeat && emit('select', itemId(element))"
              @keydown.space.prevent.self="(e) => !e.repeat && emit('select', itemId(element))"
            >
              <div class="flex items-start gap-2">
                <!-- Toggle checkbox (when the schema has a toggle projecting
                     this board's group field). Checking it sets the group
                     field, so the card also moves columns. -->
                <input
                  v-if="cardToggle"
                  type="checkbox"
                  :checked="cardChecked(element)"
                  class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer shrink-0"
                  :aria-label="cardToggle.label"
                  :data-testid="`collection-kanban-toggle-${itemId(element)}`"
                  @click.stop
                  @change="onCardToggle(element)"
                />
                <div class="text-sm font-medium text-slate-800 truncate">{{ itemLabel(element) }}</div>
              </div>
            </div>
          </template>
        </draggable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import draggable from "vuedraggable";
import { fieldVisible } from "../../core/actionVisible";
import { resolveEnumColor } from "../../core/enumColors";
import type { CollectionNotifySeverity as NotifierSeverity } from "../../core/uiTypes";
import type { CollectionItem, CollectionSchema } from "../../core/schema";

// vuedraggable @change shape — same three keys as the todo board. We act
// only on "added" (the destination column): a cross-column move emits a
// paired "removed" on the source, and "moved" is a within-column reorder
// we deliberately ignore (no manual ordering).
interface DragChangeEvent {
  added?: { newIndex: number; element: CollectionItem };
  moved?: { newIndex: number; oldIndex: number; element: CollectionItem };
  removed?: { oldIndex: number; element: CollectionItem };
}

const props = defineProps<{
  schema: CollectionSchema;
  /** The `enum` field whose value groups records into columns. */
  groupField: string;
  items: CollectionItem[];
  /** Primary-key of the currently-open record (highlighted card). */
  selected?: string;
  /** Primary-key → active-notification severity. Cards with a notification get
   *  a left accent in the matching bell colour (urgent red / nudge amber). */
  notified?: Map<string, NotifierSeverity>;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  /** Card dropped in a column: set the group field to `value` (the empty
   *  string means the Uncategorized column → clear the field). */
  move: [id: string, value: string];
}>();

const { t } = useI18n();

/** The Uncategorized column uses the empty string as its sentinel value. */
const UNCATEGORIZED = "";

interface KanbanColumn {
  value: string;
  label: string;
}

const groupSpec = computed(() => props.schema.fields[props.groupField]);

/** Declared enum values become columns in order, with a trailing
 *  Uncategorized column for empty/unknown values (also a drop target that
 *  clears the field). The Uncategorized column is omitted when the group
 *  field is `required` — there's no valid "no value" state to drop into,
 *  and clearing via it would only produce a rejected PUT. */
const columns = computed<KanbanColumn[]>(() => {
  const values = groupSpec.value?.values ?? [];
  const declared = values.map((value) => ({ value, label: value }));
  // Skip the trailing Uncategorized column when the group field is
  // `required` (no valid "no value" state), or when the enum already
  // declares an empty-string value (it would collide with the
  // Uncategorized sentinel's `value`/`:key`).
  if (groupSpec.value?.required || values.includes(UNCATEGORIZED)) return declared;
  return [...declared, { value: UNCATEGORIZED, label: t("collectionsView.kanbanUncategorized") }];
});

function itemId(item: CollectionItem): string {
  return String(item[props.schema.primaryKey] ?? "");
}

// Left-accent class per notification severity — the same red/amber the bell
// uses (see NotificationBell's severity colours), so a flagged card matches
// the badge. Empty string when the record has no active notification.
const NOTIFY_ACCENT: Record<NotifierSeverity, string> = {
  urgent: "border-l-4 border-l-red-500",
  nudge: "border-l-4 border-l-amber-500",
  info: "border-l-4 border-l-slate-400",
};

function notifyAccentClass(item: CollectionItem): string {
  const severity = props.notified?.get(itemId(item));
  return severity ? NOTIFY_ACCENT[severity] : "";
}

/** Card label: the schema's `displayField` value, else the primary key. */
function itemLabel(item: CollectionItem): string {
  const field = props.schema.displayField;
  if (field) {
    const value = item[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return itemId(item);
}

/** Which column a record belongs to: its group value when that value is
 *  one of the declared enum values, else Uncategorized. */
function columnOf(item: CollectionItem): string {
  const raw = item[props.groupField];
  if (raw === undefined || raw === null || raw === "") return UNCATEGORIZED;
  const value = String(raw);
  return (groupSpec.value?.values ?? []).includes(value) ? value : UNCATEGORIZED;
}

// Records to place on the board. A record whose group field is hidden by a
// `when` predicate is dropped entirely (its column membership is undefined
// while hidden), per the Kanban spec.
const visibleItems = computed<CollectionItem[]>(() => (groupSpec.value ? props.items.filter((item) => fieldVisible(groupSpec.value, item)) : []));

const itemsByColumnMap = computed<Map<string, CollectionItem[]>>(() => {
  const map = new Map<string, CollectionItem[]>();
  for (const column of columns.value) map.set(column.value, []);
  for (const item of visibleItems.value) {
    const value = columnOf(item);
    (map.get(value) ?? map.get(UNCATEGORIZED))?.push(item);
  }
  return map;
});

function itemsByColumn(value: string): CollectionItem[] {
  return itemsByColumnMap.value.get(value) ?? [];
}

function onDragChange(columnValue: string, event: DragChangeEvent): void {
  if (event.added) emit("move", itemId(event.added.element), columnValue);
}

// A `toggle` field that projects THIS board's group field — rendered as a
// per-card checkbox. Checking it writes the group field (so the card also
// changes column), reusing the same `move` event as a drag.
const cardToggle = computed(() => {
  for (const spec of Object.values(props.schema.fields)) {
    if (spec.type === "toggle" && spec.field === props.groupField) return spec;
  }
  return null;
});

function cardChecked(item: CollectionItem): boolean {
  const toggle = cardToggle.value;
  return toggle !== null && String(item[props.groupField] ?? "") === toggle.onValue;
}

function onCardToggle(item: CollectionItem): void {
  const toggle = cardToggle.value;
  if (!toggle) return;
  const next = cardChecked(item) ? toggle.offValue : toggle.onValue;
  if (next === undefined) return;
  emit("move", itemId(item), next);
}
</script>
