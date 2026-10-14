import { describe, expect, test } from 'vitest';
import { createLogger } from '../src/logger.js';
import { redactSecrets, redactValue, scrubSecrets } from '../src/redact.js';

describe('redaction', () => {
  test('strips bearer tokens, lingxi keys, and upstream-style keys', () => {
    const key = `lx_${'a'.repeat(32)}`;
    const text = `Authorization: Bearer ${key} and sk-proj-abcdefghijklmnopqrstuv`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(key);
    expect(redacted).not.toContain('sk-proj-abcdefghijklmnopqrstuv');
    expect(redacted).toContain('Bearer [redacted]');
    expect(redacted).toContain('sk-[redacted]');
  });

  test('keeps short key prefixes visible', () => {
    expect(redactSecrets('key_prefix=lx_abcd1234')).toContain('lx_abcd1234');
  });

  test('scrubs configured secrets and sensitive fields', () => {
    const secret = 'upstream-secret-do-not-log';
    expect(scrubSecrets(`failed with ${secret}`, [secret])).not.toContain(secret);
    const redacted = redactValue({ authorization: `Bearer ${secret}`, path: '/v1' }, [secret]) as {
      authorization: string;
      path: string;
    };
    expect(redacted.authorization).toBe('[redacted]');
    expect(redacted.path).toBe('/v1');
  });

  test('logger never writes configured secrets', () => {
    const lines: string[] = [];
    const secret = 'admin-token-should-not-appear';
    const logger = createLogger('debug', [secret], (line) => lines.push(line));
    logger.info('request', { note: `token=${secret}`, authorization: 'Bearer abc' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]).toContain('[redacted]');
  });
});
