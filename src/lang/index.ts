// Locale registry shared by the frontend (vue-i18n) and the server
// (plugin-seeded prompt localization, #1545).
//
// Deliberately free of any `vue-i18n` import: server code imports the
// message dictionaries from here to localize plugin-seeded prompts, and
// pulling `vue-i18n` (a browser runtime dep) into the Node process would
// be wrong. `src/lib/vue-i18n.ts` consumes this same registry so the
// supported-locale list and the locale→messages map live in one place.

import enMessages from "./en";
import jaMessages from "./ja";
import zhMessages from "./zh";
import koMessages from "./ko";
import esMessages from "./es";
import ptBRMessages from "./pt-BR";
import frMessages from "./fr";
import deMessages from "./de";

export const SUPPORTED_LOCALES = ["en", "ja", "zh", "ko", "es", "pt-BR", "fr", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// `en` is the schema source of truth; the explicit `Record<Locale, …>`
// annotation makes every other locale a compile error unless it matches
// `en`'s shape (the "8 locales in lockstep" rule, enforced by the type
// system rather than at runtime).
export type LocaleMessages = typeof enMessages;
export const messages: Record<Locale, LocaleMessages> = {
  en: enMessages,
  ja: jaMessages,
  zh: zhMessages,
  ko: koMessages,
  es: esMessages,
  "pt-BR": ptBRMessages,
  fr: frMessages,
  de: deMessages,
};

export function isSupportedLocale(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}
