// Type declarations for cli-flags.mjs. See the .mjs file for rationale
// on why the shared registry lives in plain JS.

export interface CliFlag {
  flag: string;
  env: string;
  help: string;
}

export const CLI_FLAGS: readonly CliFlag[];

export function flagEnvOverrides(argv: readonly string[]): Record<string, "1">;

export function cliFlagHelpLines(): string;
