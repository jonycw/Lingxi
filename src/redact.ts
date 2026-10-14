const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const LINGXI_KEY = /\blx_[A-Za-z0-9_-]{20,}\b/g;
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const ASSIGNED_SECRET = /\b(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi;

const SENSITIVE_FIELD = /authorization|api[_-]?key|token|secret|password|pepper/i;

export function redactSecrets(input: string): string {
  return input
    .replace(BEARER, 'Bearer [redacted]')
    .replace(LINGXI_KEY, 'lx_[redacted]')
    .replace(OPENAI_KEY, 'sk-[redacted]')
    .replace(ASSIGNED_SECRET, (match) => match.replace(/[=:]\s*\S+/, '=[redacted]'));
}

export function scrubSecrets(input: string, secrets: readonly string[]): string {
  let out = redactSecrets(input);
  for (const secret of secrets) {
    if (secret.length < 8) {
      continue;
    }
    if (out.includes(secret)) {
      out = out.split(secret).join('[redacted]');
    }
  }
  return out;
}

export function redactValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === 'string') {
    return scrubSecrets(value, secrets);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SENSITIVE_FIELD.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = redactValue(inner, secrets);
      }
    }
    return out;
  }
  return undefined;
}
