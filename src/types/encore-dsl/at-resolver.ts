// Resolve a parsed at-expression to an ISO date, given the
// cycle / step anchors. Pure function; the caller supplies the
// anchors (computed from the cadence + slot in `./cadence.ts`).

import { addDays } from "./cadence.js";
import type { AtExpression } from "./at-expression.js";

export interface AtAnchors {
  /** ISO date — cycle start. Always available. */
  cycleStart: string;
  /** ISO date — cycle deadline. Always available. */
  cycleDeadline: string;
  /** ISO date — this step's deadline. Only available when resolving
   *  inside a step's firingPlan (the step's own deadline is itself
   *  an at-expr resolved against cycleStart / cycleDeadline). */
  stepDeadline?: string;
}

export function resolveAtExpression(expr: AtExpression, anchors: AtAnchors): string {
  if (expr.anchor === "cycle-start") return addDays(anchors.cycleStart, expr.offsetDays);
  if (expr.anchor === "cycle-deadline") return addDays(anchors.cycleDeadline, expr.offsetDays);
  if (expr.anchor === "step-deadline") {
    if (!anchors.stepDeadline) {
      throw new Error("at-resolver: step-deadline anchor used but no stepDeadline anchor provided");
    }
    return addDays(anchors.stepDeadline, expr.offsetDays);
  }
  if (!expr.date) {
    throw new Error("at-resolver: schedule anchor missing date");
  }
  return addDays(expr.date, expr.offsetDays);
}
