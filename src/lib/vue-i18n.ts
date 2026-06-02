// vue-i18n setup.
//
// Locale resolution priority (highest → lowest):
//   1. `VITE_LOCALE` env var — explicit build-time / dev override
//      (e.g. `VITE_LOCALE=ja yarn dev`)
//   2. Browser language list (`navigator.languages` falling back to
//      `navigator.language`) — the browser inherits this from the OS,
//      so Japanese-machine users get Japanese automatically without
//      extra config. First entry that matches a supported locale wins.
//   3. Hard default `"en"`
//
// Language tags like `"ja-JP"` are matched by primary subtag, so
// `ja-JP`, `ja-Hira-JP`, etc. all collapse to `"ja"`. When only a
// regional variant is supported (`pt-BR`), tags sharing the primary
// subtag (`pt`, `pt-PT`) resolve to that variant. Completely unknown
// primary subtags (`"sw"`) skip to the next candidate.
//
// `legacy: false` switches vue-i18n to the Composition API mode, so
// components call `const { t } = useI18n()` instead of relying on
// the Options API `this.$t`. CLAUDE.md mandates Composition API.

import { createI18n } from "vue-i18n";
import { messages, isSupportedLocale, resolveLocale, type Locale, type LocaleMessages } from "../lang";

// Schema generic on createI18n — this is what makes `t("common.save")`
// calls across the whole app compile-time checked (the module
// augmentation in src/types/vue-i18n.d.ts alone is not enough; vue-i18n
// v11's `t` overloads still fall back to `string` unless the schema is
// threaded through here). The locale list + message map live in
// `src/lang/index.ts` so the server can reuse them without `vue-i18n`.
type MessageSchema = LocaleMessages;

const DEFAULT_LOCALE: Locale = "en";

function detectLocale(): Locale {
  // 1. explicit env override
  const envLocale = import.meta.env.VITE_LOCALE;
  if (typeof envLocale === "string" && isSupportedLocale(envLocale)) {
    return envLocale;
  }

  // 2. browser / OS preference list
  if (typeof navigator !== "undefined") {
    const preferred = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
    for (const tag of preferred) {
      if (typeof tag !== "string") continue;
      const match = resolveLocale(tag);
      if (match) return match;
    }
  }

  // 3. hard default
  return DEFAULT_LOCALE;
}

const locale = detectLocale();

const i18n = createI18n<[MessageSchema], Locale>({
  legacy: false,
  locale,
  fallbackLocale: "en",
  messages,
});

export default i18n;
