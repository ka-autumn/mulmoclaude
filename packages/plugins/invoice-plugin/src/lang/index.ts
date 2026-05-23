/* eslint-disable id-length */
import { computed } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";
import zh from "./zh";
import ko from "./ko";
import es from "./es";
import ptBR from "./pt-BR";
import fr from "./fr";
import de from "./de";

const MESSAGES = {
  en,
  ja,
  zh,
  ko,
  es,
  "pt-BR": ptBR,
  fr,
  de,
} as const;

type LocaleKey = keyof typeof MESSAGES;

function isSupportedLocale(value: string): value is LocaleKey {
  return value in MESSAGES;
}

export function useT() {
  const { locale } = useRuntime();
  return computed(() => (isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en));
}

/** Substitute `{key}` placeholders in a translated string with caller
 *  values. Lightweight stand-in for vue-i18n's interpolation since the
 *  plugin doesn't pull in vue-i18n. */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => (Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`));
}
