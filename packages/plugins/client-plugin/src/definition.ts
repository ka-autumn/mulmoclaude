// Tool schema for the client plugin. Lives in its own module so both
// the server entry (`index.ts`) and any future browser entry can
// import it without dragging in handler code or its dependencies.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageClient" as const,
  prompt:
    "When users ask to add, list, show, or update clients and projects, use manageClient. Use 'present' when the user asks to show / open / display the client dashboard (the CRM UI); use 'list' when the user asks how many / which clients exist and wants a verbal summary. Always run 'show' for a single client to see details rather than listing.",
  description:
    "Manage client and project profiles — add new clients/projects (as candidates), view profiles, list active engagements, archive records, or open the client dashboard.",
  parameters: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "update",
          "list",
          "show",
          "createProject",
          "showProject",
          "listProjects",
          "approveClient",
          "approveProject",
          "deleteCandidate",
          "present",
        ],
        description: "The action to perform. 'list' returns a verbal summary; 'present' opens the dashboard UI.",
      },
      id: {
        type: "string",
        description: "The client identifier/slug (e.g. 'acme'). Case-insensitive, slugified automatically.",
      },
      projectId: {
        type: "string",
        description: "The project identifier/slug (e.g. 'site-redesign').",
      },
      patch: {
        type: "object",
        description:
          "Fields to set/update for client create/update. Fields: name, status, contacts (array of {name, email, role}), rate ({amount, currency, unit}), paymentTerms, tags (array), notes.",
      },
      projectPatch: {
        type: "object",
        description:
          "Fields to set/update for project create/update. Fields: name, status, feeModel ('hour'|'fixed'|'retainer'), rate, startDate, expectedDeliverables, notes.",
      },
      candidateId: {
        type: "string",
        description: "The candidate ID/filename for 'approveClient', 'approveProject', or 'deleteCandidate'.",
      },
    },
    required: ["action"],
  },
};
