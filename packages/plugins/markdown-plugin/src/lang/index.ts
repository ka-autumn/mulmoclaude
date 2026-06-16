import { inject, ref, type Ref } from "vue";
import { PLUGIN_RUNTIME_KEY } from "gui-chat-protocol/vue";
import type { Messages } from "./messages";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import ja from "./ja";
import ko from "./ko";
import ptBR from "./ptBR";
import zh from "./zh";

// Keyed by the host's locale tag (matches MulmoClaude's src/lang/* set).
const MESSAGES = { de, en, es, fr, ja, ko, "pt-BR": ptBR, zh } as const;
type LocaleKey = keyof typeof MESSAGES;

function isSupportedLocale(value: string): value is LocaleKey {
  return Object.prototype.hasOwnProperty.call(MESSAGES, value);
}

const KEY_PREFIX = "pluginMarkdown.";

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** vue-i18n-compatible `t(key, params?)` for the plugin's own message
 *  set. Accepts the dotted `pluginMarkdown.X` keys the templates already
 *  use (the prefix is stripped). Reads `runtime.locale` live, so the UI
 *  re-renders when the host switches locale. Degrades to English when
 *  no host runtime is provided (standalone render). */
export type TFn = (key: string, params?: Record<string, unknown>) => string;

export function useT(): TFn {
  const runtime = inject(PLUGIN_RUNTIME_KEY, undefined);
  const locale: Ref<string> = runtime?.locale ?? ref("en");
  return (key, params) => {
    const table: Messages = isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en;
    const bareKey = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
    const message = table[bareKey as keyof Messages] as string | undefined;
    return message === undefined ? key : interpolate(message, params);
  };
}
