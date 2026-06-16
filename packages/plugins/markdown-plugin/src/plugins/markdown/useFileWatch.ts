// Per-file change subscription over the host-agnostic runtime pubsub
// (task #6). The package replacement for MulmoClaude's `useFileChange`:
// it subscribes to the plugin-scoped `file:<path>` channel (resolves to
// `plugin:<pkg>:file:<path>`) and bumps a monotonic `version` ref on
// each `{ mtimeMs }` event. The host forwards its workspace file-change
// events onto that channel; if it doesn't, live-refresh simply never
// fires (self-saves already update local state optimistically).

import { ref, watch, onUnmounted, type Ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";

interface FileChangePayload {
  mtimeMs?: number;
}

export function useFileWatch(filePath: Ref<string | null>): { version: Ref<number> } {
  const version = ref(0);
  const { pubsub } = useRuntime();
  let unsubscribe: (() => void) | null = null;

  function bind(nextPath: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    version.value = 0;
    if (!nextPath) return;
    unsubscribe = pubsub.subscribe<FileChangePayload>(`file:${nextPath}`, (data) => {
      if (typeof data?.mtimeMs === "number" && data.mtimeMs > version.value) {
        version.value = data.mtimeMs;
      }
    });
  }

  watch(filePath, bind, { immediate: true });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { version };
}
