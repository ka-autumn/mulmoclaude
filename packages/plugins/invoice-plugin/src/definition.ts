export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageInvoice" as const,
  prompt:
    "When users ask to create, draft, list, pay, void, or view invoices and billing candidates, use manageInvoice. Always use this tool for invoicing operations.",
  description:
    "Manage client invoices — create draft invoice candidates, view billing details, list committed/pending invoices, mark paid, void incorrect entries, or open the Invoicing Review Board.",
  parameters: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["createCandidate", "list", "invoiceMarkPaid", "invoiceVoid", "present", "getSettings", "saveSettings"],
        description: "The invoicing action to perform.",
      },
      id: {
        type: "string",
        description: "For 'invoiceMarkPaid' or 'invoiceVoid': The unique invoice ID.",
      },
      clientId: {
        type: "string",
        description: "The client identifier slug (e.g. 'acme'). Required for 'createCandidate'.",
      },
      date: {
        type: "string",
        description: "Issue date in YYYY-MM-DD format. Required for 'createCandidate'.",
      },
      dueDate: {
        type: "string",
        description: "Payment due date in YYYY-MM-DD format. Required for 'createCandidate'.",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "Item description/notes." },
            quantity: { type: "number", description: "Quantity of units. Default is 1." },
            rate: { type: "number", description: "Unit rate." },
            amount: { type: "number", description: "Line item total amount (quantity * rate)." },
          },
          required: ["description", "rate", "amount"],
        },
        description: "Detailed line items for 'createCandidate'.",
      },
      notes: {
        type: "string",
        description:
          "Print-ready beautiful Markdown invoice layout. Write the Japanese/English professional invoice document using the 有限会社パーベイシブ template.",
      },
      paymentRef: {
        type: "string",
        description: "For 'invoiceMarkPaid': Transaction ID or reference note (e.g. 'Bank Transfer 12345').",
      },
      voidReason: {
        type: "string",
        description: "For 'invoiceVoid': Explanation for voiding the invoice.",
      },
      settings: {
        type: "object",
        properties: {
          companyName: { type: "string" },
          taxRegistrationId: { type: "string" },
          postalCode: { type: "string" },
          address: { type: "string" },
          email: { type: "string" },
          bankName: { type: "string" },
          bankBranch: { type: "string" },
          bankAccountType: { type: "string" },
          bankAccountNumber: { type: "string" },
          bankAccountHolder: { type: "string" },
          bookId: { type: "string" },
        },
        description: "Issuer configuration settings to save.",
      },
    },
    required: ["action"],
  },
};
