// Promise-based confirm dialog state, host-side mirror of
// `packages/plugins/shared/components/confirm.ts`. The two have
// identical interfaces but separate module-scoped state — they
// can't be merged into one file today because the plugin-side
// ConfirmModal pulls locale from `useRuntime` (only valid inside
// PluginScopedRoot) while the host-side one uses vue-i18n. Unify
// when the host/plugin runtime split is reconciled.

import { ref } from "vue";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "success" | "danger";
}

export interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: "primary" | "success" | "danger";
  resolve: ((value: boolean) => void) | null;
}

export const confirmState = ref<ConfirmState>({
  isOpen: false,
  title: "",
  message: "",
  confirmText: "",
  cancelText: "",
  variant: "primary",
  resolve: null,
});

export function useConfirm() {
  function openConfirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts = typeof options === "string" ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      confirmState.value = {
        isOpen: true,
        title: opts.title || "",
        message: opts.message,
        confirmText: opts.confirmText || "",
        cancelText: opts.cancelText || "",
        variant: opts.variant || "primary",
        resolve,
      };
    });
  }

  function handleConfirm(value: boolean): void {
    if (confirmState.value.resolve) {
      confirmState.value.resolve(value);
    }
    confirmState.value.isOpen = false;
    confirmState.value.resolve = null;
  }

  return { confirmState, openConfirm, handleConfirm };
}
