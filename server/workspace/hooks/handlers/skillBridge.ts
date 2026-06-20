// Skill-bridge HOST adapter — thin wiring over @mulmoclaude/skill-bridge.
//
// The agent writes skill drafts under `data/skills/<slug>/` (a plain data dir, no
// `.claude/` permission special-case); the shared package decides which writes are
// allowlisted (SKILL.md, schema.json, templates/<safe path>) and mirrors them 1:1
// into `.claude/skills/<slug>/` so Claude CLI's skill discovery + the collection
// engine pick them up (and mirrors a `rm -rf data/skills/<slug>` delete). The RULE +
// the fs mirror now live in the package so MulmoClaude and MulmoTerminal can't drift.
//
// This module keeps the HOST-specific parts: reading the hook payload, firing the
// config refresh ALWAYS after a successful mirror (so the server's rescan sees the
// change — a parallel refresh could otherwise land before the canonical file existed,
// leaving a fresh skill unregistered), and server-side logging.
//
// Why a bridge at all: Claude Code gives `.claude/` stricter permission scrutiny and
// the host GUI has no surface to answer a write prompt; routing writes through
// `data/skills/` avoids the gate, and this hook (a regular subprocess, NOT a Claude
// tool call) does the mirror copy and isn't subject to the gate.

import path from "node:path";
import {
  bridgeTargetFromDataPath as ruleBridgeTarget,
  slugFromRmCommand as ruleSlugFromRmCommand,
  dataSkillDir as ruleDataSkillDir,
  claudeSkillDir as ruleClaudeSkillDir,
  mirrorSkillWrite,
  mirrorSkillDelete,
  type BridgeTarget,
} from "@mulmoclaude/skill-bridge";
import { buildAuthPost, safePost, serverLog } from "../shared/sidecar.js";
import type { HookPayload } from "../shared/stdin.js";
import { extractCommand, extractFilePath, extractToolName } from "../shared/stdin.js";
import { workspaceRoot } from "../shared/workspace.js";
import { errorMessage } from "../../../utils/errors.js";

const SKILL_FILENAME = "SKILL.md";

// Workspace-bound wrappers: the package functions take an explicit workspaceRoot;
// these bind the live workspace so existing callers + tests keep their signatures.
export type { BridgeTarget };
export const dataSkillDir = (slug: string): string => ruleDataSkillDir(workspaceRoot(), slug);
export const claudeSkillDir = (slug: string): string => ruleClaudeSkillDir(workspaceRoot(), slug);
export const dataSkillFilePath = (slug: string): string => path.join(dataSkillDir(slug), SKILL_FILENAME);
export const claudeSkillFilePath = (slug: string): string => path.join(claudeSkillDir(slug), SKILL_FILENAME);
export const bridgeTargetFromDataPath = (filePath: string): BridgeTarget | null => ruleBridgeTarget(workspaceRoot(), filePath);
export const slugFromRmCommand = (command: string): string | null => ruleSlugFromRmCommand(command);

// Fire the config refresh AFTER a successful mirror/delete so the server's skill /
// collection rescan sees the change (the ordering invariant — see header).
async function refreshConfig(): Promise<void> {
  await safePost(buildAuthPost("/api/config/refresh"));
}

async function handleWriteOrEdit(payload: HookPayload): Promise<void> {
  const filePath = extractFilePath(payload);
  if (!filePath) return;
  const target = bridgeTargetFromDataPath(filePath);
  if (target === null) return;
  const relPath = target.relSegments.join("/");
  try {
    const { src, dest } = mirrorSkillWrite(workspaceRoot(), target);
    await refreshConfig();
    await serverLog("skill-bridge", `mirrored ${src} → ${dest}`, { data: { slug: target.slug, relPath, op: "write" } });
  } catch (err) {
    // The Write itself succeeded; a failed mirror leaves the staging copy in place.
    // Surface to server logs but never throw — the user's tool turn must stay clean.
    await serverLog("skill-bridge", `mirror write failed for slug=${target.slug} (${relPath})`, {
      level: "error",
      data: { slug: target.slug, relPath, error: errorMessage(err) },
    });
  }
}

async function handleBash(payload: HookPayload): Promise<void> {
  const command = extractCommand(payload);
  if (!command) return;
  const slug = slugFromRmCommand(command);
  if (slug === null) return;
  try {
    const { dest } = mirrorSkillDelete(workspaceRoot(), slug);
    await refreshConfig();
    await serverLog("skill-bridge", `removed ${dest}`, { data: { slug, op: "delete" } });
  } catch (err) {
    await serverLog("skill-bridge", `mirror delete failed for slug=${slug}`, {
      level: "error",
      data: { slug, error: errorMessage(err) },
    });
  }
}

export async function handleSkillBridge(payload: HookPayload): Promise<void> {
  const tool = extractToolName(payload);
  if (tool === "Write" || tool === "Edit") {
    await handleWriteOrEdit(payload);
    return;
  }
  if (tool === "Bash") {
    await handleBash(payload);
  }
}
