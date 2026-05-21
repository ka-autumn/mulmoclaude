// Tool schema for the worklog plugin.
// Matches the gui-chat-protocol specification.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageWorklog" as const,
  prompt: "When users mention tracking their time, logging work, or viewing their work summaries, use manageWorklog.",
  description: "Manage worklog entries — log hours manually (create candidate), approve candidates, list committed logs, edit logs, or delete logs.",
  parameters: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "approve", "list", "edit", "delete", "present"],
        description: "The action to perform on the worklog database.",
      },
      clientId: {
        type: "string",
        description: "The client identifier (e.g. 'acme', 'globex'). Required for 'create', optional for 'list'.",
      },
      projectId: {
        type: "string",
        description: "Optional project identifier or sub-project slash-separated (e.g. 'acme/site-redesign').",
      },
      startTime: {
        type: "string",
        description: "For 'create' or 'edit': Start date/time in ISO 8601 string format (e.g. '2026-05-20T09:00:00-07:00').",
      },
      endTime: {
        type: "string",
        description: "For 'create' or 'edit': End date/time in ISO 8601 string format (e.g. '2026-05-20T11:00:00-07:00').",
      },
      notes: {
        type: "string",
        description: "Optional description of what work was completed.",
      },
      billable: {
        type: "boolean",
        description: "Whether the logged hours are billable. Default is true.",
      },
      candidateId: {
        type: "string",
        description: "For 'approve': The unique candidate file ID or entry ID to approve.",
      },
      worklogId: {
        type: "string",
        description: "For 'edit' or 'delete': The unique committed worklog entry ID.",
      },
      range: {
        type: "object",
        properties: {
          from: { type: "string", description: "ISO 8601 start date (e.g., '2026-05-18')" },
          to: { type: "string", description: "ISO 8601 end date (e.g., '2026-05-24')" },
        },
        description: "Optional date range for 'list'.",
      },
    },
    required: ["action"],
  },
};
