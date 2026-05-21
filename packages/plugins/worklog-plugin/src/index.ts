import { definePlugin } from "gui-chat-protocol";
import { TOOL_DEFINITION } from "./definition";
import { WriteMutex } from "./lock";
import { loadAllCommittedEntries, loadAllCandidates, resolveWorklogEntries, saveCandidate, deleteCandidate } from "./io";
import { handleCreate, handleApprove, handleList, handleEdit, handleDelete, type LlmActionInput } from "./handlers/llm";
import type { WorklogEntry, CandidateEntry } from "./types";

export { TOOL_DEFINITION };
export type { WorklogEntry, CandidateEntry } from "./types";

interface UiKindMap {
  listAll: Record<string, never>;
  candidateApprove: { id: string };
  candidateSave: { candidate: CandidateEntry };
  candidateDelete: { id: string };
  committedEdit: { id: string; entry: Partial<WorklogEntry> };
  committedDelete: { id: string };
}

type UiArgs = { [K in keyof UiKindMap]: { kind: K } & UiKindMap[K] }[keyof UiKindMap];

interface LlmArgs extends LlmActionInput {
  action: string;
}

function isLlmArgs(value: unknown): value is LlmArgs {
  return typeof value === "object" && value !== null && "action" in value && typeof (value as { action: unknown }).action === "string";
}

function isUiArgs(value: unknown): value is UiArgs {
  return typeof value === "object" && value !== null && "kind" in value && typeof (value as { kind: unknown }).kind === "string";
}

export default definePlugin((runtime) => {
  const { pubsub, files, log } = runtime;
  const writeMutex = new WriteMutex();

  // LLM / MCP action path
  async function handleLlm(args: LlmArgs) {
    const { action, ...input } = args;
    log.info("dispatch llm worklog", { action });

    switch (action) {
      case "create": {
        return writeMutex.run(async () => {
          const res = await handleCreate(files.data, input);
          if (res.kind === "error") return { error: res.error, status: res.status };
          pubsub.publish("changed", { reason: "llm-create" });
          return {
            data: res.data,
            message: res.message,
            jsonData: res.jsonData,
            instructions: "Show the new worklog candidate in the Review Board.",
          };
        });
      }
      case "approve": {
        return writeMutex.run(async () => {
          const res = await handleApprove(files.data, input);
          if (res.kind === "error") return { error: res.error, status: res.status };
          pubsub.publish("changed", { reason: "llm-approve" });
          return {
            data: res.data,
            message: res.message,
            jsonData: res.jsonData,
            instructions: "Show the approved entry in the worklog list.",
          };
        });
      }
      case "list": {
        const res = await handleList(files.data, input);
        if (res.kind === "error") return { error: res.error, status: res.status };
        return {
          message: res.message,
          jsonData: res.jsonData,
          instructions: "Display the weekly summary or logged list.",
        };
      }
      case "edit": {
        return writeMutex.run(async () => {
          const res = await handleEdit(files.data, input);
          if (res.kind === "error") return { error: res.error, status: res.status };
          pubsub.publish("changed", { reason: "llm-edit" });
          return {
            data: res.data,
            message: res.message,
            jsonData: res.jsonData,
            instructions: "Update the worklog list displays.",
          };
        });
      }
      case "delete": {
        return writeMutex.run(async () => {
          const res = await handleDelete(files.data, input);
          if (res.kind === "error") return { error: res.error, status: res.status };
          pubsub.publish("changed", { reason: "llm-delete" });
          return {
            data: res.data,
            message: res.message,
            jsonData: res.jsonData,
            instructions: "Remove the worklog entry from the view.",
          };
        });
      }
      case "present": {
        return {
          data: {},
          message: "Presented the Worklog Review Board and committed logs.",
          jsonData: {},
          instructions: "Show the Worklog Review Board and committed logs.",
        };
      }
      default: {
        return { error: `unknown action: ${action}`, status: 400 };
      }
    }
  }

  // Frontend UI view action path
  async function handleUi(args: UiArgs) {
    log.info("dispatch ui worklog", { kind: args.kind });

    switch (args.kind) {
      case "listAll": {
        const [rawCommitted, candidates] = await Promise.all([loadAllCommittedEntries(files.data), loadAllCandidates(files.data)]);
        const committed = resolveWorklogEntries(rawCommitted);
        return { data: { committed, candidates } };
      }

      case "candidateSave": {
        return writeMutex.run(async () => {
          const { candidate } = args;
          await saveCandidate(files.data, candidate);
          pubsub.publish("changed", { reason: "candidate-save" });
          const [rawCommitted, candidates] = await Promise.all([loadAllCommittedEntries(files.data), loadAllCandidates(files.data)]);
          return { data: { committed: resolveWorklogEntries(rawCommitted), candidates } };
        });
      }

      case "candidateDelete": {
        return writeMutex.run(async () => {
          const { id } = args;
          await deleteCandidate(files.data, id);
          pubsub.publish("changed", { reason: "candidate-delete" });
          const [rawCommitted, candidates] = await Promise.all([loadAllCommittedEntries(files.data), loadAllCandidates(files.data)]);
          return { data: { committed: resolveWorklogEntries(rawCommitted), candidates } };
        });
      }

      case "candidateApprove": {
        return writeMutex.run(async () => {
          const { id } = args;
          const res = await handleApprove(files.data, { candidateId: id });
          if (res.kind === "error") return { error: res.error, status: res.status };
          pubsub.publish("changed", { reason: "candidate-approve" });
          const [rawCommitted, candidates] = await Promise.all([loadAllCommittedEntries(files.data), loadAllCandidates(files.data)]);
          return { data: { committed: resolveWorklogEntries(rawCommitted), candidates } };
        });
      }

      case "committedEdit": {
        return writeMutex.run(async () => {
          const { id, entry } = args;
          const res = await handleEdit(files.data, {
            worklogId: id,
            clientId: entry.clientId,
            projectId: entry.projectId,
            startTime: entry.startTime,
            endTime: entry.endTime,
            notes: entry.notes,
            billable: entry.billable,
          });
          if (res.kind === "error") return { error: res.error, status: res.status };
          pubsub.publish("changed", { reason: "committed-edit" });
          const [rawCommitted, candidates] = await Promise.all([loadAllCommittedEntries(files.data), loadAllCandidates(files.data)]);
          return { data: { committed: resolveWorklogEntries(rawCommitted), candidates } };
        });
      }

      case "committedDelete": {
        return writeMutex.run(async () => {
          const { id } = args;
          const res = await handleDelete(files.data, { worklogId: id });
          if (res.kind === "error") return { error: res.error, status: res.status };
          pubsub.publish("changed", { reason: "committed-delete" });
          const [rawCommitted, candidates] = await Promise.all([loadAllCommittedEntries(files.data), loadAllCandidates(files.data)]);
          return { data: { committed: resolveWorklogEntries(rawCommitted), candidates } };
        });
      }

      default: {
        const exhaustive: never = args;
        return { error: `unknown kind: ${JSON.stringify(exhaustive)}`, status: 400 };
      }
    }
  }

  return {
    TOOL_DEFINITION,
    async manageWorklog(rawArgs: unknown) {
      try {
        if (isLlmArgs(rawArgs)) return await handleLlm(rawArgs);
        if (isUiArgs(rawArgs)) return await handleUi(rawArgs);
        return {
          error: "unknown args shape — expected { action: ... } or { kind: ... }",
          status: 400,
        };
      } catch (error) {
        log.error("manageWorklog failed", { error });
        return { error: String(error || "internal error"), status: 500 };
      }
    },
  };
});
