// draft helpers moved into @mulmoclaude/collection-plugin (collection frontend
// extraction). Thin re-export bridge so the host Collection* components keep
// compiling until they move into the package too — removed with them.
export { emptyRow, rowFromItem, draftToRecord, coerceInlineValue, firstMissingRequiredField, buildUpdatedRecord } from "@mulmoclaude/collection-plugin";
