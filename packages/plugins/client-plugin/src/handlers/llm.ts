import { z } from "zod";
import { Client, ClientSchema, Project, ProjectSchema, ClientCandidate, ProjectCandidate } from "../types";
import { deserialiseClient, deserialiseProject, serialiseClient, serialiseProject } from "../io";

// Helper to generate a unique random string ID for candidates
const makeCandidateId = (prefix: "client" | "project") => {
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${rand}-${time}`;
};

// Helper to slugify standard strings
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-+$)/g, "");
};

export async function handleManageClient(
  files: any,
  pubsub: any,
  log: any,
  withWriteLock: <T>(fn: () => Promise<T>) => Promise<T>,
  rawArgs: unknown,
): Promise<any> {
  const actionSchema = z.object({
    action: z.enum([
      "create",
      "update",
      "list",
      "show",
      "get",
      "createProject",
      "showProject",
      "getProject",
      "listProjects",
      "approveClient",
      "approveProject",
      "deleteCandidate",
      "present",
    ]),
    id: z.string().optional(),
    projectId: z.string().optional(),
    patch: z.any().optional(),
    projectPatch: z.any().optional(),
    candidateId: z.string().optional(),
  });

  const args = actionSchema.parse(rawArgs);

  const publishChanged = async () => {
    await pubsub.publish("changed", { at: new Date().toISOString() });
  };

  switch (args.action) {
    case "create": {
      // Build slug
      const inputId = args.id || (args.patch && args.patch.name) || "";
      if (!inputId) {
        return { ok: false, error: "missing_id_or_name", message: "Client ID/slug or patch.name is required to create a client." };
      }
      const slug = slugify(inputId);
      if (!slug) {
        return { ok: false, error: "invalid_slug", message: `Derived slug '${inputId}' is not a valid URL slug.` };
      }

      // Check if client already exists (committed)
      if (await files.data.exists(`${slug}.md`)) {
        return { ok: false, error: "client_exists", message: `Client '${slug}' already exists in active records.` };
      }

      // Create a draft candidate
      const candidateId = makeCandidateId("client");
      const defaultClient: Client = {
        id: slug,
        name: args.patch?.name || inputId,
        status: "active",
        contacts: args.patch?.contacts || [],
        rate: args.patch?.rate || { amount: 0, currency: "USD", unit: "hour" },
        paymentTerms: args.patch?.paymentTerms || "net-30",
        tags: args.patch?.tags || [],
        firstEngagement: args.patch?.firstEngagement || new Date().toISOString().split("T")[0],
        notes: args.patch?.notes || "",
      };

      const parsed = ClientSchema.safeParse(defaultClient);
      if (!parsed.success) {
        return { ok: false, error: "validation_failed", errors: parsed.error.format() };
      }

      const candidate: ClientCandidate = {
        candidateId,
        type: "client",
        data: parsed.data,
        createdAt: Date.now(),
      };

      // Create candidates folder if it doesn't exist (done dynamically by write)
      await files.data.write(`candidates/${candidateId}.json`, JSON.stringify(candidate, null, 2));
      await publishChanged();

      return {
        ok: true,
        message: `Successfully created pending client candidate draft for '${parsed.data.name}'! Approve via the review board to commit it.`,
        candidateId,
        data: candidate,
      };
    }

    case "update": {
      if (!args.id) {
        return { ok: false, error: "missing_id", message: "Client slug 'id' is required for update." };
      }
      const slug = slugify(args.id);

      return withWriteLock(async () => {
        const filePath = `${slug}.md`;
        if (!(await files.data.exists(filePath))) {
          return { ok: false, error: "client_not_found", message: `Client with slug '${slug}' does not exist.` };
        }

        const raw = await files.data.read(filePath);
        const client = deserialiseClient(raw);
        if (!client) {
          return { ok: false, error: "deserialization_failed", message: "Failed to parse committed client markdown file." };
        }

        // Apply patch
        const patch = args.patch || {};
        const updatedClient: Client = {
          ...client,
          name: typeof patch.name === "string" ? patch.name : client.name,
          status: typeof patch.status === "string" ? patch.status : client.status,
          paymentTerms: typeof patch.paymentTerms === "string" ? patch.paymentTerms : client.paymentTerms,
          firstEngagement: typeof patch.firstEngagement === "string" ? patch.firstEngagement : client.firstEngagement,
          notes: typeof patch.notes === "string" ? patch.notes : client.notes,
        };

        if (patch.contacts) {
          updatedClient.contacts = patch.contacts;
        }
        if (patch.rate) {
          updatedClient.rate = {
            ...client.rate,
            ...patch.rate,
          };
        }
        if (patch.tags) {
          updatedClient.tags = patch.tags;
        }

        const validated = ClientSchema.safeParse(updatedClient);
        if (!validated.success) {
          return { ok: false, error: "validation_failed", errors: validated.error.format() };
        }

        await files.data.write(filePath, serialiseClient(validated.data));
        await publishChanged();

        return {
          ok: true,
          message: `Successfully updated client '${validated.data.name}'!`,
          data: validated.data,
        };
      });
    }

    case "list": {
      const rootFiles = await files.data.readDir(".");
      const clients: Client[] = [];

      for (const entry of rootFiles) {
        if (!entry.endsWith(".md")) continue;
        try {
          const raw = await files.data.read(entry);
          const client = deserialiseClient(raw);
          if (client) {
            clients.push(client);
          }
        } catch (e: any) {
          log.warn(`Skipping corrupted client markdown file: ${entry}`, e);
        }
      }

      // Sort by name
      clients.sort((a, b) => a.name.localeCompare(b.name));

      // Read candidates
      const candidates: ClientCandidate[] = [];
      try {
        if (await files.data.exists("candidates")) {
          const candFiles = await files.data.readDir("candidates");
          for (const candFile of candFiles) {
            if (!candFile.endsWith(".json") || !candFile.startsWith("client-")) continue;
            const content = await files.data.read(`candidates/${candFile}`);
            const parsed = JSON.parse(content);
            if (parsed && parsed.type === "client") {
              candidates.push(parsed);
            }
          }
        }
      } catch (e) {
        log.warn("Failed to load client candidates", e);
      }

      // Narration-only response (matches worklog convention): no `data` so the MCP
      // bridge does not auto-mount the dashboard View — that's the `present` action's
      // job. The LLM gets `message` to read aloud and `jsonData` to reason over.
      return {
        ok: true,
        message: `Listed ${clients.length} client(s) and ${candidates.length} pending draft(s).`,
        jsonData: { clients, candidates },
      };
    }

    case "present": {
      return {
        ok: true,
        data: {},
        args: { action: "present", id: args.id ? slugify(args.id) : undefined },
        message: "Presented the client dashboard.",
        instructions: "Show the Client/CRM dashboard with active clients, projects, and pending drafts.",
      };
    }

    case "get":
    case "show": {
      if (!args.id) {
        return { ok: false, error: "missing_id", message: "Client slug 'id' is required." };
      }
      const slug = slugify(args.id);
      const filePath = `${slug}.md`;
      if (!(await files.data.exists(filePath))) {
        return { ok: false, error: "client_not_found", message: `Client with slug '${slug}' does not exist.` };
      }

      const raw = await files.data.read(filePath);
      const client = deserialiseClient(raw);
      if (!client) {
        return { ok: false, error: "deserialization_failed", message: "Corrupted client markdown file." };
      }

      // Fetch projects for this client
      const projects: Project[] = [];
      const projectsDir = `${slug}/projects`;
      try {
        if (await files.data.exists(projectsDir)) {
          const projFiles = await files.data.readDir(projectsDir);
          for (const projFile of projFiles) {
            if (!projFile.endsWith(".md")) continue;
            const content = await files.data.read(`${projectsDir}/${projFile}`);
            const project = deserialiseProject(content);
            if (project) {
              projects.push(project);
            }
          }
        }
      } catch (e) {
        log.warn(`Failed to list projects for client ${slug}`, e);
      }

      return {
        ok: true,
        client,
        projects,
        args: { action: args.action, id: slug },
        message: `Retrieved details for client "${client.name}" (status: ${client.status}).`,
        jsonData: { client, projects },
        instructions: `Open details page for client ${client.name}.`,
      };
    }

    case "createProject": {
      if (!args.id) {
        return { ok: false, error: "missing_client_id", message: "Client 'id' is required to attach a project." };
      }
      const clientSlug = slugify(args.id);

      // Ensure client exists
      if (!(await files.data.exists(`${clientSlug}.md`))) {
        return { ok: false, error: "client_not_found", message: `Client '${clientSlug}' must exist before attaching projects.` };
      }

      const inputProjId = args.projectId || (args.projectPatch && args.projectPatch.name) || "";
      if (!inputProjId) {
        return { ok: false, error: "missing_project_id", message: "Project ID/slug or projectPatch.name is required to create a project." };
      }
      const projectSlug = slugify(inputProjId);

      // Check if project already exists
      const projPath = `${clientSlug}/projects/${projectSlug}.md`;
      if (await files.data.exists(projPath)) {
        return { ok: false, error: "project_exists", message: `Project '${projectSlug}' already exists for client '${clientSlug}'.` };
      }

      const candidateId = makeCandidateId("project");
      const defaultProject: Project = {
        id: projectSlug,
        clientId: clientSlug,
        name: args.projectPatch?.name || inputProjId,
        status: "active",
        feeModel: args.projectPatch?.feeModel || "hour",
        rate: args.projectPatch?.rate || undefined,
        startDate: args.projectPatch?.startDate || new Date().toISOString().split("T")[0],
        expectedDeliverables: args.projectPatch?.expectedDeliverables || "",
        notes: args.projectPatch?.notes || "",
      };

      const parsed = ProjectSchema.safeParse(defaultProject);
      if (!parsed.success) {
        return { ok: false, error: "validation_failed", errors: parsed.error.format() };
      }

      const candidate: ProjectCandidate = {
        candidateId,
        type: "project",
        data: parsed.data,
        createdAt: Date.now(),
      };

      await files.data.write(`candidates/${candidateId}.json`, JSON.stringify(candidate, null, 2));
      await publishChanged();

      return {
        ok: true,
        message: `Successfully created project candidate draft for '${parsed.data.name}' under client '${clientSlug}'! Approve via the review board to commit it.`,
        candidateId,
        data: candidate,
      };
    }

    case "getProject":
    case "showProject": {
      if (!args.id) {
        return { ok: false, error: "missing_client_id", message: "Client slug 'id' is required." };
      }
      if (!args.projectId) {
        return { ok: false, error: "missing_project_id", message: "Project slug 'projectId' is required." };
      }
      const clientSlug = slugify(args.id);
      const projectSlug = slugify(args.projectId);

      const filePath = `${clientSlug}/projects/${projectSlug}.md`;
      if (!(await files.data.exists(filePath))) {
        return { ok: false, error: "project_not_found", message: `Project '${projectSlug}' does not exist for client '${clientSlug}'.` };
      }

      const raw = await files.data.read(filePath);
      const project = deserialiseProject(raw);
      if (!project) {
        return { ok: false, error: "deserialization_failed", message: "Corrupted project markdown file." };
      }

      return {
        ok: true,
        project,
        args: { action: args.action, id: clientSlug, projectId: projectSlug },
        message: `Retrieved details for project "${project.name}" under client "${clientSlug}" (status: ${project.status}).`,
        jsonData: { project },
        instructions: `Open project details page for project ${project.name} under client ${clientSlug}.`,
      };
    }

    case "listProjects": {
      const projects: Project[] = [];
      const rootFiles = await files.data.readDir(".");

      // If client 'id' is provided, list only for that client
      if (args.id) {
        const clientSlug = slugify(args.id);
        const projectsDir = `${clientSlug}/projects`;
        try {
          if (await files.data.exists(projectsDir)) {
            const projFiles = await files.data.readDir(projectsDir);
            for (const projFile of projFiles) {
              if (!projFile.endsWith(".md")) continue;
              const content = await files.data.read(`${projectsDir}/${projFile}`);
              const project = deserialiseProject(content);
              if (project) projects.push(project);
            }
          }
        } catch (e) {
          log.warn(`Failed to list projects for client ${clientSlug}`, e);
        }
      } else {
        // Search globally across all clients
        for (const entry of rootFiles) {
          if (entry.endsWith(".md") || entry === "candidates") continue;
          // Check if it's a directory (i.e. has a projects subdirectory)
          const projectsDir = `${entry}/projects`;
          try {
            if (await files.data.exists(projectsDir)) {
              const projFiles = await files.data.readDir(projectsDir);
              for (const projFile of projFiles) {
                if (!projFile.endsWith(".md")) continue;
                const content = await files.data.read(`${projectsDir}/${projFile}`);
                const project = deserialiseProject(content);
                if (project) projects.push(project);
              }
            }
          } catch (e) {
            // Ignore if not a valid directory or no projects
          }
        }
      }

      // Read candidates
      const candidates: ProjectCandidate[] = [];
      try {
        if (await files.data.exists("candidates")) {
          const candFiles = await files.data.readDir("candidates");
          for (const candFile of candFiles) {
            if (!candFile.endsWith(".json") || !candFile.startsWith("project-")) continue;
            const content = await files.data.read(`candidates/${candFile}`);
            const parsed = JSON.parse(content);
            if (parsed && parsed.type === "project") {
              // Filter by client ID if provided
              if (!args.id || parsed.data.clientId === slugify(args.id)) {
                candidates.push(parsed);
              }
            }
          }
        }
      } catch (e) {
        log.warn("Failed to load project candidates", e);
      }

      return {
        ok: true,
        projects,
        candidates,
      };
    }

    case "approveClient": {
      if (!args.candidateId) {
        return { ok: false, error: "missing_candidate_id", message: "candidateId is required for approveClient." };
      }

      return withWriteLock(async () => {
        const candPath = `candidates/${args.candidateId}.json`;
        if (!(await files.data.exists(candPath))) {
          return { ok: false, error: "candidate_not_found", message: `Candidate draft '${args.candidateId}' does not exist.` };
        }

        const rawJson = await files.data.read(candPath);
        const parsed: ClientCandidate = JSON.parse(rawJson);

        if (parsed.type !== "client") {
          return { ok: false, error: "invalid_candidate_type", message: "Candidate is not a client candidate." };
        }

        const mergedData = { ...parsed.data, ...(args.patch || {}) };
        const validated = ClientSchema.safeParse(mergedData);
        if (!validated.success) {
          return { ok: false, error: "validation_failed", errors: validated.error.format() };
        }

        // Commit active client record
        const slug = validated.data.id;
        const filePath = `${slug}.md`;
        if (await files.data.exists(filePath)) {
          return { ok: false, error: "client_exists", message: `Client '${slug}' already exists in active records.` };
        }
        await files.data.write(filePath, serialiseClient(validated.data));

        // Delete candidate draft
        await files.data.unlink(candPath);
        await publishChanged();

        return {
          ok: true,
          message: `Successfully approved and committed client record '${validated.data.name}'!`,
          id: slug,
          client: validated.data,
        };
      });
    }

    case "approveProject": {
      if (!args.candidateId) {
        return { ok: false, error: "missing_candidate_id", message: "candidateId is required for approveProject." };
      }

      return withWriteLock(async () => {
        const candPath = `candidates/${args.candidateId}.json`;
        if (!(await files.data.exists(candPath))) {
          return { ok: false, error: "candidate_not_found", message: `Candidate draft '${args.candidateId}' does not exist.` };
        }

        const rawJson = await files.data.read(candPath);
        const parsed: ProjectCandidate = JSON.parse(rawJson);

        if (parsed.type !== "project") {
          return { ok: false, error: "invalid_candidate_type", message: "Candidate is not a project candidate." };
        }

        const mergedData = { ...parsed.data, ...(args.patch || {}) };
        const validated = ProjectSchema.safeParse(mergedData);
        if (!validated.success) {
          return { ok: false, error: "validation_failed", errors: validated.error.format() };
        }

        const clientSlug = validated.data.clientId;
        const projectSlug = validated.data.id;

        // Ensure client still exists
        if (!(await files.data.exists(`${clientSlug}.md`))) {
          return { ok: false, error: "client_missing", message: `Cannot approve project: client '${clientSlug}' no longer exists.` };
        }

        // Commit active project record
        const filePath = `${clientSlug}/projects/${projectSlug}.md`;
        if (await files.data.exists(filePath)) {
          return { ok: false, error: "project_exists", message: `Project '${projectSlug}' already exists under client '${clientSlug}'.` };
        }
        await files.data.write(filePath, serialiseProject(validated.data));

        // Delete candidate draft
        await files.data.unlink(candPath);
        await publishChanged();

        return {
          ok: true,
          message: `Successfully approved and committed project record '${validated.data.name}' under client '${clientSlug}'!`,
          id: projectSlug,
          clientId: clientSlug,
          project: validated.data,
        };
      });
    }

    case "deleteCandidate": {
      if (!args.candidateId) {
        return { ok: false, error: "missing_candidate_id", message: "candidateId is required." };
      }

      return withWriteLock(async () => {
        const candPath = `candidates/${args.candidateId}.json`;
        if (!(await files.data.exists(candPath))) {
          return { ok: false, error: "candidate_not_found", message: `Candidate draft '${args.candidateId}' does not exist.` };
        }

        await files.data.unlink(candPath);
        await publishChanged();

        return {
          ok: true,
          message: `Successfully deleted draft candidate '${args.candidateId}'.`,
        };
      });
    }

    default: {
      const _exhaustive: never = args.action;
      return { ok: false, error: "unsupported_action", action: _exhaustive };
    }
  }
}
