import { computed, inject, ref, type ComputedRef, type Ref } from "vue";
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

// Reactive message table for the active locale, sourced from the host via
// gui-chat-protocol's BrowserPluginRuntime (PLUGIN_RUNTIME_KEY) — the same
// channel @mulmoclaude/form-plugin uses. Degrades to English when no host
// runtime is provided, so the package still renders standalone.
export function useT(): ComputedRef<Messages> {
  const runtime = inject(PLUGIN_RUNTIME_KEY, undefined);
  const locale: Ref<string> = runtime?.locale ?? ref("en");
  return computed(() => (isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en));
}
