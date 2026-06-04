// Whitelist of folders where the File Explorer offers a "New file"
// right-click action (#1598). Each entry pins the extension that the
// new file MUST receive — the UI accepts only the slug portion, so a
// user typing `my-page.txt` in a `data/wiki/pages/` row still writes
// `my-page.md`. Folders not listed here render no context menu.
//
// **Why a fixed extension per folder**: every whitelisted folder has a
// downstream consumer that depends on the extension (the wiki snapshot
// hook fires on `.md` writes under `data/wiki/pages/`, the HTML
// preview matches on `.html`, etc.). Letting the user pick an arbitrary
// extension would write a file that no part of the host knows how to
// render.
//
// **Adding a folder**: append an entry below + add an i18n key under
// `fileTree.newFilePlaceholder.*` (all 8 locales). The folder path is
// a workspace-relative POSIX string matching `TreeNode.path` for the
// folder row that should expose the menu.

import { isSafeSlug } from "../lib/wiki-page/slug";

export interface CreateFilePolicy {
  /** Workspace-relative POSIX folder path. Matched verbatim against
   *  `TreeNode.path` for folder rows in `FileTree.vue`. */
  readonly folder: string;
  /** Required filename extension including the leading dot. The UI
   *  forces this — if the user types a slug ending in another
   *  extension, it gets stripped and this one is appended. */
  readonly extension: string;
  /** i18n key for the input placeholder ("e.g. `my-new-page`"). */
  readonly placeholderKey: string;
}

/** P1 whitelist (#1598). Conservative — covers the obvious markdown
 *  sinks plus presentHtml and presentMulmoScript artifact paths.
 *  Binary / generated dirs (images, spreadsheets, attachments) stay
 *  off the list because empty-text creation doesn't make sense there. */
export const CREATE_FILE_POLICIES: readonly CreateFilePolicy[] = [
  { folder: "data/wiki/pages", extension: ".md", placeholderKey: "fileTree.newFilePlaceholder.wikiPage" },
  { folder: "conversations/summaries", extension: ".md", placeholderKey: "fileTree.newFilePlaceholder.summary" },
  { folder: "artifacts/documents", extension: ".md", placeholderKey: "fileTree.newFilePlaceholder.document" },
  { folder: "artifacts/html", extension: ".html", placeholderKey: "fileTree.newFilePlaceholder.html" },
  { folder: "artifacts/stories", extension: ".json", placeholderKey: "fileTree.newFilePlaceholder.story" },
];

/** Look up the policy for a folder. Returns `null` when the folder
 *  isn't whitelisted — caller should suppress the context menu. */
export function policyForFolder(folderPath: string): CreateFilePolicy | null {
  return CREATE_FILE_POLICIES.find((entry) => entry.folder === folderPath) ?? null;
}

export type SlugValidation = { ok: true; filename: string } | { ok: false; reason: "empty" | "unsafe" };

/** Normalise a raw input into the final basename to write
 *  (slug + policy extension). Strips a trailing extension (whatever
 *  the user typed — the policy's extension wins) and trims
 *  whitespace. The `filename` field on the success case includes
 *  the policy extension — it's exactly the basename the caller
 *  should hand to the create endpoint.
 *
 *  Returns `{ ok: false }` for inputs that can't safely become a
 *  filename:
 *
 *  - empty after trim/strip
 *  - contains `/` `\` NUL (would escape the target folder)
 *  - `.` or `..` (special directory names)
 *
 *  Does NOT slugify (lowercase / dash-collapse) — non-ASCII slugs are
 *  allowed because the wiki tree already accepts them via existing
 *  callers. UI surfaces the rejection reason for the empty / unsafe
 *  branches; everything else is left to the user. */
export function normaliseNewFileSlug(raw: string, policy: CreateFilePolicy): SlugValidation {
  const trimmed = raw.trim();
  // Strip a trailing `.<ext>` regardless of position — policy.extension
  // is re-appended below, so anything the user typed as an extension
  // (including a leading-dot-only `.md` or `.env`) collapses to its
  // bare slug. Inputs that consist of nothing but `.<ext>` therefore
  // normalise to empty and get rejected as "empty" below.
  const stripped = trimmed.replace(/\.[a-z0-9]+$/i, "");
  if (stripped.length === 0) return { ok: false, reason: "empty" };
  if (!isSafeSlug(stripped)) return { ok: false, reason: "unsafe" };
  return { ok: true, filename: stripped + policy.extension };
}
