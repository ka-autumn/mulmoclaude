import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { homedir, tmpdir, userInfo } from "node:os";
import type { FileOps } from "gui-chat-protocol";
import { type Invoice, type InvoiceCandidate, type InvoiceSettings, InvoiceSchema, InvoiceCandidateSchema, InvoiceSettingsSchema } from "./types";

// Standard file operations for committed invoices and candidate drafts.

export async function loadAllInvoices(files: FileOps): Promise<Invoice[]> {
  if (!(await files.exists("committed"))) return [];
  try {
    const fileNames = await files.readDir("committed");
    const invoices: Invoice[] = [];
    for (const name of fileNames) {
      if (!name.endsWith(".json")) continue;
      try {
        const content = await files.read(path.join("committed", name));
        const parsed = JSON.parse(content);
        const inv = InvoiceSchema.parse(parsed);
        invoices.push(inv);
      } catch {
        // Skip corrupted invoices
      }
    }
    return invoices.sort((invoiceA, invoiceB) => invoiceB.date.localeCompare(invoiceA.date));
  } catch {
    return [];
  }
}

export async function loadAllCandidates(files: FileOps): Promise<InvoiceCandidate[]> {
  if (!(await files.exists("candidates"))) return [];
  try {
    const fileNames = await files.readDir("candidates");
    const candidates: InvoiceCandidate[] = [];
    for (const name of fileNames) {
      if (!name.endsWith(".json")) continue;
      try {
        const content = await files.read(path.join("candidates", name));
        const parsed = JSON.parse(content);
        const cand = InvoiceCandidateSchema.parse(parsed);
        candidates.push(cand);
      } catch {
        // Skip corrupted candidates
      }
    }
    return candidates.sort((candidateA, candidateB) => candidateB.createdAt - candidateA.createdAt);
  } catch {
    return [];
  }
}

export async function saveCandidate(files: FileOps, candidate: InvoiceCandidate): Promise<void> {
  await files.write(path.join("candidates", `${candidate.candidateId}.json`), JSON.stringify(candidate, null, 2));
}

export async function deleteCandidate(files: FileOps, candidateId: string): Promise<void> {
  const candidatePath = path.join("candidates", `${candidateId}.json`);
  if (await files.exists(candidatePath)) {
    await files.unlink(candidatePath);
  }
}

export async function commitInvoice(files: FileOps, invoice: Invoice): Promise<void> {
  await files.write(path.join("committed", `${invoice.id}.json`), JSON.stringify(invoice, null, 2));
}

// ─────────────────────────────────────────────────────────────────────
// Loose Coupling (疎結合) Fallbacks & Dynamic Plugin APIs
// ─────────────────────────────────────────────────────────────────────

export function getWorkspacePath(): string {
  if (process.env.MULMOCLAUDE_WORKSPACE_PATH) {
    return process.env.MULMOCLAUDE_WORKSPACE_PATH;
  }
  const isTestEnv =
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((arg) => arg.includes("test")) ||
    typeof process.env.NODE_TEST_CONTEXT !== "undefined";

  let realUserHome: string;
  try {
    realUserHome = userInfo().homedir;
  } catch {
    realUserHome = homedir();
  }
  const isHomeOverridden = homedir() !== realUserHome;

  if (isTestEnv && !isHomeOverridden) {
    return path.join(tmpdir(), "mulmoclaude-test");
  }
  return path.join(homedir(), "mulmoclaude");
}

function getClientsPath(): string {
  return path.join(getWorkspacePath(), "data", "clients");
}

export interface ParsedClient {
  id: string;
  name: string;
  status: string;
  contacts: unknown[];
  rate: { amount: number; currency: string; unit: string };
  paymentTerms: string;
  tags: string[];
  firstEngagement: string;
  notes: string;
}

// eslint-disable-next-line complexity, sonarjs/cognitive-complexity
function parseClientFrontmatter(content: string, filenameId: string): ParsedClient {
  const data: ParsedClient = {
    id: filenameId,
    name: filenameId,
    status: "active",
    contacts: [],
    rate: { amount: 0, currency: "USD", unit: "hour" },
    paymentTerms: "net-30",
    tags: [],
    firstEngagement: "",
    notes: "",
  };

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return data;

  let currentKey = "";
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isIndented = line.startsWith(" ") || line.startsWith("\t");
    if (isIndented && currentKey === "rate") {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const subKey = trimmed.slice(0, colonIdx).trim();
        const val = trimmed
          .slice(colonIdx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        if (subKey === "amount") {
          data.rate.amount = parseFloat(val) || 0;
        } else if (subKey === "currency") {
          data.rate.currency = val;
        } else if (subKey === "unit") {
          data.rate.unit = val;
        }
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed
      .slice(colonIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    currentKey = key;
    if (key === "id" || key === "name" || key === "status" || key === "paymentTerms" || key === "firstEngagement" || key === "notes") {
      data[key] = val;
    }
  }

  return data;
}

// Intentional cross-plugin read: scans the active clients data directory owned by the
// client-plugin. See server/plugins/runtime.ts:358 for the host's own client-plugin special-case.
export async function fetchActiveClients(log: { error: (msg: string, details: Record<string, unknown>) => void }): Promise<ParsedClient[]> {
  const clientsDir = getClientsPath();
  try {
    const fileNames = await fsPromises.readdir(clientsDir);
    const clientsList: ParsedClient[] = [];
    const realClientsDir = await fsPromises.realpath(clientsDir);

    for (const fileName of fileNames) {
      if (!fileName.endsWith(".md")) continue;
      try {
        const clientPath = path.join(clientsDir, fileName);

        // Security: Prevent path traversal via symbolic link
        const stat = await fsPromises.lstat(clientPath);
        if (stat.isSymbolicLink()) {
          log.error("Skipped symbolic link to prevent path traversal", { file: fileName });
          continue;
        }

        const realClientPath = await fsPromises.realpath(clientPath);
        if (!realClientPath.startsWith(realClientsDir)) {
          log.error("Skipped path traversal client file", { file: fileName });
          continue;
        }

        const content = await fsPromises.readFile(realClientPath, "utf-8");
        const clientSlug = fileName.replace(/\.md$/, "");
        const parsed = parseClientFrontmatter(content, clientSlug);
        clientsList.push(parsed);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error("Failed to parse client file", { file: fileName, error: errorMessage });
      }
    }
    return clientsList;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error("Failed to read clients directory", { path: clientsDir, error: errorMessage });
    return [];
  }
}

export async function loadSettings(files: FileOps): Promise<InvoiceSettings> {
  try {
    if (await files.exists("settings.json")) {
      const content = await files.read("settings.json");
      const parsed = JSON.parse(content);
      return InvoiceSettingsSchema.parse(parsed);
    }
  } catch {
    // Return empty settings on error
  }
  return {
    companyName: "",
    taxRegistrationId: "",
    postalCode: "",
    address: "",
    email: "",
    bankName: "",
    bankBranch: "",
    bankAccountType: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    bookId: "",
    bookName: "",
  };
}

export async function saveSettings(files: FileOps, settings: InvoiceSettings): Promise<void> {
  await files.write("settings.json", JSON.stringify(settings, null, 2));
}
