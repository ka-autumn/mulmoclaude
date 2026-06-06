<template>
  <div class="h-full flex flex-col bg-slate-50/30">
    <header class="flex items-center gap-3 px-6 py-4 border-b border-slate-200 bg-white">
      <button
        v-if="!embedded"
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
        v-if="collection?.schema.ingest"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-600 font-bold text-xs transition-colors disabled:opacity-50"
        :disabled="refreshing"
        data-testid="collections-refresh-feed"
        @click="refreshFeed"
      >
        <span class="material-icons text-sm">{{ refreshing ? "hourglass_empty" : "refresh" }}</span>
        <span>{{ t("collectionsView.refreshFeed") }}</span>
      </button>

      <button
        v-if="collection"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-600 font-bold text-xs transition-colors"
        data-testid="collections-chat"
        @click="openChat"
      >
        <span class="material-icons text-sm">forum</span>
        <span>{{ t("collectionsView.chat") }}</span>
      </button>

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

      <button
        v-if="canDeleteCollection && !embedded"
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 transition-colors"
        :title="t('collectionsView.deleteCollection')"
        :aria-label="t('collectionsView.deleteCollection')"
        data-testid="collections-delete"
        @click="confirmCollectionDelete"
      >
        <span class="material-icons text-sm">delete_forever</span>
      </button>

      <button
        v-if="canDeleteFeed && !embedded"
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 transition-colors"
        :title="t('collectionsView.deleteFeed')"
        :aria-label="t('collectionsView.deleteFeed')"
        data-testid="feeds-delete"
        @click="confirmFeedDelete"
      >
        <span class="material-icons text-sm">delete_forever</span>
      </button>
    </header>

    <!-- Search Toolbar. Shown when there are items to search OR when the
         calendar toggle is available — the toggle must reach an empty
         date-bearing collection so its empty-day create affordance works. -->
    <div
      v-if="collection && (items.length > 0 || hasCalendar || hasKanban)"
      class="px-6 py-3 bg-white border-b border-slate-100 flex items-center justify-between gap-4"
    >
      <div v-if="items.length > 0" class="relative flex-1 max-w-md">
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
      <div class="flex items-center gap-2">
        <!-- View toggle: table ↔ calendar ↔ kanban. Calendar shows only when
             the schema has a `date` field, kanban only with an `enum` field;
             local UI state, never persisted. -->
        <div v-if="hasCalendar || hasKanban" class="flex gap-0.5" role="group" :aria-label="t('collectionsView.viewToggle')">
          <button
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded text-xs font-bold transition-colors"
            :class="activeView === 'table' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'"
            :aria-pressed="activeView === 'table'"
            data-testid="collection-view-toggle-table"
            @click="setView('table')"
          >
            <span class="material-icons text-sm">table_rows</span>
            <span>{{ t("collectionsView.viewTable") }}</span>
          </button>
          <button
            v-if="hasCalendar"
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded text-xs font-bold transition-colors"
            :class="activeView === 'calendar' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'"
            :aria-pressed="activeView === 'calendar'"
            data-testid="collection-view-toggle-calendar"
            @click="setView('calendar')"
          >
            <span class="material-icons text-sm">calendar_month</span>
            <span>{{ t("collectionsView.viewCalendar") }}</span>
          </button>
          <button
            v-if="hasKanban"
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded text-xs font-bold transition-colors"
            :class="activeView === 'kanban' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'"
            :aria-pressed="activeView === 'kanban'"
            data-testid="collection-view-toggle-kanban"
            @click="setView('kanban')"
          >
            <span class="material-icons text-sm">view_kanban</span>
            <span>{{ t("collectionsView.viewKanban") }}</span>
          </button>
        </div>
        <!-- Which date field anchors the grid (only when >1 date field). -->
        <select
          v-if="calendarActive && dateFields.length > 1"
          :value="calendarAnchorField"
          class="h-8 px-2 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600 focus:outline-none focus:border-indigo-500 cursor-pointer"
          :aria-label="t('collectionsView.calendarFieldLabel')"
          data-testid="collection-calendar-field"
          @change="anchorOverride = ($event.target as HTMLSelectElement).value"
        >
          <option v-for="key in dateFields" :key="key" :value="key">{{ collection?.schema.fields[key]?.label ?? key }}</option>
        </select>
        <!-- Which enum field groups the board (only when >1 enum field). -->
        <select
          v-if="kanbanActive && enumFields.length > 1"
          :value="kanbanGroupField"
          class="h-8 px-2 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600 focus:outline-none focus:border-indigo-500 cursor-pointer"
          :aria-label="t('collectionsView.kanbanFieldLabel')"
          data-testid="collection-kanban-field"
          @change="kanbanOverride = ($event.target as HTMLSelectElement).value"
        >
          <option v-for="key in enumFields" :key="key" :value="key">{{ collection?.schema.fields[key]?.label ?? key }}</option>
        </select>
        <div v-if="items.length > 0" class="text-[10px] text-slate-400 font-bold uppercase tracking-wider select-none">
          {{ t("collectionsView.searchSummary", { shown: filteredItems.length, total: items.length }) }}
        </div>
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

      <!-- Calendar body: an alternative to the table for date-bearing
           collections. Shown whenever active (even when empty) so the
           empty-cell create affordance stays available. -->
      <div v-else-if="calendarActive" class="p-4">
        <CollectionCalendarView
          :schema="collection.schema"
          :items="filteredItems"
          :anchor-field="calendarAnchorField"
          :end-field="calendarEndField"
          :selected="viewing ? String(viewing[collection.schema.primaryKey] ?? '') : undefined"
          :can-create="canCreate"
          @select="onCalendarSelect"
          @create-on="createOnDate"
        />
        <div
          v-if="viewing || editing"
          class="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
          data-testid="collections-calendar-panel"
        >
          <CollectionRecordPanel
            v-model:editing="editing"
            :collection="collection"
            :viewing="viewing"
            :saving="saving"
            :save-error="saveError"
            :action-error="actionError"
            :action-pending="actionPending"
            :visible-actions="visibleActions"
            :live-record="liveRecord"
            :live-derived="liveDerived"
            :view-title="viewTitle"
            :is-singleton="isSingleton"
            :render="render"
            :locale="locale"
            @submit="saveEditor"
            @cancel="cancelEditor"
            @edit="editFromView"
            @close="closeView"
            @delete="viewing && confirmDelete(viewing)"
            @run-action="runAction"
          />
        </div>
      </div>

      <!-- Kanban body: an alternative to the table for enum-bearing
           collections. The board groups records into columns by the chosen
           enum field; dragging a card between columns writes that field. -->
      <div v-else-if="kanbanActive" class="h-full flex flex-col">
        <!-- Inline-edit failure banner: a card drop (group-field write) was
             rolled back. The detail panel's `saveError` isn't shown during a
             drag, so inline edits surface their own — same as the table. -->
        <div
          v-if="inlineError"
          class="m-3 mb-0 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3"
          data-testid="collections-inline-error"
        >
          <span class="material-icons text-red-600">error</span>
          <span class="flex-1">{{ t("collectionsView.inlineSaveFailed", { error: inlineError }) }}</span>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-red-600 hover:bg-red-100"
            :aria-label="t('common.close')"
            @click="inlineError = null"
          >
            <span class="material-icons text-base">close</span>
          </button>
        </div>
        <div class="flex-1 min-h-0 px-3 py-2">
          <CollectionKanbanView
            :schema="collection.schema"
            :items="filteredItems"
            :group-field="kanbanGroupField"
            :selected="viewing ? String(viewing[collection.schema.primaryKey] ?? '') : undefined"
            @select="onCalendarSelect"
            @move="onKanbanMove"
          />
        </div>
        <div
          v-if="viewing || editing"
          class="m-3 mt-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0"
          data-testid="collections-kanban-panel"
        >
          <CollectionRecordPanel
            v-model:editing="editing"
            :collection="collection"
            :viewing="viewing"
            :saving="saving"
            :save-error="saveError"
            :action-error="actionError"
            :action-pending="actionPending"
            :visible-actions="visibleActions"
            :live-record="liveRecord"
            :live-derived="liveDerived"
            :view-title="viewTitle"
            :is-singleton="isSingleton"
            :render="render"
            :locale="locale"
            @submit="saveEditor"
            @cancel="cancelEditor"
            @edit="editFromView"
            @close="closeView"
            @delete="viewing && confirmDelete(viewing)"
            @run-action="runAction"
          />
        </div>
      </div>

      <div v-else-if="items.length === 0 && editing?.mode !== 'create'" class="flex flex-col items-center justify-center py-20 text-sm text-slate-400 gap-2">
        <span class="material-icons text-4xl text-slate-300">folder_open</span>
        <p class="font-semibold text-slate-600">{{ t("collectionsView.itemsEmpty") }}</p>
      </div>

      <div
        v-else-if="filteredItems.length === 0 && editing?.mode !== 'create'"
        class="flex flex-col items-center justify-center py-20 text-sm text-slate-400 gap-2"
      >
        <span class="material-icons text-4xl text-slate-300">search_off</span>
        <p class="font-semibold text-slate-600">{{ t("collectionsView.noMatchingItems") }}</p>
        <button type="button" class="text-xs text-indigo-600 font-semibold hover:underline" @click="searchQuery = ''">
          {{ t("collectionsView.clearSearch") }}
        </button>
      </div>

      <div v-else class="overflow-x-auto [container-type:inline-size]">
        <!-- Inline-edit failure banner: a cell write (checkbox/dropdown)
             was rolled back; the detail panel's `saveError` isn't visible
             here so inline edits surface their own. -->
        <div
          v-if="inlineError"
          class="m-4 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3"
          data-testid="collections-inline-error"
        >
          <span class="material-icons text-red-600">error</span>
          <span class="flex-1">{{ t("collectionsView.inlineSaveFailed", { error: inlineError }) }}</span>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-red-600 hover:bg-red-100"
            :aria-label="t('common.close')"
            @click="inlineError = null"
          >
            <span class="material-icons text-base">close</span>
          </button>
        </div>
        <table class="min-w-full text-xs">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200">
              <th v-for="[key, field] in listColumnFields" :key="key" class="px-5 py-3 font-bold text-slate-500 text-left uppercase tracking-wider">
                {{ field.label }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            <template v-for="item in displayItems" :key="String(item[collection.schema.primaryKey] ?? '')">
              <tr
                v-if="!isCreateRow(item)"
                class="hover:bg-slate-50/70 cursor-pointer transition-colors focus:outline-none focus:bg-indigo-50/30"
                :class="isRowOpen(item) || isEditingRow(item) ? 'bg-indigo-50/40' : ''"
                role="button"
                tabindex="0"
                :aria-label="t('collectionsView.openItem', { id: String(item[collection.schema.primaryKey] ?? '') })"
                :data-testid="`collections-row-${item[collection.schema.primaryKey]}`"
                @click="openView(item)"
                @keydown.enter.self="openView(item)"
                @keydown.space.self.prevent="openView(item)"
              >
                <td v-for="[key, field] in listColumnFields" :key="key" class="px-5 py-2 text-slate-700 align-middle max-w-xs font-medium">
                  <!-- Conditionally hidden field (`when` predicate) → blank cell. -->
                  <template v-if="fieldVisible(field, item)">
                    <!-- Toggle → inline checkbox projecting an enum field.
                         Stores nothing itself; toggling writes onValue/
                         offValue to the projected field via the same PUT. -->
                    <input
                      v-if="field.type === 'toggle'"
                      type="checkbox"
                      :checked="toggleChecked(item, field)"
                      :disabled="isRowInlineSaving(item)"
                      class="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer align-middle disabled:opacity-50 disabled:cursor-not-allowed"
                      :data-testid="`collections-inline-toggle-${key}-${item[collection.schema.primaryKey]}`"
                      :aria-label="field.label"
                      @click.stop
                      @change="commitToggle(item, field)"
                    />

                    <!-- Boolean → inline checkbox. Tap toggles + saves
                         immediately; `@click.stop` so it doesn't open the
                         row's detail panel. Unset (undefined) and explicit
                         false both render unchecked. -->
                    <input
                      v-else-if="field.type === 'boolean'"
                      type="checkbox"
                      :checked="item[key] === true"
                      :disabled="isRowInlineSaving(item)"
                      class="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer align-middle disabled:opacity-50 disabled:cursor-not-allowed"
                      :data-testid="`collections-inline-bool-${key}-${item[collection.schema.primaryKey]}`"
                      :aria-label="field.label"
                      @click.stop
                      @change="commitInlineEdit(item, String(key), field, ($event.target as HTMLInputElement).checked)"
                    />

                    <!-- Ref router-link badge -->
                    <span v-else-if="field.type === 'ref' && field.to && typeof item[key] === 'string' && item[key]" class="block truncate">
                      <router-link
                        :to="{ path: `/collections/${field.to}`, query: { selected: String(item[key]) } }"
                        class="text-indigo-600 hover:text-indigo-800 hover:underline font-semibold"
                        :data-testid="`collections-ref-link-${key}-${item[key]}`"
                        @click.stop
                        >{{ refDisplay(field.to, String(item[key])) }}</router-link
                      >
                    </span>

                    <!-- Enum → inline dropdown. Selecting writes + saves
                         immediately; the empty placeholder clears the field.
                         `@click.stop` keeps the row's detail panel closed. -->
                    <select
                      v-else-if="field.type === 'enum' && Array.isArray(field.values) && field.values.length > 0"
                      :value="item[key] == null ? '' : String(item[key])"
                      :disabled="isRowInlineSaving(item)"
                      class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      :data-testid="`collections-inline-enum-${key}-${item[collection.schema.primaryKey]}`"
                      :aria-label="field.label"
                      @click.stop
                      @change="commitInlineEdit(item, String(key), field, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-if="showEnumPlaceholder(item, String(key))" value="">{{ t("collectionsView.selectPlaceholder") }}</option>
                      <option v-for="value in field.values" :key="value" :value="value">{{ value }}</option>
                    </select>

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

                    <!-- URL string → external link (new tab). `@click.stop` so
                     clicking the link doesn't also open the row's detail. -->
                    <a
                      v-else-if="isExternalUrl(item[key])"
                      :href="String(item[key])"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="block truncate text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                      :data-testid="`collections-url-link-${key}-${item[collection.schema.primaryKey]}`"
                      @click.stop
                      >{{ String(item[key]) }}</a
                    >

                    <span v-else class="block truncate text-slate-600">{{ formatCell(item[key], field.type) }}</span>
                  </template>
                </td>
              </tr>

              <!-- Inline detail / edit panel: expands directly under the open
                 row (replaces the old fixed modal). One row open at a time.
                 The create form rides the synthetic top row (isCreateRow). -->
              <tr v-if="shouldExpand(item)" :data-testid="`collections-expansion-${item[collection.schema.primaryKey]}`">
                <td :colspan="listColumnFields.length" class="p-0 border-l-2 border-indigo-300 bg-slate-50/60">
                  <!-- Pin the panel to the View's visible width, not the
                       (possibly much wider) table width: sticky to the left
                       edge of the horizontal scroller and capped at the
                       scroller's content width via container-query units, so
                       a wide collection never pushes the panel off-screen.
                       `min(100%, 100cqw)` keeps it at table width when the
                       table is narrower than the View. -->
                  <div class="sticky left-0 w-[min(100%,100cqw)]">
                    <CollectionRecordPanel
                      v-model:editing="editing"
                      :collection="collection"
                      :viewing="viewing"
                      :saving="saving"
                      :save-error="saveError"
                      :action-error="actionError"
                      :action-pending="actionPending"
                      :visible-actions="visibleActions"
                      :live-record="liveRecord"
                      :live-derived="liveDerived"
                      :view-title="viewTitle"
                      :is-singleton="isSingleton"
                      :render="render"
                      :locale="locale"
                      @submit="saveEditor"
                      @cancel="cancelEditor"
                      @edit="editFromView"
                      @close="closeView"
                      @delete="viewing && confirmDelete(viewing)"
                      @run-action="runAction"
                    />
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Chat modal — collect a message and start a new general-role chat
         seeded with the collection's skill command (`/<slug> <message>`). -->
    <div
      v-if="chatOpen && collection"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collections-chat-title"
      data-testid="collections-chat-modal"
      @click.self="closeChat"
      @keydown.esc="closeChat"
    >
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col border border-slate-200 overflow-hidden">
        <header class="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
          <div class="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/50">
            <span class="material-icons text-lg">forum</span>
          </div>
          <div class="flex-1">
            <h2 id="collections-chat-title" class="text-sm font-bold text-slate-800 uppercase tracking-wide">{{ t("collectionsView.chatTitle") }}</h2>
            <span class="text-xs text-slate-400 font-semibold">{{ collection.title }}</span>
          </div>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 transition-colors"
            :aria-label="t('common.close')"
            data-testid="collections-chat-close"
            @click="closeChat"
          >
            <span class="material-icons text-lg">close</span>
          </button>
        </header>

        <div class="px-6 py-5">
          <textarea
            ref="chatInputEl"
            v-model="chatMessage"
            rows="4"
            :placeholder="t('collectionsView.chatPlaceholder')"
            class="w-full bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all resize-none"
            data-testid="collections-chat-input"
            @keydown.meta.enter="submitChat"
            @keydown.ctrl.enter="submitChat"
          ></textarea>
        </div>

        <footer class="px-6 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/50">
          <button
            type="button"
            class="h-8 px-2.5 rounded text-xs font-bold text-slate-500 hover:bg-slate-200/50 transition-colors"
            data-testid="collections-chat-cancel"
            @click="closeChat"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            class="h-8 px-2.5 rounded bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm shadow-indigo-600/10"
            :disabled="!chatMessage.trim()"
            data-testid="collections-chat-send"
            @click="submitChat"
          >
            {{ t("collectionsView.chatStart") }}
          </button>
        </footer>
      </div>
    </div>

    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { apiDelete, apiGet, apiPost, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import { BUILTIN_ROLE_IDS } from "../config/roles";
import ConfirmModal from "./ConfirmModal.vue";
import CollectionRecordPanel from "./CollectionRecordPanel.vue";
import CollectionCalendarView from "./CollectionCalendarView.vue";
import CollectionKanbanView from "./CollectionKanbanView.vue";
import { useConfirm } from "../composables/useConfirm";
import { useAppApi } from "../composables/useAppApi";
import { actionVisible, fieldVisible } from "../utils/collections/actionVisible";
import { readCollectionViewMode, writeCollectionViewMode } from "../utils/collections/collectionViewMode";
import { useCollectionRendering } from "../composables/collections/useCollectionRendering";
import { buildUpdatedRecord, coerceInlineValue, draftToRecord, firstMissingRequiredField, rowFromItem } from "../utils/collections/draft";
import type {
  CollectionAction,
  CollectionDetail,
  CollectionDetailResponse,
  CollectionItem,
  EditState,
  FieldSpec,
  ItemMutationResponse,
  TableRowDraft,
} from "./collectionTypes";

/** `slug` / `selected` are supplied only in EMBEDDED mode (the
 *  `presentCollection` chat card mounts this component and drives both
 *  from the tool result). In standalone route mode (the
 *  `/collections/:slug` page) both are undefined and the component reads
 *  `route.params.slug` / `route.query.selected` as before.
 *
 *  `sendTextMessage` is forwarded ONLY by the chat card — its presence
 *  is our "rendered inside a chat" signal. When set, chat-triggering
 *  actions send into the current session instead of spawning a new
 *  chat (see `runAction` / `submitChat`). */
const props = defineProps<{
  slug?: string;
  selected?: string;
  sendTextMessage?: (text?: string) => void;
  /** Embedded mode only: initial view / anchor / group restored from the
   *  card's persisted `viewState` so a switch to calendar or kanban
   *  survives a remount. */
  initialView?: "table" | "calendar" | "kanban";
  initialAnchorField?: string;
  initialGroupField?: string;
}>();

const emit = defineEmits<{
  /** Embedded mode only: the open record changed (id) or closed (null).
   *  The card persists this in its tool-result `viewState` so the open
   *  item survives a re-render. */
  select: [id: string | null];
  /** Embedded mode only: the view mode / calendar anchor / kanban group
   *  changed. The card persists these alongside `selected` so the calendar
   *  and kanban stick. */
  viewStateChange: [state: { view: "table" | "calendar" | "kanban"; anchorField: string; groupField: string }];
}>();

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { openConfirm } = useConfirm();
const appApi = useAppApi();

/** Embedded when a `slug` prop is supplied; standalone (route-driven)
 *  otherwise. Switches the slug/selected source and the open/close
 *  navigation behaviour. */
const embedded = computed<boolean>(() => props.slug !== undefined);

/** Active collection slug: the prop in embedded mode, else the route
 *  param. */
const activeSlug = computed<string | undefined>(() => {
  if (props.slug !== undefined) return props.slug;
  const { slug } = route.params;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
});

/** Active open-record id: the prop in embedded mode (may be undefined),
 *  else the `?selected=` query. */
const activeSelected = computed<string | undefined>(() => {
  if (embedded.value) return props.selected;
  const { selected } = route.query;
  return typeof selected === "string" ? selected : undefined;
});

const collection = ref<CollectionDetail | null>(null);
const items = ref<CollectionItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
/** True while a feed collection's manual refresh is in flight. */
const refreshing = ref(false);
/** Slug already auto-refreshed on first open — prevents a reload loop
 *  (the auto-refresh reloads the view, which would re-trigger otherwise). */
const autoRefreshedSlug = ref<string | null>(null);
const editing = ref<EditState | null>(null);
/** The record currently shown in read-only "open" mode. Distinct
 *  from `editing`: open mode renders formatted values (no inputs)
 *  and is what a `/collections/<slug>?selected=<id>` deep link
 *  lands on. Mutually exclusive with `editing` in practice —
 *  `editFromView` hands off from one to the other. */
const viewing = ref<CollectionItem | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
/** Error from an inline table-cell edit (checkbox/dropdown). Distinct
 *  from `saveError` (rendered only inside the detail panel, which is
 *  closed during inline editing) — shown as a banner above the table. */
const inlineError = ref<string | null>(null);
/** Per-load snapshot of enum cells that had NO value when fetched
 *  (keyed `<rowId>:<fieldKey>`). Only these cells offer the empty
 *  placeholder option in their inline dropdown — a cell that already
 *  has a value can't be blanked inline (use the edit form for that). */
const enumOriginallyEmpty = ref<Set<string>>(new Set());
/** Rows with an inline cell save in flight (by `rowId`). While a row is
 *  here its inline controls are disabled, so two quick edits to the same
 *  row can't race two full-record PUTs — an older PUT landing last would
 *  otherwise clobber the newer field on disk while the UI shows the
 *  newer optimistic value (Codex PR #1599 P2). */
const inlineSavingRows = ref<Set<string>>(new Set());
const actionPending = ref(false);
const actionError = ref<string | null>(null);
const chatOpen = ref(false);
const chatMessage = ref("");
const chatInputEl = ref<HTMLTextAreaElement | null>(null);

// Shared rendering + linked-data layer: owns the ref/embed caches and
// every value-formatting helper, reused by the extracted record panel
// (table + calendar) so there's one implementation. Destructure the
// helpers the list table renders with; pass the whole object to the
// panel as its `render` prop.
const render = useCollectionRendering(collection, locale);
const { refRecordCache, refDisplay, formatMoney, resolveCurrency, derivedDisplay, evaluateDerivedAgainstItem, formatCell, isExternalUrl } = render;

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

// ────────────────────────────────────────────────────────────────
// Inline row expansion (#detail / #edit / #create panels)
// ────────────────────────────────────────────────────────────────
// Detail + edit render as a panel directly under the open row; create
// rides a synthetic row pinned at the top of the list. One panel open
// at a time (`viewing` / `editing` are single refs). The synthetic
// create row keeps the edit form in a SINGLE template location (no
// duplication, no separate component, no prop-mutation) — its data row
// is hidden (`v-if="!isCreateRow"`) so only its expansion (the form)
// shows.

/** Sentinel primary-key for the synthetic create row. Chosen to never
 *  collide with a real record id. */
const CREATE_ROW_ID = "__mc_create__";

/** Stringified primary-key value for a row (the row's stable identity). */
function rowId(item: CollectionItem): string {
  const primaryKey = collection.value?.schema.primaryKey;
  return primaryKey ? String(item[primaryKey] ?? "") : "";
}

function isCreateRow(item: CollectionItem): boolean {
  return rowId(item) === CREATE_ROW_ID;
}

/** Stable key for one cell in the `enumOriginallyEmpty` snapshot. */
function cellKey(rowIdValue: string, fieldKey: string): string {
  return `${rowIdValue}:${fieldKey}`;
}

/** Build the set of enum cells that were empty in the freshly-fetched
 *  records — the only cells whose inline dropdown offers an empty option. */
function snapshotEmptyEnums(schema: CollectionDetail["schema"], records: CollectionItem[]): Set<string> {
  const empty = new Set<string>();
  const enumKeys = Object.entries(schema.fields)
    .filter(([, field]) => field.type === "enum")
    .map(([fieldKey]) => fieldKey);
  if (enumKeys.length === 0) return empty;
  for (const record of records) {
    const recordId = String(record[schema.primaryKey] ?? "");
    for (const fieldKey of enumKeys) {
      if (record[fieldKey] == null || record[fieldKey] === "") empty.add(cellKey(recordId, fieldKey));
    }
  }
  return empty;
}

/** Whether an inline enum dropdown should render its empty placeholder
 *  option: only for cells with no value at load time. */
function showEnumPlaceholder(item: CollectionItem, fieldKey: string): boolean {
  return enumOriginallyEmpty.value.has(cellKey(rowId(item), fieldKey));
}

/** Rows rendered by the table: the filtered records, plus a synthetic
 *  create row at the top while a create is in progress. */
const displayItems = computed<CollectionItem[]>(() => {
  if (editing.value?.mode === "create" && collection.value) {
    const sentinel = { [collection.value.schema.primaryKey]: CREATE_ROW_ID } as CollectionItem;
    return [sentinel, ...filteredItems.value];
  }
  return filteredItems.value;
});

/** This row is the one open in read-only detail. */
function isRowOpen(item: CollectionItem): boolean {
  return viewing.value !== null && rowId(viewing.value) === rowId(item);
}

/** This row is the one being edited (a real row in edit mode, or the
 *  synthetic create row in create mode). */
function isEditingRow(item: CollectionItem): boolean {
  const draft = editing.value;
  if (!draft) return false;
  if (draft.mode === "create") return isCreateRow(item);
  return draft.originalId === rowId(item);
}

/** Whether to render this row's expansion panel (detail or edit). */
function shouldExpand(item: CollectionItem): boolean {
  return isRowOpen(item) || isEditingRow(item);
}

function detailUrl(slug: string): string {
  return API_ROUTES.collections.detail.replace(":slug", encodeURIComponent(slug));
}

/** Re-run a feed collection's retrieval now, then reload its records.
 *  Only reachable when `schema.ingest` is present (button is gated). */
async function refreshFeed(): Promise<void> {
  const current = collection.value;
  if (!current?.schema.ingest || refreshing.value) return;
  refreshing.value = true;
  inlineError.value = null;
  const url = API_ROUTES.collections.refresh.replace(":slug", encodeURIComponent(current.slug));
  const result = await apiPost<{ refreshed: boolean; written: number; errors: string[] }>(url, {});
  refreshing.value = false;
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  await loadCollection(current.slug);
  // refreshOne reports retriever failures via `errors` even on HTTP 200, so
  // surface them — otherwise a failed refresh looks like success.
  if (result.data.errors.length > 0) {
    inlineError.value = t("collectionsView.refreshFailed", { error: result.data.errors.join("; ") });
  }
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
  // In a chat card we have a channel into the current session — send
  // the seed prompt there rather than spawning a new chat. Standalone
  // route mode has no such channel, so start a fresh chat in the
  // action's role (which carries the tools the action needs).
  if (props.sendTextMessage) {
    props.sendTextMessage(result.data.prompt);
    return;
  }
  appApi.startNewChat(result.data.prompt, result.data.role);
}

/** Open the chat modal, blanking any prior draft and focusing the input. */
function openChat(): void {
  chatMessage.value = "";
  chatOpen.value = true;
  void nextTick(() => chatInputEl.value?.focus());
}

function closeChat(): void {
  chatOpen.value = false;
}

/** Start a new general-role chat seeded with the collection's skill
 *  command, so e.g. "I want to create an item" on `mc_worklog` becomes
 *  `/mc_worklog I want to create an item`. */
function submitChat(): void {
  if (!collection.value) return;
  const message = chatMessage.value.trim();
  if (!message) return;
  closeChat();
  const text = `/${collection.value.slug} ${message}`;
  // Chat card → send into the current session; standalone → new chat.
  if (props.sendTextMessage) {
    props.sendTextMessage(text);
    return;
  }
  appApi.startNewChat(text, BUILTIN_ROLE_IDS.general);
}

async function loadCollection(slug: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  collection.value = null;
  items.value = [];
  searchQuery.value = ""; // Reset search query on collection load
  render.resetLinkedCaches();
  viewing.value = null;
  const result = await apiGet<CollectionDetailResponse>(detailUrl(slug));
  loading.value = false;
  if (!result.ok) {
    loadError.value = result.status === 404 ? "not-found" : result.error;
    return;
  }
  collection.value = result.data.collection;
  items.value = result.data.items;
  enumOriginallyEmpty.value = snapshotEmptyEnums(result.data.collection.schema, result.data.items);
  // Fan out to fetch each unique target collection so the table can
  // render ref values as display names (not slugs) and the form
  // dropdown has options. Failures fall back gracefully — the table
  // cell shows the raw slug and the form falls back to text input.
  // Pass the slug that triggered THIS load so the helper can drop
  // its result if a faster subsequent load has already switched us
  // to a different collection (Codex P1 review on PR #1495).
  await render.loadLinkedCollections(result.data.collection.schema, slug);
  // A `?selected=<id>` deep link opens that record in read-only
  // mode once its items are available. Guard against a stale load:
  // only act if we're still on the slug that triggered this fetch.
  if (collection.value?.slug === slug) syncViewToSelected();
  maybeAutoRefreshFeed(slug);
}

// First-open auto-refresh: when a feed view opens with no records yet
// (e.g. a just-registered feed that hasn't hit the scheduler), fetch once
// so data appears without a manual Refresh. Guarded per slug so the reload
// `refreshFeed` triggers can't loop; the view re-mounts per slug, so each
// open retries at most once.
function maybeAutoRefreshFeed(slug: string): void {
  if (embedded.value) return;
  const current = collection.value;
  if (current?.slug !== slug || !current.schema.ingest) return;
  if (items.value.length > 0 || autoRefreshedSlug.value === slug) return;
  autoRefreshedSlug.value = slug;
  void refreshFeed();
}

/** Schema fields excluding display-only `embed` fields — used by the
 *  list table only (a whole embedded record doesn't fit a table cell,
 *  and it'd be identical in every row). The detail modal and the edit
 *  form iterate the full `schema.fields` so embeds render there too. */
// Fields shown as columns in the list table. Excludes `embed`
// (display-only fixed record, no per-record value), `image` — a
// per-row <img> fetches one file each, too expensive for a collection
// with many records, and the image is shown in the detail view anyway —
// and the primary key (an id is plumbing, not data: it identifies the
// row via data-testid / ref links but doesn't earn a column).
const listColumnFields = computed<[string, FieldSpec][]>(() =>
  collection.value
    ? Object.entries(collection.value.schema.fields).filter(
        ([key, field]) => field.type !== "embed" && field.type !== "image" && key !== collection.value?.schema.primaryKey,
      )
    : [],
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

// A collection is deletable only when it's project-scope AND not a
// preset (`mc-*`) — mirrors the server-side rule in
// `deleteCollection`. User-scope skills are read-only from MulmoClaude;
// presets re-seed on restart so deleting them is futile.
const canDeleteCollection = computed<boolean>(() => {
  const current = collection.value;
  if (!current) return false;
  return current.source === "project" && !current.slug.startsWith("mc-");
});

// True when this view was opened as a feed (`/feeds/:slug`): the schema
// carries an `ingest` block. Feeds are deleted via DELETE /api/feeds/:slug,
// not the project-scope collection delete above.
const isFeed = computed<boolean>(() => Boolean(collection.value?.schema.ingest));
const canDeleteFeed = computed<boolean>(() => isFeed.value && !embedded.value);

// Which list to return to from the back arrow: feeds opened via /feeds
// go back to the feed list; everything else to the collections index.
const isFeedRoute = computed<boolean>(() => !embedded.value && route.name === PAGE_ROUTES.feeds);

// ── View mode (table | calendar | kanban) ─────────────────────────
// Local UI state only — NEVER persisted to schema. The user toggles it;
// the host never flips it programmatically. The calendar is offered only
// when the schema has a `date` field and the kanban only when it has an
// `enum` field, so plain collections and the initial load are unchanged
// (default "table").
//
// Standalone route mode persists the last-used mode per collection in
// localStorage so reopening `/collections/:slug` restores the prior view
// instead of always starting on the table. Embedded mode ignores the store
// and restores from the card's `initialView` prop instead.
type CollectionViewMode = "table" | "calendar" | "kanban";

/** The view to open with: the embedded card's restored `initialView` if
 *  present, else the standalone slug's stored mode, else "table". Embedded
 *  mode never reads the localStorage store — its state lives in the card's
 *  `viewState`, so a standalone preference must not leak into (and then be
 *  re-persisted by) an embedded card. */
function initialViewMode(): CollectionViewMode {
  if (props.initialView) return props.initialView;
  if (embedded.value) return "table";
  const slug = activeSlug.value;
  return (slug && readCollectionViewMode(slug)) || "table";
}
const view = ref<CollectionViewMode>(initialViewMode());

/** `date` fields in declaration order — the calendar can anchor on any. */
const dateFields = computed<string[]>(() =>
  collection.value
    ? Object.entries(collection.value.schema.fields)
        .filter(([, field]) => field.type === "date")
        .map(([key]) => key)
    : [],
);

/** Whether the table ↔ calendar toggle is offered. */
const hasCalendar = computed<boolean>(() => dateFields.value.length > 0);

/** `enum` fields in declaration order — the kanban can group on any. */
const enumFields = computed<string[]>(() =>
  collection.value
    ? Object.entries(collection.value.schema.fields)
        .filter(([, field]) => field.type === "enum")
        .map(([key]) => key)
    : [],
);

/** Whether the kanban toggle is offered (needs an `enum` field to group on). */
const hasKanban = computed<boolean>(() => enumFields.value.length > 0);

/** The effective view, collapsing any stale mode whose enabling field
 *  vanished (e.g. `view = "kanban"` after switching to an enum-less
 *  collection) back to "table". Single source of truth for the toggle and
 *  the body branches. */
const activeView = computed<CollectionViewMode>(() => {
  if (view.value === "calendar" && hasCalendar.value) return "calendar";
  if (view.value === "kanban" && hasKanban.value) return "kanban";
  return "table";
});

/** True when the calendar is the active body. */
const calendarActive = computed<boolean>(() => activeView.value === "calendar");

/** True when the kanban is the active body. */
const kanbanActive = computed<boolean>(() => activeView.value === "kanban");

// In-view override for which enum field groups the board; null ⇒ the schema
// hint, else the first enum field.
const kanbanOverride = ref<string | null>(props.initialGroupField ?? null);
const kanbanGroupField = computed<string>(() => {
  if (kanbanOverride.value && enumFields.value.includes(kanbanOverride.value)) return kanbanOverride.value;
  const hint = collection.value?.schema.kanbanField;
  if (hint && enumFields.value.includes(hint)) return hint;
  return enumFields.value[0] ?? "";
});

// In-view override for which date field anchors the grid; null ⇒ the
// schema hint, else the first date field.
const anchorOverride = ref<string | null>(props.initialAnchorField ?? null);
const calendarAnchorField = computed<string>(() => {
  if (anchorOverride.value && dateFields.value.includes(anchorOverride.value)) return anchorOverride.value;
  const hint = collection.value?.schema.calendarField;
  if (hint && dateFields.value.includes(hint)) return hint;
  return dateFields.value[0] ?? "";
});
// The end field pairs with `schema.calendarField`. If the user switches the
// in-view anchor to a different date field, the span no longer applies —
// drop it so chips don't render from the new start to the original end.
const calendarEndField = computed<string | undefined>(() => {
  const schema = collection.value?.schema;
  if (!schema?.calendarEndField) return undefined;
  return calendarAnchorField.value === schema.calendarField ? schema.calendarEndField : undefined;
});

function setView(next: CollectionViewMode): void {
  view.value = next;
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
    } else if (field.type !== "derived" && field.type !== "embed" && field.type !== "toggle") {
      text[key] = "";
    }
    // derived (computed), embed (display-only, foreign record), and toggle
    // (projection of an enum field) have no draft slot.
  }
  // Singleton collections fix the primary key to the schema-declared
  // value (e.g. "me") so the first Add can't pick an arbitrary id.
  const { singleton, primaryKey } = collection.value.schema;
  if (singleton) text[primaryKey] = singleton;
  viewing.value = null; // one panel open at a time
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
    } else if (field.type !== "derived" && field.type !== "embed" && field.type !== "toggle") {
      text[key] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  const primaryRaw = item[collection.value.schema.primaryKey];
  const originalId = typeof primaryRaw === "string" ? primaryRaw : String(primaryRaw ?? "");
  viewing.value = null; // one panel open at a time
  editing.value = { mode: "edit", text, bool, boolOriginallyPresent, boolTouched, table, originalId };
  saveError.value = null;
}

function closeEditor(): void {
  editing.value = null;
  saving.value = false;
  saveError.value = null;
}

/** Cancel the editor. Edit → reopen the record's read-only detail (don't
 *  collapse the panel); create → just close (no prior detail to show). */
function cancelEditor(): void {
  const draft = editing.value;
  const returnTo = draft && draft.mode === "edit" ? draft.originalId : null;
  closeEditor();
  if (returnTo) {
    const item = findItemById(returnTo);
    if (item) showDetail(item);
  }
}

/** Scroll the open expansion panel into view after it opens (e.g. a newly
 *  created record that landed off-screen). Only one panel is open at a
 *  time, so a fixed prefix selector finds it — no record id is
 *  interpolated into the selector (avoids CSS injection / `SyntaxError`
 *  from ids containing selector-special chars). Best-effort. */
function scrollOpenPanelIntoView(): void {
  void nextTick(() => {
    const row = document.querySelector('[data-testid^="collections-expansion-"]');
    if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

/** Open mode (read-only detail). Toggles: clicking the already-open row
 *  collapses it. Opening a row cancels any in-progress edit (one panel
 *  open at a time). In embedded mode, report the open id so the host
 *  card can persist it in `viewState`. */
function openView(item: CollectionItem): void {
  if (isRowOpen(item) && !editing.value) {
    closeView();
    return;
  }
  if (editing.value) closeEditor();
  showDetail(item);
}

/** Open the read-only detail for a record WITHOUT the click-toggle. Used
 *  when reopening detail programmatically (after save / cancel), where
 *  `openView`'s "click the open row to collapse" guard would otherwise
 *  immediately close a row the embedded `viewState` sync just reopened. */
function showDetail(item: CollectionItem): void {
  viewing.value = item;
  actionError.value = null;
  if (embedded.value && collection.value) {
    emit("select", String(item[collection.value.schema.primaryKey] ?? ""));
  }
}

/** Close open mode. Embedded mode reports the close via `select(null)`
 *  (the card clears its `viewState`); standalone mode drops the
 *  `?selected=` query param so a refresh / back-button doesn't reopen
 *  the record and the URL reflects the closed state. */
function closeView(): void {
  viewing.value = null;
  actionError.value = null;
  if (embedded.value) {
    emit("select", null);
    return;
  }
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
  const selected = activeSelected.value;
  if (typeof selected !== "string" || selected.length === 0) {
    viewing.value = null;
    return;
  }
  const match = findItemById(selected) ?? null;
  viewing.value = match;
  // A deep link / notification can target a row that loaded off-screen
  // (long collection). Bring the now-open record into view — the save
  // path already does this; the `?selected=` path must too.
  if (match) scrollOpenPanelIntoView();
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

/** Live computed record from the current draft. Drives derived
 *  field displays in the form so subtotal/tax/total update as
 *  the user edits line items. */
const liveRecord = computed<CollectionItem | null>(() => {
  if (!collection.value || !editing.value) return null;
  return draftToRecord(editing.value, collection.value.schema);
});

/** Live record with derived fields resolved (drives the form's
 *  read-only derived inputs). Derivation lives in the shared
 *  rendering composable; this binds it to the current draft. */
const liveDerived = computed<CollectionItem | null>(() => {
  if (!collection.value || !liveRecord.value) return null;
  return render.deriveAll(collection.value.schema, liveRecord.value, refRecordCache.value);
});

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
  const savedId = result.data.itemId;
  closeEditor();
  await loadCollection(slug);
  // Return to the saved record's read-only detail (for create, this is the
  // newly added row), scrolling it into view if it's off-screen.
  const saved = findItemById(savedId);
  if (saved) {
    showDetail(saved);
    scrollOpenPanelIntoView();
  }
}

/** Write a single cell's value directly onto the live `items` entry.
 *  Reactive in Vue 3 (proxy), so the bound checkbox/select re-renders.
 *  `undefined` (enum cleared to the placeholder) renders as the empty
 *  option; the PUT body omits the key via `buildUpdatedRecord`. */
function applyInlineValue(item: CollectionItem, key: string, value: unknown): void {
  item[key] = value;
}

/** True while this row has an inline cell save in flight — its inline
 *  controls render disabled to serialize edits (one PUT per row). */
function isRowInlineSaving(item: CollectionItem): boolean {
  return inlineSavingRows.value.has(rowId(item));
}

/** Inline table-cell edit (boolean checkbox / enum dropdown): optimistic
 *  update, then PUT the full record. Gated per row so a second edit can't
 *  race the in-flight one. On failure, roll the cell back and surface the
 *  error. Bypasses the detail/edit panel entirely. */
async function commitInlineEdit(item: CollectionItem, key: string, field: FieldSpec, raw: boolean | string): Promise<void> {
  if (!collection.value) return;
  const { slug } = collection.value;
  const itemId = rowId(item);
  if (!itemId || inlineSavingRows.value.has(itemId)) return;
  const previous = item[key];
  const coerced = coerceInlineValue(field, raw);
  applyInlineValue(item, key, coerced);
  inlineError.value = null;
  inlineSavingRows.value.add(itemId);
  const result = await apiPut<ItemMutationResponse>(itemUrl(slug, itemId), buildUpdatedRecord(item, key, coerced));
  inlineSavingRows.value.delete(itemId);
  if (!result.ok) {
    applyInlineValue(item, key, previous);
    inlineError.value = result.error;
  }
}

/** Whether a `toggle` field reads as checked: its projected enum field
 *  currently equals `onValue`. The toggle stores nothing itself. */
function toggleChecked(item: CollectionItem, field: FieldSpec): boolean {
  return field.field !== undefined && String(item[field.field] ?? "") === field.onValue;
}

/** Flip a `toggle`: write the projected enum field to `offValue` when
 *  currently checked, else `onValue`. Reuses the inline-edit PUT path
 *  (optimistic + rollback) — the toggle has no value of its own. */
function commitToggle(item: CollectionItem, field: FieldSpec): void {
  const targetKey = field.field;
  if (!targetKey || !collection.value) return;
  const enumField = collection.value.schema.fields[targetKey];
  if (!enumField) return;
  const next = toggleChecked(item, field) ? field.offValue : field.onValue;
  if (next === undefined) return;
  void commitInlineEdit(item, targetKey, enumField, next);
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

// Delete the whole collection (skill + records), not just one item.
// The server archives a restorable copy first; on success we leave the
// now-gone collection's route for the index.
async function confirmCollectionDelete(): Promise<void> {
  const current = collection.value;
  if (!current) return;
  // Snapshot before the await — the confirm dialog yields control and
  // the route could change underneath us (see confirmDelete).
  const { slug, title } = current;
  const ok = await openConfirm({
    message: t("collectionsView.confirmDeleteCollection", { title }),
    confirmText: t("common.remove"),
    cancelText: t("common.cancel"),
    variant: "danger",
  });
  if (!ok) return;
  const result = await apiDelete(detailUrl(slug));
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  router.push({ name: PAGE_ROUTES.collections, params: {} }).catch(() => {});
}

function goBack(): void {
  const name = isFeedRoute.value ? PAGE_ROUTES.feeds : PAGE_ROUTES.collections;
  router.push({ name, params: {} }).catch(() => {});
}

// Delete a feed: remove its feeds/<slug>/ registry entry (records on disk
// are retained), then return to the feed list. Distinct from
// `confirmCollectionDelete`, which archives + deletes a skill-backed
// collection through the project-scope collection-delete route.
async function confirmFeedDelete(): Promise<void> {
  const current = collection.value;
  if (!current) return;
  const { slug, title } = current;
  const ok = await openConfirm({
    message: t("collectionsView.confirmDeleteFeed", { title }),
    confirmText: t("common.remove"),
    cancelText: t("common.cancel"),
    variant: "danger",
  });
  if (!ok) return;
  const result = await apiDelete(API_ROUTES.feeds.detail.replace(":slug", encodeURIComponent(slug)));
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  router.push({ name: PAGE_ROUTES.feeds, params: {} }).catch(() => {});
}

// Load on slug change, immediate so the initial value (route param or
// prop) triggers the first fetch — replaces the old `onMounted` +
// separate slug watch. Works identically for route mode (reads
// `route.params.slug`) and embedded mode (reads the `slug` prop).
/** Open the create form with the clicked calendar day prefilled into the
 *  anchor date field. The calendar's empty-cell affordance; the create
 *  flow itself is the same one the Add button uses. */
function createOnDate(iso: string): void {
  if (!canCreate.value) return;
  openCreate();
  const anchor = calendarAnchorField.value;
  if (editing.value && anchor) editing.value.text[anchor] = iso;
}

/** Calendar chip / kanban card click → open that record's detail below the
 *  grid (or close when a deselect is reported). Unlike `openView`, this
 *  never toggles — a second click on the same record keeps it open. */
function onCalendarSelect(itemId: string | null): void {
  if (!itemId) {
    closeView();
    return;
  }
  const item = findItemById(itemId);
  if (!item) return;
  if (editing.value) closeEditor();
  showDetail(item);
}

/** Kanban card dropped in a column → set the record's group field to the
 *  column value (the empty string clears it for the Uncategorized column).
 *  Reuses the inline-edit path (optimistic write + PUT + rollback). */
function onKanbanMove(itemId: string, value: string): void {
  const item = findItemById(itemId);
  const key = kanbanGroupField.value;
  const field = collection.value?.schema.fields[key];
  if (!item || !field) return;
  void commitInlineEdit(item, key, field, value);
}

watch(
  activeSlug,
  (slug, prevSlug) => {
    // Reset view state when switching BETWEEN collections — but not on the
    // initial run (prevSlug undefined), so an embedded card's restored
    // `initialView` / `initialAnchorField` survive the first load. Standalone
    // mode restores the new collection's stored mode (else "table"); the axis
    // fields always reset to their schema defaults.
    if (prevSlug !== undefined && slug !== prevSlug) {
      view.value = (slug && !embedded.value && readCollectionViewMode(slug)) || "table";
      anchorOverride.value = null;
      kanbanOverride.value = null;
    }
    if (slug) {
      loadCollection(slug);
    } else {
      collection.value = null;
      items.value = [];
      enumOriginallyEmpty.value = new Set();
      inlineSavingRows.value = new Set();
      searchQuery.value = ""; // Reset search query
      loading.value = false;
    }
  },
  { immediate: true },
);

// Embedded mode: report view/anchor changes so the chat card persists them
// in `viewState` (alongside `selected`). Standalone mode: persist the view
// mode per slug in localStorage so reopening restores it.
// `loading` is a dependency so the write re-runs when the collection finishes
// loading: that's the point where a stored mode unsupported by this schema
// (its date/enum field gone) has collapsed to "table" and must be normalized
// back into storage — otherwise no other dependency changes and it lingers.
watch([activeView, calendarAnchorField, kanbanGroupField, loading], () => {
  // Persist the EFFECTIVE view (activeView), not the raw `view` ref — a
  // stale "calendar"/"kanban" that has fallen back to "table" (its enabling
  // field gone) must not be saved as an impossible mode.
  if (embedded.value) {
    emit("viewStateChange", { view: activeView.value, anchorField: calendarAnchorField.value, groupField: kanbanGroupField.value });
    return;
  }
  // Don't write during the load window: until the collection resolves,
  // `hasCalendar`/`hasKanban` are false so `activeView` reads "table",
  // which would clobber a stored "calendar"/"kanban" before it can apply.
  if (activeSlug.value && !loading.value && collection.value) writeCollectionViewMode(activeSlug.value, activeView.value);
});

// React to the active selection changing while already on this
// collection: follow it to open the new record, OR close the modal when
// it's cleared (browser back / card close) or points at a missing id.
// The initial / cross-collection case is handled by `loadCollection`;
// here we only act once items are loaded.
watch(activeSelected, () => {
  if (!loading.value && collection.value) syncViewToSelected();
});
</script>
