<template>
  <!-- Edit / Create panel (in-place, detail-style grid layout). Shown
       when an edit draft is active; otherwise the read-only detail. This
       is the panel body only — the host (table row or calendar) supplies
       the surrounding container. -->
  <form
    v-if="editing"
    class="px-6 py-5 max-h-[60vh] overflow-y-auto"
    :data-testid="editing.mode === 'create' ? 'collections-create' : 'collections-edit'"
    @submit.prevent="emit('submit')"
  >
    <div class="flex items-center gap-2 mb-4">
      <div class="flex-1 min-w-0">
        <span class="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">{{ collection.title }}</span>
        <h2 class="text-base font-bold text-slate-800 truncate" data-testid="collections-edit-title">
          {{ editing.mode === "create" ? t("collectionsView.createTitle") : (editing.originalId ?? "") }}
        </h2>
      </div>
      <button
        type="button"
        class="h-8 px-2.5 rounded text-xs font-bold text-slate-500 hover:bg-slate-200/50 transition-colors"
        data-testid="collections-editor-cancel"
        @click="emit('cancel')"
      >
        {{ t("common.cancel") }}
      </button>
      <button
        type="submit"
        class="h-8 px-2.5 rounded bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm shadow-indigo-600/10"
        :disabled="saving"
        data-testid="collections-editor-save"
      >
        {{ saving ? t("common.saving") : t("common.save") }}
      </button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm">
      <template v-for="(field, key) in collection.schema.fields" :key="key">
        <!-- `toggle` is a projection of an enum field — that enum has its own
             input here, so the toggle isn't a separate editable control. -->
        <div
          v-if="field.type !== 'toggle' && fieldVisible(field, liveRecord ?? {}) && (!field.primary || editing.mode === 'create')"
          class="flex flex-col gap-1.5"
          :class="['table', 'markdown', 'embed'].includes(field.type) ? 'col-span-full' : 'col-span-1'"
        >
          <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1" :for="`collections-field-${key}`">
            {{ field.label }}
            <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "*" is a universal required-field glyph; treating it as i18n copy would force eight translations of the same symbol. -->
            <span v-if="field.required" class="text-rose-500 font-bold">*</span>
          </label>

          <!-- Boolean checkbox -->
          <label v-if="field.type === 'boolean'" class="inline-flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input
              :id="`collections-field-${key}`"
              v-model="editing.bool[key]"
              type="checkbox"
              class="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer"
              :data-testid="`collections-input-${key}`"
              @change="markBoolTouched(String(key))"
            />
            <span class="text-xs font-semibold" :class="editing.bool[key] ? 'text-indigo-600' : 'text-slate-500'">
              {{ editing.bool[key] ? t("common.yes") : t("common.no") }}
            </span>
          </label>

          <!-- Embed card (read-only) -->
          <CollectionEmbedView v-else-if="field.type === 'embed' && embedViews[key]" :view="embedViews[key]" :field-key="String(key)" />

          <!-- Ref selector -->
          <select
            v-else-if="field.type === 'ref' && field.to && render.refOptions(field.to).length > 0"
            :id="`collections-field-${key}`"
            v-model="editing.text[key]"
            :required="isFieldRequiredInUi(field)"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 hover:bg-slate-50/50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all cursor-pointer font-medium text-slate-700"
            :data-testid="`collections-input-${key}`"
          >
            <option value="">{{ t("collectionsView.selectPlaceholder") }}</option>
            <option v-for="opt in render.refOptions(field.to)" :key="opt.slug" :value="opt.slug">{{ opt.display }}</option>
          </select>

          <!-- Enum selector -->
          <select
            v-else-if="field.type === 'enum' && Array.isArray(field.values) && field.values.length > 0"
            :id="`collections-field-${key}`"
            v-model="editing.text[key]"
            :required="isFieldRequiredInUi(field)"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 hover:bg-slate-50/50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all cursor-pointer font-medium text-slate-700"
            :data-testid="`collections-input-${key}`"
          >
            <option value="">{{ t("collectionsView.selectPlaceholder") }}</option>
            <option v-for="value in field.values" :key="value" :value="value">{{ value }}</option>
          </select>

          <!-- Nested Table editor -->
          <div
            v-else-if="field.type === 'table' && field.of"
            class="border border-slate-200 bg-slate-50/30 rounded-xl p-4 space-y-3"
            :data-testid="`collections-table-${key}`"
          >
            <div v-if="editing.table[key] && editing.table[key].length > 0" class="overflow-hidden border border-slate-200 rounded-lg shadow-sm">
              <table class="w-full text-xs text-slate-600 bg-white">
                <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th v-for="(subField, subKey) in field.of" :key="subKey" class="text-left px-3 py-2 font-bold">{{ subField.label }}</th>
                    <th class="w-9"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr v-for="(row, rowIdx) in editing.table[key]" :key="rowIdx" class="hover:bg-slate-50/50">
                    <td v-for="(subField, subKey) in field.of" :key="subKey" class="px-2 py-1.5 align-middle">
                      <input
                        v-if="subField.type === 'boolean'"
                        v-model="row.bool[subKey]"
                        type="checkbox"
                        class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer"
                        @change="markRowBoolTouched(row, String(subKey))"
                      />
                      <select
                        v-else-if="subField.type === 'enum' && Array.isArray(subField.values) && subField.values.length > 0"
                        v-model="row.text[subKey]"
                        :required="subField.required"
                        class="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none cursor-pointer bg-slate-50 font-medium"
                      >
                        <option value="">{{ t("collectionsView.selectPlaceholder") }}</option>
                        <option v-for="value in subField.values" :key="value" :value="value">{{ value }}</option>
                      </select>
                      <select
                        v-else-if="subField.type === 'ref' && subField.to && render.refOptions(subField.to).length > 0"
                        v-model="row.text[subKey]"
                        :required="subField.required"
                        class="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none cursor-pointer bg-slate-50 font-medium"
                      >
                        <option value="">{{ t("collectionsView.selectPlaceholder") }}</option>
                        <option v-for="opt in render.refOptions(subField.to)" :key="opt.slug" :value="opt.slug">{{ opt.display }}</option>
                      </select>
                      <div v-else-if="subField.type === 'money'" class="relative flex items-center">
                        <span class="absolute left-1.5 text-[10px] text-slate-400 font-bold pr-1 border-r border-slate-200">{{
                          render.currencySymbol(render.resolveCurrency(subField, liveRecord))
                        }}</span>
                        <input
                          v-model="row.text[subKey]"
                          type="number"
                          step="0.01"
                          :required="subField.required"
                          class="w-full rounded-lg border border-slate-200 pl-6 pr-1.5 py-1 text-xs focus:border-indigo-500 focus:outline-none font-semibold text-slate-800"
                        />
                      </div>
                      <input
                        v-else
                        v-model="row.text[subKey]"
                        :type="render.inputTypeFor(subField.type)"
                        :required="subField.required"
                        class="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none font-medium text-slate-700"
                      />
                    </td>
                    <td class="text-center px-1">
                      <button
                        type="button"
                        class="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        :aria-label="t('collectionsView.removeRow')"
                        :data-testid="`collections-table-${key}-remove-${rowIdx}`"
                        @click="removeTableRow(String(key), rowIdx)"
                      >
                        <span class="material-icons text-base">close</span>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="text-xs text-slate-400 italic">{{ t("collectionsView.noRows") }}</p>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
              :data-testid="`collections-table-${key}-add`"
              @click="addTableRow(String(key), field.of)"
            >
              <span class="material-icons text-xs">add</span>
              <span>{{ t("collectionsView.addRow") }}</span>
            </button>
          </div>

          <!-- Derived formula field -->
          <div v-else-if="field.type === 'derived'" class="relative flex items-center">
            <span class="absolute left-3 text-indigo-500 font-bold text-[9px] uppercase select-none tracking-wider">{{
              t("collectionsView.derivedLabel")
            }}</span>
            <input
              :id="`collections-field-${key}`"
              :value="render.derivedDisplay(field, liveDerived?.[key] ?? null, liveRecord)"
              type="text"
              disabled
              class="w-full rounded-xl border border-indigo-100 bg-indigo-50/15 pl-16 pr-3 py-2 text-xs font-bold text-indigo-700 select-none cursor-not-allowed"
              :data-testid="`collections-input-${key}`"
            />
          </div>

          <!-- Money input field -->
          <div v-else-if="field.type === 'money'" class="relative flex items-center">
            <div class="absolute left-3 text-slate-400 font-bold text-xs select-none pr-1.5 border-r border-slate-200">
              {{ render.currencySymbol(render.resolveCurrency(field, liveRecord)) }}
            </div>
            <input
              :id="`collections-field-${key}`"
              v-model="editing.text[key]"
              type="number"
              step="0.01"
              :required="isFieldRequiredInUi(field)"
              class="w-full rounded-xl border border-slate-200 pl-11 pr-3 py-2 text-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none font-semibold text-slate-800 transition-all"
              :data-testid="`collections-input-${key}`"
            />
          </div>

          <!-- Scalar inputs -->
          <input
            v-else-if="['string', 'email', 'number', 'date', 'datetime', 'ref', 'image'].includes(field.type)"
            :id="`collections-field-${key}`"
            v-model="editing.text[key]"
            :type="render.inputTypeFor(field.type)"
            :required="isFieldRequiredInUi(field)"
            :disabled="field.primary === true && (editing.mode === 'edit' || isSingleton)"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 font-medium text-slate-700 transition-all"
            :data-testid="`collections-input-${key}`"
          />

          <!-- Markdown or long text -->
          <textarea
            v-else
            :id="`collections-field-${key}`"
            v-model="editing.text[key]"
            :rows="field.type === 'markdown' ? 5 : 3"
            :required="isFieldRequiredInUi(field)"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none font-medium text-slate-700 transition-all"
            :data-testid="`collections-input-${key}`"
          />
        </div>
      </template>
      <p v-if="saveError" class="col-span-full text-xs font-semibold text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-xl">
        {{ saveError }}
      </p>
    </div>
  </form>

  <!-- Read-only detail panel -->
  <div v-else-if="viewing" data-testid="collections-detail" class="px-6 py-5 max-h-[60vh] overflow-y-auto">
    <div class="flex items-center gap-2 mb-4">
      <div class="flex-1 min-w-0">
        <span class="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">{{ collection.title }}</span>
        <h2 class="text-base font-bold text-slate-800 truncate" data-testid="collections-detail-title">{{ viewTitle }}</h2>
      </div>
      <div class="flex items-center gap-2">
        <!-- Dynamic Actions -->
        <button
          v-for="action in visibleActions"
          :key="action.id"
          type="button"
          class="h-8 px-2.5 rounded border border-indigo-200 bg-indigo-50/50 text-indigo-600 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 font-bold text-xs transition-all flex items-center gap-1 disabled:opacity-50"
          :disabled="actionPending"
          :data-testid="`collections-detail-action-${action.id}`"
          @click="emit('runAction', action)"
        >
          <span v-if="action.icon" class="material-icons text-sm">{{ action.icon }}</span>
          <span>{{ action.label }}</span>
        </button>

        <button
          type="button"
          class="h-8 px-2.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-bold text-xs transition-all flex items-center gap-1"
          data-testid="collections-detail-edit"
          @click="emit('edit')"
        >
          <span class="material-icons text-sm">edit</span>
          <span>{{ t("collectionsView.editItem") }}</span>
        </button>

        <button
          type="button"
          class="h-8 px-2.5 rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 font-bold text-xs transition-all flex items-center gap-1"
          data-testid="collections-detail-remove"
          @click="emit('delete')"
        >
          <span class="material-icons text-sm">delete</span>
          <span>{{ t("common.remove") }}</span>
        </button>

        <button
          type="button"
          class="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          :aria-label="t('common.close')"
          data-testid="collections-detail-close"
          @click="emit('close')"
        >
          <span class="material-icons text-lg">close</span>
        </button>
      </div>
    </div>

    <p
      v-if="actionError"
      class="mb-3 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-xl shadow-sm"
      data-testid="collections-detail-action-error"
    >
      {{ actionError }}
    </p>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm">
      <template v-for="(field, key) in collection.schema.fields" :key="key">
        <div
          v-if="fieldVisible(field, viewing ?? {}) && !field.primary"
          class="flex flex-col gap-1"
          :class="['table', 'markdown', 'embed', 'image'].includes(field.type) ? 'col-span-full' : 'col-span-1'"
        >
          <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider select-none">{{ field.label }}</div>

          <div class="text-xs font-medium text-slate-700 break-words" :data-testid="`collections-detail-value-${key}`">
            <!-- Toggle state (read-only reflection of the projected enum). -->
            <template v-if="field.type === 'toggle'">
              <span
                v-if="field.field !== undefined && String(viewing[field.field] ?? '') === field.onValue"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/40"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                {{ t("common.yes") }}
              </span>
              <span
                v-else
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-400 border border-slate-200/20"
              >
                {{ t("common.no") }}
              </span>
            </template>

            <!-- Boolean state -->
            <template v-else-if="field.type === 'boolean'">
              <span
                v-if="viewing[key] === true"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/40"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                {{ t("common.yes") }}
              </span>
              <span
                v-else-if="viewing[key] === false"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-400 border border-slate-200/20"
              >
                {{ t("common.no") }}
              </span>
              <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "—" for an omitted boolean: distinct from an explicit false. -->
              <span v-else class="text-slate-300">—</span>
            </template>

            <!-- Ref details link -->
            <router-link
              v-else-if="field.type === 'ref' && field.to && typeof viewing[key] === 'string' && viewing[key]"
              :to="{ path: `/collections/${field.to}`, query: { selected: String(viewing[key]) } }"
              class="text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
              :data-testid="`collections-detail-ref-${key}`"
              >{{ render.refDisplay(field.to, String(viewing[key])) }}</router-link
            >

            <!-- Money format -->
            <span v-else-if="field.type === 'money'" class="font-semibold text-slate-900 tabular-nums text-sm">{{
              render.formatMoney(viewing[key], render.resolveCurrency(field, viewing), locale)
            }}</span>

            <!-- Derived formula badge -->
            <span
              v-else-if="field.type === 'derived'"
              class="inline-block truncate tabular-nums font-bold text-indigo-900 bg-indigo-50/50 px-2 py-0.5 rounded border border-indigo-100/50"
              >{{ render.derivedDisplay(field, render.evaluateDerivedAgainstItem(field, String(key), viewing), viewing) }}</span
            >

            <!-- Sub table -->
            <div
              v-else-if="field.type === 'table' && field.of && render.hasTableRows(viewing[key])"
              class="border border-slate-200/80 rounded-xl overflow-hidden shadow-sm mt-1"
            >
              <table class="w-full text-[11px] text-slate-600 bg-white">
                <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th v-for="(subField, subKey) in field.of" :key="subKey" class="text-left px-4 py-2 font-bold">{{ subField.label }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr v-for="(row, rowIdx) in render.tableRows(viewing[key])" :key="rowIdx" class="hover:bg-slate-50/50">
                    <td v-for="(subField, subKey) in field.of" :key="subKey" class="px-4 py-2 align-middle font-medium">
                      <template v-if="subField.type === 'boolean'">
                        <span v-if="row[subKey] === true" class="material-icons text-emerald-600 text-base">check_circle</span>
                        <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "—" empty-value glyph (boolean=false), same as elsewhere. -->
                        <span v-else class="text-slate-300">—</span>
                      </template>
                      <span v-else :class="[subField.type === 'money' ? 'font-bold text-slate-800 tabular-nums' : '']">{{
                        render.formatSubCell(subField, row[subKey], viewing)
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <span v-else-if="field.type === 'table'" class="text-slate-400 italic">{{ t("collectionsView.noRows") }}</span>

            <!-- Markdown blocks with scroll area -->
            <div
              v-else-if="field.type === 'markdown'"
              class="bg-slate-50 rounded-xl p-4 border border-slate-200/60 text-slate-600 text-xs whitespace-pre-wrap leading-relaxed max-h-[30vh] overflow-y-auto"
            >
              {{ render.detailText(viewing[key]) }}
            </div>

            <!-- Embed view -->
            <CollectionEmbedView v-else-if="field.type === 'embed' && embedViews[key]" :view="embedViews[key]" :field-key="String(key)" />

            <!-- Image (workspace-relative path → <img> via auth-exempt /api/files/raw) -->
            <img
              v-else-if="field.type === 'image' && typeof viewing[key] === 'string' && viewing[key]"
              :src="resolveImageSrc(String(viewing[key]))"
              :alt="field.label"
              class="max-h-64 max-w-full object-contain rounded-lg border border-slate-200 bg-slate-50"
              :data-testid="`collections-detail-image-${key}`"
            />

            <!-- URL string → external link (new tab). -->
            <a
              v-else-if="render.isExternalUrl(viewing[key])"
              :href="String(viewing[key])"
              target="_blank"
              rel="noopener noreferrer"
              class="text-blue-600 hover:text-blue-800 font-semibold hover:underline break-all"
              :data-testid="`collections-detail-url-${key}`"
              >{{ String(viewing[key]) }}</a
            >

            <!-- Fallback text styling -->
            <span v-else class="text-slate-800 font-semibold">{{ render.formatCell(viewing[key], field.type) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CollectionEmbedView from "./CollectionEmbedView.vue";
import { fieldVisible } from "../utils/collections/actionVisible";
import { emptyRow } from "../utils/collections/draft";
import { resolveImageSrc } from "../utils/image/resolve";
import type { CollectionRendering } from "../composables/collections/useCollectionRendering";
import type { CollectionAction, CollectionDetail, CollectionItem, EditState, FieldSpec, TableRowDraft } from "./collectionTypes";

const props = defineProps<{
  collection: CollectionDetail;
  /** Open record in read-only mode, or null. */
  viewing: CollectionItem | null;
  saving: boolean;
  saveError: string | null;
  actionError: string | null;
  actionPending: boolean;
  visibleActions: CollectionAction[];
  /** Live record computed from the draft (drives derived previews). */
  liveRecord: CollectionItem | null;
  /** Live record with derived fields resolved. */
  liveDerived: CollectionItem | null;
  viewTitle: string;
  isSingleton: boolean;
  /** Shared rendering/derivation helpers + ref/embed caches. */
  render: CollectionRendering;
  locale: string;
}>();

// The edit/create draft is a two-way model: the form's v-model bindings and
// the table-row mutators write into its nested reactive state (the parent
// owns the object identity, so in-place edits flow straight back). A model
// rather than a prop so `vue/no-mutating-props` doesn't fire on the form.
const editing = defineModel<EditState | null>("editing", { required: true });

const emit = defineEmits<{
  submit: [];
  cancel: [];
  edit: [];
  close: [];
  delete: [];
  runAction: [action: CollectionAction];
}>();

const { t } = useI18n();

// `embedViews` is a ComputedRef nested in the `render` object, so it isn't
// auto-unwrapped in the template — re-expose it as a top-level computed.
const embedViews = computed(() => props.render.embedViews.value);

/** Mirror of the create-mode primary-key carve-out: drop the HTML5
 *  `required` flag on the primary field while creating so the browser
 *  doesn't block an intentionally-blank primary (server generates the id). */
function isFieldRequiredInUi(field: FieldSpec): boolean {
  if (!field.required) return false;
  if (editing.value?.mode === "create" && field.primary === true) return false;
  return true;
}

// The edit-draft mutators write the model's nested reactive state — the same
// object the form's v-model bindings mutate, so no parent round-trip needed.
function markBoolTouched(key: string): void {
  if (editing.value) editing.value.boolTouched[key] = true;
}

function markRowBoolTouched(row: TableRowDraft, subKey: string): void {
  row.boolTouched[subKey] = true;
}

function addTableRow(key: string, subFields: Record<string, FieldSpec>): void {
  if (!editing.value) return;
  const rows = editing.value.table[key] ?? [];
  rows.push(emptyRow(subFields));
  editing.value.table[key] = rows;
}

function removeTableRow(key: string, index: number): void {
  if (!editing.value) return;
  const rows = editing.value.table[key];
  if (rows) rows.splice(index, 1);
}
</script>
