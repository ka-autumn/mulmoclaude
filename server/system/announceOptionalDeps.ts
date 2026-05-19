// Boot-time graceful-degradation announcement for missing optional
// host binaries (#1385). Probes the registry, then for each missing
// dependency emits one structured log.warn plus a deduped bell
// notification naming the affected feature/plugins. Never throws —
// degradation is the whole point.

import { BUILT_IN_PLUGIN_METAS } from "../../src/plugins/metas.js";
import type { PluginMeta } from "../../src/plugins/meta-types.js";
import { NOTIFICATION_KINDS, NOTIFICATION_PRIORITIES } from "../../src/types/notification.js";
import { log } from "./logger/index.js";
import { publishNotification, type PublishNotificationOpts } from "../events/notifications.js";
import { probeOptionalDeps, optionalDeps, type OptionalDep, type DepStatus } from "./optionalDeps.js";

function pluginsRequiring(depId: string): string[] {
  const metas: readonly PluginMeta[] = Object.values(BUILT_IN_PLUGIN_METAS);
  return metas.filter((meta) => meta.requires?.includes(depId)).map((meta) => meta.toolName);
}

// Pure payload builder, exposed for unit tests. `not-on-path` →
// install it; `probe-failed` → it's installed but not responding
// (e.g. the docker daemon is down). The remediation differs, so
// title + body are reason-aware. The title carries `{command}` so
// the bell history view — which renders title only — is
// self-explanatory without hovering for the body tooltip.
export function buildOptionalDepNotification(dep: OptionalDep, status: DepStatus): PublishNotificationOpts {
  const notFound = status.reason === "not-on-path";
  return {
    id: `optional-dep-missing:${dep.id}`,
    kind: NOTIFICATION_KINDS.system,
    priority: NOTIFICATION_PRIORITIES.normal,
    title: notFound ? `${dep.command} not installed` : `${dep.command} not running`,
    body: notFound
      ? `${dep.command} not found — some features are disabled. Install ${dep.command} and restart MulmoClaude.`
      : `${dep.command} is installed but not running — some features are disabled. Start ${dep.command} and restart MulmoClaude.`,
    i18n: {
      titleKey: notFound ? "optionalDeps.titleNotFound" : "optionalDeps.titleNotResponding",
      titleParams: { command: dep.command },
      bodyKey: notFound ? "optionalDeps.notFound" : "optionalDeps.notResponding",
      bodyParams: { command: dep.command },
    },
  };
}

export async function announceOptionalDeps(): Promise<void> {
  const statuses = await probeOptionalDeps();
  for (const dep of optionalDeps()) {
    const status = statuses[dep.id];
    if (!status || status.available) continue;
    const affectedPlugins = pluginsRequiring(dep.id);
    log.warn("deps", `optional dependency '${dep.command}' unavailable — ${dep.enables} degraded`, {
      depId: dep.id,
      reason: status.reason,
      affectedPlugins,
    });
    publishNotification(buildOptionalDepNotification(dep, status));
  }
}
