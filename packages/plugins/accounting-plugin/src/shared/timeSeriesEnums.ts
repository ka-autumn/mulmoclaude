// Single source of truth for the `getTimeSeries` action's enum
// surfaces — kept outside the server module so the frontend tool
// definition (`definition.ts`) and the server validator
// (`server/accounting/timeSeries.ts`) can both import without
// crossing the src ↔ server boundary in the wrong direction.
//
// Adding a new metric / granularity: extend the array here, then
// extend the corresponding switch / aggregation in
// `server/accounting/timeSeries.ts`. The LLM tool schema picks up
// the new value automatically via `definition.ts`'s `enum` field.

export const TIME_SERIES_METRICS = ["revenue", "expense", "netIncome", "accountBalance"] as const;
export type TimeSeriesMetric = (typeof TIME_SERIES_METRICS)[number];

export const TIME_SERIES_GRANULARITIES = ["month", "quarter", "year"] as const;
export type TimeSeriesGranularity = (typeof TIME_SERIES_GRANULARITIES)[number];
