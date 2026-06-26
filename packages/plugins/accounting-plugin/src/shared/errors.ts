// Normalise an unknown thrown value into a human-readable string.
// Isomorphic (used by both the Vue surface and the server surface) so
// it lives in ./shared. Mirrors the host's `src/utils/errors.ts`
// `errorMessage` — kept in the package so neither surface reaches
// uphill into the host for it.

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const obj = err as { details?: unknown; message?: unknown };
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  if (fallback !== undefined) return fallback;
  return String(err);
}
