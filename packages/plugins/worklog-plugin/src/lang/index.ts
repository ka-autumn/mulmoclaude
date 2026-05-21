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
  return computed(() => {
    const loc = locale.value;
    return isSupportedLocale(loc) ? MESSAGES[loc] : MESSAGES.en;
  });
}
