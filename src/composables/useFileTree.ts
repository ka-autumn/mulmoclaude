// Composable: workspace file tree state + lazy loading.
// Extracted from FilesView.vue (#507 step 1).

import { ref } from "vue";
import type { TreeNode } from "../types/fileTree";
import { useExpandedDirs } from "./useExpandedDirs";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export function useFileTree() {
  const { expand } = useExpandedDirs();

  const rootNode = ref<TreeNode | null>(null);
  const refRoots = ref<TreeNode[]>([]);
  const childrenByPath = ref<Map<string, TreeNode[] | null>>(new Map());
  const treeError = ref<string | null>(null);

  // Root-level generation counter — incremented on reloadRoot so
  // in-flight requests from a prior generation don't write stale data.
  let generation = 0;

  // Per-folder generation counter — incremented every time the cache
  // entry for that folder is invalidated (cold start or reloadDir-
  // Children). A response that returns after the entry has been
  // re-invalidated is from a stale earlier request and must NOT be
  // applied, or it would overwrite the fresh children list. Closes
  // the race CodeRabbit flagged on #1608.
  const folderGeneration = new Map<string, number>();

  function bumpFolderGen(path: string): number {
    const next = (folderGeneration.get(path) ?? 0) + 1;
    folderGeneration.set(path, next);
    return next;
  }

  async function loadDirChildren(path: string): Promise<void> {
    if (childrenByPath.value.has(path)) return;

    const gen = generation;
    const folderGen = bumpFolderGen(path);
    const next = new Map(childrenByPath.value);
    next.set(path, null);
    childrenByPath.value = next;

    const result = await apiGet<TreeNode>(API_ROUTES.files.dir, { path });
    // Bail if reloadRoot was called while we were awaiting, or if
    // this folder was re-invalidated (reloadDirChildren) since we
    // started — a fresher request superseded us.
    if (gen !== generation) return;
    if (folderGeneration.get(path) !== folderGen) return;
    if (!result.ok) {
      const rollback = new Map(childrenByPath.value);
      rollback.delete(path);
      childrenByPath.value = rollback;
      treeError.value = result.error || `dir: ${result.status}`;
      return;
    }
    const node = result.data;
    const updated = new Map(childrenByPath.value);
    updated.set(path, node.children ?? []);
    childrenByPath.value = updated;
    if (path === "") rootNode.value = { ...node, children: [] };
  }

  async function ensureAncestorsLoaded(filePath: string): Promise<void> {
    const parts = filePath.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      ancestors.push(parts.slice(0, i).join("/"));
    }
    for (const dir of ancestors) {
      expand(dir);
      await loadDirChildren(dir);
    }
  }

  async function reloadRoot(): Promise<void> {
    generation++;
    rootNode.value = null;
    childrenByPath.value = new Map();
    treeError.value = null;
    await loadDirChildren("");
  }

  async function loadRefRoots(): Promise<void> {
    const result = await apiGet<TreeNode[]>(API_ROUTES.files.refRoots);
    if (result.ok && Array.isArray(result.data)) {
      refRoots.value = result.data;
    }
  }

  /** Drop a single folder's children from the cache and re-fetch.
   *  Used after a file-create / -delete from the same View so the
   *  user sees the change land without a full root reload. Bumps the
   *  per-folder generation so any in-flight request for the same
   *  path is discarded when it lands. */
  async function reloadDirChildren(path: string): Promise<void> {
    bumpFolderGen(path);
    const next = new Map(childrenByPath.value);
    next.delete(path);
    childrenByPath.value = next;
    await loadDirChildren(path);
  }

  return {
    rootNode,
    refRoots,
    childrenByPath,
    treeError,
    loadDirChildren,
    ensureAncestorsLoaded,
    reloadRoot,
    reloadDirChildren,
    loadRefRoots,
  };
}
