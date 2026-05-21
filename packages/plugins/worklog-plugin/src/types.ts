import { z } from "zod";

export const WorklogEntrySchema = z.object({
  id: z.string(),
  clientId: z.string(),
  projectId: z.string().optional(),
  startTime: z.string(), // ISO string with offset
  endTime: z.string(), // ISO string with offset
  duration: z.number().int().nonnegative(), // seconds
  billable: z.boolean().default(true),
  source: z.enum(["manual", "claude-session", "git", "document", "calendar"]).default("manual"),
  evidence: z.array(z.any()).default([]),
  notes: z.string().default(""),
  supersedes: z.string().nullable().default(null),
  deleted: z.boolean().default(false),
});

export type WorklogEntry = z.infer<typeof WorklogEntrySchema>;

export const CandidateEntrySchema = z.object({
  id: z.string(),
  clientId: z.string(),
  projectId: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  duration: z.number().int().nonnegative(),
  billable: z.boolean().default(true),
  notes: z.string().default(""),
  confidence: z.number().min(0).max(1).default(1.0),
  evidence: z.array(z.any()).default([]),
});

export type CandidateEntry = z.infer<typeof CandidateEntrySchema>;

import type { ToolResultComplete } from "gui-chat-protocol";

export interface ExtendedToolResultComplete extends ToolResultComplete<any> {
  args?: {
    action?: string;
    [key: string]: any;
  };
}
