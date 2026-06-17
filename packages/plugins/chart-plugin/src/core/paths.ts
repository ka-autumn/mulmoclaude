// Browser-safe artifact path helpers — no node:path / no node:crypto, so
// this module bundles cleanly into both the server (`.`) and browser
// (`./vue`) entries. The `Date.now()` suffix disambiguates filenames, so a
// plain ASCII slug (falling back to "chart") is enough; we don't need the
// host's crypto-hash fallback for non-ASCII titles.

const CHART_DIR = "charts";
const ARTIFACTS_ROOT = "artifacts";

/** Lowercase ASCII slug; empty / non-ASCII input falls back to `fallback`. */
export function slugify(title: string | undefined, fallback = "chart"): string {
  if (!title) return fallback;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** UTC `YYYY/MM` partition (matches the host's #764 artifact sharding). */
function yearMonthUtc(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

export interface ChartPath {
  /** Path relative to the artifacts root — what `files.artifacts.write` takes. */
  relPath: string;
  /** Workspace-relative path — surfaced to the host/LLM for display. */
  filePath: string;
}

/** Build the `charts/<YYYY>/<MM>/<slug>-<ts>.chart.json` location for a document. */
export function chartArtifactPath(title: string | undefined, now: Date = new Date()): ChartPath {
  const fname = `${slugify(title)}-${now.getTime()}.chart.json`;
  const relPath = `${CHART_DIR}/${yearMonthUtc(now)}/${fname}`;
  return { relPath, filePath: `${ARTIFACTS_ROOT}/${relPath}` };
}
