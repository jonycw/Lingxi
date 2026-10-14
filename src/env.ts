import { existsSync, readFileSync } from 'node:fs';

/** Parse a dotenv file. Later lines do not override earlier ones. Quotes and `export` are accepted. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) {
      key = key.slice('export '.length).trim();
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || out[key] !== undefined) {
      continue;
    }
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Load `.env` without overriding variables already present in the environment. */
export function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) {
    return;
  }
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
