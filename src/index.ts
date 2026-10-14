import './silenceSqliteWarning.js';
import type { ServerType } from '@hono/node-server';
import { loadConfig } from './config.js';
import { loadDotEnv } from './env.js';
import { createLogger } from './logger.js';
import { scrubSecrets } from './redact.js';
import { SERVICE_NAME, VERSION } from './version.js';

function startupSecrets(): string[] {
  const values = [
    process.env.ADMIN_TOKEN,
    process.env.UPSTREAM_API_KEY,
    process.env.PAYMENT_WEBHOOK_SECRET,
    process.env.KEY_HASH_PEPPER,
  ];
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && databaseUrl.includes('@')) {
    values.push(databaseUrl);
  }
  return values.filter((value): value is string => Boolean(value && value.length >= 8));
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`${SERVICE_NAME} failed to start: ${scrubSecrets(message, startupSecrets())}\n`);
  process.exit(1);
}

loadDotEnv();

const config = (() => {
  try {
    return loadConfig(process.env);
  } catch (error) {
    fail(error);
  }
})();

const logger = createLogger(config.logLevel, config.secrets);
const { migrate, openDatabase } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { serve } = await import('@hono/node-server');
const db = openDatabase(config);

let server: ServerType | undefined;

async function main(): Promise<void> {
  await migrate(db, { usageRetentionDays: config.usageRetentionDays });
  const { createRepository } = await import('./db/repository.js');
  const { createModelCatalog } = await import('./models.js');
  const { createRuntimeSettings } = await import('./runtimeSettings.js');
  const repo = createRepository();
  const models = createModelCatalog(config.modelConfigPath);
  const runtime = createRuntimeSettings({ config, db, repo, models });
  const live = await runtime.effective();
  const app = createApp({ config, db, repo, models, logger, runtime });
  if (config.adminToken === 'dev-admin-token-change-me') {
    logger.warn('admin_token_is_example', {
      hint: 'Change ADMIN_TOKEN before exposing Lingxi beyond this machine',
    });
  }
  if (live.mode === 'mock') {
    logger.warn('upstream_mock', {
      hint: 'Chat uses the local mock until an upstream key is saved in the admin console or set with UPSTREAM_API_KEY.',
    });
  }
  server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    (info) => {
      logger.info('listening', {
        service: SERVICE_NAME,
        version: VERSION,
        host: info.address,
        port: info.port,
        database: db.dialect,
        upstream: live.mode,
        upstream_base_url: live.mode === 'proxy' ? live.baseUrl : undefined,
      });
    },
  );
}

async function shutdown(signal: string): Promise<void> {
  logger.info('shutdown', { signal });
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
  await db.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

main().catch((error: unknown) => {
  fail(error);
});
