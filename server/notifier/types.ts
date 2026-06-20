// Notifier value types — now sourced from @mulmoclaude/notifier (shared
// with MulmoTerminal). Re-exported here so existing host imports
// (`../notifier/types.js`) keep working unchanged.
export {
  NOTIFIER_LIFECYCLES,
  NOTIFIER_SEVERITIES,
  HISTORY_CAP,
  type NotifierLifecycle,
  type NotifierSeverity,
  type NotifierEntry,
  type NotifierHistoryEntry,
  type PublishInput,
  type NotifierFile,
  type NotifierHistoryFile,
  type NotifierEvent,
} from "@mulmoclaude/notifier";
