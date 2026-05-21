import type { FileOps } from "gui-chat-protocol";
import { type WorklogEntry, type CandidateEntry, WorklogEntrySchema, CandidateEntrySchema } from "./types";

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

function assertYearMonth(value: string): string {
  if (!YEAR_MONTH_RE.test(value)) throw new Error(`Invalid year-month segment: "${value}"`);
  return value;
}

function assertSafeId(value: string): string {
  if (!SAFE_ID_RE.test(value)) throw new Error(`Invalid id segment: "${value}"`);
  return value;
}

/**
 * Reads and parses a monthly append-only JSONL file.
 * Gracefully ignores the metadata header `{"schema": "v1"}` and any corrupted lines.
 */
async function readJsonl(files: FileOps, rel: string): Promise<WorklogEntry[]> {
  if (!(await files.exists(rel))) return [];
  try {
    const content = await files.read(rel);
    const lines = content.split("\n");
    const entries: WorklogEntry[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed.id) continue; // Skip header line {"schema": "v1"}
        const entry = WorklogEntrySchema.parse(parsed);
        entries.push(entry);
      } catch {
        // Gracefully ignore unparseable lines or schema mismatches
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Resolves the supersedes graph for a collection of committed worklog entries.
 * Returns only the latest active (non-deleted) version of each unique entry.
 */
export function resolveWorklogEntries(rawEntries: WorklogEntry[]): WorklogEntry[] {
  const activeMap = new Map<string, WorklogEntry>();
  const supersededBy = new Map<string, string>();

  // Collect all entries and trace supersedes relationships
  for (const entry of rawEntries) {
    activeMap.set(entry.id, entry);
    if (entry.supersedes) {
      supersededBy.set(entry.supersedes, entry.id);
    }
  }

  const resolved: WorklogEntry[] = [];
  for (const [id, entry] of activeMap.entries()) {
    // If this entry is superseded by a newer version, skip it
    if (supersededBy.has(id)) {
      continue;
    }
    // If the latest version is marked as deleted, skip it
    if (entry.deleted) {
      continue;
    }
    resolved.push(entry);
  }

  // Default sorting: chronologically by startTime
  return resolved.sort((a, b) => {
    const tA = new Date(a.startTime).getTime();
    const tB = new Date(b.startTime).getTime();
    if (isNaN(tA) || isNaN(tB)) {
      return a.startTime.localeCompare(b.startTime);
    }
    return tA - tB;
  });
}

/**
 * Loads all committed entries from all monthly JSONL files.
 */
export async function loadAllCommittedEntries(files: FileOps): Promise<WorklogEntry[]> {
  if (!(await files.exists("committed"))) return [];
  try {
    const fileNames = await files.readDir("committed");
    const allEntries: WorklogEntry[] = [];
    for (const name of fileNames) {
      if (name.endsWith(".jsonl")) {
        const entries = await readJsonl(files, `committed/${name}`);
        allEntries.push(...entries);
      }
    }
    return allEntries;
  } catch {
    return [];
  }
}

/**
 * Appends one or more entries to their respective monthly JSONL files,
 * automatically grouping by the YYYY-MM segment of their startTime.
 */
export async function appendCommittedEntries(files: FileOps, entries: WorklogEntry[]): Promise<void> {
  const groups: Record<string, WorklogEntry[]> = {};
  for (const entry of entries) {
    const yearMonth = assertYearMonth(entry.startTime.substring(0, 7)); // Extract "YYYY-MM"
    if (!groups[yearMonth]) {
      groups[yearMonth] = [];
    }
    groups[yearMonth].push(entry);
  }

  for (const [yearMonth, groupEntries] of Object.entries(groups)) {
    const rel = `committed/${yearMonth}.jsonl`;
    let content = "";
    if (await files.exists(rel)) {
      content = await files.read(rel);
      if (content && !content.endsWith("\n")) {
        content += "\n";
      }
    } else {
      content = JSON.stringify({ schema: "v1" }) + "\n";
    }

    for (const entry of groupEntries) {
      content += JSON.stringify(entry) + "\n";
    }
    await files.write(rel, content);
  }
}

/**
 * Loads all candidates from the candidates directory.
 */
export async function loadAllCandidates(files: FileOps): Promise<CandidateEntry[]> {
  if (!(await files.exists("candidates"))) return [];
  try {
    const fileNames = await files.readDir("candidates");
    const allCandidates: CandidateEntry[] = [];
    for (const name of fileNames) {
      if (name.endsWith(".json")) {
        try {
          const rel = `candidates/${name}`;
          const raw = await files.read(rel);
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of list) {
            const candidate = CandidateEntrySchema.parse(item);
            allCandidates.push(candidate);
          }
        } catch {
          // Skip malformed candidate files
        }
      }
    }
    return allCandidates;
  } catch {
    return [];
  }
}

/**
 * Saves a single candidate entry to its own candidate JSON file.
 */
export async function saveCandidate(files: FileOps, candidate: CandidateEntry): Promise<void> {
  const safeId = assertSafeId(candidate.id);
  const rel = `candidates/${safeId}.json`;
  await files.write(rel, JSON.stringify([candidate], null, 2));
}

/**
 * Deletes a candidate entry file.
 */
export async function deleteCandidate(files: FileOps, id: string): Promise<void> {
  const safeId = assertSafeId(id);
  const rel = `candidates/${safeId}.json`;
  if (await files.exists(rel)) {
    await files.unlink(rel);
  }
}
