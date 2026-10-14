import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { migrate, openDatabase, type Db } from '../src/db/index.js';
import { createLogger, type Logger } from '../src/logger.js';
import type { FetchLike } from '../src/upstream.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type TestContext = {
  app: ReturnType<typeof createApp>;
  db: Db;
  config: AppConfig;
  dir: string;
  logs: string[];
  logger: Logger;
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
  close: () => Promise<void>;
};

export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const databaseDir = mkdtempSync(path.join(tmpdir(), 'lingxi-'));
  const base: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '8787',
    LINGXI_HOST: '127.0.0.1',
    ADMIN_TOKEN: 'test-admin-token-value',
    DATABASE_URL: `file:${path.join(databaseDir, 'test.sqlite')}`,
    UPSTREAM_BASE_URL: 'https://upstream.example/v1',
    UPSTREAM_API_KEY: '',
    UPSTREAM_MOCK: 'false',
    CORS_ORIGINS: '*',
    MODEL_CONFIG_PATH: path.join(repoRoot, 'config', 'models.json'),
    AUTH_FAIL_LIMIT: '1000',
    LOG_LEVEL: 'info',
    PAYMENT_WEBHOOK_SECRET: '',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      base[key] = value;
    }
  }
  return base;
}

export async function createTestContext(options?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<TestContext> {
  const env = testEnv(options?.env);
  const dir = path.dirname(env.DATABASE_URL!.replace(/^file:/, ''));
  const config = loadConfig(env);
  const db = openDatabase(config);
  await migrate(db);
  await migrate(db);
  const logs: string[] = [];
  const logger = createLogger(config.logLevel, config.secrets, (line) => {
    logs.push(line);
  });
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    fetchCalls.push({ url, init });
    if (options?.fetchImpl) {
      return options.fetchImpl(url, init);
    }
    return new Response(JSON.stringify({ error: { message: 'fetch not stubbed' } }), { status: 500 });
  };
  const app = createApp({
    config,
    db,
    logger,
    now: options?.now ?? (() => new Date('2026-10-14T00:00:00.000Z')),
    fetchImpl,
  });
  return {
    app,
    db,
    config,
    dir,
    logs,
    logger,
    fetchCalls,
    async close() {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const adminToken = 'test-admin-token-value';

export function adminHeaders(token = adminToken): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function issueCustomerKey(
  app: TestContext['app'],
  options?: { credits?: number; key?: Record<string, unknown>; name?: string },
) {
  const created = await app.request('/admin/customers', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      name: options?.name ?? 'demo',
      initial_credits: options?.credits ?? 100,
    }),
  });
  expect(created.status).toBe(201);
  const customer = (await created.json()) as { id: string; balance_micros: number };
  const keyRes = await app.request(`/admin/customers/${customer.id}/keys`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'laptop', ...(options?.key ?? {}) }),
  });
  expect(keyRes.status).toBe(201);
  const key = (await keyRes.json()) as { id: string; key: string; prefix: string };
  return { customer, key };
}

export function chatRequest(app: TestContext['app'], apiKey: string, body: Record<string, unknown>) {
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
