import { z } from "zod";

// Contact Schema
export const ContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address").or(z.string().length(0)),
  role: z.string().optional().default(""),
});

export type Contact = z.infer<typeof ContactSchema>;

// Rate Schema
export const RateSchema = z.object({
  amount: z.number().nonnegative("Amount must be positive"),
  currency: z.string().default("USD"),
  unit: z.string().default("hour"), // hour, fixed, month, etc.
});

export type Rate = z.infer<typeof RateSchema>;

// Client Schema
export const ClientSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "ID must be a lowercase URL slug (alphanumeric and hyphens only)"),
  name: z.string().min(1, "Client name is required"),
  status: z.enum(["active", "paused", "archived"]).default("active"),
  contacts: z.array(ContactSchema).default([]),
  rate: RateSchema.default({ amount: 0, currency: "USD", unit: "hour" }),
  paymentTerms: z.string().default("net-30"),
  tags: z.array(z.string()).default([]),
  firstEngagement: z.string().default(() => new Date().toISOString().split("T")[0]),
  notes: z.string().default(""),
});

export type Client = z.infer<typeof ClientSchema>;

// Project Schema
export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "ID must be a lowercase URL slug (alphanumeric and hyphens only)"),
  clientId: z.string().min(1, "Client ID is required"),
  name: z.string().min(1, "Project name is required"),
  status: z.enum(["active", "paused", "archived"]).default("active"),
  feeModel: z.enum(["hour", "fixed", "retainer"]).default("hour"),
  rate: RateSchema.optional(),
  startDate: z.string().default(() => new Date().toISOString().split("T")[0]),
  expectedDeliverables: z.string().default(""),
  notes: z.string().default(""),
});

export type Project = z.infer<typeof ProjectSchema>;

// Candidate wrapper schema for "AI-on-a-leash" approvals
export interface ClientCandidate {
  candidateId: string;
  type: "client";
  data: Client;
  createdAt: number;
}

export interface ProjectCandidate {
  candidateId: string;
  type: "project";
  data: Project;
  createdAt: number;
}

import type { ToolResultComplete } from "gui-chat-protocol";

export interface ExtendedToolResultComplete extends ToolResultComplete<any> {
  args?: {
    action?: string;
    [key: string]: any;
  };
}
