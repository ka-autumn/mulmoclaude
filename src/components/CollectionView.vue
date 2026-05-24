<template>
  <div class="h-full flex flex-col">
    <header class="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
        :title="t('collectionsView.backToIndex')"
        :aria-label="t('collectionsView.backToIndex')"
        data-testid="collections-back"
        @click="goBack"
      >
        <span class="material-icons text-base">arrow_back</span>
      </button>
      <span v-if="collection" class="material-icons text-blue-600">{{ collection.icon }}</span>
      <h1 class="text-lg font-medium text-gray-900 flex-1 min-w-0 truncate">
        {{ collection?.title ?? t("collectionsView.title") }}
      </h1>
      <button
        v-if="collection"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-sm"
        data-testid="collections-add-item"
        @click="openCreate"
      >
        <span class="material-icons text-base">add</span>
        <span>{{ t("common.add") }}</span>
      </button>
    </header>

    <div class="flex-1 overflow-auto">
      <div v-if="loading" class="p-6 text-sm text-gray-500">{{ t("common.loading") }}</div>

      <div v-else-if="loadError" class="m-6 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ loadError === "not-found" ? t("collectionsView.notFound") : `${t("collectionsView.loadFailed")}: ${loadError}` }}
      </div>

      <div v-else-if="!collection">
        <!-- defensive: loading=false, error=null, collection=null -->
      </div>

      <div v-else-if="items.length === 0" class="p-6 text-sm text-gray-500">{{ t("collectionsView.itemsEmpty") }}</div>

      <table v-else class="min-w-full text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th v-for="(field, key) in collection.schema.fields" :key="key" class="px-4 py-2 font-medium">{{ field.label }}</th>
            <th class="px-4 py-2 font-medium w-px"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="item in items" :key="String(item[collection.schema.primaryKey] ?? '')" class="hover:bg-gray-50">
            <td v-for="(field, key) in collection.schema.fields" :key="key" class="px-4 py-2 text-gray-800 align-top max-w-xs">
              <span v-if="field.type === 'boolean'" class="block">
                <span v-if="item[key] === true" class="material-icons text-green-600 text-base align-middle">check</span>
                <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "—" is a universal "empty value" glyph already used in `formatCell` and reused here for the boolean=false case; translating it would diverge the two visual states across locales. -->
                <span v-else class="text-gray-400">—</span>
              </span>
              <span v-else-if="field.type === 'ref' && field.to && typeof item[key] === 'string' && item[key]" class="block truncate">
                <router-link
                  :to="{ path: `/collections/${field.to}`, query: { highlight: String(item[key]) } }"
                  class="text-blue-600 hover:underline"
                  :data-testid="`collections-ref-link-${key}-${item[key]}`"
                  >{{ refDisplay(field.to, String(item[key])) }}</router-link
                >
              </span>
              <span v-else class="block truncate">{{ formatCell(item[key], field.type) }}</span>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button
                type="button"
                class="text-xs text-blue-600 hover:underline mr-3"
                :data-testid="`collections-edit-item-${item[collection.schema.primaryKey]}`"
                @click="openEdit(item)"
              >
                {{ t("collectionsView.editItem") }}
              </button>
              <button
                type="button"
                class="text-xs text-red-600 hover:underline"
                :data-testid="`collections-delete-item-${item[collection.schema.primaryKey]}`"
                @click="confirmDelete(item)"
              >
                {{ t("common.remove") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Edit / Create modal -->
    <div v-if="editing && collection" class="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" @click.self="closeEditor">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <header class="px-5 py-3 border-b border-gray-200 flex items-center gap-3">
          <span class="material-icons text-blue-600 text-base">{{ editing.mode === "create" ? "add" : "edit" }}</span>
          <h2 class="text-base font-medium text-gray-900 flex-1">
            {{ editing.mode === "create" ? `${t("common.add")} — ${collection.title}` : `${t("collectionsView.editItem")} — ${collection.title}` }}
          </h2>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100"
            :aria-label="t('common.close')"
            data-testid="collections-editor-close"
            @click="closeEditor"
          >
            <span class="material-icons text-base">close</span>
          </button>
        </header>

        <form class="flex-1 overflow-auto px-5 py-4 space-y-3" @submit.prevent="saveEditor">
          <div v-for="(field, key) in collection.schema.fields" :key="key" class="space-y-1">
            <label class="text-xs font-medium text-gray-700 flex items-center gap-1" :for="`collections-field-${key}`">
              {{ field.label }}
              <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "*" is a universal required-field glyph; treating it as i18n copy would force eight translations of the same symbol. -->
              <span v-if="field.required" class="text-red-500">*</span>
            </label>
            <label v-if="field.type === 'boolean'" class="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                :id="`collections-field-${key}`"
                v-model="editing.bool[key]"
                type="checkbox"
                class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                :data-testid="`collections-input-${key}`"
                @change="markBoolTouched(key)"
              />
              <span>{{ editing.bool[key] ? t("common.yes") : t("common.no") }}</span>
            </label>
            <select
              v-else-if="field.type === 'ref' && field.to && refOptions(field.to).length > 0"
              :id="`collections-field-${key}`"
              v-model="editing.text[key]"
              :required="isFieldRequiredInUi(field)"
              class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
              :data-testid="`collections-input-${key}`"
            >
              <option value="">{{ t("collectionsView.refPlaceholder") }}</option>
              <option v-for="opt in refOptions(field.to)" :key="opt.slug" :value="opt.slug">{{ opt.display }}</option>
            </select>
            <input
              v-else-if="['string', 'email', 'number', 'date', 'ref'].includes(field.type)"
              :id="`collections-field-${key}`"
              v-model="editing.text[key]"
              :type="inputTypeFor(field.type)"
              :required="isFieldRequiredInUi(field)"
              :disabled="field.primary === true && editing.mode === 'edit'"
              class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500"
              :data-testid="`collections-input-${key}`"
            />
            <textarea
              v-else
              :id="`collections-field-${key}`"
              v-model="editing.text[key]"
              :rows="field.type === 'markdown' ? 6 : 3"
              :required="isFieldRequiredInUi(field)"
              class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
              :data-testid="`collections-input-${key}`"
            />
          </div>
          <p v-if="saveError" class="text-sm text-red-700">{{ saveError }}</p>
        </form>

        <footer class="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <button type="button" class="h-8 px-3 rounded text-sm text-gray-700 hover:bg-gray-100" data-testid="collections-editor-cancel" @click="closeEditor">
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            class="h-8 px-3 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            :disabled="saving"
            data-testid="collections-editor-save"
            @click="saveEditor"
          >
            {{ saving ? t("common.saving") : t("common.save") }}
          </button>
        </footer>
      </div>
    </div>

    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { apiDelete, apiGet, apiPost, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import ConfirmModal from "./ConfirmModal.vue";
import { useConfirm } from "../composables/useConfirm";

type FieldType = "string" | "text" | "email" | "number" | "date" | "boolean" | "markdown" | "ref";

interface FieldSpec {
  type: FieldType;
  label: string;
  primary?: boolean;
  required?: boolean;
  /** When type === "ref": slug of the target collection (see
   *  plans/feat-collections-ref-field.md). */
  to?: string;
}

/** Per-target-collection cache: maps an item's primary-key slug to
 *  the value we'll show in the table and dropdown. Filled in by
 *  `loadRefTargets` after the main collection's items arrive — one
 *  fetch per unique target collection, regardless of how many ref
 *  fields point at it. */
type RefDisplayMap = Record<string, string>;
type RefCache = Record<string, RefDisplayMap>;

interface CollectionSchema {
  title: string;
  icon: string;
  dataPath: string;
  primaryKey: string;
  fields: Record<string, FieldSpec>;
}

interface CollectionDetail {
  slug: string;
  title: string;
  icon: string;
  source: "user" | "project";
  schema: CollectionSchema;
}

type CollectionItem = Record<string, unknown>;

interface CollectionDetailResponse {
  collection: CollectionDetail;
  items: CollectionItem[];
}

interface ItemMutationResponse {
  itemId: string;
  item: CollectionItem;
}

interface EditState {
  mode: "create" | "edit";
  /** Form drafts for text-like inputs. v-model on `<input type="text">`
   *  / `<textarea>` / number / date / email all bind here as strings;
   *  `draftToRecord` parses numbers and date strings before posting. */
  text: Record<string, string>;
  /** Form drafts for `boolean`-typed fields. v-model on `<input
   *  type="checkbox">` binds here. Split from `text` so the v-model
   *  generic stays unambiguous (string vs boolean) — vue-tsc complains
   *  about `string | boolean` slots used as modelValue. */
  bool: Record<string, boolean>;
  /** Boolean keys whose value was present in the source record at
   *  the time the editor was opened. Used by `draftToRecord` to
   *  preserve omission semantics: an originally-absent boolean
   *  that the user never touched stays omitted (so the consumer's
   *  default applies — `mc-worklog` treats absent `billable` as
   *  "default true"). */
  boolOriginallyPresent: Record<string, boolean>;
  /** Boolean keys whose checkbox the user has actively interacted
   *  with in this editor session. Combined with
   *  `boolOriginallyPresent`, this lets `draftToRecord` distinguish
   *  "untouched and originally absent → omit" from "explicitly
   *  set to false → emit false". Without the dirty bit a user
   *  cannot persist an explicit `false` from create mode (every
   *  unchecked box looks the same as untouched), which blocks
   *  things like a non-billable mc-worklog entry from the UI. */
  boolTouched: Record<string, boolean>;
  /** For edit mode: the original item id pinned to the URL. */
  originalId: string | null;
}

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { openConfirm } = useConfirm();

const collection = ref<CollectionDetail | null>(null);
const items = ref<CollectionItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const editing = ref<EditState | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
const refCache = ref<RefCache>({});

function detailUrl(slug: string): string {
  return API_ROUTES.collections.detail.replace(":slug", encodeURIComponent(slug));
}

function itemsUrl(slug: string): string {
  return API_ROUTES.collections.items.replace(":slug", encodeURIComponent(slug));
}

function itemUrl(slug: string, itemId: string): string {
  return API_ROUTES.collections.item.replace(":slug", encodeURIComponent(slug)).replace(":itemId", encodeURIComponent(itemId));
}

async function loadCollection(slug: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  collection.value = null;
  items.value = [];
  refCache.value = {};
  const result = await apiGet<CollectionDetailResponse>(detailUrl(slug));
  loading.value = false;
  if (!result.ok) {
    loadError.value = result.status === 404 ? "not-found" : result.error;
    return;
  }
  collection.value = result.data.collection;
  items.value = result.data.items;
  // Fan out to fetch each unique target collection so the table can
  // render ref values as display names (not slugs) and the form
  // dropdown has options. Failures fall back gracefully — the table
  // cell shows the raw slug and the form falls back to text input.
  // Pass the slug that triggered THIS load so the helper can drop
  // its result if a faster subsequent load has already switched us
  // to a different collection (Codex P1 review on PR #1495).
  await loadRefTargets(result.data.collection.schema, slug);
}

function uniqueRefTargets(schema: CollectionSchema): string[] {
  const targets = new Set<string>();
  for (const field of Object.values(schema.fields)) {
    if (field.type === "ref" && typeof field.to === "string" && field.to.length > 0) {
      targets.add(field.to);
    }
  }
  return [...targets];
}

async function loadRefTargets(schema: CollectionSchema, expectedSlug: string): Promise<void> {
  const targets = uniqueRefTargets(schema);
  if (targets.length === 0) return;
  const results = await Promise.all(targets.map((target) => apiGet<CollectionDetailResponse>(detailUrl(target)).then((result) => ({ target, result }))));
  // Stale-write guard: a quicker subsequent `loadCollection()`
  // (user navigated to a different collection mid-fetch) may have
  // already replaced `collection.value`. Overwriting `refCache`
  // here would surface the previous collection's ref data on the
  // current one's UI — broken labels until another reload. Drop
  // the write if we're no longer on the slug that triggered us.
  if (collection.value?.slug !== expectedSlug) return;
  const next: RefCache = {};
  for (const { target, result } of results) {
    if (!result.ok) continue;
    next[target] = buildRefDisplayMap(result.data);
  }
  refCache.value = next;
}

function buildRefDisplayMap(detail: CollectionDetailResponse): RefDisplayMap {
  // Heuristic for what to display in the table cell + dropdown:
  // prefer a field called `name`, fall back to `title`, then to the
  // primary key value (= the slug itself, which we'd show anyway).
  // Future-proof escape hatch (`displayField` in the schema) is
  // explicitly deferred — see plans/feat-collections-ref-field.md.
  const { fields, primaryKey } = detail.collection.schema;
  const displayField = "name" in fields ? "name" : "title" in fields ? "title" : primaryKey;
  const map: RefDisplayMap = {};
  for (const item of detail.items) {
    const slugRaw = item[primaryKey];
    if (typeof slugRaw !== "string" || slugRaw.length === 0) continue;
    const displayRaw = item[displayField];
    const display = typeof displayRaw === "string" && displayRaw.length > 0 ? displayRaw : slugRaw;
    map[slugRaw] = display;
  }
  return map;
}

function refDisplay(targetSlug: string, itemSlug: string): string {
  const map = refCache.value[targetSlug];
  return (map && map[itemSlug]) || itemSlug;
}

function refOptions(targetSlug: string): { slug: string; display: string }[] {
  const map = refCache.value[targetSlug];
  if (!map) return [];
  return Object.entries(map)
    .map(([slug, display]) => ({ slug, display }))
    .sort((left, right) => left.display.localeCompare(right.display));
}

function inputTypeFor(type: FieldType): string {
  if (type === "email") return "email";
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
}

/** Mirror of the create-mode primary-key carve-out in `saveEditor`:
 *  drop the HTML5 `required` flag on the primary field while creating
 *  so browser-level form validation doesn't pop a "Please fill out
 *  this field" tooltip when the user is intentionally leaving the
 *  primary blank for server-side ID generation. */
function isFieldRequiredInUi(field: FieldSpec): boolean {
  if (!field.required) return false;
  if (editing.value?.mode === "create" && field.primary === true) return false;
  return true;
}

function formatCell(value: unknown, type: FieldType): string {
  if (value === undefined || value === null || value === "") return "—";
  if (type === "markdown" && typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function openCreate(): void {
  if (!collection.value) return;
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  for (const [key, field] of Object.entries(collection.value.schema.fields)) {
    if (field.type === "boolean") {
      bool[key] = false;
      // New record — no boolean was originally present.
      boolOriginallyPresent[key] = false;
      boolTouched[key] = false;
    } else {
      text[key] = "";
    }
  }
  editing.value = { mode: "create", text, bool, boolOriginallyPresent, boolTouched, originalId: null };
  saveError.value = null;
}

function openEdit(item: CollectionItem): void {
  if (!collection.value) return;
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  for (const [key, field] of Object.entries(collection.value.schema.fields)) {
    const raw = item[key];
    if (field.type === "boolean") {
      bool[key] = raw === true;
      // Track whether the key was present in the source record so
      // we can preserve "omitted" through a save that doesn't
      // touch this field. `typeof raw === "boolean"` is more
      // defensive than `key in item` because a wrong-typed value
      // (e.g. `billable: "yes"`) shouldn't be treated as a real
      // existing boolean state.
      boolOriginallyPresent[key] = typeof raw === "boolean";
      boolTouched[key] = false;
    } else {
      text[key] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  const primaryRaw = item[collection.value.schema.primaryKey];
  const originalId = typeof primaryRaw === "string" ? primaryRaw : String(primaryRaw ?? "");
  editing.value = { mode: "edit", text, bool, boolOriginallyPresent, boolTouched, originalId };
  saveError.value = null;
}

function markBoolTouched(key: string): void {
  if (editing.value) editing.value.boolTouched[key] = true;
}

function closeEditor(): void {
  editing.value = null;
  saving.value = false;
  saveError.value = null;
}

function draftToRecord(state: EditState, schema: CollectionSchema): CollectionItem {
  const record: CollectionItem = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type === "boolean") {
      // Emit the boolean if any of:
      //   - it was originally present (preserve prior choice + any
      //     in-session toggle, including explicit false)
      //   - the user has actively interacted with the checkbox in
      //     this session (boolTouched — required to make explicit
      //     `false` round-trippable from create mode, where every
      //     untouched checkbox would otherwise look like "omit")
      //   - the schema marks the field required (downstream
      //     consumers may depend on the key always being present)
      // Otherwise omit so a brand-new record that didn't touch
      // an optional boolean doesn't materialize `false` for it,
      // letting the consumer's default (e.g. mc-worklog's
      // "absent billable means true") apply.
      const value = state.bool[key] === true;
      if (state.boolOriginallyPresent[key] || state.boolTouched[key] || field.required) {
        record[key] = value;
      }
      continue;
    }
    const raw = state.text[key];
    if (raw === undefined || raw === "") continue;
    if (field.type === "number") {
      const num = Number(raw);
      record[key] = Number.isFinite(num) ? num : raw;
    } else {
      record[key] = raw;
    }
  }
  return record;
}

async function saveEditor(): Promise<void> {
  if (!collection.value || !editing.value) return;
  // Snapshot mutable refs before any await — route changes during
  // the save (e.g. user navigates away) can null `collection.value`
  // and would throw on the post-await `loadCollection(...)`.
  const { slug, schema } = collection.value;
  const draft = editing.value;
  saveError.value = null;

  // Client-side required-field check — server doesn't enforce. Skip
  // the primary key in create mode: the server auto-generates an id
  // when the field is blank, so blocking here would deny the
  // documented "blank → server-generated id" flow even for schemas
  // (like mc-clients) that mark the primary field `required: true`
  // for the edit-form-displays-it-as-a-real-field reason.
  for (const [key, field] of Object.entries(schema.fields)) {
    if (!field.required) continue;
    if (draft.mode === "create" && field.primary === true) continue;
    // Booleans always have a value (`false` is a valid answer), so
    // `required: true` on a boolean field is a no-op rather than a
    // gate. Skip the empty check for them.
    if (field.type === "boolean") continue;
    if (!draft.text[key]) {
      saveError.value = `${field.label}: ${t("collectionsView.requiredField")}`;
      return;
    }
  }

  saving.value = true;
  const record = draftToRecord(draft, schema);
  const isCreate = draft.mode === "create";
  const result = isCreate
    ? await apiPost<ItemMutationResponse>(itemsUrl(slug), record)
    : await apiPut<ItemMutationResponse>(itemUrl(slug, draft.originalId ?? ""), record);
  saving.value = false;
  if (!result.ok) {
    saveError.value = result.error;
    return;
  }
  closeEditor();
  await loadCollection(slug);
}

async function confirmDelete(item: CollectionItem): Promise<void> {
  if (!collection.value) return;
  // Snapshot before any await (see saveEditor) — confirm dialog
  // awaits user input, plenty of time for the route to change.
  const { slug } = collection.value;
  const { primaryKey } = collection.value.schema;
  const idRaw = item[primaryKey];
  const itemId = typeof idRaw === "string" ? idRaw : String(idRaw ?? "");
  if (!itemId) return;
  const ok = await openConfirm({
    message: t("collectionsView.confirmDelete"),
    confirmText: t("common.remove"),
    cancelText: t("common.cancel"),
    variant: "danger",
  });
  if (!ok) return;
  const result = await apiDelete(itemUrl(slug, itemId));
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  await loadCollection(slug);
}

function goBack(): void {
  router.push({ name: PAGE_ROUTES.collections, params: {} }).catch(() => {});
}

watch(
  () => route.params.slug,
  (slug) => {
    if (typeof slug === "string" && slug.length > 0) {
      loadCollection(slug);
    } else {
      collection.value = null;
      items.value = [];
      loading.value = false;
    }
  },
);

onMounted(() => {
  const { slug } = route.params;
  if (typeof slug === "string" && slug.length > 0) {
    loadCollection(slug);
  } else {
    loading.value = false;
  }
});
</script>
