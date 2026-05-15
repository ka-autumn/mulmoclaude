<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div>
        <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginManageSkills.heading") }}</h2>
        <p class="text-xs text-gray-400 mt-0.5">{{ t("pluginManageSkills.subheading", { count: skills.length }) }}</p>
      </div>
    </div>

    <!-- List load error (standalone mode) -->
    <div v-if="listError" class="px-6 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">
      {{ listError }}
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Left: skill list -->
      <div class="w-64 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50">
        <div
          v-for="skill in skills"
          :key="skill.name"
          :data-testid="`skill-item-${skill.name}`"
          class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
          :class="selectedName === skill.name && !selectedCatalog ? 'bg-white border-l-2 border-l-blue-500' : ''"
          role="button"
          tabindex="0"
          :aria-pressed="selectedName === skill.name && !selectedCatalog"
          @click="selectActiveSkill(skill.name)"
          @keydown.enter.prevent="selectActiveSkill(skill.name)"
          @keydown.space.prevent="selectActiveSkill(skill.name)"
        >
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-medium text-gray-800 truncate">{{ skill.name }}</div>
              <div class="text-xs text-gray-500 truncate mt-0.5">
                {{ skill.description }}
              </div>
            </div>
            <span class="shrink-0 material-icons text-sm" :class="sourceMeta(skill.source).colour" :title="sourceMeta(skill.source).title" aria-hidden="true">{{
              sourceMeta(skill.source).icon
            }}</span>
          </div>
        </div>
        <i18n-t v-if="skills.length === 0" keypath="pluginManageSkills.emptyWithPath" tag="p" class="p-4 text-sm text-gray-400 italic">
          <template #path>
            <code class="text-[11px]">{{ t("pluginManageSkills.emptySkillPath") }}</code>
          </template>
        </i18n-t>

        <!-- Catalog: launcher-managed presets. Rows behave like the
             active list above — click selects an entry, which loads
             its detail (description + body) into the right pane
             along with ★ Star / ▶ Run once actions. Inline icon
             buttons were removed; the right pane is now the single
             place to read + act on a catalog entry. (#1335 PR-B2
             follow-up.) -->
        <div v-if="catalogPresets.length > 0" class="border-t border-gray-200 mt-2">
          <div class="px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold" data-testid="skill-catalog-section-heading">
            {{ t("pluginManageSkills.catalogPresetHeading") }}
          </div>
          <div
            v-for="entry in catalogPresets"
            :key="`catalog-preset-${entry.slug}`"
            :data-testid="`skill-catalog-item-${entry.slug}`"
            class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
            :class="selectedCatalog?.slug === entry.slug ? 'bg-white border-l-2 border-l-blue-500' : ''"
            role="button"
            tabindex="0"
            :aria-pressed="selectedCatalog?.slug === entry.slug"
            @click="selectCatalogEntry(entry)"
            @keydown.enter.prevent="selectCatalogEntry(entry)"
            @keydown.space.prevent="selectCatalogEntry(entry)"
          >
            <div class="flex items-center gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-700 truncate">{{ entry.name }}</div>
                <div class="text-xs text-gray-500 truncate mt-0.5">{{ entry.description }}</div>
              </div>
              <span
                v-if="entry.alreadyActive"
                class="shrink-0 material-icons text-sm text-yellow-500"
                :title="t('pluginManageSkills.catalogStarred')"
                :data-testid="`skill-catalog-starred-indicator-${entry.slug}`"
                aria-hidden="true"
                >star</span
              >
              <span class="shrink-0 material-icons text-sm" :class="presetSourceMeta.colour" :title="presetSourceMeta.title" aria-hidden="true">{{
                presetSourceMeta.icon
              }}</span>
            </div>
          </div>
          <div v-if="catalogError" class="px-4 py-2 text-xs text-red-600">{{ catalogError }}</div>
        </div>
      </div>

      <!-- Right: detail pane -->
      <div class="flex-1 min-w-0 overflow-y-auto">
        <!-- Catalog (preset) detail. Selecting a row from the
             "Preset catalog" section in the left column routes
             here. Shows description + body + Star / Run once
             actions. (#1335 PR-B2 follow-up — replaces the inline
             buttons and the Preview modal with a single right-pane
             that mirrors the active-skill view.) -->
        <div v-if="selectedCatalog" class="p-6" data-testid="skill-catalog-detail-pane">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="material-icons text-sm" :class="presetSourceMeta.colour" :title="presetSourceMeta.title" aria-hidden="true">{{
                  presetSourceMeta.icon
                }}</span>
                <h3 class="text-xl font-semibold text-gray-800 truncate">{{ selectedCatalog.name }}</h3>
              </div>
              <p class="text-sm text-gray-600 mt-1">{{ selectedCatalog.description }}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                v-if="!selectedCatalog.alreadyActive"
                class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-yellow-400 text-yellow-600 hover:bg-yellow-50 disabled:opacity-40"
                :disabled="catalogActioningSlug === selectedCatalog.slug"
                :title="t('pluginManageSkills.catalogStar')"
                data-testid="skill-catalog-detail-star-btn"
                @click="starCatalogEntry(selectedCatalog)"
              >
                <span class="material-icons text-sm" aria-hidden="true">star_border</span>
                {{ t("pluginManageSkills.catalogStar") }}
              </button>
              <button
                v-else
                class="h-8 px-2.5 flex items-center gap-1 text-sm rounded text-yellow-500 cursor-not-allowed"
                :title="t('pluginManageSkills.catalogStarred')"
                data-testid="skill-catalog-detail-starred"
                disabled
              >
                <span class="material-icons text-sm" aria-hidden="true">star</span>
                {{ t("pluginManageSkills.catalogStarred") }}
              </button>
              <button
                class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
                :disabled="catalogActioningSlug === selectedCatalog.slug || !catalogDetail"
                :title="t('pluginManageSkills.catalogRunOnce')"
                data-testid="skill-catalog-detail-run-btn"
                @click="runOnceCatalogEntry(selectedCatalog)"
              >
                <span class="material-icons text-sm" aria-hidden="true">play_arrow</span>
                {{ t("pluginManageSkills.catalogRunOnce") }}
              </button>
            </div>
          </div>
          <div v-if="catalogDetailLoading" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.loading") }}</div>
          <div v-else-if="catalogError" class="text-sm text-red-600">{{ catalogError }}</div>
          <!-- eslint-disable vue/no-v-html -- markdown sanitized via sanitizeMarkdownHtml; same trust chain as the active-skill body below -->
          <div v-else-if="catalogDetail" class="markdown-content text-gray-700" v-html="catalogRenderedBody"></div>
          <!-- eslint-enable vue/no-v-html -->
        </div>

        <div v-else-if="!selected" class="p-6 text-sm text-gray-400 italic">{{ t("pluginManageSkills.selectHint") }}</div>
        <div v-else class="p-6">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div class="min-w-0">
              <h3 class="text-xl font-semibold text-gray-800 truncate">
                {{ selected.name }}
              </h3>
              <p class="text-sm text-gray-600 mt-1">
                {{ selected.description }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <template v-if="editing">
                <button
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  data-testid="skill-cancel-btn"
                  @click="cancelEdit"
                >
                  {{ t("common.cancel") }}
                </button>
                <button
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
                  :disabled="saving"
                  data-testid="skill-save-btn"
                  @click="saveEdit"
                >
                  <span class="material-icons text-sm">save</span>
                  {{ t("common.save") }}
                </button>
              </template>
              <template v-else>
                <button
                  v-if="detail && detail.source === 'project'"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  :disabled="detailLoading"
                  data-testid="skill-edit-btn"
                  @click="startEdit"
                >
                  <span class="material-icons text-sm">edit</span>
                  {{ t("pluginManageSkills.btnEdit") }}
                </button>
                <button
                  v-if="detail && detail.source === 'project'"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40"
                  :disabled="detailLoading || deleting"
                  data-testid="skill-delete-btn"
                  :title="t('pluginManageSkills.deleteProjectSkill')"
                  @click="deleteSkill"
                >
                  <span class="material-icons text-sm">delete</span>
                  {{ t("pluginManageSkills.btnDelete") }}
                </button>
                <button
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
                  :disabled="detailLoading || !detail"
                  data-testid="skill-run-btn"
                  @click="runSkill"
                >
                  <span class="material-icons text-sm">play_arrow</span>
                  {{ t("pluginManageSkills.btnRun") }}
                </button>
              </template>
            </div>
          </div>
          <div v-if="detailLoading" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.loading") }}</div>
          <div v-else-if="detailError" class="text-sm text-red-600">
            {{ detailError }}
          </div>
          <!-- Edit mode -->
          <div v-else-if="editing && detail" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1"> {{ t("pluginManageSkills.fieldDescription") }} </label>
              <input
                v-model="editDescription"
                data-testid="skill-edit-description"
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800"
              />
            </div>
            <div class="flex-1">
              <label class="block text-xs font-medium text-gray-500 mb-1"> {{ t("pluginManageSkills.fieldBody") }} </label>
              <textarea
                v-model="editBody"
                data-testid="skill-edit-body"
                class="w-full h-96 px-3 py-2 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 resize-y"
              ></textarea>
            </div>
          </div>
          <!-- View mode -->
          <!-- eslint-disable vue/no-v-html -- sanitized via DOMPurify; multi-line element so disable/enable pair (CLAUDE.md UI rule) instead of -next-line -->
          <div
            v-else-if="detail && renderedBody"
            class="markdown-content text-gray-700"
            data-testid="skill-body-rendered"
            @click="handleExternalLinkClick"
            v-html="renderedBody"
          ></div>
          <!-- eslint-enable vue/no-v-html -->
          <p v-else-if="detail" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.emptyBody") }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData, SkillSummary } from "./index";
import { useAppApi } from "../../composables/useAppApi";
import { apiGet, apiPost, apiPut, apiDelete } from "../../utils/api";
import { handleExternalLinkClick } from "../../utils/dom/externalLink";
import { sanitizeMarkdownHtml } from "../../utils/markdown/sanitize";
import { pluginEndpoints } from "../api";
import { buildRouteUrl } from "../meta-types";
import type { SkillsEndpoints } from "./definition";

const { t } = useI18n();

interface SkillDetail {
  name: string;
  description: string;
  body: string;
  source: "user" | "project";
  path: string;
}

const props = defineProps<{
  selectedResult?: ToolResultComplete<ManageSkillsData>;
}>();

// Local mutable copy of the skill list so the Delete button can
// remove rows without waiting for a fresh tool_result push.
// Re-seeded whenever the underlying tool result changes.
const skills = ref<SkillSummary[]>(props.selectedResult?.data?.skills ?? []);
const selectedName = ref<string | null>(skills.value[0]?.name ?? null);
const detail = ref<SkillDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const deleting = ref(false);
const editing = ref(false);
const saving = ref(false);
const editDescription = ref("");
const editBody = ref("");

const selected = computed(() => skills.value.find((skill) => skill.name === selectedName.value) ?? null);

const renderedBody = computed(() => {
  const body = detail.value?.body;
  if (!body) return "";
  return sanitizeMarkdownHtml(marked(body) as string);
});

const listError = ref<string | null>(null);

const endpoints = pluginEndpoints<SkillsEndpoints>("skills");

// Catalog state (#1335 PR-B). Loaded on mount + after a successful
// star so the row updates from "★ Star" → "★ Starred". `starringSlug`
// disables the button mid-request to prevent double-clicks.
type CatalogSource = "preset";
interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  source: CatalogSource;
  alreadyActive: boolean;
}
interface CatalogDetail {
  slug: string;
  source: CatalogSource;
  description: string;
  body: string;
}
const catalogPresets = ref<CatalogEntry[]>([]);
const catalogError = ref<string | null>(null);
// Single in-flight gate covers Star / Run once on the selected
// entry so a slow request doesn't let the user fire a second
// action mid-flight.
const catalogActioningSlug = ref<string | null>(null);
// Right-pane selection for a catalog entry (mutually exclusive
// with `selectedName` — picking one clears the other).
const selectedCatalog = ref<CatalogEntry | null>(null);
const catalogDetail = ref<CatalogDetail | null>(null);
const catalogDetailLoading = ref(false);
// `appApi` is also referenced lower down by the existing `runSkill`
// (slash-command invocation for active skills); hoisting one
// declaration so the catalog handlers don't need their own lookup.
const catalogAppApi = useAppApi();

const catalogRenderedBody = computed(() => {
  const body = catalogDetail.value?.body;
  if (!body) return "";
  return sanitizeMarkdownHtml(marked(body) as string);
});

// Visual key for the "scope" badge that appears in every row +
// the right-pane header. Three scopes today:
//   - user    `~/.claude/skills/`           — global across workspaces
//   - project `<workspace>/.claude/skills/` — this workspace only
//   - preset  catalog (not yet ★ Starred)   — launcher-managed
// Icons + colours are deliberately monochromatic except for the
// preset case where we hint "library / shelf" with the inventory
// glyph. The yellow ★ for "starred" is rendered separately so the
// scope badge stays semantically about provenance, not state.
interface SourceMeta {
  icon: string;
  title: string;
  colour: string;
}

function sourceMeta(source: "user" | "project"): SourceMeta {
  if (source === "user") {
    return { icon: "home", title: t("pluginManageSkills.sourceUserTitle"), colour: "text-blue-500" };
  }
  return { icon: "folder", title: t("pluginManageSkills.sourceProjectTitle"), colour: "text-green-600" };
}

const presetSourceMeta = computed<SourceMeta>(() => ({
  icon: "inventory_2",
  title: t("pluginManageSkills.sourcePresetTitle"),
  colour: "text-gray-400",
}));

// Reset the selection when the tool result is replaced (e.g. the
// user opens a newer `manageSkills` invocation from the sidebar).
// Lives after the catalog refs so source-order use-before-define
// is satisfied — the closure runs at watch-fire time, not at
// module-eval time, but the lint rule is structural.
watch(
  () => props.selectedResult?.uuid,
  () => {
    skills.value = props.selectedResult?.data?.skills ?? [];
    selectedName.value = skills.value[0]?.name ?? null;
    // Also reset catalog-side selection so opening a different
    // historical manageSkills tool result doesn't leave a stale
    // catalog detail visible in the right pane. `v-if="selectedCatalog"`
    // wins over the active-skill branch, so without this reset the
    // user sees last-session catalog content under a fresh tool
    // result. (Codex review on PR #1374.)
    selectedCatalog.value = null;
    catalogDetail.value = null;
    catalogDetailLoading.value = false;
  },
);

async function loadCatalog(): Promise<void> {
  const response = await apiGet<{ entries: CatalogEntry[] }>(endpoints.catalogList.url);
  if (!response.ok) {
    catalogError.value = t("pluginManageSkills.errCatalogListFailed", { error: response.error });
    return;
  }
  catalogError.value = null;
  if (Array.isArray(response.data.entries)) {
    catalogPresets.value = response.data.entries.filter((entry) => entry.source === "preset");
  }
}

async function refreshActiveList(): Promise<void> {
  // Mirrors the onMounted fetch so the left-column list reflects the
  // newly-starred skill without waiting for the next manageSkills
  // tool result. Errors here are non-fatal — the catalog state is
  // the source of truth for the "Starred" badge.
  const response = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
  if (response.ok && Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
  }
}

async function starCatalogEntry(entry: CatalogEntry): Promise<void> {
  if (entry.alreadyActive) return;
  catalogActioningSlug.value = entry.slug;
  const response = await apiPost<{ starred: true; slug: string }>(endpoints.catalogStar.url, { source: entry.source, slug: entry.slug });
  catalogActioningSlug.value = null;
  if (!response.ok) {
    catalogError.value = t("pluginManageSkills.errCatalogStarFailed", { error: response.error });
    return;
  }
  catalogError.value = null;
  // Refresh both lists so the row flips to "Starred" and the new
  // active entry shows up in the left column.
  await Promise.all([loadCatalog(), refreshActiveList()]);
  // Reconcile the right-pane selection with the refreshed list so
  // its `alreadyActive` flag reflects reality without forcing the
  // user to re-click.
  if (selectedCatalog.value?.slug === entry.slug) {
    const updated = catalogPresets.value.find((candidate) => candidate.slug === entry.slug);
    if (updated) selectedCatalog.value = updated;
  }
}

async function fetchCatalogDetail(entry: CatalogEntry): Promise<CatalogDetail | null> {
  const response = await apiGet<{ detail: CatalogDetail }>(endpoints.catalogPreview.url, { source: entry.source, slug: entry.slug });
  if (!response.ok) {
    catalogError.value = t("pluginManageSkills.errCatalogPreviewFailed", { error: response.error });
    return null;
  }
  catalogError.value = null;
  return response.data.detail;
}

function selectActiveSkill(name: string): void {
  // Active and catalog selections are mutually exclusive — picking
  // one clears the other so the right pane has a single source of
  // truth.
  selectedCatalog.value = null;
  catalogDetail.value = null;
  selectedName.value = name;
}

async function selectCatalogEntry(entry: CatalogEntry): Promise<void> {
  selectedName.value = null;
  selectedCatalog.value = entry;
  catalogDetail.value = null;
  catalogDetailLoading.value = true;
  const slugAtRequest = entry.slug;
  const fetched = await fetchCatalogDetail(entry);
  // Selection may have changed while the request was in flight —
  // drop the response if so (same race-condition guard the active-
  // skill detail watcher uses).
  if (selectedCatalog.value?.slug !== slugAtRequest) return;
  catalogDetailLoading.value = false;
  if (fetched !== null) catalogDetail.value = fetched;
}

async function runOnceCatalogEntry(entry: CatalogEntry): Promise<void> {
  // Use the already-fetched detail when the entry is the current
  // right-pane selection (the common case — user reads body, then
  // clicks Run once). Falls back to a fresh fetch when the click
  // somehow lands without a prior selection (defensive — the right
  // pane is the only place Run once is exposed today).
  //
  // The shared in-flight gate is held for the whole flow so a
  // rapid double-click can't enqueue two `startNewChat` calls
  // and spawn duplicate sessions. (Codex review on PR #1374.)
  catalogActioningSlug.value = entry.slug;
  try {
    const body = catalogDetail.value?.slug === entry.slug && catalogDetail.value !== null ? catalogDetail.value.body : (await fetchCatalogDetail(entry))?.body;
    if (!body || !body.trim()) {
      catalogError.value = t("pluginManageSkills.errCatalogRunOnceEmpty");
      return;
    }
    catalogAppApi.startNewChat(body);
  } finally {
    catalogActioningSlug.value = null;
  }
}

// Standalone mode: if no selectedResult was passed, fetch the skill
// list from the API on mount so the view is populated.
onMounted(async () => {
  // Always load the catalog so the section appears even when the
  // view was opened from a tool result (which only carries the
  // active list).
  await loadCatalog();
  if (props.selectedResult || skills.value.length > 0) return;
  const response = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
  if (!response.ok) {
    listError.value = t("pluginManageSkills.errListFailed", { error: response.error });
    return;
  }
  if (Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
    selectedName.value = skills.value[0]?.name ?? null;
  }
});

// Fetch detail when the selection changes. Failures surface inline
// so the Run button stays disabled and the user sees why. Each request
// captures the `name` it was issued for — if the user clicks another
// skill while the first fetch is in flight, the slower response is
// discarded (otherwise stale detail can land under the new selection
// and break deleteSkill(), which reads `detail.value.name`).
watch(
  selectedName,
  async (name) => {
    if (!name) {
      detail.value = null;
      editing.value = false;
      return;
    }
    editing.value = false;
    detailLoading.value = true;
    detailError.value = null;
    const response = await apiGet<{ skill: SkillDetail }>(buildRouteUrl(endpoints.detail, { name }));
    if (selectedName.value !== name) {
      // Selection changed while this request was in flight — drop it.
      return;
    }
    if (!response.ok) {
      detailError.value = t("pluginManageSkills.errDetailFailed", { error: response.error });
      detail.value = null;
    } else {
      detail.value = response.data.skill;
    }
    detailLoading.value = false;
  },
  { immediate: true },
);

function startEdit(): void {
  if (!detail.value) return;
  editDescription.value = detail.value.description;
  editBody.value = detail.value.body;
  editing.value = true;
}

function cancelEdit(): void {
  editing.value = false;
}

async function saveEdit(): Promise<void> {
  if (!detail.value) return;
  const { name } = detail.value;
  saving.value = true;
  detailError.value = null;
  const result = await apiPut<{ updated: boolean; path: string }>(buildRouteUrl(endpoints.update, { name }), {
    description: editDescription.value,
    body: editBody.value,
  });
  saving.value = false;
  if (!result.ok) {
    detailError.value = t("pluginManageSkills.errSaveFailed", { error: result.error });
    return;
  }
  detail.value = {
    ...detail.value,
    description: editDescription.value,
    body: editBody.value,
  };
  // Update the sidebar summary too.
  const idx = skills.value.findIndex((skill) => skill.name === name);
  if (idx >= 0) {
    skills.value[idx] = {
      ...skills.value[idx],
      description: editDescription.value,
    };
  }
  editing.value = false;
}

// Run = send the skill invocation as a Claude Code slash command.
// Claude CLI already knows about every ~/.claude/skills/<name>/SKILL.md
// at spawn, so sending `/<name>` is enough — no need to ship the body.
// Uses startNewChat (not sendMessage) so the user is routed to /chat
// to see the response — Skills view is only rendered on /skills.
const appApi = useAppApi();

function runSkill(): void {
  if (!selectedName.value) return;
  appApi.startNewChat(`/${selectedName.value}`);
}

// Delete is project-scope only — see saveProjectSkill / deleteProjectSkill
// in server/skills/writer.ts. The button is hidden in the template
// when source !== "project". A native confirm() is enough for phase 1
// since the action is reversible by re-saving via the conversation.
async function deleteSkill(): Promise<void> {
  if (!detail.value || detail.value.source !== "project") return;
  const { name } = detail.value;
  if (!window.confirm(t("pluginManageSkills.confirmDelete", { name }))) {
    return;
  }
  deleting.value = true;
  const result = await apiDelete<unknown>(buildRouteUrl(endpoints.remove, { name }));
  deleting.value = false;
  if (!result.ok) {
    detailError.value = result.error || t("pluginManageSkills.errDeleteFailed");
    return;
  }
  // Remove from the local list, advance selection, clear detail.
  const idx = skills.value.findIndex((skill) => skill.name === name);
  if (idx >= 0) {
    skills.value.splice(idx, 1);
  }
  selectedName.value = skills.value[0]?.name ?? null;
  detail.value = null;
  // Refresh the catalog so a deleted star reverts to ☆ Star.
  // `alreadyActive` is computed from disk at list time — without
  // this call the badge + right-pane state would lag until the
  // next mount. (#1335 PR-B2 follow-up.)
  await loadCatalog();
  if (selectedCatalog.value?.slug === name) {
    const refreshed = catalogPresets.value.find((candidate) => candidate.slug === name);
    if (refreshed) selectedCatalog.value = refreshed;
  }
}
</script>
