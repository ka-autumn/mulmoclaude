<template>
  <div class="h-full flex flex-col bg-slate-50/30">
    <header class="flex items-center gap-3 px-6 py-4 border-b border-slate-200 bg-white">
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
        :title="t('collectionsView.backToIndex')"
        :aria-label="t('collectionsView.backToIndex')"
        data-testid="collections-back"
        @click="goBack"
      >
        <span class="material-icons text-lg">arrow_back</span>
      </button>

      <div v-if="collection" class="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
        <span class="material-icons text-xl">{{ collection.icon }}</span>
      </div>

      <div class="flex-1 min-w-0">
        <h1 class="text-base font-bold text-slate-800 truncate">
          {{ collection?.title ?? t("collectionsView.title") }}
        </h1>
        <span v-if="collection" class="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          {{ collection.slug }}
        </span>
      </div>

      <button
        v-if="canCreate"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors shadow-sm"
        data-testid="collections-add-item"
        @click="openCreate"
      >
        <span class="material-icons text-sm">add</span>
        <span>{{ t("common.add") }}</span>
      </button>
    </header>

    <!-- Search Toolbar -->
    <div v-if="collection && items.length > 0" class="px-6 py-3 bg-white border-b border-slate-100 flex items-center justify-between gap-4">
      <div class="relative flex-1 max-w-md">
        <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
          <span class="material-icons text-lg">search</span>
        </span>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('collectionsView.searchPlaceholder')"
          :aria-label="t('collectionsView.searchPlaceholder')"
          class="w-full bg-slate-50 border border-slate-200/80 rounded-xl pl-9 pr-8 py-1.5 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all font-medium"
        />
        <button
          v-if="searchQuery"
          type="button"
          :aria-label="t('collectionsView.clearSearch')"
          class="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
          @click="searchQuery = ''"
        >
          <span class="material-icons text-sm">close</span>
        </button>
      </div>
      <div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider select-none">
        {{ t("collectionsView.searchSummary", { shown: filteredItems.length, total: items.length }) }}
      </div>
    </div>

    <div class="flex-1 overflow-auto">
      <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-sm text-slate-500 gap-3">
        <div class="h-8 w-8 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
        <span>{{ t("common.loading") }}</span>
      </div>

      <div v-else-if="loadError" class="m-6 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3">
        <span class="material-icons text-red-600">error</span>
        <span>{{ loadError === "not-found" ? t("collectionsView.notFound") : `${t("collectionsView.loadFailed")}: ${loadError}` }}</span>
      </div>

      <div v-else-if="!collection">
        <!-- defensive: loading=false, error=null, collection=null -->
      </div>

      <div v-else-if="items.length === 0" class="flex flex-col items-center justify-center py-20 text-sm text-slate-400 gap-2">
        <span class="material-icons text-4xl text-slate-300">folder_open</span>
        <p class="font-semibold text-slate-600">{{ t("collectionsView.itemsEmpty") }}</p>
      </div>

      <div v-else-if="filteredItems.length === 0" class="flex flex-col items-center justify-center py-20 text-sm text-slate-400 gap-2">
        <span class="material-icons text-4xl text-slate-300">search_off</span>
        <p class="font-semibold text-slate-600">{{ t("collectionsView.noMatchingItems") }}</p>
        <button type="button" class="text-xs text-indigo-600 font-semibold hover:underline" @click="searchQuery = ''">
          {{ t("collectionsView.clearSearch") }}
        </button>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="min-w-full text-xs">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200">
              <th v-for="[key, field] in nonEmbedFields" :key="key" class="px-5 py-3 font-bold text-slate-500 text-left uppercase tracking-wider">
                {{ field.label }}
              </th>
              <th class="px-5 py-3 font-medium w-24"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            <tr
              v-for="item in filteredItems"
              :key="String(item[collection.schema.primaryKey] ?? '')"
              class="hover:bg-slate-50/70 cursor-pointer transition-colors focus:outline-none focus:bg-indigo-50/30"
              role="button"
              tabindex="0"
              :aria-label="t('collectionsView.openItem', { id: String(item[collection.schema.primaryKey] ?? '') })"
              :data-testid="`collections-row-${item[collection.schema.primaryKey]}`"
              @click="openView(item)"
              @keydown.enter.self="openView(item)"
              @keydown.space.self.prevent="openView(item)"
            >
              <td v-for="[key, field] in nonEmbedFields" :key="key" class="px-5 py-3.5 text-slate-700 align-middle max-w-xs font-medium">
                <!-- Boolean state badge -->
                <span v-if="field.type === 'boolean'" class="block">
                  <span
                    v-if="item[key] === true"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/40"
                  >
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    {{ t("common.yes") }}
                  </span>
                  <span
                    v-else-if="item[key] === false"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-400 border border-slate-200/20"
                  >
                    {{ t("common.no") }}
                  </span>
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "—" for an omitted boolean: distinct from an explicit false (the edit pipeline tracks presence via boolOriginallyPresent). -->
                  <span v-else class="text-slate-300">—</span>
                </span>

                <!-- Ref router-link badge -->
                <span v-else-if="field.type === 'ref' && field.to && typeof item[key] === 'string' && item[key]" class="block truncate">
                  <router-link
                    :to="{ path: `/collections/${field.to}`, query: { selected: String(item[key]) } }"
                    class="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 hover:underline font-semibold"
                    :data-testid="`collections-ref-link-${key}-${item[key]}`"
                    @click.stop
                  >
                    <span>{{ refDisplay(field.to, String(item[key])) }}</span>
                    <span class="material-icons text-[10px]">launch</span>
                  </router-link>
                </span>

                <!-- Enum badges -->
                <span
                  v-else-if="field.type === 'enum' && item[key]"
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
                  :class="enumBadgeClass(item[key])"
                >
                  {{ item[key] }}
                </span>

                <!-- Money -->
                <span v-else-if="field.type === 'money'" class="block truncate tabular-nums font-semibold text-slate-900">{{
                  formatMoney(item[key], resolveCurrency(field, item), locale)
                }}</span>

                <!-- Table summary counter -->
                <span
                  v-else-if="field.type === 'table'"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200/40"
                >
                  <span class="material-icons text-[11px]">list</span>
                  <span>{{ tableSummary(item[key]) }}</span>
                </span>

                <!-- Derived formula fields -->
                <span
                  v-else-if="field.type === 'derived'"
                  class="inline-block truncate tabular-nums font-bold text-indigo-900 bg-indigo-50/50 px-1.5 py-0.5 rounded border border-indigo-100/50"
                  >{{ derivedDisplay(field, evaluateDerivedAgainstItem(field, String(key), item), item) }}</span
                >

                <span v-else class="block truncate text-slate-600">{{ formatCell(item[key], field.type) }}</span>
              </td>

              <td class="px-5 py-3.5 text-right whitespace-nowrap align-middle">
                <div class="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 transition-all duration-200"
                    :title="t('collectionsView.editItem')"
                    :aria-label="t('collectionsView.editItem')"
                    :data-testid="`collections-edit-item-${item[collection.schema.primaryKey]}`"
                    @click.stop="openEdit(item)"
                  >
                    <span class="material-icons text-base">edit</span>
                  </button>
                  <button
                    type="button"
                    class="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-all duration-200"
                    :title="t('common.remove')"
                    :aria-label="t('common.remove')"
                    :data-testid="`collections-delete-item-${item[collection.schema.primaryKey]}`"
                    @click.stop="confirmDelete(item)"
                  >
                    <span class="material-icons text-base">delete</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Edit / Create modal -->
    <div
      v-if="editing && collection"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all duration-300"
      @click.self="closeEditor"
    >
      <div
        class="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col border border-slate-200 overflow-hidden transform scale-100 transition-all"
      >
        <header class="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
          <div class="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/50">
            <span class="material-icons text-lg">{{ editing.mode === "create" ? "add_circle_outline" : "edit" }}</span>
          </div>
          <div class="flex-1">
            <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wide">
              {{ editing.mode === "create" ? t("collectionsView.createTitle") : t("collectionsView.editTitle") }}
            </h2>
            <span class="text-xs text-slate-400 font-semibold">{{ collection.title }}</span>
          </div>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 transition-colors"
            :aria-label="t('common.close')"
            data-testid="collections-editor-close"
            @click="closeEditor"
          >
            <span class="material-icons text-lg">close</span>
          </button>
        </header>

        <form class="flex-1 overflow-auto px-6 py-5 space-y-4" @submit.prevent="saveEditor">
          <div v-for="(field, key) in collection.schema.fields" :key="key" class="space-y-1.5">
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
                @change="markBoolTouched(key)"
              />
              <span class="text-xs font-semibold" :class="editing.bool[key] ? 'text-indigo-600' : 'text-slate-500'">
                {{ editing.bool[key] ? t("common.yes") : t("common.no") }}
              </span>
            </label>

            <!-- Embed card (read-only) -->
            <CollectionEmbedView v-else-if="field.type === 'embed' && embedViews[key]" :view="embedViews[key]" :field-key="String(key)" />

            <!-- Ref selector -->
            <select
              v-else-if="field.type === 'ref' && field.to && refOptions(field.to).length > 0"
              :id="`collections-field-${key}`"
              v-model="editing.text[key]"
              :required="isFieldRequiredInUi(field)"
              class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 hover:bg-slate-50/50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all cursor-pointer font-medium text-slate-700"
              :data-testid="`collections-input-${key}`"
            >
              <option value="">{{ t("collectionsView.selectPlaceholder") }}</option>
              <option v-for="opt in refOptions(field.to)" :key="opt.slug" :value="opt.slug">{{ opt.display }}</option>
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
                          v-else-if="subField.type === 'ref' && subField.to && refOptions(subField.to).length > 0"
                          v-model="row.text[subKey]"
                          :required="subField.required"
                          class="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none cursor-pointer bg-slate-50 font-medium"
                        >
                          <option value="">{{ t("collectionsView.selectPlaceholder") }}</option>
                          <option v-for="opt in refOptions(subField.to)" :key="opt.slug" :value="opt.slug">{{ opt.display }}</option>
                        </select>
                        <!-- money subfield -->
                        <div v-else-if="subField.type === 'money'" class="relative flex items-center">
                          <span class="absolute left-1.5 text-[10px] text-slate-400 font-bold pr-1 border-r border-slate-200">{{
                            currencySymbol(resolveCurrency(subField, liveRecord))
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
                          :type="inputTypeFor(subField.type)"
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
                          @click="removeTableRow(key, rowIdx)"
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
                @click="addTableRow(key, field.of)"
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
                :value="derivedDisplay(field, liveDerived?.[key] ?? null, liveRecord)"
                type="text"
                disabled
                class="w-full rounded-xl border border-indigo-100 bg-indigo-50/15 pl-16 pr-3 py-2 text-xs font-bold text-indigo-700 select-none cursor-not-allowed"
                :data-testid="`collections-input-${key}`"
              />
            </div>

            <!-- Money input field -->
            <div v-else-if="field.type === 'money'" class="relative flex items-center">
              <div class="absolute left-3 text-slate-400 font-bold text-xs select-none pr-1.5 border-r border-slate-200">
                {{ currencySymbol(resolveCurrency(field, liveRecord)) }}
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
              v-else-if="['string', 'email', 'number', 'date', 'ref'].includes(field.type)"
              :id="`collections-field-${key}`"
              v-model="editing.text[key]"
              :type="inputTypeFor(field.type)"
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
          <p v-if="saveError" class="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-xl">{{ saveError }}</p>
        </form>

        <footer class="px-6 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/50">
          <button
            type="button"
            class="h-8 px-2.5 rounded text-xs font-bold text-slate-500 hover:bg-slate-200/50 transition-colors"
            data-testid="collections-editor-cancel"
            @click="closeEditor"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            class="h-8 px-2.5 rounded bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm shadow-indigo-600/10"
            :disabled="saving"
            data-testid="collections-editor-save"
            @click="saveEditor"
          >
            {{ saving ? t("common.saving") : t("common.save") }}
          </button>
        </footer>
      </div>
    </div>

    <!-- Open / detail modal (read-only document-style card) -->
    <div
      v-if="viewing && collection"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all duration-300"
      data-testid="collections-detail"
      @click.self="closeView"
    >
      <div
        class="bg-slate-50/90 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-slate-200/50 overflow-hidden transform scale-100 transition-all"
      >
        <header class="px-6 py-4 bg-white border-b border-slate-200 flex items-center gap-3">
          <div class="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <span class="material-icons text-xl">{{ collection.icon }}</span>
          </div>
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
              @click="runAction(action)"
            >
              <span v-if="action.icon" class="material-icons text-sm">{{ action.icon }}</span>
              <span>{{ action.label }}</span>
            </button>

            <!-- Edit Button -->
            <button
              type="button"
              class="h-8 px-2.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-bold text-xs transition-all flex items-center gap-1"
              data-testid="collections-detail-edit"
              @click="editFromView"
            >
              <span class="material-icons text-sm">edit</span>
              <span>{{ t("collectionsView.editItem") }}</span>
            </button>

            <!-- Close Button -->
            <button
              type="button"
              class="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              :aria-label="t('common.close')"
              data-testid="collections-detail-close"
              @click="closeView"
            >
              <span class="material-icons text-lg">close</span>
            </button>
          </div>
        </header>

        <div class="flex-1 overflow-auto p-6 space-y-4">
          <p
            v-if="actionError"
            class="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-xl shadow-sm"
            data-testid="collections-detail-action-error"
          >
            {{ actionError }}
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm">
            <div
              v-for="(field, key) in collection.schema.fields"
              :key="key"
              class="flex flex-col gap-1"
              :class="['table', 'markdown', 'embed'].includes(field.type) ? 'col-span-full' : 'col-span-1'"
            >
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider select-none">{{ field.label }}</div>

              <div class="text-xs font-medium text-slate-700 break-words" :data-testid="`collections-detail-value-${key}`">
                <!-- Boolean state -->
                <template v-if="field.type === 'boolean'">
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
                  class="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
                  :data-testid="`collections-detail-ref-${key}`"
                >
                  <span>{{ refDisplay(field.to, String(viewing[key])) }}</span>
                  <span class="material-icons text-xs">launch</span>
                </router-link>

                <!-- Money format -->
                <span v-else-if="field.type === 'money'" class="font-semibold text-slate-900 tabular-nums text-sm">{{
                  formatMoney(viewing[key], resolveCurrency(field, viewing), locale)
                }}</span>

                <!-- Derived formula badge -->
                <span
                  v-else-if="field.type === 'derived'"
                  class="inline-block truncate tabular-nums font-bold text-indigo-900 bg-indigo-50/50 px-2 py-0.5 rounded border border-indigo-100/50"
                  >{{ derivedDisplay(field, evaluateDerivedAgainstItem(field, String(key), viewing), viewing) }}</span
                >

                <!-- Sub table (e.g. Line Items in details) -->
                <div
                  v-else-if="field.type === 'table' && field.of && hasTableRows(viewing[key])"
                  class="border border-slate-200/80 rounded-xl overflow-hidden shadow-sm mt-1"
                >
                  <table class="w-full text-[11px] text-slate-600 bg-white">
                    <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                      <tr>
                        <th v-for="(subField, subKey) in field.of" :key="subKey" class="text-left px-4 py-2 font-bold">{{ subField.label }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <tr v-for="(row, rowIdx) in tableRows(viewing[key])" :key="rowIdx" class="hover:bg-slate-50/50">
                        <td v-for="(subField, subKey) in field.of" :key="subKey" class="px-4 py-2 align-middle font-medium">
                          <template v-if="subField.type === 'boolean'">
                            <span v-if="row[subKey] === true" class="material-icons text-emerald-600 text-base">check_circle</span>
                            <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "—" empty-value glyph (boolean=false), same as elsewhere. -->
                            <span v-else class="text-slate-300">—</span>
                          </template>
                          <span v-else :class="[subField.type === 'money' ? 'font-bold text-slate-800 tabular-nums' : '']">{{
                            formatSubCell(subField, row[subKey], viewing)
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
                  {{ detailText(viewing[key]) }}
                </div>

                <!-- Embed view -->
                <CollectionEmbedView v-else-if="field.type === 'embed' && embedViews[key]" :view="embedViews[key]" :field-key="String(key)" />

                <!-- Fallback text styling -->
                <span v-else class="text-slate-800 font-semibold">{{ formatCell(viewing[key], field.type) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { apiDelete, apiGet, apiPost, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import ConfirmModal from "./ConfirmModal.vue";
import CollectionEmbedView from "./CollectionEmbedView.vue";
import type { EmbedRow, EmbedView } from "./collectionEmbed";
import { useConfirm } from "../composables/useConfirm";
import { useAppApi } from "../composables/useAppApi";
import { evaluateDerived } from "../utils/collections/derivedFormula";
import { actionVisible } from "../utils/collections/actionVisible";

type FieldType = "string" | "text" | "email" | "number" | "date" | "boolean" | "markdown" | "ref" | "money" | "enum" | "table" | "derived" | "embed";

interface FieldSpec {
  type: FieldType;
  label: string;
  primary?: boolean;
  required?: boolean;
  /** When type === "ref" or "embed": slug of the target collection
   *  (see plans/done/feat-collections-ref-field.md). */
  to?: string;
  /** When type === "embed": primary-key value of the fixed record
   *  pulled from `to` and rendered read-only in the detail view
   *  (e.g. `me` for the singleton mc-profile). Display-only — never
   *  stored, never shown in the list table or the edit form. */
  id?: string;
  /** When type === "money" (or derived/money): a literal ISO 4217
   *  currency, fixed for every record. Falls back to "USD" when both
   *  this and `currencyField` are absent. */
  currency?: string;
  /** When type === "money" (or derived/money): name of a sibling
   *  record field holding the ISO code, so currency can vary per
   *  record. `resolveCurrency` reads `record[currencyField]` first,
   *  then `currency`, then "USD". Resolved against the top-level
   *  record even for money sub-fields inside a table. */
  currencyField?: string;
  /** When type === "enum": closed list of allowed string values
   *  for the form `<select>`. */
  values?: readonly string[];
  /** When type === "table": sub-schema for each row (a flat map
   *  of non-table / non-derived sub-fields). */
  of?: Record<string, FieldSpec>;
  /** When type === "derived": formula evaluated against the
   *  record. See src/utils/collections/derivedFormula.ts. */
  formula?: string;
  /** When type === "derived": render the computed value as this
   *  field type (e.g. "money"). Defaults to "number". */
  display?: FieldType;
}

/** Per-target-collection cache: maps an item's primary-key slug to
 *  the value we'll show in the table and dropdown. Filled in by
 *  `loadLinkedCollections` after the main collection's items arrive
 *  — one fetch per unique target collection, regardless of how many
 *  ref fields point at it. */
type RefDisplayMap = Record<string, string>;
type RefCache = Record<string, RefDisplayMap>;

/** Per-target cache for `embed` fields: the target collection's
 *  schema + items, kept in full (not reduced to display names like
 *  RefCache) so the detail view can render the embedded record's
 *  every field read-only. Keyed by target slug; the fixed record is
 *  looked up by `field.id` at render time. */
interface EmbedTargetData {
  schema: CollectionSchema;
  items: CollectionItem[];
}
type EmbedCache = Record<string, EmbedTargetData>;

/** A schema-declared, per-record action rendered as a button in the
 *  detail view. The host stays generic: it reads these fields and, on
 *  click, asks the server to assemble the seed prompt for `kind:"chat"`
 *  then starts a chat in `role`. */
interface CollectionAction {
  id: string;
  label: string;
  icon?: string;
  kind: "chat";
  role: string;
  template: string;
  /** Optional visibility predicate: the button renders only when
   *  `String(record[when.field])` is one of `when.in`. */
  when?: { field: string; in: string[] };
}

interface CollectionSchema {
  title: string;
  icon: string;
  dataPath: string;
  primaryKey: string;
  /** When set, the collection is a singleton: at most one record whose
   *  primary key is fixed to this value. */
  singleton?: string;
  fields: Record<string, FieldSpec>;
  actions?: CollectionAction[];
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

/** One row of a `table`-typed field, in draft form. Same shape as
 *  a top-level EditState's `text`/`bool` slots but flat — v0
 *  disallows nested tables and derived columns, so a row never
 *  needs its own table/derived sub-buckets. The boolean
 *  presence/touched maps mirror the top-level boolean omission
 *  semantics per row, so a row's explicit `false` round-trips
 *  through a no-op edit instead of being dropped. */
interface TableRowDraft {
  text: Record<string, string>;
  bool: Record<string, boolean>;
  boolOriginallyPresent: Record<string, boolean>;
  boolTouched: Record<string, boolean>;
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
  /** Per-table-field row drafts. Vue tracks deep mutations on
   *  these arrays so derived formulas re-evaluate live as the
   *  user edits cells. */
  table: Record<string, TableRowDraft[]>;
  /** For edit mode: the original item id pinned to the URL. */
  originalId: string | null;
}

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { openConfirm } = useConfirm();
const appApi = useAppApi();

const collection = ref<CollectionDetail | null>(null);
const items = ref<CollectionItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const editing = ref<EditState | null>(null);
/** The record currently shown in read-only "open" mode. Distinct
 *  from `editing`: open mode renders formatted values (no inputs)
 *  and is what a `/collections/<slug>?selected=<id>` deep link
 *  lands on. Mutually exclusive with `editing` in practice —
 *  `editFromView` hands off from one to the other. */
const viewing = ref<CollectionItem | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
const actionPending = ref(false);
const actionError = ref<string | null>(null);
const refCache = ref<RefCache>({});
const embedCache = ref<EmbedCache>({});

const searchQuery = ref("");

/** Case-insensitive substring match across an item's scalar fields.
 *  Object-valued fields (table rows, nested records) are skipped —
 *  they don't render as searchable text in the list table. */
function itemMatchesQuery(item: CollectionItem, query: string): boolean {
  return Object.values(item).some((val) => {
    if (val === undefined || val === null || typeof val === "object") return false;
    return String(val).toLowerCase().includes(query);
  });
}

const filteredItems = computed<CollectionItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return items.value;
  return items.value.filter((item) => itemMatchesQuery(item, query));
});

// Best-effort status coloring for enum badges: maps common
// status-like values to a semantic tint, falling back to neutral
// slate for anything unrecognized. Value-matching only (no i18n).
function enumBadgeClass(value: unknown): string {
  const str = String(value).toLowerCase();
  if (["paid", "completed", "success", "active", "approved", "yes", "true"].includes(str)) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200/30";
  }
  if (["pending", "processing", "draft", "warning"].includes(str)) {
    return "bg-amber-50 text-amber-700 border-amber-200/30";
  }
  if (["void", "cancelled", "failed", "error", "no", "false"].includes(str)) {
    return "bg-rose-50 text-rose-700 border-rose-200/30";
  }
  return "bg-slate-50 text-slate-600 border-slate-200/50";
}

function detailUrl(slug: string): string {
  return API_ROUTES.collections.detail.replace(":slug", encodeURIComponent(slug));
}

function itemsUrl(slug: string): string {
  return API_ROUTES.collections.items.replace(":slug", encodeURIComponent(slug));
}

function itemUrl(slug: string, itemId: string): string {
  return API_ROUTES.collections.item.replace(":slug", encodeURIComponent(slug)).replace(":itemId", encodeURIComponent(itemId));
}

function actionUrl(slug: string, itemId: string, actionId: string): string {
  return API_ROUTES.collections.itemAction
    .replace(":slug", encodeURIComponent(slug))
    .replace(":itemId", encodeURIComponent(itemId))
    .replace(":actionId", encodeURIComponent(actionId));
}

/** Actions whose optional `when` predicate matches the open record.
 *  Status-driven buttons (e.g. invoice "Record payment") stay hidden
 *  until the record reaches the matching state. */
const visibleActions = computed<CollectionAction[]>(() => {
  const record = viewing.value;
  if (!record) return [];
  return (collection.value?.schema.actions ?? []).filter((action) => actionVisible(action, record));
});

/** Run a schema-declared action on the open record: ask the server to
 *  assemble the seed prompt, then start a new chat in the action's
 *  role with it. Generic — no knowledge of what the action does. */
async function runAction(action: CollectionAction): Promise<void> {
  if (!collection.value || !viewing.value) return;
  const itemId = String(viewing.value[collection.value.schema.primaryKey] ?? "");
  if (!itemId) return;
  actionPending.value = true;
  actionError.value = null;
  const result = await apiPost<{ prompt: string; role: string }>(actionUrl(collection.value.slug, itemId, action.id), {});
  actionPending.value = false;
  if (!result.ok) {
    actionError.value = result.error;
    return;
  }
  appApi.startNewChat(result.data.prompt, result.data.role);
}

async function loadCollection(slug: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  collection.value = null;
  items.value = [];
  searchQuery.value = ""; // Reset search query on collection load
  refCache.value = {};
  embedCache.value = {};
  viewing.value = null;
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
  await loadLinkedCollections(result.data.collection.schema, slug);
  // A `?selected=<id>` deep link opens that record in read-only
  // mode once its items are available. Guard against a stale load:
  // only act if we're still on the slug that triggered this fetch.
  if (collection.value?.slug === slug) syncViewToSelected();
}

function uniqueRefTargets(schema: CollectionSchema): string[] {
  const targets = new Set<string>();
  const walk = (fields: Record<string, FieldSpec>): void => {
    for (const field of Object.values(fields)) {
      if (field.type === "ref" && typeof field.to === "string" && field.to.length > 0) {
        targets.add(field.to);
      }
      if (field.type === "table" && field.of) {
        // Sub-fields of a table can also be refs (e.g. lineItem
        // referencing a product catalog). Walk one level deep —
        // nested tables are rejected by the schema, so a single
        // recursion is enough.
        walk(field.of);
      }
    }
  };
  walk(schema.fields);
  return [...targets];
}

function uniqueEmbedTargets(schema: CollectionSchema): string[] {
  const targets = new Set<string>();
  // Embeds are top-level only — the schema rejects `embed` inside a
  // table's `of` (SubFieldSpecSchema omits it), so no recursion.
  for (const field of Object.values(schema.fields)) {
    if (field.type === "embed" && typeof field.to === "string" && field.to.length > 0) targets.add(field.to);
  }
  return [...targets];
}

/** Fetch every collection this schema links to — `ref` targets (for
 *  display-name labels + dropdown options) and `embed` targets (for
 *  the full record rendered in the detail view). Fetched as one
 *  union so a slug used by both is only requested once; the result
 *  fans out into `refCache` (display maps) and `embedCache` (full
 *  schema + items). */
async function loadLinkedCollections(schema: CollectionSchema, expectedSlug: string): Promise<void> {
  const refTargets = new Set(uniqueRefTargets(schema));
  const embedTargets = new Set(uniqueEmbedTargets(schema));
  const allTargets = [...new Set([...refTargets, ...embedTargets])];
  if (allTargets.length === 0) return;
  const results = await Promise.all(allTargets.map((target) => apiGet<CollectionDetailResponse>(detailUrl(target)).then((result) => ({ target, result }))));
  // Stale-write guard: a quicker subsequent `loadCollection()`
  // (user navigated to a different collection mid-fetch) may have
  // already replaced `collection.value`. Overwriting the caches
  // here would surface the previous collection's linked data on the
  // current one's UI — broken labels until another reload. Drop
  // the write if we're no longer on the slug that triggered us.
  if (collection.value?.slug !== expectedSlug) return;
  const nextRef: RefCache = {};
  const nextEmbed: EmbedCache = {};
  for (const { target, result } of results) {
    if (!result.ok) continue;
    if (refTargets.has(target)) nextRef[target] = buildRefDisplayMap(result.data);
    if (embedTargets.has(target)) nextEmbed[target] = { schema: result.data.collection.schema, items: result.data.items };
  }
  refCache.value = nextRef;
  embedCache.value = nextEmbed;
}

function buildRefDisplayMap(detail: CollectionDetailResponse): RefDisplayMap {
  // Heuristic for what to display in the table cell + dropdown:
  // prefer a field called `name`, fall back to `title`, then to the
  // primary key value (= the slug itself, which we'd show anyway).
  // Future-proof escape hatch (`displayField` in the schema) is
  // explicitly deferred — see plans/done/feat-collections-ref-field.md.
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

/** Resolve the fixed record an `embed` field points at, from the
 *  embedCache. Returns the target schema + the matching record, or
 *  nulls when the target couldn't be loaded or has no record with
 *  that id — the detail view renders the fields when `item` is set,
 *  a "missing" message otherwise. */
function resolveEmbed(field: FieldSpec): { schema: CollectionSchema | null; item: CollectionItem | null } {
  if (field.type !== "embed" || !field.to || !field.id) return { schema: null, item: null };
  const data = embedCache.value[field.to];
  if (!data) return { schema: null, item: null };
  const item = data.items.find((entry) => String(entry[data.schema.primaryKey] ?? "") === field.id) ?? null;
  return { schema: data.schema, item };
}

/** Read-only string for one field of an embedded record. Booleans
 *  and markdown are handled in the template (icon / pre-wrap); money
 *  formats via Intl; everything else falls back to the full text
 *  value (a ref inside an embedded record can't resolve a label
 *  across the boundary, so it shows its raw slug). */
function embedValue(field: FieldSpec, value: unknown, record: CollectionItem | null): string {
  if (field.type === "money") return formatMoney(value, resolveCurrency(field, record), locale.value);
  return detailText(value);
}

/** Render-ready model for each `embed` field of the current
 *  collection, resolved against the embedCache and keyed by field
 *  key. Pre-formatting the rows in script keeps the detail template
 *  simple and type-safe. Independent of which record is open — an
 *  embed shows a fixed record regardless. */
const embedViews = computed<Record<string, EmbedView>>(() => {
  const out: Record<string, EmbedView> = {};
  if (!collection.value) return out;
  for (const [key, field] of Object.entries(collection.value.schema.fields)) {
    if (field.type !== "embed") continue;
    const { schema, item } = resolveEmbed(field);
    const rows: EmbedRow[] = [];
    if (schema && item) {
      for (const [subKey, subField] of Object.entries(schema.fields)) {
        const value = item[subKey];
        // Skip empty fields — the embed is a read-only summary of
        // another record (e.g. a "From (issuer)" block), so unfilled
        // optional fields would just be "—" noise rather than the
        // editable blanks a form needs.
        if (value === undefined || value === null || value === "") continue;
        rows.push({ key: subKey, label: subField.label, type: subField.type, value, display: embedValue(subField, value, item) });
      }
    }
    out[key] = { found: Boolean(item), rows, targetSlug: field.to ?? "", recordId: field.id ?? "" };
  }
  return out;
});

/** Schema fields excluding display-only `embed` fields — used by the
 *  list table only (a whole embedded record doesn't fit a table cell,
 *  and it'd be identical in every row). The detail modal and the edit
 *  form iterate the full `schema.fields` so embeds render there too. */
const nonEmbedFields = computed<[string, FieldSpec][]>(() =>
  collection.value ? Object.entries(collection.value.schema.fields).filter(([, field]) => field.type !== "embed") : [],
);

/** True when the current collection declares `schema.singleton` —
 *  exactly one record, its primary key fixed to the declared value. */
const isSingleton = computed<boolean>(() => Boolean(collection.value?.schema.singleton));

/** Whether the Add button should show. Always for a normal collection;
 *  for a singleton only until its one record exists. */
const canCreate = computed<boolean>(() => {
  if (!collection.value) return false;
  return !(isSingleton.value && items.value.length > 0);
});

function inputTypeFor(type: FieldType): string {
  if (type === "email") return "email";
  if (type === "number") return "number";
  if (type === "money") return "number";
  if (type === "date") return "date";
  return "text";
}

/** Resolve the ISO currency code for a money / derived-money field.
 *  A field may either pin a literal `currency` (same for every
 *  record) or name a `currencyField` whose per-record value carries
 *  the code (e.g. an invoice's `currency` enum). Precedence:
 *  `record[currencyField]` → literal `currency` → undefined (which
 *  `formatMoney` / `currencySymbol` then default to "USD"). Always
 *  resolved against the top-level record, including for money
 *  sub-fields inside a table — table rows don't carry currency. */
function resolveCurrency(field: FieldSpec, record: CollectionItem | null | undefined): string | undefined {
  if (field.currencyField && record) {
    const code = record[field.currencyField];
    if (typeof code === "string" && code.trim().length > 0) return code;
  }
  return field.currency;
}

/** Extract the localized currency symbol for a given ISO code
 *  (`USD` → `$`, `JPY` → `¥`, `EUR` → `€`). Used in the form's
 *  money input so the user can see which currency they're typing
 *  into — the schema declares the code per-field, but a bare
 *  number input gave no visual hint of currency. Falls back to
 *  the raw code on any Intl failure. */
function currencySymbol(currency: string | undefined): string {
  const code = currency && currency.length > 0 ? currency : "USD";
  try {
    const parts = new Intl.NumberFormat(locale.value, { style: "currency", currency: code }).formatToParts(0);
    const part = parts.find((entry) => entry.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** Format a money value via `Intl.NumberFormat`. Falls back to the
 *  raw number on any failure (unknown currency code, non-finite
 *  amount, etc.) so a malformed record still renders something
 *  rather than blowing up the row. Locale comes from the active
 *  i18n locale so digit grouping / decimal separator follow the
 *  user's settings even though the currency is declared by the
 *  schema. */
function formatMoney(value: unknown, currency: string | undefined, displayLocale: string): string {
  // `null` is intentionally NOT in this guard — `derivedDisplay`
  // short-circuits on null before calling here, and the table
  // cell branch passes `item[key]` from JSON where missing keys
  // arrive as `undefined`, not `null` (we never persist explicit
  // null). CodeQL flagged the original `value === null` as
  // unreachable; removed per github-code-quality on PR #1497.
  if (value === undefined || value === "") return "—";
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);
  const currencyCode = currency && currency.length > 0 ? currency : "USD";
  try {
    return new Intl.NumberFormat(displayLocale, { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return String(amount);
  }
}

/** Live computed record from the current draft, used by `derived`
 *  fields in the form so subtotal/tax/total update as the user
 *  edits line items. For derived cells in the main table, we
 *  evaluate against the loaded item instead — see the table cell
 *  branch. */
function emptyRow(subFields: Record<string, FieldSpec>): TableRowDraft {
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  for (const [subKey, subField] of Object.entries(subFields)) {
    if (subField.type === "boolean") {
      bool[subKey] = false;
      boolOriginallyPresent[subKey] = false; // brand-new row
      boolTouched[subKey] = false;
    } else {
      text[subKey] = "";
    }
  }
  return { text, bool, boolOriginallyPresent, boolTouched };
}

function rowFromItem(item: Record<string, unknown>, subFields: Record<string, FieldSpec>): TableRowDraft {
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  for (const [subKey, subField] of Object.entries(subFields)) {
    const raw = item[subKey];
    if (subField.type === "boolean") {
      bool[subKey] = raw === true;
      // `typeof raw === "boolean"` (not `raw === true`) so an
      // existing explicit `false` is recorded as present and
      // round-trips on a no-op save.
      boolOriginallyPresent[subKey] = typeof raw === "boolean";
      boolTouched[subKey] = false;
    } else {
      text[subKey] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  return { text, bool, boolOriginallyPresent, boolTouched };
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
  if (!rows) return;
  rows.splice(index, 1);
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

/** Full (untruncated) text rendering for open mode. `formatCell`
 *  clips markdown to 80 chars for the dense table; the detail view
 *  has room to show the whole value. */
function detailText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  return String(value);
}

/** Coerce a persisted `table` cell into a typed row array for
 *  read-only rendering (open mode). Mirrors the filtering in
 *  `openEdit` so a malformed non-object row never reaches the
 *  template. */
function tableRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function hasTableRows(value: unknown): boolean {
  return tableRows(value).length > 0;
}

/** Format one cell of a `table` sub-field for open mode. Booleans
 *  are handled in the template (check / em-dash icon); everything
 *  else routes through the same formatters the top-level fields
 *  use. Sub-fields can't be `table`/`derived` (schema-rejected),
 *  so only money / ref / scalar need handling here. */
function formatSubCell(subField: FieldSpec, value: unknown, record: CollectionItem | null): string {
  if (subField.type === "money") return formatMoney(value, resolveCurrency(subField, record), locale.value);
  if (subField.type === "ref" && subField.to && typeof value === "string" && value.length > 0) {
    return refDisplay(subField.to, value);
  }
  return formatCell(value, subField.type);
}

function openCreate(): void {
  if (!collection.value) return;
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  const table: Record<string, TableRowDraft[]> = {};
  for (const [key, field] of Object.entries(collection.value.schema.fields)) {
    if (field.type === "boolean") {
      bool[key] = false;
      // New record — no boolean was originally present.
      boolOriginallyPresent[key] = false;
      boolTouched[key] = false;
    } else if (field.type === "table") {
      table[key] = [];
    } else if (field.type !== "derived" && field.type !== "embed") {
      text[key] = "";
    }
    // derived (computed) and embed (display-only, foreign record)
    // fields have no draft slot.
  }
  // Singleton collections fix the primary key to the schema-declared
  // value (e.g. "me") so the first Add can't pick an arbitrary id.
  const { singleton, primaryKey } = collection.value.schema;
  if (singleton) text[primaryKey] = singleton;
  editing.value = { mode: "create", text, bool, boolOriginallyPresent, boolTouched, table, originalId: null };
  saveError.value = null;
}

function openEdit(item: CollectionItem): void {
  if (!collection.value) return;
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  const table: Record<string, TableRowDraft[]> = {};
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
    } else if (field.type === "table" && field.of) {
      const sub = field.of;
      const rows = Array.isArray(raw) ? raw : [];
      table[key] = rows
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
        .map((row) => rowFromItem(row, sub));
    } else if (field.type !== "derived" && field.type !== "embed") {
      text[key] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  const primaryRaw = item[collection.value.schema.primaryKey];
  const originalId = typeof primaryRaw === "string" ? primaryRaw : String(primaryRaw ?? "");
  editing.value = { mode: "edit", text, bool, boolOriginallyPresent, boolTouched, table, originalId };
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

/** Open mode (read-only detail). */
function openView(item: CollectionItem): void {
  viewing.value = item;
  actionError.value = null;
}

/** Close open mode and drop the `?selected=` query param so a
 *  refresh / back-button doesn't immediately reopen the record and
 *  the URL reflects the closed state. */
function closeView(): void {
  viewing.value = null;
  actionError.value = null;
  if (route.query.selected !== undefined) {
    const query = { ...route.query };
    delete query.selected;
    router.replace({ query }).catch(() => {});
  }
}

/** Hand off from open mode to the editor for the same record. */
function editFromView(): void {
  const item = viewing.value;
  if (!item) return;
  viewing.value = null;
  openEdit(item);
}

function findItemById(itemId: string): CollectionItem | undefined {
  if (!collection.value) return undefined;
  const { primaryKey } = collection.value.schema;
  return items.value.find((item) => String(item[primaryKey] ?? "") === itemId);
}

/** Reconcile the open-mode view with the `?selected=<id>` query —
 *  the single source of truth for which record is open. Opens the
 *  matching record, or closes the modal when the param is absent /
 *  empty / points at an id that isn't loaded (deleted record, stale
 *  link). Keeping `viewing` in lockstep with the URL means browser
 *  back / forward and a removed param both close the modal instead
 *  of leaving stale UI on screen (Codex P2 + CodeRabbit on #1502). */
function syncViewToSelected(): void {
  const { selected } = route.query;
  if (typeof selected !== "string" || selected.length === 0) {
    viewing.value = null;
    return;
  }
  viewing.value = findItemById(selected) ?? null;
}

/** Title for the open-mode header: the record's primary-key value
 *  (e.g. `INV-2026-0001`), falling back to the collection title.
 *  Non-string primary keys (numeric ids) are stringified rather
 *  than discarded (CodeRabbit on #1502). */
const viewTitle = computed<string>(() => {
  if (!viewing.value || !collection.value) return "";
  const pkValue = viewing.value[collection.value.schema.primaryKey];
  if (pkValue === undefined || pkValue === null || pkValue === "") return collection.value.title ?? "";
  return String(pkValue);
});

/** Decide whether and how to emit a boolean field's draft value.
 *  Extracted from `draftToRecord` to keep that function's
 *  cognitive complexity under the lint cap. */
function shouldEmitBoolean(state: EditState, key: string, field: FieldSpec): boolean {
  // Emit when any of:
  //  - originally present (preserve prior choice + any in-session
  //    toggle, including explicit false)
  //  - user has actively interacted with the checkbox (required so
  //    explicit `false` is round-trippable from create mode, where
  //    every untouched checkbox would otherwise look like "omit")
  //  - the schema marks the field required (downstream consumers
  //    may depend on the key always being present)
  // Otherwise omit so a brand-new record that didn't touch an
  // optional boolean doesn't materialize `false`, letting the
  // consumer's default apply (e.g. mc-worklog's "absent billable
  // means true").
  return Boolean(state.boolOriginallyPresent[key] || state.boolTouched[key] || field.required);
}

/** Convert a scalar draft slot (text bucket) to its persisted form
 *  per the field's type. Returns `undefined` to signal "omit". */
function scalarDraftToValue(raw: string | undefined, fieldType: FieldType): unknown {
  if (raw === undefined || raw === "") return undefined;
  if (fieldType === "number" || fieldType === "money") {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  return raw;
}

/** True when a draft slot should count as "empty" for required-
 *  field validation. NOT a truthiness check: Vue coerces
 *  `<input type="number">` to a numeric `0`, and a required field
 *  whose value is `0` (a quantity of 0, a rate of 0) is a filled
 *  value, not a missing one. Only `undefined` / `null` / empty
 *  string count as missing. (CodeRabbit PR #1497.) */
function isMissingDraftValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Convert one row of a `table` field's draft to its persisted
 *  row record. Sub-fields are restricted to non-table / non-derived
 *  types by the SubFieldSpecSchema, so we only need to handle the
 *  scalar + boolean branches. */
function rowDraftToRecord(rowDraft: TableRowDraft, subFields: Record<string, FieldSpec>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [subKey, subField] of Object.entries(subFields)) {
    if (subField.type === "boolean") {
      // Full mirror of the top-level boolean omission rule: emit if
      // it was originally present (preserve an existing explicit
      // `false`), OR the user actively toggled it this session, OR
      // it's required, OR it's now `true`. Otherwise omit so a
      // brand-new untouched optional boolean stays absent (default
      // applies) — round-tripping both "absent" and explicit
      // "false" losslessly. (Codex PR #1497, two rounds.)
      const value = rowDraft.bool[subKey] === true;
      if (rowDraft.boolOriginallyPresent[subKey] || rowDraft.boolTouched[subKey] || value || subField.required) {
        row[subKey] = value;
      }
      continue;
    }
    const value = scalarDraftToValue(rowDraft.text[subKey], subField.type);
    if (value !== undefined) row[subKey] = value;
  }
  return row;
}

/** Walk every row of a `table` field's draft, returning the label
 *  of the first required sub-field that's empty in any row.
 *  Returns null when every required cell is filled (or when no
 *  rows / no required sub-fields exist).
 *
 *  Why this needs to exist: save is triggered via a `type="button"`
 *  click that calls `saveEditor` directly, which skips native HTML5
 *  form submission. The `:required` attributes on row inputs are
 *  therefore never enforced by the browser — we have to enforce
 *  them here. (Codex P1 review on PR #1497.) */
function firstMissingTableSubField(field: FieldSpec, rows: TableRowDraft[] | undefined): string | null {
  if (!field.of || !rows) return null;
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (const [subKey, subField] of Object.entries(field.of)) {
      if (!subField.required) continue;
      // Boolean required is a no-op (same reasoning as the
      // top-level skip below).
      if (subField.type === "boolean") continue;
      if (isMissingDraftValue(row.text[subKey])) return `${field.label} #${rowIdx + 1}: ${subField.label}`;
    }
  }
  return null;
}

/** Client-side required-field check. Returns the human-readable
 *  label of the first missing required field, or null if everything
 *  required is filled. Extracted from `saveEditor` to keep that
 *  function's cognitive complexity under the lint cap.
 *
 *  Skip rules:
 *  - primary key in create mode (server auto-generates an id when
 *    blank, so blocking here would deny the documented
 *    "blank → server-generated id" flow even for schemas that mark
 *    the primary field required)
 *  - booleans (`false` is a valid answer; required is a no-op)
 *  - derived (computed, not user-entered)
 *
 *  Table fields are special: their `required` flag means "at least
 *  one row", AND each row's sub-fields validate per their own
 *  `required` flags — even if the table itself is optional. The
 *  table block therefore runs OUTSIDE the `if (!field.required)`
 *  short-circuit. */
function validateOneField(key: string, field: FieldSpec, draft: EditState): string | null {
  if (field.type === "table" && field.of) {
    const rows = draft.table[key];
    if (field.required && (!rows || rows.length === 0)) return field.label;
    return firstMissingTableSubField(field, rows);
  }
  if (!field.required) return null;
  if (draft.mode === "create" && field.primary === true) return null;
  // embed has no draft slot (foreign display-only); derived is computed.
  if (field.type === "boolean" || field.type === "derived" || field.type === "embed") return null;
  return isMissingDraftValue(draft.text[key]) ? field.label : null;
}

function firstMissingRequiredField(draft: EditState, schema: CollectionSchema): string | null {
  for (const [key, field] of Object.entries(schema.fields)) {
    const missing = validateOneField(key, field, draft);
    if (missing) return missing;
  }
  return null;
}

function draftToRecord(state: EditState, schema: CollectionSchema): CollectionItem {
  const record: CollectionItem = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type === "derived" || field.type === "embed") continue; // never persisted (computed / foreign display-only)
    if (field.type === "boolean") {
      if (shouldEmitBoolean(state, key, field)) record[key] = state.bool[key] === true;
      continue;
    }
    if (field.type === "table" && field.of) {
      const subFields = field.of;
      record[key] = (state.table[key] ?? []).map((rowDraft) => rowDraftToRecord(rowDraft, subFields));
      continue;
    }
    const value = scalarDraftToValue(state.text[key], field.type);
    if (value !== undefined) record[key] = value;
  }
  return record;
}

/** Live computed record from the current draft. Drives derived
 *  field displays in the form so subtotal/tax/total update as
 *  the user edits line items. */
const liveRecord = computed<CollectionItem | null>(() => {
  if (!collection.value || !editing.value) return null;
  return draftToRecord(editing.value, collection.value.schema);
});

/** Evaluate every derived field against `base`, iterating until
 *  the values stop changing (or until we've used at most one pass
 *  per derived field — the natural upper bound on chain length,
 *  reached when the fields appear in worst-case dependency order
 *  and each pass settles only one slot).
 *
 *  Per CodeRabbit on PR #1497: the previous hard-coded 3-pass
 *  ceiling silently capped longer chains. The new bound is exact
 *  for any DAG over derived fields and an early `break` on
 *  fixed-point keeps the common-case cost the same. */
function deriveAll(schema: CollectionSchema, base: CollectionItem): CollectionItem {
  const enriched: CollectionItem = { ...base };
  const maxPasses = Object.values(schema.fields).filter((field) => field.type === "derived").length;
  for (let pass = 0; pass < maxPasses; pass++) {
    let mutated = false;
    for (const [key, field] of Object.entries(schema.fields)) {
      if (field.type !== "derived" || !field.formula) continue;
      const next = evaluateDerived(field.formula, { record: enriched });
      if (next !== null && enriched[key] !== next) {
        enriched[key] = next;
        mutated = true;
      }
    }
    if (!mutated) break;
  }
  return enriched;
}

const liveDerived = computed<CollectionItem | null>(() => {
  if (!collection.value || !liveRecord.value) return null;
  return deriveAll(collection.value.schema, liveRecord.value);
});

function derivedDisplay(field: FieldSpec, computedValue: unknown, record: CollectionItem | null): string {
  if (computedValue === null || computedValue === undefined) return "—";
  if (field.display === "money") {
    return formatMoney(computedValue, resolveCurrency(field, record), locale.value);
  }
  return formatCell(computedValue, field.display ?? "number");
}

/** Evaluate a derived field against a persisted item (for the
 *  main collection table). The form uses `liveDerived` instead so
 *  it can reflect uncommitted draft edits. */
function evaluateDerivedAgainstItem(field: FieldSpec, fieldKey: string, item: CollectionItem): number | null {
  if (!field.formula || !collection.value) return null;
  // Walk derived chain: subtotal → tax → total. Same 3-pass cap as
  // `deriveAll`; if a field's value is already on disk (Claude
  // wrote it), prefer the disk value over re-computing.
  const enriched = deriveAll(collection.value.schema, item);
  const result = enriched[fieldKey];
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

/** Short summary for a `table`-typed cell in the main collection
 *  table. Counts rows; nothing fancier yet (per-row preview is
 *  hard to fit in a single cell). */
function tableSummary(value: unknown): string {
  if (!Array.isArray(value)) return "—";
  if (value.length === 0) return "—";
  return t("collectionsView.tableSummary", { count: value.length });
}

async function saveEditor(): Promise<void> {
  if (!collection.value || !editing.value) return;
  // Snapshot mutable refs before any await — route changes during
  // the save (e.g. user navigates away) can null `collection.value`
  // and would throw on the post-await `loadCollection(...)`.
  const { slug, schema } = collection.value;
  const draft = editing.value;
  saveError.value = null;

  const missing = firstMissingRequiredField(draft, schema);
  if (missing) {
    saveError.value = `${missing}: ${t("collectionsView.requiredField")}`;
    return;
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
      searchQuery.value = ""; // Reset search query
      loading.value = false;
    }
  },
);

// React to `?selected=` changing while already on this collection:
// follow it to open the new record, OR close the modal when the
// param is removed (browser back) or points at a missing id. The
// initial / cross-collection case is handled by `loadCollection`;
// here we only act once items are loaded.
watch(
  () => route.query.selected,
  () => {
    if (!loading.value && collection.value) syncViewToSelected();
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
