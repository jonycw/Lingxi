import type { Hono } from 'hono';
import type { FailLimiter } from './abuse.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/executor.js';
import type { Repository } from './db/repository.js';
import type { Logger } from './logger.js';
import type { ModelCatalog } from './models.js';
import type { RuntimeSettings } from './runtimeSettings.js';
import type { AuthContext } from './types.js';
import type { Upstream } from './upstream.js';

export type AppVariables = {
  requestId: string;
  auth?: AuthContext;
};

export type AppDeps = {
  config: AppConfig;
  db: Db;
  repo: Repository;
  logger: Logger;
  models: ModelCatalog;
  upstream: Upstream;
  runtime: RuntimeSettings;
  now: () => Date;
  failLimiter: FailLimiter;
};

export type LingxiApp = Hono<{ Variables: AppVariables }>;
