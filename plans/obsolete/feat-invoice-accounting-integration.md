# Plan: Solopreneur Invoice Plugin with AI-Native Bookkeeping Coordination

This plan describes the implementation of the `@mulmoclaude/invoice-plugin` completely from scratch, utilizing **AI-Native Bookkeeping Coordination** to achieve strict decoupling (疎結合), complete sandboxed safety, and premium solopreneur UI layouts.

---

## 1. Requirements & Scope

### Standalone Invoice Management
- Standard CRUD-like commands for billing candidates and committed invoices.
- Dual-panel UI dashboard showing candidates next to committed invoices.
- Dynamic settings page for setting issuer details (Company Name, T-number, Address, Email, Bank Details) and target ledger book configurations (`bookId`, `bookName`).

### Loose Decoupling (疎結合)
- Avoids direct backend-to-backend plugin communications entirely.
- The invoice plugin remains 100% sandboxed inside its own data directory.
- No direct dynamic module imports (`importServerModule`) or custom server-side dynamic lookups are used, ensuring clean sandboxed safety.
- Restores a pristine, standard Vite bundler configuration (no Node built-ins as `external`).

### AI-Native Bookkeeping Coordination
- Rather than having the backend write directly to the accounting ledger, the frontend View uses the host-provided **`sendTextMessage`** callback to request the **AI Accountant (LLM running in the `"accounting"` role)** to post the entries.
- **Trigger Points**:
  - **Approval**: Upon successful local invoice candidate approval, the View sends a message to the active chat instructing the LLM to Debit A/R (`1100`) and Credit Revenue (`4000`) / Sales Tax Payable (`2400`) in the chosen ledger book.
  - **Payment**: Upon marking an invoice paid, the View sends a message instructing the LLM to Debit Checking/Cash (`1010`/`1000`) and Credit A/R (`1100`).
  - **Void**: Upon voiding an invoice, the View sends a message instructing the LLM to scan and void matching entries.
- The active AI Accountant receives the message and executes the actual accounting write using its standard `manageAccounting` tool dispatches (`addEntries` / `voidEntry`).

### AI Invoice Layout Generation
- Clicking "Generate Layout (AI)" dispatches `startPrintableGenerationChat` on the backend.
- Spawns a new chat in the `"accounting"` role via the host's `runtime.chat.start` runtime API.
- Seeds the chat with a precise prompt containing the invoice items, totals, and dynamic issuer settings, instructing the LLM to output a beautiful Japanese/English print-ready invoice based on the 有限会社パーベイシブ template design and save it directly to `artifacts/invoices/<invoice-id>.md`.
- Redirects the user to the resulting `/chat/<chatId>`.

---

## 2. File Deliverables

### Backend Plugin Infrastructure
- **[MODIFY] [types.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/types.ts)**: Incorporates `InvoiceSettingsSchema` (Zod) including `bookId` and `bookName`, and exports type `InvoiceSettings`.
- **[MODIFY] [io.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/io.ts)**: Implements Zod-validated configuration loading and saving (`loadSettings`, `saveSettings`) to write issuer data to `settings.json`. Completely sandboxed (no dynamic registry imports).
- **[MODIFY] [index.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/index.ts)**: Entry point for `definePlugin` orchestrating `manageInvoice` dispatches. Standard sandboxed file operations.
- **[NEW] [handlers/llm.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/handlers/llm.ts)**: Specialized LLM-callable handlers to create candidates or query data.
- **[MODIFY] [definition.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/definition.ts)**: Tool descriptor for `manageInvoice` including settings configuration actions and notes prompt.

### Role Permissions & Registry
- **[MODIFY] [toolNames.ts](file:///Users/satoshi/git/ai/mulmoclaude/src/config/toolNames.ts)**: Registers `manageInvoice: "manageInvoice"`.
- **[MODIFY] [roles.ts](file:///Users/satoshi/git/ai/mulmoclaude/src/config/roles.ts)**: Grants access to `manageWorklog`, `manageClient`, and `manageInvoice` in the `accounting` role.
- **[MODIFY] [preset-list.ts](file:///Users/satoshi/git/ai/mulmoclaude/server/plugins/preset-list.ts)**: Registers `@mulmoclaude/invoice-plugin` in the runtime engine preset list.

### Premium Frontend UI Component
- **[NEW] [View.vue](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/View.vue)**: HSL-tuned premium glassmorphic Solopreneur Invoicing board with Candidate vs Committed lists.
  - Receives `sendTextMessage` callback as a prop.
  - Features a target ledger selector dropdown under Settings.
  - Programmatically calls `sendTextMessage` upon successful candidate approvals, bank payments, or invoice void actions to request ledger writes via the AI Accountant.
- **[NEW] [vue.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/vue.ts)**: Frontend plugin binder exporting `View.vue` and custom menus.
- **[NEW] [shared.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/shared.ts)**: Shared utilities (constants or helpers).
- **[NEW] [shims-vue.d.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/shims-vue.d.ts)**: Vue shim definitions.

---

## 3. Verification & Launch Plan

1. Rebuild and verify standard, sandboxed Vue and backend JS bundles.
2. Confirm strict type-safety across the workspace.
3. Validate AI-native message dispatches end-to-end.
