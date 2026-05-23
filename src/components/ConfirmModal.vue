<!-- Host-side confirm dialog. Mirror of
     `packages/plugins/shared/components/ConfirmModal.vue` with two
     intentional deltas:
       - Locale via vue-i18n's `useI18n` rather than the plugin
         runtime's `useRuntime` (this component mounts in host code,
         outside any PluginScopedRoot).
       - Header iconography uses Material Icons (host convention,
         see CLAUDE.md UI-controls rule) rather than emoji glyphs.
     Composable + state interface stays identical so the two can be
     unified the day the host/plugin runtime split is reconciled. -->
<template>
  <Transition name="confirm-modal">
    <div
      v-if="confirmState.isOpen"
      class="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      data-testid="host-confirm-modal"
      @click="onOverlayClick"
    >
      <div class="confirm-card" @click.stop>
        <div class="confirm-header">
          <div class="confirm-icon-wrapper" :class="confirmState.variant">
            <span class="material-icons icon" aria-hidden="true">{{ iconName }}</span>
          </div>
          <h3 id="confirm-title" class="confirm-title">
            {{ confirmState.title || defaultTitle }}
          </h3>
        </div>

        <div id="confirm-message" class="confirm-body">
          {{ confirmState.message }}
        </div>

        <div class="confirm-footer">
          <button ref="cancelBtn" type="button" class="btn-cancel" data-testid="host-confirm-cancel" @click="handleConfirm(false)">
            {{ confirmState.cancelText || defaultCancelText }}
          </button>
          <button ref="confirmBtn" type="button" class="btn-confirm" :class="confirmState.variant" data-testid="host-confirm-ok" @click="handleConfirm(true)">
            {{ confirmState.confirmText || defaultConfirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useConfirm } from "../composables/useConfirm";

const { confirmState, handleConfirm } = useConfirm();
const { locale } = useI18n();

const confirmBtn = ref<HTMLButtonElement | null>(null);
const cancelBtn = ref<HTMLButtonElement | null>(null);

const iconName = computed(() => {
  if (confirmState.value.variant === "danger") return "warning";
  if (confirmState.value.variant === "success") return "check_circle";
  return "info";
});

const defaultTitle = computed(() => {
  switch (locale.value) {
    case "ja":
      return "確認";
    case "ko":
      return "확인";
    case "zh":
      return "确认";
    case "es":
      return "Confirmar";
    case "de":
      return "Bestätigen";
    case "fr":
      return "Confirmer";
    case "pt-BR":
      return "Confirmar";
    default:
      return "Confirm";
  }
});

const defaultConfirmText = computed(() => {
  switch (locale.value) {
    case "ja":
      return "実行";
    case "ko":
      return "확인";
    case "zh":
      return "确定";
    case "es":
      return "Aceptar";
    case "de":
      return "Bestätigen";
    case "fr":
      return "Confirmer";
    case "pt-BR":
      return "Confirmar";
    default:
      return "Confirm";
  }
});

const defaultCancelText = computed(() => {
  switch (locale.value) {
    case "ja":
      return "キャンセル";
    case "ko":
      return "취소";
    case "zh":
      return "取消";
    case "es":
      return "Cancelar";
    case "de":
      return "Abbrechen";
    case "fr":
      return "Annuler";
    case "pt-BR":
      return "Cancelar";
    default:
      return "Cancel";
  }
});

function onKeyDown(event: KeyboardEvent): void {
  if (!confirmState.value.isOpen) return;

  if (event.key === "Escape") {
    event.preventDefault();
    handleConfirm(false);
    return;
  }

  if (event.key === "Enter") {
    const active = document.activeElement;
    if (active === cancelBtn.value) {
      handleConfirm(false);
    } else if (active !== confirmBtn.value) {
      event.preventDefault();
      handleConfirm(true);
    }
    return;
  }

  if (event.key === "Tab") {
    const active = document.activeElement;
    if (event.shiftKey && active !== confirmBtn.value) {
      event.preventDefault();
      confirmBtn.value?.focus();
    } else if (!event.shiftKey && active !== cancelBtn.value) {
      event.preventDefault();
      cancelBtn.value?.focus();
    }
  }
}

watch(
  () => confirmState.value.isOpen,
  (open) => {
    if (open) {
      window.addEventListener("keydown", onKeyDown);
      nextTick(() => {
        confirmBtn.value?.focus();
      });
    } else {
      window.removeEventListener("keydown", onKeyDown);
    }
  },
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
});

function onOverlayClick(): void {
  handleConfirm(false);
}
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.confirm-card {
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.05),
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  border-radius: 1.25rem;
  width: 100%;
  max-width: 420px;
  padding: 1.5rem;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-sizing: border-box;
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.confirm-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.confirm-icon-wrapper .icon {
  font-size: 1.25rem;
}

.confirm-icon-wrapper.primary {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.2);
  color: #2563eb;
}

.confirm-icon-wrapper.success {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.2);
  color: #047857;
}

.confirm-icon-wrapper.danger {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #b91c1c;
}

.confirm-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.confirm-body {
  font-size: 0.9375rem;
  line-height: 1.5;
  color: #475569;
  margin: 0;
  word-break: break-word;
}

.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.btn-cancel,
.btn-confirm {
  padding: 0.625rem 1.25rem;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  border: none;
  outline: none;
}

.btn-cancel {
  background: rgba(241, 245, 249, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.8);
  color: #475569;
}

.btn-cancel:hover {
  background: #e2e8f0;
  color: #1e293b;
  transform: translateY(-1px);
}

.btn-cancel:focus-visible {
  box-shadow: 0 0 0 2px rgba(148, 163, 184, 0.5);
}

.btn-confirm {
  color: #ffffff;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.btn-confirm.primary {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
}

.btn-confirm.primary:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px -1px rgba(59, 130, 246, 0.3);
}

.btn-confirm.primary:focus-visible {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
}

.btn-confirm.success {
  background: linear-gradient(135deg, #10b981 0%, #047857 100%);
}

.btn-confirm.success:hover {
  background: linear-gradient(135deg, #059669 0%, #065f46 100%);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px -1px rgba(16, 185, 129, 0.3);
}

.btn-confirm.success:focus-visible {
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.5);
}

.btn-confirm.danger {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
}

.btn-confirm.danger:hover {
  background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px -1px rgba(239, 68, 68, 0.3);
}

.btn-confirm.danger:focus-visible {
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.5);
}

.btn-cancel:active,
.btn-confirm:active {
  transform: translateY(0);
}

.confirm-modal-enter-active,
.confirm-modal-leave-active {
  transition: opacity 0.25s ease;
}

.confirm-modal-enter-from,
.confirm-modal-leave-to {
  opacity: 0;
}

.confirm-modal-enter-active .confirm-card {
  transition:
    transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease;
}

.confirm-modal-leave-active .confirm-card {
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.2s ease;
}

.confirm-modal-enter-from .confirm-card {
  transform: scale(0.9) translateY(8px);
  opacity: 0;
}

.confirm-modal-leave-to .confirm-card {
  transform: scale(0.95) translateY(4px);
  opacity: 0;
}
</style>
