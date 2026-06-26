// Country utilities for the accounting plugin.
//
// The book's country (ISO 3166-1 alpha-2) identifies the tax
// jurisdiction the book is kept under. The Accounting role uses it
// to give country-aware advice — Japanese T-number under
// インボイス制度, EU VAT ID, UK VAT, GSTIN, ABN, etc.
//
// Curated against the supported currency list and the tax-regime
// guidance in `src/config/roles.ts` (Accounting role prompt).
// Intl.DisplayNames provides the localized human name at render
// time, so this stays a flat list of codes.

/** ISO 3166-1 alpha-2 country codes shown in the book country
 *  dropdown. Curated to cover every jurisdiction the Accounting role
 *  has explicit tax-registration advice for, plus the major economies
 *  represented in `SUPPORTED_CURRENCY_CODES`. */
export const SUPPORTED_COUNTRY_CODES = [
  "US",
  "JP",
  "GB",
  "CA",
  "AU",
  "NZ",
  "DE",
  "FR",
  "IT",
  "ES",
  "NL",
  "BE",
  "AT",
  "IE",
  "PT",
  "FI",
  "SE",
  "DK",
  "PL",
  "CH",
  "NO",
  "CN",
  "KR",
  "TW",
  "HK",
  "SG",
  "IN",
  "BR",
  "MX",
] as const;

export type SupportedCountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

/** EU member states as of 2026. Used by the role-prompt advice path
 *  to recommend a VAT identification number when the book country is
 *  in the EU. */
export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

/** Localized human name for a country code. Falls back to the code
 *  itself if the runtime can't resolve the name. */
export function localizedCountryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Runtime guard for `BookSummary.country`. The type is the union
 *  `SupportedCountryCode`, but every entry point that takes user /
 *  LLM input arrives as raw `string` (form submit, JSON-RPC body),
 *  so the service layer narrows here before persisting. */
export function isSupportedCountryCode(value: unknown): value is SupportedCountryCode {
  return typeof value === "string" && (SUPPORTED_COUNTRY_CODES as readonly string[]).includes(value);
}

/** Country-gated UI features. Each key is a feature name; the value
 *  is the set of country codes for which the feature is enabled.
 *  Components ask `countryHasFeature("...", country)` instead of
 *  hard-coding country lists at the call site.
 *
 *  Add a new country-specific feature by adding a new key here and
 *  reading it via `countryHasFeature`. An unknown / undefined
 *  country never has any feature — components fall back to neutral
 *  default UI rather than guessing.
 *
 *  Mirrors the "Country-aware tax behaviour" prose in the
 *  Accounting role prompt (`src/config/roles.ts`). The two MUST
 *  stay in sync — drift means the LLM and the form give the user
 *  contradictory advice. The prompt is the source of truth for
 *  agent behaviour; this table is structured-data sibling for the
 *  form. */
export const COUNTRY_FEATURES = {
  /** Show an amber "missing tax ID" warning + helper text on a
   *  postable 14xx (input-tax) line whose taxRegistrationId is
   *  blank. Limited to jurisdictions where the role prompt
   *  explicitly requires the counterparty registration number
   *  (JP T-number, EU VAT ID, GB VAT, GSTIN, ABN, NZ GST, CA BN).
   *  The "other countries" bucket and US (no federal sales-tax
   *  registration) intentionally stay quiet. 24xx output-tax
   *  lines don't trigger the warning — see `isTaxAccountCode`. */
  warnMissingTaxRegistrationId: new Set<SupportedCountryCode>([
    "JP",
    "GB",
    "DE",
    "FR",
    "IT",
    "ES",
    "NL",
    "BE",
    "AT",
    "IE",
    "PT",
    "FI",
    "SE",
    "DK",
    "PL",
    "IN",
    "AU",
    "NZ",
    "CA",
  ]),
} as const;

export type CountryFeature = keyof typeof COUNTRY_FEATURES;

/** Resolve a country-gated feature flag. Returns `false` when the
 *  country is undefined / unsupported — components default to the
 *  neutral path (no warning, no extra UI) rather than guessing. */
export function countryHasFeature(feature: CountryFeature, country: SupportedCountryCode | undefined): boolean {
  if (!country) return false;
  return COUNTRY_FEATURES[feature].has(country);
}
