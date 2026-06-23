# Shared Utilities Catalog

> **Before writing a new helper, check this list.** If a similar helper already exists, use it. When you add a new shared helper (a cross-cutting formatter, error normaliser, path joiner, etc.) append a 1-line entry here in the same PR.

Skipping this step is how `truncate()` ended up with 6 implementations, `formatBytes()` with 2 + an inline copy, and the `err instanceof Error ? err.message : String(err)` pattern with 30+ inline copies. The catalog is the prevention mechanism. (Tracking: #1304.)

This catalog only covers **cross-cutting** helpers — formatters, error helpers, network wrappers, path joiners, shared regex. One plugin's parser or one route's validator stays inside that plugin / route; it doesn't belong here.

---

## Time / Dates

| Path                       | Helper                                                                                                                                                    | When to use                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `server/utils/time.ts`     | `ONE_SECOND_MS`, `ONE_MINUTE_MS`, `ONE_HOUR_MS`, `ONE_DAY_MS`                                                                                             | Anywhere a duration in milliseconds shows up. Never raw literals like `60_000`.                               |
| `server/utils/time.ts`     | `SUBPROCESS_PROBE_TIMEOUT_MS`, `SUBPROCESS_WORK_TIMEOUT_MS`, `CLI_SUBPROCESS_TIMEOUT_MS`, `STARTUP_FAILURE_FORCE_EXIT_MS`, `DEV_PLUGIN_WATCH_DEBOUNCE_MS` | Named timeout presets for subprocess / CLI / startup paths. Add a new constant rather than passing a literal. |
| `src/utils/format/date.ts` | `formatDate`, `formatDateTime`, `formatTime`, `formatShortDate`, `formatShortTime`, `formatMonthYear`, `formatSmartTime`, `formatRelativeTime`            | User-facing date display in Vue Views. Prefer over inline `toLocaleString()`.                                 |
| `src/utils/format/date.ts` | `isSameDay`, `isToday`                                                                                                                                    | Day-boundary comparisons.                                                                                     |

## Errors

| Path                                 | Helper                                                | When to use                                                                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/utils/errors.ts`             | `errorMessage(err, fallback?)`                        | Inside any `catch (err)` block, instead of inlining `err instanceof Error ? err.message : String(err)`. Also handles gRPC-style `{ details }` and plain `{ message }` objects (which would otherwise print as `[object Object]`). |
| `src/utils/errors.ts`                | `errorMessage(err, fallback?)`                        | Frontend mirror of the server-side helper. Inside a Vue `<script setup>` where `errorMessage` is already a ref name, import as `import { errorMessage as toErrorMessage } from "../../utils/errors"` to avoid the shadow.         |
| `server/utils/asyncHandler.ts`       | `asyncHandler(namespace, fallbackMessage, handler)`   | Wrap every async Express route handler. Logs the raw error server-side, sends a sanitized 500 to the client. Never let an unhandled throw escape a route.                                                                         |
| `server/utils/httpError.ts`          | `serverError(res, msg)`, `badRequest(res, msg)`, etc. | HTTP error responses with consistent shape.                                                                                                                                                                                       |
| `server/utils/logBackgroundError.ts` | `logBackgroundError(namespace, msg, err)`             | Fire-and-forget background tasks where the caller can't await. Logs with the right namespace and stack.                                                                                                                           |

## Network

| Path                      | Helper                                                                           | When to use                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/api.ts`        | `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `apiCall`, `apiFetchRaw` | Frontend → server calls. Auto-attaches bearer token. Returns `ApiResult<T>` discriminated union. **Never** raw `fetch()` to the local server from Vue code. |
| `src/utils/api.ts`        | `setAuthToken(token)`                                                            | Once at boot to wire the bearer token.                                                                                                                      |
| `server/utils/fetch.ts`   | `fetchWithTimeout(url, opts)`                                                    | Server → external host. Bundles `AbortController` + `response.ok` checks.                                                                                   |
| `server/utils/request.ts` | request-side helpers                                                             | Express request parsing / typed body extraction.                                                                                                            |

## Files / Paths

| Path                                     | Helper                                                                                                              | When to use                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/workspace/paths.ts`              | `WORKSPACE_PATHS`, `WORKSPACE_DIRS`, `WORKSPACE_FILES`                                                              | All workspace path joins. Plugin contributions auto-merge from each `meta.ts`. Never hardcode `~/mulmoclaude/...`.                                                                       |
| `server/utils/files/atomic.ts`           | `writeFileAtomic(path, content, opts?)`                                                                             | All file writes from the server. Writes through a temp file alongside the target, then renames. Tmp lives next to destination (NOT `os.tmpdir()`) — required for cross-volume atomicity. |
| `server/utils/files/json.ts`             | `readJson`, `writeJsonAtomic`, `writeJsonAtomicSync`                                                                | JSON read/write with validation hooks. Use over `JSON.parse(fs.readFileSync(...))`.                                                                                                      |
| `server/utils/files/<domain>-io.ts`      | per-domain accessors                                                                                                | Domain-specific read/write modules (e.g. `accounting-io.ts`, `journal-io.ts`). Never raw `fs.writeFile` in route handlers — find or add a `<domain>-io.ts` instead.                      |
| `server/utils/files/attachment-store.ts` | `saveAttachment`, `loadAttachmentBytes`, `extensionForMime`, `inferMimeFromExtension`, `registerSaveAttachmentHook` | Attachment I/O + MIME ↔ extension mapping. Never re-implement the mime/ext table.                                                                                                        |
| `server/utils/files/svg-store.ts`        | svg-specific helpers                                                                                                | SVG asset I/O.                                                                                                                                                                           |
| `server/utils/files/markdown-store.ts`   | markdown-specific helpers                                                                                           | Markdown file I/O.                                                                                                                                                                       |
| `server/utils/files/safe.ts`             | `resolveWithinRoot`, `resolveWriteWithinRoot`                                                                       | Read-time / write-time path confinement to a workspace root. Read variant requires the leaf to exist; write variant mkdir-p's the parent inside root.                                    |
| `server/utils/files/safe.ts`             | `containsDotfileSegment(relPath)`, `hasTraversalSegment(value)`                                                     | Segment-split policy checks. `containsDotfileSegment` flags ANY `.`-prefixed segment (`.git`, `.hidden`, plus `.`/`..`) — `dotfiles: deny` parity. `hasTraversalSegment` flags ONLY `.`/`..` (dotfiles allowed). Both split on `/` AND `\` for Windows decode safety. |
| `server/utils/files/store-resolvers.ts`  | `makeStoreResolvers(getRoot, dirPrefix)`                                                                            | Factory for per-store path resolvers with `forRead` / `forWrite` methods. Replaces the per-store `safeResolve` wrappers. Caches realpath of root per workspace.                          |

## Strings / Text

| Path                        | Helper                           | When to use                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/utils/text.ts`      | `truncate(text, max, ellipsis?)` | Clip a string to at most `max` chars, ellipsis included in the budget so output never exceeds `max`. Default ellipsis is `…`. Empty string for `max <= 0`. Distinct from `truncateMiddle` in `chat-index/summarizer.ts` which preserves both ends.                                                                                                            |
| `src/utils/format/bytes.ts` | `formatBytes(bytes, opts?)`      | Human-readable file / attachment sizes (B / KB / MB / GB, 1024-based, default 1 decimal). Returns `"—"` for negative or non-finite input.                                                                                                                                                                                                                     |
| `server/utils/slug.ts`      | slug helpers                     | URL-safe slugs from arbitrary text.                                                                                                                                                                                                                                                                                                                           |
| `src/lib/wiki-page/slug.ts` | wiki page slug helpers           | Wiki-specific slug shape (separate from the server one because the rules differ).                                                                                                                                                                                                                                                                             |
| `server/utils/id.ts`        | id generation                    | Stable IDs (attachment, session).                                                                                                                                                                                                                                                                                                                             |
| `src/utils/promptSafety.ts` | `defangForPrompt(value)`         | Neutralize record-controlled text before interpolating it into an LLM-facing prompt: strips `<>`, defangs backticks / `${`, collapses whitespace (blocks newline-injected pseudo-instructions), clips to 200 chars. Used by BOTH the server (`presentCollection` validation → instructions) and the client (collection Repair button) so the two can't drift. |

## Regex

| Path                    | Helper                                                                                           | When to use                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `server/utils/regex.ts` | `SLUG_PATTERN`, `BULLET_LINK_PATTERN`, `BULLET_WIKI_LINK_PATTERN`, `LEADING_BLANK_LINES_PATTERN` | Shared regex constants. Add new shared patterns here rather than scattering literals across files. |

## Markdown

| Path                                      | Helper                                                                           | When to use                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/markdown/wikiEmbeds.ts`        | `registerWikiEmbed`, `wikiEmbedExtension`, `escapeHtml`, `listWikiEmbedPrefixes` | Marked extension + handler registry for `[[<prefix>:<id>]]` embeds. Register new prefixes via `registerWikiEmbed`; the host installs the extension once. |
| `src/utils/markdown/wikiEmbedHandlers.ts` | `registerAmazonEmbed`, `registerIsbnEmbed`, `registerBuiltInWikiEmbeds`          | Built-in handlers for `[[amazon:<asin>]]` / `[[isbn:<isbn>]]`.                                                                                           |
| `src/utils/markdown/setup.ts`             | `setupMarked()`                                                                  | Idempotent marked initialisation — call once before mounting the Vue app.                                                                                |
| `src/utils/markdown/sanitize.ts`          | `sanitizeMarkdownHtml(html)`                                                     | DOMPurify wrapper for marked output before `v-html`.                                                                                                     |
| `server/utils/markdown.ts`                | server-side helpers                                                              | Server-side markdown utilities (not for Vue).                                                                                                            |
| `src/utils/dom/externalLink.ts`           | `handleExternalLinkClick(event)`                                                 | Single source of truth for v-html link delegation. Every `v-html` consumer routes external links through this so OS-vs-in-app navigation is consistent.  |

## Collections

| Path                                 | Helper                                                          | When to use                                                                                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/collections/deriveAll.ts` | `deriveAll(schema, record, refRecords)` / `resolveRowRefs(...)` | Evaluate every `derived` field on a collection record (saturating, cycle-safe, ref-deref via a preloaded target cache). The ONE derive implementation — used by the client rendering layer and the server's `manageCollection` enrichment; never reimplement the loop. |

## Plugin Infrastructure

> The plugin META aggregator pattern is the canonical way to extend host barrels (api routes, tool names, workspace dirs, pub-sub channels). **Edit the plugin's `meta.ts`, not the host barrel.**

| Path                           | Helper                                                                        | When to use                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugins/<name>/meta.ts`   | `definePluginMeta({ toolName, apiRoutes?, workspaceDirs?, staticChannels? })` | Plugin's identity declaration. Merged into host barrels at module load.                                                         |
| `src/plugins/metas.ts`         | `defineHostAggregate`                                                         | Internal: merges plugin META contributions into the host record. First-write-wins; collisions surface as boot-time diagnostics. |
| `src/config/apiRoutes.ts`      | `API_ROUTES`                                                                  | Host-fixed entries + plugin contributions auto-merged from each `META.apiRoutes`.                                               |
| `src/config/toolNames.ts`      | `TOOL_NAMES`                                                                  | Host-fixed entries + plugin `META.toolName` auto-merged.                                                                        |
| `src/config/pubsubChannels.ts` | `PUBSUB_CHANNELS`                                                             | Host-fixed entries + plugin `META.staticChannels` auto-merged.                                                                  |
| `gui-chat-protocol/vue`        | `useRuntime()`                                                                | Inside a plugin's Vue component, the typed `endpoints` map.                                                                     |
| `src/plugins/api.ts`           | `pluginEndpoints<E>(scope)`                                                   | Inside a plugin's executor, the typed endpoints.                                                                                |

## Logging

| Path                            | Helper                                                  | When to use                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/system/logger/index.ts` | `log.{error, warn, info, debug}(namespace, msg, data?)` | All server-side logging. **Never** `console.*` directly. The first arg is a short namespace string (`"accounting"`, `"wiki"`, …) matching the existing convention so log filtering works. |

## i18n

| Path                  | Helper                                  | When to use                                                                                                                                          |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/vue-i18n.ts` | `createI18n` setup, `SUPPORTED_LOCALES` | i18n bootstrap. Keep all 8 locales (`src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts`) in lockstep when adding keys — type-checked via `typeof enMessages`. |
| (Vue)                 | `$t()` / `useI18n().t`                  | All user-facing UI strings. Never hardcode in templates.                                                                                             |

## UI Composables / Patterns

| Path                                   | Helper                                                        | When to use                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/composables/useContentDisplay.ts` | `useContentDisplay()`                                         | Shared "show one of: loading / error / empty / data" state machine for plugin Views.                                                                                                  |
| `src/utils/dom/iframeHeightClamp.ts`   | `iframeHeightClamp(...)`                                      | iframe height autosize logic (used by html / spreadsheet preview surfaces).                                                                                                           |
| `src/utils/html/previewCsp.ts`         | `buildHtmlPreviewCsp(origin?)` / `buildCustomViewCsp(origin)` | CSP for sandboxed LLM-HTML iframes. Preview variant blocks all `connect-src`; custom-view variant allows `connect-src <origin>` (the view fetches its own data endpoint).             |
| `src/utils/html/customViewSrcdoc.ts`   | `buildCustomViewSrcdoc(html, {slug, token, dataUrl, origin})` | Build the sandboxed-iframe `srcdoc` for a collection custom view: injects the CSP meta + the `window.__MC_VIEW` bootstrap (scoped token + data URL + the `onChange(cb)` live-refresh helper) at the start of `<head>`.         |
| `src/utils/confirmDelete.ts`           | `confirmItemDelete(message)`                                  | "Are you sure?" gate before deleting a single item (todo card, calendar event, …). Single seam over `window.confirm` so the UI/wording can be swapped to a styled modal in one place. |

---

## Adding a new shared helper

1. **Search first.** Grep this catalog and the relevant directory for an existing helper. Reaching for a generic name (`truncate`, `format`, `parse`) often surfaces a near-match.
2. **If nothing fits, write the helper** in the appropriate location (`server/utils/...` for server, `src/utils/...` for frontend). Co-locate with similar helpers; don't make a new top-level file unless it's a new area.
3. **Add tests** under `test/` mirroring the source path.
4. **Append one line to this catalog** in the same PR, under the right area. The entry shape is `path` — `helper(signature)` — one-line "when to use".
5. **If your helper supersedes scattered call sites,** include the migration in the same PR when it's small (< ~5 sites) or open a follow-up refactor issue for larger sweeps.
