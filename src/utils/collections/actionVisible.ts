// Pure visibility predicate for schema-declared collection actions.
// Kept as its own module (no Vue) so CollectionView can stay thin and
// the match semantics are pinned by unit tests. Domain-free: the host
// compares the stringified record value against the allowed set with no
// knowledge of what the field means.

/** Minimal shape this helper needs from an action — just its optional
 *  `when` predicate. Accepts the full CollectionAction too. */
export interface ActionWithWhen {
  when?: { field: string; in: string[] };
}

/** True when the action's button should render against `record`:
 *  - no `when` ⇒ always visible;
 *  - otherwise visible only when `record[when.field]` is present and its
 *    stringified value is one of `when.in`.
 *  A missing/undefined field is treated as "not a match" (hidden), so a
 *  status-gated action never shows on a record that lacks the status. */
export function actionVisible(action: ActionWithWhen, record: Record<string, unknown>): boolean {
  const { when } = action;
  if (!when) return true;
  const value = record[when.field];
  if (value === undefined || value === null) return false;
  return when.in.includes(String(value));
}
