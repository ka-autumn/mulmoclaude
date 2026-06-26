// Public entry for `@mulmoclaude/accounting-plugin/server` — the
// workspace-file-backed backend, wired via dependency injection so it
// pulls zero host-only infra (no logger / pub-sub / workspace-paths
// imports; the host supplies them). Imported by the host's server
// bootstrap and by MulmoTerminal.
//
// Wiring contract (host, once at startup, before serving):
//   configureAccountingServer({ workspaceRoot, logger });
//   initAccountingEventPublisher(pubsub);
//   app.use(createAccountingRouter());

export { createAccountingRouter } from "./router.js";
export { configureAccountingServer } from "./context.js";
export type { AccountingServerDeps, AccountingLogger, IPubSub } from "./context.js";
export { initAccountingEventPublisher } from "./eventPublisher.js";

// Pure date-validation helper reused by host e2e mock fixtures so the
// mock dispatcher rejects the same malformed dates the real service does.
export { isValidCalendarDate } from "./journal.js";
