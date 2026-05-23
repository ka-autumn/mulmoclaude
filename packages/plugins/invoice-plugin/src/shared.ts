// Cross-context entry — types + schemas that host components
// can import without dragging in the server's `definePlugin` factory
// or the runtime-loaded Vue components.

export { InvoiceItemSchema, InvoiceSchema, InvoiceCandidateSchema, InvoiceSettingsSchema } from "./types";
export type { InvoiceItem, Invoice, InvoiceCandidate, InvoiceSettings } from "./types";
