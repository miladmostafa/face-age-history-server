import { existsSync, readFileSync } from 'node:fs';

/** Fill unset environment variables from .env and .env.local. Existing variables win. */
export function loadEnvFiles(cwd = process.cwd()): void {
  for (const name of ['.env', '.env.local']) {
    const file = `${cwd}/${name}`;
    if (!existsSync(file)) continue;
    applyEnvText(readFileSync(file, 'utf8'));
  }
}

export function applyEnvText(text: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}
