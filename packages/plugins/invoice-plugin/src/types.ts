import { z } from "zod";

export const InvoiceItemSchema = z.object({
  description: z.string(),
  quantity: z.number().default(1),
  rate: z.number(),
  amount: z.number(),
});

export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  date: z.string(), // YYYY-MM-DD
  dueDate: z.string(), // YYYY-MM-DD
  status: z.enum(["approved", "paid", "void"]).default("approved"),
  items: z.array(InvoiceItemSchema),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  notes: z.string().default(""),
  paymentRef: z.string().optional(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

export const InvoiceCandidateSchema = z.object({
  candidateId: z.string(),
  clientId: z.string(),
  date: z.string(), // YYYY-MM-DD
  dueDate: z.string(), // YYYY-MM-DD
  items: z.array(InvoiceItemSchema),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  notes: z.string().default(""),
  createdAt: z.number(),
});

export type InvoiceCandidate = z.infer<typeof InvoiceCandidateSchema>;

export interface ExtendedToolResultComplete {
  ok: boolean;
  message?: string;
  jsonData?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: string;
  status?: number;
  instructions?: string;
  args?: Record<string, unknown>;
}

export const InvoiceSettingsSchema = z.object({
  companyName: z.string().default(""),
  taxRegistrationId: z.string().default(""),
  postalCode: z.string().default(""),
  address: z.string().default(""),
  email: z.string().default(""),
  bankName: z.string().default(""),
  bankBranch: z.string().default(""),
  bankAccountType: z.string().default(""),
  bankAccountNumber: z.string().default(""),
  bankAccountHolder: z.string().default(""),
  bookId: z.string().default(""),
  bookName: z.string().default(""),
});

export type InvoiceSettings = z.infer<typeof InvoiceSettingsSchema>;
