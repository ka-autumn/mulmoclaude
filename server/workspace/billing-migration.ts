// One-time migration: the billing/invoicing suite (clients / worklog /
// invoice / profile) moved from bundled `mc-*` preset skills to
// on-demand help-file recipes (`config/helps/billing-*.md`).
//
// On launch, REMOVE any lingering legacy `mc-*` billing skill from
// `.claude/skills/` (a copy a user had ★ Starred while the presets
// shipped). Only the skill directory is deleted — the records under
// `data/{clients,worklog,invoice,profile}/items` are left completely
// untouched, so re-running the recipe later re-attaches to the same
// data. A one-time bell explains the change.
//
// Idempotency is structural: once the skill dirs are gone the boot
// check below finds nothing and is a no-op. The preset sources and
// their catalog entries are already removed/pruned, so a legacy skill
// can never reappear through the normal star flow — no marker file is
// needed.

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_PATHS } from "./paths.js";
import { NOTIFICATION_KINDS, NOTIFICATION_PRIORITIES } from "../../src/types/notification.js";
import { publishNotification } from "../events/notifications.js";
import { log } from "../system/logger/index.js";

// The legacy preset slugs this migration retires. Their records live
// at prefix-free `data/<name>/items/` paths that are NOT touched here.
const LEGACY_BILLING_SLUGS = ["mc-clients", "mc-worklog", "mc-invoice", "mc-profile"] as const;

/** Delete one legacy billing skill dir from `.claude/skills/` if
 *  present. Returns true when a dir was removed. Never throws. */
function removeLegacyBillingSkill(slug: string): boolean {
  const dir = path.join(WORKSPACE_PATHS.claudeSkills, slug);
  if (!existsSync(dir)) return false;
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (err) {
    log.warn("billing-migration", "failed to remove legacy billing skill", { slug, error: String(err) });
    return false;
  }
}

function notifyBillingMigration(): void {
  publishNotification({
    id: "billing-recipes-migration",
    kind: NOTIFICATION_KINDS.system,
    priority: NOTIFICATION_PRIORITIES.normal,
    title: "Invoicing moved to on-demand setup",
    body: "The bundled clients, worklog, invoice, and profile collections were removed from your dashboard, but your data is safe and untouched. Ask to set up client & time tracking, then invoicing, to recreate them — your existing records will reappear.",
    i18n: {
      titleKey: "billingMigration.title",
      bodyKey: "billingMigration.body",
    },
  });
}

/** Remove any lingering legacy `mc-*` billing skill from
 *  `.claude/skills/` (data preserved) and fire a one-time notice when
 *  at least one was removed. No-op once the dirs are gone. Never
 *  throws — boot must not depend on it. */
export function migrateLegacyBillingPresets(): void {
  const removed: string[] = [];
  for (const slug of LEGACY_BILLING_SLUGS) {
    if (removeLegacyBillingSkill(slug)) removed.push(slug);
  }
  if (removed.length === 0) return;
  log.info("billing-migration", "removed legacy billing preset skills (records preserved)", { removed });
  notifyBillingMigration();
}
