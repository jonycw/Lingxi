import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';
import { parseEnv } from '../src/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('configuration', () => {
  test('the example env boots in mock mode and contains no upstream key', () => {
    const raw = readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    const parsed = parseEnv(raw);
    expect(parsed.UPSTREAM_API_KEY).toBe('');
    expect(parsed.ADMIN_TOKEN).toBe('dev-admin-token-change-me');
    expect(parsed.DATABASE_URL).toContain('lingxi.sqlite');
    const config = loadConfig({ ...parsed, NODE_ENV: 'development' });
    expect(config.upstreamMode).toBe('mock');
    expect(config.upstreamApiKey).toBe('');
    expect(config.port).toBe(8787);
    expect(config.adminToken).toBe('dev-admin-token-change-me');
  });

  test('production refuses the example admin token', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        ADMIN_TOKEN: 'dev-admin-token-change-me',
        DATABASE_URL: 'file:./data/lingxi.sqlite',
      }),
    ).toThrow(/ADMIN_TOKEN/);
  });

  test('missing required variables fail fast', () => {
    expect(() => loadConfig({ DATABASE_URL: 'file:./data/lingxi.sqlite' })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ ADMIN_TOKEN: 'a-long-enough-token' })).toThrow(/DATABASE_URL/);
  });

  test('an upstream key switches the gateway to proxy mode', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      ADMIN_TOKEN: 'dev-admin-token-change-me',
      DATABASE_URL: 'file:./data/lingxi.sqlite',
      UPSTREAM_API_KEY: 'owner-key-value',
      UPSTREAM_BASE_URL: 'https://upstream.example/v1',
      UPSTREAM_MOCK: 'false',
    });
    expect(config.upstreamMode).toBe('proxy');
  });
});
