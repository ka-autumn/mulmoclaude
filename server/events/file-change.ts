// File-change publisher — thin host binding over
// @mulmoclaude/file-change-publisher. Every route that writes through
// the app calls `publishFileChange(relPath)` after a successful write so
// that subscribed UI tabs (and other browsers) refetch. The orchestration
// (stat → primary channel → plugin-scoped forwards → side-effect) lives in
// the shared package so MulmoTerminal forwards to the identical channels;
// this file only injects MulmoClaude's specifics.
//
// Channel name + payload shape still live in `src/config/pubsubChannels.ts`
// (`fileChannel`/`toPosixWorkspacePath`) so subscribers can't drift from the
// publisher; we hand those to the package as the primary channel + normaliser.

import type { IPubSub } from "./pub-sub/index.js";
import { configureFileChangePublisher, publishFileChange, resetFileChangePublisher } from "@mulmoclaude/file-change-publisher";
import { fileChannel, toPosixWorkspacePath } from "../../src/config/pubsubChannels.js";
import { isMarkdownPath } from "../utils/files/markdown-store.js";
import { isHtmlPath } from "../utils/files/html-store.js";
import { workspacePath } from "../workspace/workspace.js";
import { maybeRegenerateTopicIndex, TOPIC_INDEX_RELATIVE_PATH } from "../workspace/memory/topic-index-hook.js";
import { log } from "../system/logger/index.js";

export { publishFileChange };

export function initFileChangePublisher(instance: IPubSub): void {
  configureFileChangePublisher({
    publish: (channel, payload) => instance.publish(channel, payload),
    workspaceRoot: workspacePath,
    toPosix: toPosixWorkspacePath,
    primaryChannel: fileChannel,
    // The extracted markdown/html plugin Views subscribe via runtime.pubsub
    // ("file:<path>" → "plugin:<scope>:file:<path>"), so forwarding here gives
    // them the same any-source live-refresh the in-tree useFileChange had
    // (task #6). The package's `pluginFileChannel` produces the matching names.
    pluginScopes: [
      { scope: "markdown", matches: isMarkdownPath },
      { scope: "html", matches: isHtmlPath },
    ],
    // Side-effect: keep the topic-format MEMORY.md index in sync when a user
    // edits a topic file via the file explorer (#1032). No-op for non-topic
    // paths. When regen runs, re-publish the index file itself so a FilesView
    // tab pinned to MEMORY.md refreshes; the recursion is bounded because
    // `MEMORY.md` is excluded by `isTopicFilePath`.
    onPublished: (posixPath) => {
      maybeRegenerateTopicIndex(posixPath)
        .then((didRegen) => (didRegen ? publishFileChange(TOPIC_INDEX_RELATIVE_PATH) : undefined))
        .catch(() => {});
    },
    warn: (message, data) => log.warn("file-change", message, data),
  });
}

/** Test-only — clear the module singleton so each test starts clean. */
export function _resetFileChangePublisherForTesting(): void {
  resetFileChangePublisher();
}
