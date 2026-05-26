<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div>
        <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginManageSkills.heading") }}</h2>
        <p class="text-xs text-gray-400 mt-0.5">{{ t("pluginManageSkills.subheading", { count: skills.length }) }}</p>
        <i18n-t keypath="pluginManageSkills.sectionLegendActive" tag="p" class="text-xs text-gray-400 mt-0.5">
          <template #system>
            <span class="material-icons !text-sm align-middle leading-none text-gray-500" aria-hidden="true">lock</span>
          </template>
          <template #project>
            <span class="material-icons !text-sm align-middle leading-none text-green-600" aria-hidden="true">folder</span>
          </template>
          <template #user>
            <span class="material-icons !text-sm align-middle leading-none text-blue-500" aria-hidden="true">home</span>
          </template>
        </i18n-t>
        <i18n-t keypath="pluginManageSkills.sectionLegendCatalog" tag="p" class="text-xs text-gray-400 mt-0.5">
          <template #star>
            <span class="material-icons !text-sm align-middle leading-none text-amber-500" aria-hidden="true">star</span>
          </template>
          <template #runOnce>
            <span class="material-icons !text-sm align-middle leading-none text-blue-600" aria-hidden="true">play_arrow</span>
          </template>
        </i18n-t>
      </div>
    </div>

    <!-- List load error (standalone mode) -->
    <div v-if="listError" class="px-6 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">
      {{ listError }}
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Left: two collapsible sections — Active (discovered by
           Claude Code, loaded into the prompt) and Catalog (browse /
           ★ star / ▶ run once without bloating the prompt). Aligns
           with the #1335 catalog/active model. -->
      <div class="w-64 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50">
        <!-- ★ Active -->
        <div data-testid="skill-section-active">
          <button
            type="button"
            data-testid="skill-section-toggle-active"
            class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-100 border-b border-gray-100"
            :aria-expanded="isSectionOpen('active')"
            aria-controls="skill-section-panel-active"
            @click="toggleSection('active')"
          >
            <span class="flex items-center gap-1">
              <span class="material-icons text-base">{{ isSectionOpen("active") ? "expand_more" : "chevron_right" }}</span>
              {{ t("pluginManageSkills.sectionActive") }}
            </span>
            <span data-testid="skill-section-count-active" class="text-gray-400 font-normal normal-case">{{ activeSkills.length }}</span>
          </button>
          <div v-show="isSectionOpen('active')" id="skill-section-panel-active" role="group">
            <div
              v-for="skill in activeSkills"
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
                <span class="shrink-0 material-icons text-sm" :class="skillBadge(skill).colour" :title="skillBadge(skill).title" aria-hidden="true">{{
                  skillBadge(skill).icon
                }}</span>
              </div>
            </div>
            <i18n-t v-if="activeSkills.length === 0" keypath="pluginManageSkills.emptyWithPath" tag="p" class="p-4 text-sm text-gray-400 italic">
              <template #path>
                <code class="text-[11px]">{{ t("pluginManageSkills.emptySkillPath") }}</code>
              </template>
            </i18n-t>
          </div>
        </div>

        <!-- 📚 Catalog: launcher-managed presets. Rows behave like the
             active list — click selects an entry, loading its detail
             into the right pane with ★ Star / ▶ Run once actions.
             Anthropic + Community sub-catalogs land with #1335 PR-C. -->
        <div data-testid="skill-section-catalog" class="border-t border-gray-200">
          <button
            type="button"
            data-testid="skill-section-toggle-catalog"
            class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-100 border-b border-gray-100"
            :aria-expanded="isSectionOpen('catalog')"
            aria-controls="skill-section-panel-catalog"
            @click="toggleSection('catalog')"
          >
            <span class="flex items-center gap-1">
              <span class="material-icons text-base">{{ isSectionOpen("catalog") ? "expand_more" : "chevron_right" }}</span>
              {{ t("pluginManageSkills.sectionCatalog") }}
            </span>
            <span data-testid="skill-section-count-catalog" class="text-gray-400 font-normal normal-case">{{
              catalogPresets.length + catalogExternal.length
            }}</span>
          </button>
          <div v-show="isSectionOpen('catalog')" id="skill-section-panel-catalog" role="group">
            <div class="px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold" data-testid="skill-catalog-section-heading">
              {{ t("pluginManageSkills.catalogPresetHeading") }}
            </div>
            <div
              v-for="entry in catalogPresets"
              :key="`catalog-preset-${entryKey(entry)}`"
              :data-testid="`skill-catalog-item-${entryKey(entry)}`"
              class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
              :class="selectedCatalogKey === entryKey(entry) ? 'bg-white border-l-2 border-l-blue-500' : ''"
              role="button"
              tabindex="0"
              :aria-pressed="selectedCatalogKey === entryKey(entry)"
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
                  :data-testid="`skill-catalog-starred-indicator-${entryKey(entry)}`"
                  aria-hidden="true"
                  >star</span
                >
                <span class="shrink-0 material-icons text-sm" :class="presetSourceMeta.colour" :title="presetSourceMeta.title" aria-hidden="true">{{
                  presetSourceMeta.icon
                }}</span>
              </div>
            </div>
            <p v-if="catalogPresets.length === 0 && !catalogError" class="px-4 py-3 text-xs text-gray-400 italic" data-testid="skill-catalog-empty">
              {{ t("pluginManageSkills.catalogEmpty") }}
            </p>
            <div v-if="catalogError" class="px-4 py-2 text-xs text-red-600">{{ catalogError }}</div>

            <!-- External repos (#1383 PR-C2): one collapsible subgroup
                 per installed repo. Rows behave exactly like preset
                 rows (select → right pane with ★ Star / ▶ Run once). -->
            <div
              v-for="group in externalGroups"
              :key="`catalog-repo-${group.repo.repoId}`"
              :data-testid="`skill-catalog-repo-${group.repo.repoId}`"
              class="border-t border-gray-100"
            >
              <div class="w-full flex items-center hover:bg-gray-100">
                <button
                  type="button"
                  :data-testid="`skill-catalog-repo-toggle-${group.repo.repoId}`"
                  class="flex-1 min-w-0 flex items-center gap-1 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold"
                  :aria-expanded="isRepoOpen(group.repo.repoId)"
                  @click="toggleRepo(group.repo.repoId)"
                >
                  <span class="material-icons text-sm">{{ isRepoOpen(group.repo.repoId) ? "expand_more" : "chevron_right" }}</span>
                  <span class="truncate normal-case text-gray-600">{{ repoLabel(group.repo) }}</span>
                  <span class="text-gray-400 font-normal">({{ group.entries.length }})</span>
                </button>
                <button
                  type="button"
                  class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-blue-600 disabled:opacity-40"
                  :data-testid="`skill-catalog-repo-update-${group.repo.repoId}`"
                  :disabled="updatingRepoId === group.repo.repoId"
                  :title="t('pluginManageSkills.catalogUpdateRepo')"
                  :aria-label="t('pluginManageSkills.catalogUpdateRepo')"
                  :aria-busy="updatingRepoId === group.repo.repoId"
                  @click="updateRepo(group.repo)"
                >
                  <span class="material-icons text-sm" :class="updatingRepoId === group.repo.repoId ? 'animate-spin' : ''" aria-hidden="true">refresh</span>
                </button>
                <button
                  type="button"
                  class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-red-600 disabled:opacity-40"
                  :data-testid="`skill-catalog-repo-uninstall-${group.repo.repoId}`"
                  :disabled="uninstallingRepoId === group.repo.repoId"
                  :title="t('pluginManageSkills.catalogUninstallRepo')"
                  :aria-label="t('pluginManageSkills.catalogUninstallRepo')"
                  :aria-busy="uninstallingRepoId === group.repo.repoId"
                  @click="uninstallRepo(group.repo.repoId)"
                >
                  <span class="material-icons text-sm" aria-hidden="true">delete_outline</span>
                </button>
              </div>
              <div v-show="isRepoOpen(group.repo.repoId)" role="group">
                <div
                  v-for="entry in group.entries"
                  :key="`catalog-ext-${entryKey(entry)}`"
                  :data-testid="`skill-catalog-item-${entryKey(entry)}`"
                  class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
                  :class="selectedCatalogKey === entryKey(entry) ? 'bg-white border-l-2 border-l-blue-500' : ''"
                  role="button"
                  tabindex="0"
                  :aria-pressed="selectedCatalogKey === entryKey(entry)"
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
                      :data-testid="`skill-catalog-starred-indicator-${entryKey(entry)}`"
                      aria-hidden="true"
                      >star</span
                    >
                    <span class="shrink-0 material-icons text-sm text-gray-400" :title="t('pluginManageSkills.sourceExternalTitle')" aria-hidden="true"
                      >cloud</span
                    >
                  </div>
                </div>
                <p v-if="group.entries.length === 0" class="px-4 py-3 text-xs text-gray-400 italic">
                  {{ t("pluginManageSkills.catalogRepoEmpty") }}
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="skill-catalog-add-repo"
              class="w-full flex items-center gap-1 px-4 py-3 text-sm text-blue-600 hover:bg-white border-t border-gray-100"
              @click="openAddRepo"
            >
              <span class="material-icons text-sm" aria-hidden="true">add</span>
              {{ t("pluginManageSkills.catalogAddRepo") }}
            </button>
          </div>
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
                :disabled="catalogActioningKey === selectedCatalogKey"
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
                :disabled="catalogActioningKey === selectedCatalogKey || !catalogDetail"
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
                  v-if="isSelectedEditable"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  :disabled="detailLoading"
                  data-testid="skill-edit-btn"
                  @click="startEdit"
                >
                  <span class="material-icons text-sm">edit</span>
                  {{ t("pluginManageSkills.btnEdit") }}
                </button>
                <button
                  v-if="isSelectedEditable"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  :class="isSelectedPreset ? '' : 'border-red-300 text-red-600 hover:bg-red-50'"
                  :disabled="detailLoading || deleting"
                  :data-testid="isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'"
                  :title="isSelectedPreset ? t('pluginManageSkills.unstarPresetSkill') : t('pluginManageSkills.deleteProjectSkill')"
                  @click="deleteSkill"
                >
                  <span class="material-icons text-sm" :class="isSelectedPreset ? 'text-amber-500' : ''">{{
                    isSelectedPreset ? "star_border" : "delete"
                  }}</span>
                  {{ isSelectedPreset ? t("pluginManageSkills.btnUnstar") : t("pluginManageSkills.btnDelete") }}
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

    <!-- Add-repo modal (#1383 PR-C2). URL (+ optional subpath) or a
         one-click seed suggestion. Backend error kinds (invalid-url /
         invalid-subpath / id-collision / no-skills / 502) surface
         inline. -->
    <div
      v-if="addRepoOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="skill-add-repo-modal"
      @click.self="addRepoOpen = false"
    >
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <h3 class="text-base font-semibold text-gray-800 mb-3">{{ t("pluginManageSkills.catalogAddRepoTitle") }}</h3>
        <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageSkills.catalogRepoUrlLabel") }}</label>
        <input
          v-model="addRepoUrl"
          type="text"
          data-testid="skill-add-repo-url"
          class="w-full h-8 px-2 mb-3 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          :placeholder="t('pluginManageSkills.catalogRepoUrlPlaceholder')"
          @keydown.enter="installRepo(addRepoUrl, addRepoSubpath)"
        />
        <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageSkills.catalogRepoSubpathLabel") }}</label>
        <input
          v-model="addRepoSubpath"
          type="text"
          data-testid="skill-add-repo-subpath"
          class="w-full h-8 px-2 mb-3 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          :placeholder="t('pluginManageSkills.catalogRepoSubpathPlaceholder')"
          @keydown.enter="installRepo(addRepoUrl, addRepoSubpath)"
        />
        <p v-if="addRepoError" class="text-xs text-red-600 mb-3" data-testid="skill-add-repo-error">{{ addRepoError }}</p>
        <div class="flex items-center justify-end gap-2 mb-4">
          <button
            type="button"
            class="h-8 px-2.5 flex items-center text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            @click="addRepoOpen = false"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            data-testid="skill-add-repo-submit"
            class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
            :disabled="addRepoBusy"
            @click="installRepo(addRepoUrl, addRepoSubpath)"
          >
            {{ addRepoBusy ? t("pluginManageSkills.catalogRepoInstalling") : t("pluginManageSkills.catalogAddRepoSubmit") }}
          </button>
        </div>
        <div v-if="suggestions.length > 0">
          <p class="text-xs font-medium text-gray-600 mb-2">{{ t("pluginManageSkills.catalogAddRepoSuggestions") }}</p>
          <div
            v-for="suggestion in suggestions"
            :key="suggestion.url"
            class="mb-1 rounded border"
            :class="selectedSuggestionUrl === suggestion.url ? 'border-blue-400 bg-blue-50' : 'border-gray-200'"
          >
            <div class="flex items-start">
              <button
                type="button"
                :data-testid="`skill-add-repo-suggestion-${suggestion.url}`"
                class="flex-1 min-w-0 text-left px-3 py-2 text-sm"
                :aria-pressed="selectedSuggestionUrl === suggestion.url"
                @click="selectSuggestion(suggestion)"
              >
                <div class="font-medium text-gray-700">{{ suggestion.displayName }}</div>
                <div class="text-xs text-gray-500" :class="selectedSuggestionUrl === suggestion.url ? 'whitespace-normal break-words' : 'truncate'">
                  {{ suggestion.description }}
                </div>
              </button>
              <a
                :href="suggestion.url"
                target="_blank"
                rel="noopener noreferrer"
                :data-testid="`skill-add-repo-suggestion-link-${suggestion.url}`"
                class="h-8 w-8 shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-blue-600"
                :title="t('pluginManageSkills.catalogRepoOpenLink')"
                :aria-label="t('pluginManageSkills.catalogRepoOpenLink')"
                @click.stop
              >
                <span class="material-icons text-sm" aria-hidden="true">open_in_new</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
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
import {
  categorizeSkill,
  loadCollapsedSections,
  persistCollapsedSections,
  loadRepoCollapsed,
  persistRepoCollapsed,
  pickInitialSelection,
  type SkillSectionKey,
} from "./categories";
import { isPresetActivation } from "./presetDetection";

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

// Collapsed-section state for the sidebar (active / catalog). Persisted
// to localStorage so each user's preference survives reloads.
// shallowRef because we always replace the Set wholesale (toggleSection
// builds a fresh Set), avoiding the deep-proxy that ref() would create.
const collapsedSections = shallowRef<Set<SkillSectionKey>>(loadCollapsedSections());

// Active skills, alphabetised. Provenance (system / project / user) is
// shown as a per-row badge via sourceMeta, not as its own collapsible
// group — the sidebar groups by section, not by provenance.
const activeSkills = computed(() => [...skills.value].sort((leftSkill, rightSkill) => leftSkill.name.localeCompare(rightSkill.name)));

function isSectionOpen(key: SkillSectionKey): boolean {
  return !collapsedSections.value.has(key);
}

function toggleSection(key: SkillSectionKey): void {
  const next = new Set(collapsedSections.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsedSections.value = next;
  persistCollapsedSections(next);
}

const selectedName = ref<string | null>(pickInitialSelection(activeSkills.value, collapsedSections.value));
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

// Edit/Delete follows the backend writer contract (writer.ts rejects
// only source === "user"), NOT the mc- name heuristic. Under #1335
// PR-A the launcher syncs presets to data/skills/catalog/preset/ and
// leaves .claude/skills/ untouched, so a ★-starred mc- preset is a
// normal project-scope skill — gating it read-only by name would make
// activation one-way (no un-star / edit from /skills). The mc- =
// "system" classification survives only as the provenance badge.
const isSelectedEditable = computed(() => detail.value?.source === "project");

const listError = ref<string | null>(null);

const endpoints = pluginEndpoints<SkillsEndpoints>("skills");

// Catalog state (#1335 PR-B). Loaded on mount + after a successful
// star so the row updates from "★ Star" → "★ Starred".
// `catalogActioningKey` (declared below) disables the button
// mid-request to prevent double-clicks across Star / Run once.
type CatalogSource = "preset" | "external";
interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  source: CatalogSource;
  alreadyActive: boolean;
  // External entries only — identify the source repo + skill folder
  // so star / preview / run-once can address them (slug alone is the
  // derived activeId, not enough to locate the catalog copy).
  repoId?: string;
  skillFolder?: string;
  repoUrl?: string;
}
interface CatalogDetail {
  slug: string;
  source: CatalogSource;
  description: string;
  body: string;
}
interface ExternalRepo {
  repoId: string;
  url: string;
  subpath?: string;
  sha: string;
  installedAt: string;
}
interface ExternalSuggestion {
  url: string;
  subpath?: string;
  displayName: string;
  description: string;
  license?: string;
}
const catalogPresets = ref<CatalogEntry[]>([]);
const catalogExternal = ref<CatalogEntry[]>([]);
const catalogRepos = ref<ExternalRepo[]>([]);
const catalogError = ref<string | null>(null);

// True when the selected active skill has a matching entry in the
// preset catalog — meaning a "delete" from `.claude/skills/<slug>/`
// is recoverable, because the launcher re-syncs the catalog copy
// under `data/skills/catalog/preset/<slug>/` on every boot
// (see server/workspace/skills-preset.ts). We expose this case as
// "Unstar" with a non-destructive confirm message; the underlying
// DELETE endpoint is identical.
//
// Catalog membership (not the `mc-` slug prefix) is the
// authoritative signal: the writer pipeline does not reserve the
// `mc-` namespace, so a hand-rolled project skill named `mc-foo`
// without a catalog entry must still surface the destructive Delete
// copy. See isPresetActivation tests in test/plugins/manageSkills/.
const isSelectedPreset = computed(() => isPresetActivation(detail.value?.name, catalogPresets.value));
// Per-repo collapse set (repoId ∈ set ⇒ collapsed). shallowRef: the
// Set is replaced wholesale on toggle.
const repoCollapsed = shallowRef<Set<string>>(loadRepoCollapsed());
// Add-repo modal state.
const addRepoOpen = ref(false);
const addRepoUrl = ref("");
const addRepoSubpath = ref("");
const addRepoError = ref<string | null>(null);
const addRepoBusy = ref(false);
const suggestions = ref<ExternalSuggestion[]>([]);
// Which suggestion the user picked: drives the form prefill + the
// "expanded description" / highlight. Selecting never installs —
// install stays explicit (Install button / Enter in the URL field).
const selectedSuggestionUrl = ref<string | null>(null);
const uninstallingRepoId = ref<string | null>(null);
const updatingRepoId = ref<string | null>(null);
// Single in-flight gate covers Star / Run once on the selected
// entry so a slow request doesn't let the user fire a second
// action mid-flight.
const catalogActioningKey = ref<string | null>(null);
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

// External catalog entries grouped under their repo, in the repo
// order returned by `/external/repos`. Repos with zero discoverable
// entries still render (header + empty state) so an install that
// found nothing is visible rather than silently absent.
const externalGroups = computed<{ repo: ExternalRepo; entries: CatalogEntry[] }[]>(() =>
  catalogRepos.value.map((repo) => ({
    repo,
    entries: catalogExternal.value
      .filter((entry) => entry.repoId === repo.repoId)
      .sort((leftEntry, rightEntry) => leftEntry.slug.localeCompare(rightEntry.slug)),
  })),
);

function repoLabel(repo: ExternalRepo): string {
  // `https://github.com/owner/repo` → `owner/repo`; fall back to the
  // repoId if the URL is somehow unparseable.
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repo.url);
  return match ? match[1] : repo.repoId;
}

function isRepoOpen(repoId: string): boolean {
  return !repoCollapsed.value.has(repoId);
}

function toggleRepo(repoId: string): void {
  const next = new Set(repoCollapsed.value);
  if (next.has(repoId)) {
    next.delete(repoId);
  } else {
    next.add(repoId);
  }
  repoCollapsed.value = next;
  persistRepoCollapsed(next);
}

// Body/query shape for star + preview: external entries are keyed by
// (repoId, skillFolder); presets by slug. Centralised so the two call
// sites can't drift.
function catalogActionParams(entry: CatalogEntry): Record<string, string> {
  if (entry.source === "external" && entry.repoId && entry.skillFolder) {
    return { source: "external", repoId: entry.repoId, skillFolder: entry.skillFolder };
  }
  return { source: entry.source, slug: entry.slug };
}

// Stable UI identity. External `slug` is the backend-derived
// `<owner>-<skillFolder>` activeId — lossy + owner-prefixed, so two
// external entries can collide (dup Vue keys / testids, wrong row
// highlighted, shared in-flight lock, stale preview guard passing for
// the wrong item). `(repoId, skillFolder)` is the unique stable key;
// presets keep their already-unique slug.
function entryKey(entry: CatalogEntry): string {
  if (entry.source === "external" && entry.repoId && entry.skillFolder) {
    return `${entry.repoId}/${entry.skillFolder}`;
  }
  return entry.slug;
}

const selectedCatalogKey = computed(() => (selectedCatalog.value ? entryKey(selectedCatalog.value) : null));

// Visual key for the provenance badge on every active row + the
// preset rows. Provenance is derived via categorizeSkill (NOT the raw
// `source`, which can't express "system") so the badge stays
// consistent with sectionLegend and the edit gate:
//   - system  `mc-` bundled, read-only      — launcher-owned
//   - project `<workspace>/.claude/skills/` — this workspace only
//   - user    `~/.claude/skills/`           — global across workspaces
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

function skillBadge(skill: SkillSummary): SourceMeta {
  const provenance = categorizeSkill(skill);
  if (provenance === "system") {
    return { icon: "lock", title: t("pluginManageSkills.sourceSystemTitle"), colour: "text-gray-500" };
  }
  if (provenance === "user") {
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
    selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
    selectedCatalog.value = null;
    catalogDetail.value = null;
    catalogDetailLoading.value = false;
    catalogActioningKey.value = null;
    catalogError.value = null;
    addRepoOpen.value = false;
    addRepoError.value = null;
    selectedSuggestionUrl.value = null;
    uninstallingRepoId.value = null;
    updatingRepoId.value = null;
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
    catalogExternal.value = response.data.entries.filter((entry) => entry.source === "external");
  }
}

async function loadExternalRepos(): Promise<void> {
  const response = await apiGet<{ repos: ExternalRepo[] }>(endpoints.externalReposList.url);
  if (!response.ok) {
    catalogError.value = t("pluginManageSkills.errCatalogRepoListFailed", { error: response.error });
    return;
  }
  if (Array.isArray(response.data.repos)) catalogRepos.value = response.data.repos;
}

async function loadSuggestions(): Promise<void> {
  const response = await apiGet<{ suggestions: ExternalSuggestion[] }>(endpoints.externalSuggestions.url);
  if (response.ok && Array.isArray(response.data.suggestions)) suggestions.value = response.data.suggestions;
}

function openAddRepo(): void {
  addRepoUrl.value = "";
  addRepoSubpath.value = "";
  addRepoError.value = null;
  selectedSuggestionUrl.value = null;
  addRepoOpen.value = true;
  if (suggestions.value.length === 0) void loadSuggestions();
}

// Pick a suggestion → prefill the form so the user can review and
// then press Install. Deliberately does NOT install (avoids the
// accidental one-click install footgun).
function selectSuggestion(suggestion: ExternalSuggestion): void {
  addRepoUrl.value = suggestion.url;
  addRepoSubpath.value = suggestion.subpath ?? "";
  addRepoError.value = null;
  selectedSuggestionUrl.value = suggestion.url;
}

async function installRepo(url: string, subpath?: string): Promise<void> {
  if (addRepoBusy.value) return;
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    addRepoError.value = t("pluginManageSkills.errCatalogRepoInvalidUrl");
    return;
  }
  addRepoBusy.value = true;
  addRepoError.value = null;
  try {
    const trimmedSubpath = subpath?.trim();
    const body: Record<string, string> = { url: trimmedUrl };
    if (trimmedSubpath) body.subpath = trimmedSubpath;
    const response = await apiPost<{ installed: true; repoId: string }>(endpoints.externalReposInstall.url, body);
    if (!response.ok) {
      addRepoError.value = t("pluginManageSkills.errCatalogRepoInstallFailed", { error: response.error });
      return;
    }
    addRepoOpen.value = false;
    await Promise.all([loadExternalRepos(), loadCatalog()]);
  } finally {
    addRepoBusy.value = false;
  }
}

async function uninstallRepo(repoId: string): Promise<void> {
  if (uninstallingRepoId.value !== null) return;
  if (typeof window !== "undefined" && !window.confirm(t("pluginManageSkills.catalogUninstallConfirm"))) return;
  uninstallingRepoId.value = repoId;
  try {
    const response = await apiDelete<{ uninstalled: true }>(buildRouteUrl(endpoints.externalReposRemove, { repoId }));
    if (!response.ok) {
      catalogError.value = t("pluginManageSkills.errCatalogRepoUninstallFailed", { error: response.error });
      return;
    }
    catalogError.value = null;
    if (selectedCatalog.value?.repoId === repoId) {
      selectedCatalog.value = null;
      catalogDetail.value = null;
    }
    // Starred copies survive uninstall (backend-guaranteed, C1) — pull
    // the active list so any starred-from-this-repo rows stay visible.
    await Promise.all([loadExternalRepos(), loadCatalog(), refreshActiveList()]);
  } finally {
    uninstallingRepoId.value = null;
  }
}

// "Update" == re-install with the repo's recorded url/subpath. C1's
// install path re-fetches upstream HEAD, wipes + re-copies the
// catalog dir, and rewrites `.source.json` with the new SHA. Starred
// copies under `.claude/skills/` are untouched (catalog-layer only).
async function updateRepo(repo: ExternalRepo): Promise<void> {
  if (updatingRepoId.value !== null) return;
  updatingRepoId.value = repo.repoId;
  // try/finally so the in-flight gate always clears even if the
  // request throws — otherwise the button stays disabled forever
  // (same hardening as runOnceCatalogEntry, Codex review #1374).
  try {
    const body: Record<string, string> = { url: repo.url };
    if (repo.subpath) body.subpath = repo.subpath;
    const response = await apiPost<{ installed: true; repoId: string }>(endpoints.externalReposInstall.url, body);
    if (!response.ok) {
      catalogError.value = t("pluginManageSkills.errCatalogRepoInstallFailed", { error: response.error });
      return;
    }
    catalogError.value = null;
    await Promise.all([loadExternalRepos(), loadCatalog()]);
  } finally {
    updatingRepoId.value = null;
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
  catalogActioningKey.value = entryKey(entry);
  const response = await apiPost<{ starred: true; slug: string }>(endpoints.catalogStar.url, catalogActionParams(entry));
  catalogActioningKey.value = null;
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
  if (selectedCatalog.value && entryKey(selectedCatalog.value) === entryKey(entry)) {
    const pool = entry.source === "external" ? catalogExternal.value : catalogPresets.value;
    const updated = pool.find((candidate) => entryKey(candidate) === entryKey(entry));
    if (updated) selectedCatalog.value = updated;
  }
}

async function fetchCatalogDetail(entry: CatalogEntry): Promise<CatalogDetail | null> {
  const response = await apiGet<{ detail: CatalogDetail }>(endpoints.catalogPreview.url, catalogActionParams(entry));
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
  const keyAtRequest = entryKey(entry);
  const fetched = await fetchCatalogDetail(entry);
  // Selection may have changed while the request was in flight —
  // drop the response if so (same race-condition guard the active-
  // skill detail watcher uses). Identity is the (repoId, skillFolder)
  // composite for external entries, not the lossy slug.
  if (!selectedCatalog.value || entryKey(selectedCatalog.value) !== keyAtRequest) return;
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
  catalogActioningKey.value = entryKey(entry);
  try {
    const isSelectedEntry = selectedCatalog.value !== null && entryKey(selectedCatalog.value) === entryKey(entry) && catalogDetail.value !== null;
    const body = isSelectedEntry && catalogDetail.value !== null ? catalogDetail.value.body : (await fetchCatalogDetail(entry))?.body;
    if (!body || !body.trim()) {
      catalogError.value = t("pluginManageSkills.errCatalogRunOnceEmpty");
      return;
    }
    catalogAppApi.startNewChat(body);
  } finally {
    catalogActioningKey.value = null;
  }
}

// Standalone mode: if no selectedResult was passed, fetch the skill
// list from the API on mount so the view is populated.
onMounted(async () => {
  // Always load the catalog so the section appears even when the
  // view was opened from a tool result (which only carries the
  // active list). External repos load in parallel — failure of one
  // doesn't block the other (each sets its own inline error).
  await Promise.all([loadCatalog(), loadExternalRepos()]);
  if (props.selectedResult || skills.value.length > 0) return;
  const response = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
  if (!response.ok) {
    listError.value = t("pluginManageSkills.errListFailed", { error: response.error });
    return;
  }
  if (Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
    selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
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
// For preset (mc-*) entries the same endpoint is invoked, but the
// confirm copy reflects that the catalog copy survives — see
// `isSelectedPreset` above and `syncPresetSkills` in skills-preset.ts.
async function deleteSkill(): Promise<void> {
  if (!detail.value || detail.value.source !== "project") return;
  const { name } = detail.value;
  const confirmKey = isSelectedPreset.value ? "pluginManageSkills.confirmUnstar" : "pluginManageSkills.confirmDelete";
  if (!window.confirm(t(confirmKey, { name }))) {
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
  selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
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
