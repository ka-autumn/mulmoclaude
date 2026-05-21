<template>
  <div class="crm-container">
    <!-- Header with Glassmorphism and Tab Navigation -->
    <header class="crm-header">
      <div class="crm-logo-area">
        <h1 class="crm-title">{{ t("title") }}</h1>
      </div>
      <nav class="crm-tabs">
        <button type="button" class="tab-btn" :class="{ active: activeTab === 'spreadsheet' }" @click="switchToSpreadsheet">
          <span class="material-icons text-base leading-none">folder</span>
          {{ t("title") }}
        </button>
        <button type="button" class="tab-btn" :class="{ active: activeTab === 'review' }" @click="switchToReview">
          <span class="material-icons text-base leading-none">rate_review</span>
          {{ t("reviewBoard") }}
          <span v-if="pendingReviewCount > 0" class="review-badge animate-pulse">
            {{ pendingReviewCount }}
          </span>
        </button>
        <button v-if="selectedClientId" type="button" class="tab-btn" :class="{ active: activeTab === 'details' }" @click="activeTab = 'details'">
          <span class="material-icons text-base leading-none">visibility</span>
          {{ t("details") }}
        </button>
      </nav>
    </header>

    <!-- Main Content Area -->
    <main class="crm-main">
      <div v-if="successMsg" class="alert alert-success">
        <span>{{ successMsg }}</span>
        <button type="button" class="alert-close" @click="successMsg = ''">×</button>
      </div>
      <div v-if="errorMsg" class="alert alert-error">
        <span>{{ errorMsg }}</span>
        <button type="button" class="alert-close" @click="errorMsg = ''">×</button>
      </div>

      <!-- SPREADSHEET LIST TAB -->
      <section v-if="activeTab === 'spreadsheet'" class="tab-pane">
        <div class="toolbar">
          <div class="search-box">
            <span class="search-icon material-icons">search</span>
            <input v-model="searchQuery" type="text" :placeholder="t('searchPlaceholder')" class="search-input" />
          </div>
          <div class="filter-group">
            <button
              v-for="status in ['all', 'active', 'paused', 'archived']"
              :key="status"
              type="button"
              class="filter-btn"
              :class="{ active: statusFilter === status }"
              @click="statusFilter = status as any"
            >
              {{ status === "all" ? t("statusAll") : t(("status" + status.charAt(0).toUpperCase() + status.slice(1)) as any) }}
            </button>
          </div>
        </div>

        <div class="table-container">
          <table class="crm-table">
            <thead>
              <tr>
                <th>{{ t("client") }}</th>
                <th>{{ t("status") }}</th>
                <th>{{ t("rate") }}</th>
                <th>{{ t("paymentTerms") }}</th>
                <th>{{ t("contacts") }}</th>
                <th>{{ t("projectsHeader") }}</th>
                <th>{{ t("tags") }}</th>
                <th>{{ t("firstEngagement") }}</th>
                <th class="text-right">{{ t("actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="client in filteredClients" :key="client.id" class="table-row" @click="selectClient(client.id)">
                <td class="client-name-cell">
                  <div class="name-wrapper">
                    <div>
                      <div class="client-name">{{ client.name }}</div>
                      <div class="client-id-sub">@{{ client.id }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="status-pill" :class="client.status">
                    {{ t(("status" + client.status.charAt(0).toUpperCase() + client.status.slice(1)) as any) }}
                  </span>
                </td>
                <td class="font-mono">{{ client.rate?.amount }} {{ client.rate?.currency }}/{{ client.rate?.unit }}</td>
                <td>{{ client.paymentTerms }}</td>
                <td>
                  <span class="count-badge bg-blue-light">{{ client.contacts?.length ?? 0 }}</span>
                </td>
                <td>
                  <span class="count-badge bg-purple-light">{{ getProjectsCount(client.id) }}</span>
                </td>
                <td>
                  <div class="tags-row">
                    <span v-for="tag in client.tags" :key="tag" class="tag-pill">{{ tag }}</span>
                  </div>
                </td>
                <td class="text-muted text-sm font-mono">{{ client.firstEngagement }}</td>
                <td class="text-right" @click.stop>
                  <button type="button" class="btn-action" @click="selectClient(client.id)">
                    <span class="material-icons text-sm leading-none">visibility</span>
                    {{ t("details") }}
                  </button>
                </td>
              </tr>
              <tr v-if="filteredClients.length === 0">
                <td colspan="9" class="table-empty">
                  {{ t("noClients") }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- REVIEW BOARD TAB (AI-on-a-Leash) -->
      <section v-if="activeTab === 'review'" class="tab-pane">
        <div class="review-intro">
          <h2>{{ t("reviewBoard") }}</h2>
          <p class="text-muted text-sm">
            {{ t("reviewBoardIntro") }}
          </p>
        </div>

        <div class="candidates-grid">
          <!-- Client Candidates -->
          <div v-for="cand in clientCandidates" :key="cand.candidateId" class="candidate-card bg-amber-border">
            <div class="candidate-header">
              <span class="type-badge client-badge">{{ t("clientDraft").toUpperCase() }}</span>
              <span class="date-badge font-mono">{{ new Date(cand.createdAt).toLocaleDateString() }}</span>
            </div>
            <div class="candidate-body">
              <div class="field-group">
                <label class="field-label">{{ t("clientName") }}</label>
                <input v-model="cand.data.name" type="text" class="form-input" />
              </div>
              <div class="field-row">
                <div class="field-group flex-1">
                  <label class="field-label">{{ t("idSlug") }}</label>
                  <input v-model="cand.data.id" type="text" class="form-input font-mono" />
                </div>
                <div class="field-group flex-1">
                  <label class="field-label">{{ t("paymentTerms") }}</label>
                  <input v-model="cand.data.paymentTerms" type="text" class="form-input" />
                </div>
              </div>
              <div class="field-group">
                <label class="field-label">{{ t("rate") }}</label>
                <div class="rate-input-row">
                  <input v-model.number="cand.data.rate.amount" type="number" class="form-input font-mono flex-1" />
                  <input
                    v-model="cand.data.rate.currency"
                    type="text"
                    class="form-input text-xs w-16 text-center font-mono"
                    :placeholder="t('currencyPlaceholder')"
                  />
                  <select v-model="cand.data.rate.unit" class="form-select text-xs w-20">
                    <option value="hour">{{ t("rateHour") }}</option>
                    <option value="fixed">{{ t("rateFixed") }}</option>
                    <option value="month">{{ t("rateMonth") }}</option>
                  </select>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label">{{ t("tagsCommaSeparated") }}</label>
                <input
                  :value="cand.data.tags.join(', ')"
                  type="text"
                  class="form-input"
                  @change="(e) => updateCandidateTags(cand, (e.target as HTMLInputElement).value)"
                />
              </div>
              <div class="field-group">
                <label class="field-label">{{ t("notesMarkdown") }}</label>
                <textarea v-model="cand.data.notes" class="form-textarea" rows="3"></textarea>
              </div>

              <!-- Contacts inside Candidate -->
              <div class="candidate-contacts-section">
                <div class="field-label font-bold mb-1">{{ t("contacts") }} ({{ cand.data.contacts?.length ?? 0 }})</div>
                <div v-for="(c, i) in cand.data.contacts" :key="i" class="candidate-contact-row">
                  <input v-model="c.name" type="text" :placeholder="t('contactName')" class="form-input text-xs" />
                  <input v-model="c.email" type="text" :placeholder="t('contactEmail')" class="form-input text-xs" />
                  <input v-model="c.role" type="text" :placeholder="t('contactRole')" class="form-input text-xs" />
                  <button type="button" class="btn-remove" @click="cand.data.contacts.splice(i, 1)">×</button>
                </div>
                <button type="button" class="btn-add-contact" @click="cand.data.contacts.push({ name: '', email: '', role: '' })">
                  <span class="material-icons text-sm leading-none">add</span>
                  {{ t("addContact") }}
                </button>
              </div>
            </div>
            <div class="candidate-actions">
              <button type="button" class="btn-approve" :disabled="approving[cand.candidateId]" @click="approveClientCandidate(cand)">
                <span v-if="!approving[cand.candidateId]" class="material-icons text-sm leading-none">check</span>
                {{ approving[cand.candidateId] ? t("approving") : t("approve") }}
              </button>
              <button type="button" class="btn-reject" :disabled="deletingCand[cand.candidateId]" @click="deleteCandidate(cand.candidateId, cand.data.name)">
                <span v-if="!deletingCand[cand.candidateId]" class="material-icons text-sm leading-none">delete</span>
                {{ deletingCand[cand.candidateId] ? t("deleting") : t("reject") }}
              </button>
            </div>
          </div>

          <!-- Project Candidates -->
          <div v-for="cand in projectCandidates" :key="cand.candidateId" class="candidate-card bg-purple-border">
            <div class="candidate-header">
              <span class="type-badge project-badge">{{ t("projectDraft").toUpperCase() }}</span>
              <span class="date-badge font-mono">{{ new Date(cand.createdAt).toLocaleDateString() }}</span>
            </div>
            <div class="candidate-body">
              <div class="field-row">
                <div class="field-group flex-1">
                  <label class="field-label">{{ t("projectName") }}</label>
                  <input v-model="cand.data.name" type="text" class="form-input" />
                </div>
                <div class="field-group flex-1">
                  <label class="field-label">{{ t("clientSlug") }}</label>
                  <input v-model="cand.data.clientId" type="text" class="form-input font-mono" disabled />
                </div>
              </div>
              <div class="field-row">
                <div class="field-group flex-1">
                  <label class="field-label">{{ t("idSlug") }}</label>
                  <input v-model="cand.data.id" type="text" class="form-input font-mono" />
                </div>
                <div class="field-group flex-1">
                  <label class="field-label">{{ t("feeModel") }}</label>
                  <select v-model="cand.data.feeModel" class="form-select">
                    <option value="hour">{{ t("rateHourOption") }}</option>
                    <option value="fixed">{{ t("rateFixedOption") }}</option>
                    <option value="retainer">{{ t("rateRetainerOption") }}</option>
                  </select>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label">{{ t("deliverables") }}</label>
                <input v-model="cand.data.expectedDeliverables" type="text" class="form-input" />
              </div>
              <div class="field-group">
                <label class="field-label">{{ t("notesMarkdown") }}</label>
                <textarea v-model="cand.data.notes" class="form-textarea" rows="3"></textarea>
              </div>
            </div>
            <div class="candidate-actions">
              <button type="button" class="btn-approve-project" :disabled="approving[cand.candidateId]" @click="approveProjectCandidate(cand)">
                <span v-if="!approving[cand.candidateId]" class="material-icons text-sm leading-none">check</span>
                {{ approving[cand.candidateId] ? t("approving") : t("approve") }}
              </button>
              <button type="button" class="btn-reject" :disabled="deletingCand[cand.candidateId]" @click="deleteCandidate(cand.candidateId, cand.data.name)">
                <span v-if="!deletingCand[cand.candidateId]" class="material-icons text-sm leading-none">delete</span>
                {{ deletingCand[cand.candidateId] ? t("deleting") : t("reject") }}
              </button>
            </div>
          </div>

          <div v-if="pendingReviewCount === 0" class="no-candidates-panel">
            <div class="info-text">{{ t("noCandidates") }}</div>
          </div>
        </div>
      </section>

      <!-- CLIENT DETAILS TAB -->
      <section v-if="activeTab === 'details' && selectedClient" class="tab-pane details-pane">
        <div class="details-topbar">
          <button type="button" class="btn-secondary" @click="switchToSpreadsheet">
            <span class="material-icons text-sm leading-none">arrow_back</span>
            {{ t("backToList") }}
          </button>
          <div class="details-status-control">
            <span class="text-sm font-semibold">{{ t("status") }}:</span>
            <select
              :value="selectedClient.status"
              class="status-select"
              :class="selectedClient.status"
              @change="(e) => updateClientStatus((e.target as HTMLSelectElement).value as any)"
            >
              <option value="active">{{ t("statusActive") }}</option>
              <option value="paused">{{ t("statusPaused") }}</option>
              <option value="archived">{{ t("statusArchived") }}</option>
            </select>
          </div>
        </div>

        <div class="details-grid">
          <!-- Left Column: Settings and Metadata -->
          <div class="details-col-left">
            <div class="details-card glass-panel">
              <h3 class="panel-heading">{{ t("profileDetails") }}</h3>
              <div class="form-grid">
                <div class="field-group">
                  <label class="field-label">{{ t("contactName") }}</label>
                  <input v-model="editClientForm.name" type="text" class="form-input font-bold" />
                </div>
                <div class="field-group">
                  <label class="field-label">{{ t("idSlug") }}</label>
                  <input :value="selectedClient.id" type="text" class="form-input font-mono text-muted" disabled />
                </div>
                <div class="field-group">
                  <label class="field-label">{{ t("firstEngagement") }}</label>
                  <input v-model="editClientForm.firstEngagement" type="date" class="form-input font-mono" />
                </div>
                <div class="field-group">
                  <label class="field-label">{{ t("paymentTerms") }}</label>
                  <input v-model="editClientForm.paymentTerms" type="text" class="form-input" />
                </div>

                <div class="field-group">
                  <label class="field-label">{{ t("rate") }}</label>
                  <div class="rate-input-row">
                    <input v-model.number="editClientForm.rate.amount" type="number" class="form-input font-mono flex-1" />
                    <input
                      v-model="editClientForm.rate.currency"
                      type="text"
                      class="form-input text-xs w-16 text-center font-mono"
                      :placeholder="t('currencyPlaceholder')"
                    />
                    <select v-model="editClientForm.rate.unit" class="form-select text-xs w-20">
                      <option value="hour">{{ t("rateHour") }}</option>
                      <option value="fixed">{{ t("rateFixed") }}</option>
                      <option value="month">{{ t("rateMonth") }}</option>
                    </select>
                  </div>
                </div>

                <!-- Tag Management -->
                <div class="field-group">
                  <label class="field-label">{{ t("tags") }}</label>
                  <div class="tags-manager">
                    <div class="tags-list">
                      <span v-for="tag in editClientForm.tags" :key="tag" class="tag-pill interactive">
                        {{ tag }}
                        <button type="button" class="btn-tag-remove" @click="removeTag(tag)">×</button>
                      </span>
                    </div>
                    <div class="tag-input-row">
                      <input v-model="newTagInput" type="text" :placeholder="t('addTagPlaceholder')" class="form-input text-xs" @keyup.enter="addTag" />
                      <button type="button" class="btn-tag-add" @click="addTag" :aria-label="t('addContact')">
                        <span class="material-icons text-sm leading-none">add</span>
                      </button>
                    </div>
                  </div>
                </div>

                <button type="button" class="btn-primary w-full justify-center" :disabled="updatingClient" @click="saveClientMetadata">
                  <span v-if="!updatingClient" class="material-icons text-base leading-none">save</span>
                  {{ updatingClient ? t("saving") : t("saveProfileDetails") }}
                </button>
              </div>
            </div>
          </div>

          <!-- Right Column: Contacts, Projects, Notes -->
          <div class="details-col-right flex flex-col gap-4">
            <!-- Contacts Management -->
            <div class="details-card glass-panel">
              <h3 class="panel-heading">{{ t("contacts") }} ({{ editClientForm.contacts.length }})</h3>
              <div class="contacts-table-wrapper">
                <table class="contacts-table">
                  <thead>
                    <tr>
                      <th>{{ t("contactName") }}</th>
                      <th>{{ t("contactEmail") }}</th>
                      <th>{{ t("contactRole") }}</th>
                      <th class="text-right">{{ t("action") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(contact, index) in editClientForm.contacts" :key="index">
                      <td>
                        <input v-model="contact.name" type="text" class="table-input font-semibold" :placeholder="t('contactName')" />
                      </td>
                      <td>
                        <input v-model="contact.email" type="text" class="table-input font-mono" :placeholder="t('contactEmail')" />
                      </td>
                      <td>
                        <input v-model="contact.role" type="text" class="table-input" :placeholder="t('contactRolePlaceholder')" />
                      </td>
                      <td class="text-right">
                        <button type="button" class="btn-circle-danger" @click="removeContact(index)" :aria-label="t('delete')">
                          <span class="material-icons text-sm leading-none">delete</span>
                        </button>
                      </td>
                    </tr>
                    <tr v-if="editClientForm.contacts.length === 0">
                      <td colspan="4" class="text-center text-muted py-4 text-xs font-italic">{{ t("noContacts") }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="contacts-actions">
                <button type="button" class="btn-secondary text-xs" @click="addNewContactRow">
                  <span class="material-icons text-sm leading-none">add</span>
                  {{ t("addContactRow") }}
                </button>
                <button type="button" class="btn-primary text-xs" :disabled="updatingClient" @click="saveClientMetadata">
                  <span class="material-icons text-sm leading-none">save</span>
                  {{ t("saveContacts") }}
                </button>
              </div>
            </div>

            <!-- Committed & Candidate Projects -->
            <div class="details-card glass-panel">
              <div class="panel-heading-row">
                <h3 class="panel-heading">{{ t("projectsHeader") }} ({{ clientProjects.length + clientProjectCandidates.length }})</h3>
                <button type="button" class="btn-secondary text-xs" @click="showAddProjectForm = !showAddProjectForm">
                  <span v-if="!showAddProjectForm" class="material-icons text-sm leading-none">add</span>
                  {{ showAddProjectForm ? t("cancel") : t("createNewProject") }}
                </button>
              </div>

              <!-- Inline New Project Candidate Form -->
              <div v-if="showAddProjectForm" class="new-project-candidate-form">
                <h4 class="form-subheading">{{ t("createNewProject") }}</h4>
                <div class="form-grid">
                  <div class="field-row">
                    <div class="field-group flex-1">
                      <label class="field-label">{{ t("projectName") }}</label>
                      <input v-model="newProjectForm.name" type="text" class="form-input" :placeholder="t('projectNamePlaceholder')" />
                    </div>
                    <div class="field-group flex-1">
                      <label class="field-label">{{ t("idSlugHelp") }}</label>
                      <input v-model="newProjectForm.id" type="text" class="form-input font-mono" :placeholder="t('idSlugPlaceholder')" />
                    </div>
                  </div>
                  <div class="field-row">
                    <div class="field-group flex-1">
                      <label class="field-label">{{ t("feeModel") }}</label>
                      <select v-model="newProjectForm.feeModel" class="form-select">
                        <option value="hour">{{ t("rateHourOption") }}</option>
                        <option value="fixed">{{ t("rateFixedOption") }}</option>
                        <option value="retainer">{{ t("rateRetainerOption") }}</option>
                      </select>
                    </div>
                    <div class="field-group flex-1">
                      <label class="field-label">{{ t("billingRateOverride") }}</label>
                      <input v-model.number="newProjectForm.rateAmount" type="number" class="form-input font-mono" placeholder="0" />
                    </div>
                  </div>
                  <div class="field-group">
                    <label class="field-label">{{ t("deliverables") }}</label>
                    <input v-model="newProjectForm.expectedDeliverables" type="text" class="form-input" :placeholder="t('deliverablesPlaceholder')" />
                  </div>
                  <div class="field-group">
                    <label class="field-label">{{ t("notes") }}</label>
                    <textarea v-model="newProjectForm.notes" class="form-textarea" rows="2" :placeholder="t('projectSpecsPlaceholder')"></textarea>
                  </div>
                  <button type="button" class="btn-primary w-full justify-center" :disabled="creatingProject" @click="submitProjectCandidate">
                    <span v-if="!creatingProject" class="material-icons text-base leading-none">add</span>
                    {{ creatingProject ? t("creating") : t("createDraftCandidate") }}
                  </button>
                </div>
              </div>

              <!-- Projects list -->
              <div class="projects-list-grid">
                <!-- Project Candidates (Drafts) -->
                <div v-for="cand in clientProjectCandidates" :key="cand.candidateId" class="project-item-card draft border-amber">
                  <div class="project-item-head">
                    <div class="project-item-name font-bold">{{ cand.data.name }}</div>
                    <span class="project-status-badge draft animate-pulse">{{ t("draftBadge") }}</span>
                  </div>
                  <div class="project-item-meta text-xs">
                    <span>{{ localizedFeeModel(cand.data.feeModel) }}</span>
                    <span v-if="cand.data.rate"> · {{ cand.data.rate.amount }} {{ cand.data.rate.currency }}/{{ cand.data.rate.unit }}</span>
                  </div>
                  <div class="project-item-desc" v-if="cand.data.notes">{{ cand.data.notes.slice(0, 100) }}...</div>
                  <div class="project-draft-actions">
                    <button type="button" class="btn-approve-mini" @click="approveProjectCandidateDirect(cand)">
                      <span class="material-icons text-sm leading-none">check</span>
                      {{ t("commit") }}
                    </button>
                    <button type="button" class="btn-reject-mini" @click="deleteCandidateDirect(cand.candidateId, cand.data.name)">
                      <span class="material-icons text-sm leading-none">delete</span>
                      {{ t("delete") }}
                    </button>
                  </div>
                </div>

                <!-- Committed Projects -->
                <div v-for="proj in clientProjects" :key="proj.id" class="project-item-card" :class="proj.status">
                  <div class="project-item-head">
                    <div class="project-item-name font-bold text-slate-900">{{ proj.name }}</div>
                    <span class="project-status-badge" :class="proj.status">{{ localizedStatus(proj.status) }}</span>
                  </div>
                  <div class="project-item-meta text-xs text-muted">
                    <span>{{ localizedFeeModel(proj.feeModel) }}</span>
                    <span v-if="proj.rate"> · {{ proj.rate.amount }} {{ proj.rate.currency }}/{{ proj.rate.unit }}</span>
                    <span> · {{ t("startedLabel") }}: {{ proj.startDate }}</span>
                  </div>
                  <div class="project-item-desc text-sm" v-if="proj.notes">{{ proj.notes.slice(0, 120) }}{{ proj.notes.length > 120 ? "..." : "" }}</div>
                  <div v-if="proj.expectedDeliverables" class="project-deliverables text-xs">
                    <strong>{{ t("deliverablesLabel") }}:</strong> {{ proj.expectedDeliverables }}
                  </div>
                </div>

                <div v-if="clientProjects.length === 0 && clientProjectCandidates.length === 0" class="text-center text-muted py-6 text-xs font-italic">
                  {{ t("noProjects") }}
                </div>
              </div>
            </div>

            <!-- Notes Markdown Editor and Render Pane -->
            <div class="details-card glass-panel">
              <div class="panel-heading-row">
                <h3 class="panel-heading">{{ t("notes") }} & {{ t("crmLog") }}</h3>
                <div class="notes-tabs">
                  <button type="button" class="notes-tab-btn" :class="{ active: notesMode === 'edit' }" @click="notesMode = 'edit'">{{ t("edit") }}</button>
                  <button type="button" class="notes-tab-btn" :class="{ active: notesMode === 'preview' }" @click="notesMode = 'preview'">
                    {{ t("preview") }}
                  </button>
                </div>
              </div>

              <!-- Notes Editor -->
              <div v-if="notesMode === 'edit'" class="notes-editor-pane">
                <textarea v-model="editClientForm.notes" class="notes-textarea font-mono" rows="10" :placeholder="t('notesPlaceholder')"></textarea>
                <div class="notes-actions mt-2">
                  <button type="button" class="btn-primary text-xs" :disabled="updatingClient" @click="saveClientMetadata">
                    <span class="material-icons text-sm leading-none">save</span>
                    {{ t("saveNotes") }}
                  </button>
                </div>
              </div>

              <!-- Notes Preview -->
              <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdownLite escapes raw input first, so HTML is safe -->
              <div v-else class="notes-preview-pane markdown-body" v-html="renderedNotes"></div>
            </div>
          </div>
        </div>
      </section>
    </main>
    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useT, format } from "./lang";
import type { Client, Project, ClientCandidate, ProjectCandidate, ExtendedToolResultComplete } from "./types";
import ConfirmModal from "../../shared/components/ConfirmModal.vue";
import { useConfirm } from "../../shared/components/confirm";

const { openConfirm } = useConfirm();

const messages = useT();

function t(key: keyof typeof messages.value, params?: Record<string, string | number>): string {
  const template = messages.value[key];
  return params ? format(template, params) : template;
}

function localizedStatus(status: "active" | "paused" | "archived"): string {
  if (status === "active") return t("statusActive");
  if (status === "paused") return t("statusPaused");
  return t("statusArchived");
}

function localizedFeeModel(model: "hour" | "fixed" | "retainer"): string {
  if (model === "hour") return t("feeModelHour");
  if (model === "fixed") return t("feeModelFixed");
  return t("feeModelRetainer");
}

// Typing for dispatch responses
interface ListResponse {
  ok: boolean;
  // `list` is a narration-only action (worklog convention): the LLM-facing payload
  // lives under `jsonData`; no top-level `clients`/`candidates`, no `data` field.
  jsonData?: {
    clients?: Client[];
    candidates?: ClientCandidate[];
  };
}

interface ListProjectsResponse {
  ok: boolean;
  projects?: Project[];
  candidates?: ProjectCandidate[];
}

interface ShowClientResponse {
  ok: boolean;
  client?: Client;
  projects?: Project[];
  jsonData?: {
    client?: Client;
    projects?: Project[];
  };
  data?: {
    client?: Client;
    projects?: Project[];
  };
}

interface ActionResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

const props = defineProps<{ selectedResult?: ExtendedToolResultComplete }>();

const { dispatch, pubsub, log } = useRuntime();

// Application State
const activeTab = ref<"spreadsheet" | "review" | "details">("spreadsheet");
const searchQuery = ref("");
const statusFilter = ref<"all" | "active" | "paused" | "archived">("all");

const clients = ref<Client[]>([]);
const clientCandidates = ref<ClientCandidate[]>([]);
const projects = ref<Project[]>([]);
const projectCandidates = ref<ProjectCandidate[]>([]);

const selectedClientId = ref<string | null>(null);
const selectedClient = ref<Client | null>(null);
const clientProjects = ref<Project[]>([]);

// Interaction States
const successMsg = ref("");
const errorMsg = ref("");
const approving = ref<Record<string, boolean>>({});
const deletingCand = ref<Record<string, boolean>>({});
const updatingClient = ref(false);
const showAddProjectForm = ref(false);
const creatingProject = ref(false);
const notesMode = ref<"edit" | "preview">("edit");

// Client Form States
const editClientForm = ref<Client>({
  id: "",
  name: "",
  status: "active",
  contacts: [],
  rate: { amount: 0, currency: "USD", unit: "hour" },
  paymentTerms: "net-30",
  tags: [],
  firstEngagement: "",
  notes: "",
});

const newTagInput = ref("");

// Project Form States
const newProjectForm = ref({
  id: "",
  name: "",
  feeModel: "hour" as "hour" | "fixed" | "retainer",
  rateAmount: 0,
  expectedDeliverables: "",
  notes: "",
});

// Computed properties
const pendingReviewCount = computed(() => {
  return clientCandidates.value.length + projectCandidates.value.length;
});

const clientProjectCandidates = computed(() => {
  if (!selectedClientId.value) return [];
  return projectCandidates.value.filter((p) => p.data.clientId === selectedClientId.value);
});

const filteredClients = computed(() => {
  return clients.value.filter((c) => {
    // Status Filter
    if (statusFilter.value !== "all" && c.status !== statusFilter.value) {
      return false;
    }
    // Search Query Filter
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase();
      const matchName = c.name.toLowerCase().includes(q);
      const matchId = c.id.toLowerCase().includes(q);
      const matchTags = c.tags.some((t) => t.toLowerCase().includes(q));
      return matchName || matchId || matchTags;
    }
    return true;
  });
});

const renderedNotes = computed(() => {
  const notesText = editClientForm.value.notes;
  if (!notesText) return `<p class="text-muted font-italic">${t("noNotesRecorded")}</p>`;
  return renderMarkdownLite(notesText);
});

function syncActiveTab(action: string | undefined, candidateCount: number) {
  if (
    (action === "show" || action === "get" || action === "showProject" || action === "getProject" || action === "present") &&
    props.selectedResult?.args?.id
  ) {
    void selectClient(props.selectedResult.args.id);
  } else if (action === "present") {
    activeTab.value = "spreadsheet";
  } else if (action === "create" || action === "createProject" || (activeTab.value === "spreadsheet" && candidateCount > 0)) {
    activeTab.value = "review";
  }
}

// Auto-select first client or candidates if passed via props
watch(
  () => props.selectedResult?.uuid,
  () => {
    if (props.selectedResult) {
      syncActiveTab(props.selectedResult.args?.action, pendingReviewCount.value);
      void refreshAll().then(() => {
        syncActiveTab(props.selectedResult?.args?.action, pendingReviewCount.value);
      });
    }
  },
  { immediate: true },
);

async function refreshAll(): Promise<void> {
  try {
    const [clientsRes, projectsRes] = await Promise.all([
      dispatch<ListResponse>({ action: "list" }),
      dispatch<ListProjectsResponse>({ action: "listProjects" }),
    ]);

    if (clientsRes?.ok && Array.isArray(clientsRes.jsonData?.clients)) {
      clients.value = clientsRes.jsonData.clients;
    }
    if (clientsRes?.ok && Array.isArray(clientsRes.jsonData?.candidates)) {
      clientCandidates.value = clientsRes.jsonData.candidates;
    }
    if (projectsRes?.ok && Array.isArray(projectsRes.projects)) {
      projects.value = projectsRes.projects;
    }
    if (projectsRes?.ok && Array.isArray(projectsRes.candidates)) {
      projectCandidates.value = projectsRes.candidates;
    }

    // Refresh selected client details if already open
    if (selectedClientId.value) {
      await loadClientDetails(selectedClientId.value);
    }
  } catch (err) {
    log.error("Failed to refresh CRM data", { error: err instanceof Error ? err.message : String(err) });
  }
}

// Navigation helpers
function switchToSpreadsheet() {
  activeTab.value = "spreadsheet";
}

function switchToReview() {
  activeTab.value = "review";
}

// Client Selection / details loader
async function selectClient(clientId: string) {
  selectedClientId.value = clientId;
  await loadClientDetails(clientId);
  activeTab.value = "details";
  notesMode.value = "edit";
  showAddProjectForm.value = false;
  resetProjectForm();
}

async function loadClientDetails(clientId: string) {
  try {
    const res = await dispatch<ShowClientResponse>({ action: "get", id: clientId });
    const clientData = res?.client || res?.jsonData?.client || res?.data?.client;
    const projectsData = res?.projects || res?.jsonData?.projects || res?.data?.projects;
    if (res?.ok && clientData) {
      selectedClient.value = clientData;
      clientProjects.value = projectsData ?? [];

      // Load deep copy into editable form
      editClientForm.value = JSON.parse(JSON.stringify(clientData));
    }
  } catch (err) {
    errorMsg.value = format(t("errorLoadClientDetails"), { clientId });
    log.error(err instanceof Error ? err.message : String(err));
  }
}

// Counter helpers
function getProjectsCount(clientId: string): number {
  return projects.value.filter((p) => p.clientId === clientId).length;
}

// Tag Operations
function addTag() {
  const tag = newTagInput.value.trim().toLowerCase();
  if (tag && !editClientForm.value.tags.includes(tag)) {
    editClientForm.value.tags.push(tag);
  }
  newTagInput.value = "";
}

function removeTag(tagToRemove: string) {
  editClientForm.value.tags = editClientForm.value.tags.filter((t) => t !== tagToRemove);
}

// Contact Operations
function addNewContactRow() {
  editClientForm.value.contacts.push({
    name: "",
    email: "",
    role: "",
  });
}

function removeContact(index: number) {
  editClientForm.value.contacts.splice(index, 1);
}

function buildClientPatch(form: typeof editClientForm.value) {
  return {
    name: form.name,
    paymentTerms: form.paymentTerms,
    firstEngagement: form.firstEngagement,
    rate: form.rate,
    tags: form.tags,
    contacts: form.contacts,
    notes: form.notes,
  };
}

function handleSaveError(err: any) {
  errorMsg.value = err?.message || t("errorUnexpected");
}

// Save Metadata
async function saveClientMetadata() {
  if (!selectedClientId.value) return;
  updatingClient.value = true;
  successMsg.value = "";
  errorMsg.value = "";

  try {
    const res = await dispatch<ActionResponse>({
      action: "update",
      id: selectedClientId.value,
      patch: buildClientPatch(editClientForm.value),
    });

    if (res?.ok) {
      successMsg.value = t("saveSuccess");
      await refreshAll();
    } else {
      errorMsg.value = res?.error ?? t("errorSaveClient");
    }
  } catch (err: any) {
    handleSaveError(err);
  } finally {
    updatingClient.value = false;
  }
}

// Change Status
async function updateClientStatus(newStatus: "active" | "paused" | "archived") {
  if (!selectedClientId.value) return;
  try {
    const res = await dispatch<ActionResponse>({
      action: "update",
      id: selectedClientId.value,
      patch: { status: newStatus },
    });
    if (res?.ok) {
      successMsg.value = format(t("statusUpdated"), { status: localizedStatus(newStatus) });
      await refreshAll();
    }
  } catch (err: any) {
    errorMsg.value = err.message || t("errorUpdateClientStatus");
  }
}

// Candidate operations (Approve / Reject)
function updateCandidateTags(cand: ClientCandidate, csv: string) {
  cand.data.tags = csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function approveThenUpdate(cand: ClientCandidate) {
  const approveRes = await dispatch<ActionResponse & { id: string }>({
    action: "approveClient",
    candidateId: cand.candidateId,
    patch: cand.data,
  });
  return approveRes;
}

async function approveClientCandidate(cand: ClientCandidate) {
  const name = cand.data.name;
  if (
    !(await openConfirm({
      title: t("approve"),
      message: format(t("confirmApprove"), { name }),
      confirmText: t("approve"),
      variant: "success",
    }))
  )
    return;

  approving.value[cand.candidateId] = true;
  errorMsg.value = "";

  try {
    const res = await approveThenUpdate(cand);
    if (res?.ok) {
      successMsg.value = format(t("clientCommitSuccess"), { name });
      await refreshAll();
    } else {
      errorMsg.value = res?.error ?? t("errorApproveClient");
    }
  } catch (err: any) {
    errorMsg.value = err.message || t("errorApproveClientGeneral");
  } finally {
    approving.value[cand.candidateId] = false;
  }
}

async function approveProjectRequest(candidateId: string, patch?: Project) {
  return await dispatch<ActionResponse>({
    action: "approveProject",
    candidateId,
    patch,
  });
}

async function approveProjectCandidate(cand: ProjectCandidate) {
  const name = cand.data.name;
  if (
    !(await openConfirm({
      title: t("approve"),
      message: format(t("confirmApprove"), { name }),
      confirmText: t("approve"),
      variant: "success",
    }))
  )
    return;

  approving.value[cand.candidateId] = true;
  errorMsg.value = "";

  try {
    const res = await approveProjectRequest(cand.candidateId, cand.data);
    if (res?.ok) {
      successMsg.value = format(t("projectCommitSuccess"), { name });
      await refreshAll();
    } else {
      errorMsg.value = res?.error ?? t("errorApproveProject");
    }
  } catch (err: any) {
    errorMsg.value = err.message || t("errorApproveProjectGeneral");
  } finally {
    approving.value[cand.candidateId] = false;
  }
}

async function confirmDeleteCandidate(name: string) {
  return await openConfirm({
    title: t("reject"),
    message: format(t("confirmDeleteCandidate"), { name }),
    confirmText: t("reject"),
    variant: "danger",
  });
}

async function executeDeleteCandidate(candidateId: string, name: string) {
  deletingCand.value[candidateId] = true;
  errorMsg.value = "";

  try {
    const res = await dispatch<ActionResponse>({
      action: "deleteCandidate",
      candidateId,
    });

    if (res?.ok) {
      successMsg.value = format(t("deleteCandidateSuccess"), { name });
      await refreshAll();
    } else {
      errorMsg.value = res?.error ?? t("errorDeleteCandidate");
    }
  } catch (err: any) {
    errorMsg.value = err.message || t("errorDeleteCandidate");
  } finally {
    deletingCand.value[candidateId] = false;
  }
}

async function deleteCandidate(candidateId: string, name: string) {
  if (await confirmDeleteCandidate(name)) {
    await executeDeleteCandidate(candidateId, name);
  }
}

// Inline Direct Actions on details page
async function approveProjectCandidateDirect(cand: ProjectCandidate) {
  approving.value[cand.candidateId] = true;
  try {
    const res = await dispatch<ActionResponse>({
      action: "approveProject",
      candidateId: cand.candidateId,
      patch: cand.data,
    });
    if (res?.ok) {
      successMsg.value = format(t("projectCommitSuccess"), { name: cand.data.name });
      await refreshAll();
    }
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
  } finally {
    approving.value[cand.candidateId] = false;
  }
}

async function deleteCandidateDirect(candidateId: string, name: string) {
  if (
    !(await openConfirm({
      title: t("reject"),
      message: format(t("confirmDeleteCandidate"), { name }),
      confirmText: t("reject"),
      variant: "danger",
    }))
  )
    return;
  try {
    await dispatch({ action: "deleteCandidate", candidateId });
    await refreshAll();
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
  }
}

// Project Candidate Submission
function resetProjectForm() {
  newProjectForm.value = {
    id: "",
    name: "",
    feeModel: "hour",
    rateAmount: 0,
    expectedDeliverables: "",
    notes: "",
  };
}

async function submitProjectCandidate() {
  if (!selectedClientId.value) return;
  if (!newProjectForm.value.name) {
    errorMsg.value = t("projectNameRequired");
    return;
  }

  creatingProject.value = true;
  errorMsg.value = "";

  // Derive slug if not typed
  const projSlug = newProjectForm.value.id.trim() || newProjectForm.value.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  try {
    const res = await dispatch<ActionResponse>({
      action: "createProject",
      id: selectedClientId.value,
      projectId: projSlug,
      projectPatch: {
        name: newProjectForm.value.name,
        feeModel: newProjectForm.value.feeModel,
        rate: newProjectForm.value.rateAmount
          ? { amount: newProjectForm.value.rateAmount, currency: "USD", unit: newProjectForm.value.feeModel === "hour" ? "hour" : "fixed" }
          : undefined,
        expectedDeliverables: newProjectForm.value.expectedDeliverables,
        notes: newProjectForm.value.notes,
      },
    });

    if (res?.ok) {
      successMsg.value = t("projectCreatedSuccess");
      showAddProjectForm.value = false;
      resetProjectForm();
      await refreshAll();
    } else {
      errorMsg.value = res?.error ?? t("errorCreateProjectCandidate");
    }
  } catch (err: any) {
    errorMsg.value = err.message || t("errorCreateProjectCandidate");
  } finally {
    creatingProject.value = false;
  }
}

// Pubsub logic
let unsub: (() => void) | undefined;
onMounted(() => {
  syncActiveTab(props.selectedResult?.args?.action, pendingReviewCount.value);

  void refreshAll().then(() => {
    syncActiveTab(props.selectedResult?.args?.action, pendingReviewCount.value);
  });

  unsub = pubsub.subscribe("changed", () => {
    void refreshAll().then(() => {
      syncActiveTab(props.selectedResult?.args?.action, pendingReviewCount.value);
    });
  });
});

onUnmounted(() => {
  unsub?.();
});

// Tiny Markdown Subset Renderer
function renderMarkdownLite(input: string): string {
  const escaped = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let buffer: string[] = [];

  const flushPara = (): void => {
    if (buffer.length === 0) return;
    out.push(`<p>${buffer.join(" ")}</p>`);
    buffer = [];
  };

  const closeLists = (): void => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushPara();
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${formatInline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${formatInline(ol[1])}</li>`);
      continue;
    }
    if (line.trim().length === 0) {
      flushPara();
      closeLists();
      continue;
    }
    buffer.push(formatInline(line));
  }
  flushPara();
  closeLists();
  return out.join("\n");
}

function formatInline(input: string): string {
  return input
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>");
}
</script>

<style scoped>
/* CRM Glassmorphic Style Design */
button:has(.material-icons) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
}

.crm-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family:
    "Outfit",
    "Inter",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    sans-serif;
  color: #1e293b;
  background-color: #f8fafc;
  min-height: 500px;
}

/* Glass Header */
.crm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.5rem;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
  position: sticky;
  top: 0;
  z-index: 10;
}

.crm-logo-area {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.crm-title {
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.025em;
  background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Tab Navigation */
.crm-tabs {
  display: flex;
  gap: 0.25rem;
  background: #f1f5f9;
  padding: 0.25rem;
  border-radius: 0.5rem;
}

.tab-btn {
  background: transparent;
  border: none;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  position: relative;
}

.tab-btn:hover {
  color: #334155;
  background: rgba(255, 255, 255, 0.5);
}

.tab-btn.active {
  color: #0f172a;
  background: #ffffff;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.05),
    0 1px 2px rgba(0, 0, 0, 0.02);
}

.review-badge {
  background: #ef4444;
  color: white;
  font-size: 8px;
  font-weight: 700;
  padding: 0.125rem 0.3rem;
  border-radius: 9999px;
  margin-left: 0.25rem;
  display: inline-block;
  line-height: 1;
}

/* Main Area */
.crm-main {
  flex: 1;
  padding: 1.5rem;
  overflow-y: auto;
  min-height: 0;
}

/* Alerts */
.alert {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1.25rem;
  font-size: 0.8125rem;
  font-weight: 500;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    transform: translateY(-10px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.alert-success {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.alert-error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.alert-close {
  background: transparent;
  border: none;
  font-size: 1.125rem;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
}

.alert-close:hover {
  opacity: 1;
}

/* Toolbar */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  flex: 1;
  max-width: 320px;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
  font-size: 1.125rem;
}

.search-input {
  width: 100%;
  padding: 0.45rem 0.75rem 0.45rem 2.25rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  font-family: inherit;
  background: #ffffff;
  color: #1e293b;
  transition: all 0.15s ease;
}

.search-input:focus {
  outline: none;
  border-color: #0f172a;
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.08);
}

.filter-group {
  display: flex;
  gap: 0.25rem;
  background: #f1f5f9;
  padding: 0.2rem;
  border-radius: 0.375rem;
}

.filter-btn {
  background: transparent;
  border: none;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.filter-btn:hover {
  color: #334155;
}

.filter-btn.active {
  background: #ffffff;
  color: #0f172a;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* Premium Spreadsheet Grid Table */
.table-container {
  background: #ffffff;
  border-radius: 0.75rem;
  border: 1px solid #e2e8f0;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.02),
    0 2px 4px -1px rgba(0, 0, 0, 0.01);
  overflow-x: auto;
}

.crm-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.8125rem;
}

.crm-table th {
  background: #f8fafc;
  padding: 0.75rem 1rem;
  font-weight: 600;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}

.crm-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}

.table-row {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.table-row:hover {
  background-color: #f8fafc;
}

.client-name-cell {
  font-weight: 600;
}

.name-wrapper {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.client-name {
  color: #0f172a;
  font-size: 0.875rem;
  line-height: 1.2;
}

.client-id-sub {
  font-size: 0.6875rem;
  color: #94a3b8;
  font-weight: 400;
}

/* Status Badges */
.status-pill {
  display: inline-block;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.status-pill.active {
  background: #ecfdf5;
  color: #065f46;
}

.status-pill.paused {
  background: #fffbeb;
  color: #92400e;
}

.status-pill.archived {
  background: #f1f5f9;
  color: #475569;
}

/* Simple counts badges */
.count-badge {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
}

.bg-blue-light {
  background: #eff6ff;
  color: #1e40af;
}

.bg-purple-light {
  background: #faf5ff;
  color: #6b21a8;
}

/* Tags row */
.tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  max-width: 200px;
}

.tag-pill {
  font-size: 0.6875rem;
  background: #f1f5f9;
  color: #475569;
  padding: 0.1rem 0.375rem;
  border-radius: 0.25rem;
  font-weight: 500;
}

.tag-pill.interactive {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.btn-tag-remove {
  background: transparent;
  border: none;
  font-size: 0.875rem;
  cursor: pointer;
  color: #94a3b8;
  padding: 0 0.1rem;
}

.btn-tag-remove:hover {
  color: #ef4444;
}

.table-empty {
  text-align: center;
  padding: 3rem 1rem;
  color: #94a3b8;
  font-style: italic;
}

/* Action Buttons */
.btn-action {
  background: transparent;
  border: 1px solid #cbd5e1;
  color: #475569;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-action:hover {
  background: #f8fafc;
  color: #0f172a;
  border-color: #94a3b8;
}

/* Review Board & Candidates */
.review-intro {
  margin-bottom: 1.5rem;
}

.review-intro h2 {
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
  color: #0f172a;
}

.candidates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 1.5rem;
}

.candidate-card {
  background: #ffffff;
  border-radius: 0.75rem;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
  display: flex;
  flex-direction: column;
}

.candidate-card.bg-amber-border {
  border-top: 4px solid #f59e0b;
}

.candidate-card.bg-purple-border {
  border-top: 4px solid #a855f7;
}

.candidate-header {
  padding: 0.75rem 1rem;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.type-badge {
  font-size: 0.625rem;
  font-weight: 800;
  padding: 0.15rem 0.4rem;
  border-radius: 0.25rem;
}

.client-badge {
  background: #fef3c7;
  color: #92400e;
}

.project-badge {
  background: #f3e8ff;
  color: #6b21a8;
}

.date-badge {
  font-size: 0.6875rem;
  color: #94a3b8;
}

.candidate-body {
  padding: 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-row {
  display: flex;
  gap: 0.75rem;
}

.field-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.form-input,
.form-select,
.form-textarea {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  font-family: inherit;
  background: #ffffff;
  color: #1e293b;
  box-sizing: border-box;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: #475569;
}

.form-textarea {
  resize: vertical;
}

.candidate-contacts-section {
  border-top: 1px solid #f1f5f9;
  padding-top: 0.75rem;
}

.candidate-contact-row {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.25rem;
}

.btn-remove {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 1.125rem;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
}

.btn-remove:hover {
  color: #ef4444;
}

.btn-add-contact {
  background: transparent;
  border: 1px dashed #cbd5e1;
  color: #475569;
  font-size: 0.6875rem;
  font-weight: 600;
  width: 100%;
  padding: 0.25rem;
  border-radius: 0.25rem;
  cursor: pointer;
  margin-top: 0.25rem;
}

.btn-add-contact:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.candidate-actions {
  padding: 0.75rem 1rem;
  background: #f8fafc;
  border-top: 1px solid #f1f5f9;
  display: flex;
  gap: 0.5rem;
}

.btn-approve,
.btn-approve-project {
  flex: 1;
  color: white;
  border: none;
  padding: 0.4rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.btn-approve {
  background: #d97706;
}

.btn-approve:hover:not(:disabled) {
  background: #b45309;
}

.btn-approve-project {
  background: #7c3aed;
}

.btn-approve-project:hover:not(:disabled) {
  background: #6d28d9;
}

.btn-reject {
  background: white;
  border: 1px solid #fca5a5;
  color: #dc2626;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-reject:hover:not(:disabled) {
  background: #fef2f2;
}

.btn-approve:disabled,
.btn-approve-project:disabled,
.btn-reject:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.no-candidates-panel {
  grid-column: 1 / -1;
  text-align: center;
  padding: 5rem 2rem;
  background: #ffffff;
  border-radius: 0.75rem;
  border: 1px dashed #cbd5e1;
  color: #94a3b8;
}

.info-text {
  font-size: 0.875rem;
  font-weight: 500;
}

/* Client Details Panel & Grid */
.details-pane {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.details-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-secondary {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  color: #334155;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  transition: all 0.15s ease;
}

.btn-secondary:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.btn-primary {
  background: #0f172a;
  border: 1px solid #0f172a;
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  transition: all 0.15s ease;
}

.btn-primary:hover:not(:disabled) {
  background: #1e293b;
  border-color: #1e293b;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.details-status-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-select {
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.status-select.active {
  background: #ecfdf5;
  color: #065f46;
  border-color: #a7f3d0;
}

.status-select.paused {
  background: #fffbeb;
  color: #92400e;
  border-color: #fde68a;
}

.status-select.archived {
  background: #f1f5f9;
  color: #475569;
  border-color: #cbd5e1;
}

.details-grid {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 1.5rem;
}

@media (max-width: 768px) {
  .details-grid {
    grid-template-columns: 1fr;
  }
}

.glass-panel {
  background: #ffffff;
  border-radius: 0.75rem;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.01);
  padding: 1.25rem;
}

.panel-heading {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 1rem;
}

.panel-heading-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.panel-heading-row .panel-heading {
  margin-bottom: 0;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.rate-input-row {
  display: flex;
  gap: 0.25rem;
}

.tags-manager {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid #e2e8f0;
  padding: 0.5rem;
  border-radius: 0.375rem;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  min-height: 24px;
}

.tag-input-row {
  display: flex;
  gap: 0.25rem;
}

.btn-tag-add {
  background: transparent;
  border: none;
  cursor: pointer;
}

/* Contacts Table */
.contacts-table-wrapper {
  overflow-x: auto;
  margin-bottom: 0.75rem;
}

.contacts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.contacts-table th {
  text-align: left;
  color: #64748b;
  font-weight: 600;
  padding: 0.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.contacts-table td {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid #f1f5f9;
}

.table-input {
  border: none;
  background: transparent;
  width: 100%;
  padding: 0.25rem 0.125rem;
  font-size: 0.75rem;
  color: #1e293b;
  font-family: inherit;
}

.table-input:focus {
  outline: none;
  background: #f8fafc;
}

.btn-circle-danger {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 9999px;
  line-height: 1;
}

.btn-circle-danger:hover {
  background: #fef2f2;
}

.contacts-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* New Project Candidate inline form */
.new-project-candidate-form {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.form-subheading {
  font-size: 0.75rem;
  font-weight: 700;
  margin: 0 0 0.75rem;
  color: #0f172a;
}

/* Projects Grid inside Details */
.projects-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.project-item-card {
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  transition: all 0.15s ease;
}

.project-item-card:hover {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
}

.project-item-card.draft {
  background: #fffbeb;
  border: 1px dashed #f59e0b;
}

.project-item-card.paused {
  border-left: 3px solid #f59e0b;
}

.project-item-card.archived {
  opacity: 0.6;
}

.project-item-card.active {
  border-left: 3px solid #10b981;
}

.project-item-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}

.project-item-name {
  font-size: 0.8125rem;
  color: #0f172a;
}

.project-status-badge {
  font-size: 0.625rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  text-transform: uppercase;
}

.project-status-badge.active {
  background: #ecfdf5;
  color: #059669;
}

.project-status-badge.paused {
  background: #fffbeb;
  color: #d97706;
}

.project-status-badge.archived {
  background: #f1f5f9;
  color: #475569;
}

.project-status-badge.draft {
  background: #fef3c7;
  color: #d97706;
}

.project-item-desc {
  font-size: 0.75rem;
  color: #475569;
  font-style: italic;
}

.project-deliverables {
  background: #f8fafc;
  padding: 0.35rem;
  border-radius: 0.25rem;
  border-left: 2px solid #cbd5e1;
}

.project-draft-actions {
  display: flex;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.btn-approve-mini {
  flex: 1;
  background: #d97706;
  border: none;
  color: white;
  font-size: 0.6875rem;
  font-weight: 700;
  padding: 0.2rem;
  border-radius: 0.25rem;
  cursor: pointer;
}

.btn-reject-mini {
  background: transparent;
  border: 1px solid #fca5a5;
  color: #dc2626;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  cursor: pointer;
}

/* Notes Editor Layout */
.notes-tabs {
  display: flex;
  background: #f1f5f9;
  padding: 0.15rem;
  border-radius: 0.25rem;
}

.notes-tab-btn {
  background: transparent;
  border: none;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 0.2rem;
  color: #64748b;
  cursor: pointer;
}

.notes-tab-btn.active {
  background: #ffffff;
  color: #0f172a;
}

.notes-textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  padding: 0.5rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #1e293b;
  box-sizing: border-box;
}

.notes-textarea:focus {
  outline: none;
  border-color: #0f172a;
}

.notes-preview-pane {
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 1rem;
  background: #fafafa;
  min-height: 200px;
}

/* Markdown Rendering styles inside preview */
.markdown-body {
  font-size: 0.8125rem;
  line-height: 1.6;
  color: #334155;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  color: #0f172a;
  font-weight: 700;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.markdown-body :deep(h1) {
  font-size: 1.125rem;
}
.markdown-body :deep(h2) {
  font-size: 1rem;
}
.markdown-body :deep(h3) {
  font-size: 0.875rem;
}

.markdown-body :deep(p) {
  margin: 0 0 0.75rem;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.25rem;
  margin: 0 0 0.75rem;
}

.markdown-body :deep(li) {
  margin-bottom: 0.25rem;
}

.markdown-body :deep(strong) {
  color: #0f172a;
  font-weight: 600;
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(.inline-code) {
  background: #f1f5f9;
  padding: 0.1rem 0.25rem;
  border-radius: 0.25rem;
  font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 85%;
}

.flex {
  display: flex;
}
.flex-col {
  flex-direction: column;
}
.gap-4 {
  gap: 1rem;
}
.w-full {
  width: 100%;
}
.justify-center {
  justify-content: center;
}
.text-right {
  text-align: right;
}
.font-bold {
  font-weight: 700;
}
.font-semibold {
  font-weight: 600;
}
.font-mono {
  font-family: SFMono-Regular, Consolas, Menlo, monospace;
}
.text-xs {
  font-size: 0.75rem;
}
.text-sm {
  font-size: 0.8125rem;
}
.text-muted {
  color: #64748b;
}
.text-sm {
  font-size: 0.75rem;
}
.font-italic {
  font-style: italic;
}
.mb-1 {
  margin-bottom: 0.25rem;
}
.mt-2 {
  margin-top: 0.5rem;
}
.py-4 {
  padding-top: 1rem;
  padding-bottom: 1rem;
}
.py-6 {
  padding-top: 1.5rem;
  padding-bottom: 1.5rem;
}
.w-16 {
  width: 4rem;
}
.w-20 {
  width: 5rem;
}
.text-center {
  text-align: center;
}
.flex-1 {
  flex: 1;
}
</style>
