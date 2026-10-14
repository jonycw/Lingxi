import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { createFailLimiter } from './abuse.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/executor.js';
import { createRepository, type Repository } from './db/repository.js';
import { ApiError, errorBody } from './errors.js';
import { createLogger, type Logger } from './logger.js';
import { createModelCatalog, type ModelCatalog } from './models.js';
import { registerPaymentWebhook } from './payments.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerOpenAiRoutes } from './routes/openai.js';
import { registerConsole } from './routes/ui.js';
import { createRuntimeSettings, type RuntimeSettings } from './runtimeSettings.js';
import { createUpstream, type FetchLike, type Upstream } from './upstream.js';
import type { AppDeps, AppVariables, LingxiApp } from './appTypes.js';
import { adminAuth, customerAuth } from './auth.js';
import { SERVICE_NAME, VERSION } from './version.js';

export type CreateAppOptions = {
  config: AppConfig;
  db: Db;
  repo?: Repository;
  logger?: Logger;
  models?: ModelCatalog;
  upstream?: Upstream;
  fetchImpl?: FetchLike;
  now?: () => Date;
  failLimiter?: ReturnType<typeof createFailLimiter>;
  runtime?: RuntimeSettings;
};

function registerHealth(app: LingxiApp, deps: AppDeps): void {
  const handler = async (c: Context<{ Variables: AppVariables }>) => {
    try {
      await deps.db.get('SELECT 1 AS ok');
      const live = await deps.runtime.effective();
      return c.json({
        status: 'ok',
        service: SERVICE_NAME,
        version: VERSION,
        uptime_seconds: Math.round(process.uptime()),
        database: { status: 'ok', dialect: deps.db.dialect },
        upstream: live.mode,
      });
    } catch {
      return c.json(
        {
          status: 'error',
          service: SERVICE_NAME,
          version: VERSION,
          database: { status: 'error', dialect: deps.db.dialect },
          upstream: deps.config.upstreamMode,
        },
        503,
      );
    }
  };
  app.get('/health', handler);
  app.get('/healthz', handler);
}

export function createApp(options: CreateAppOptions): LingxiApp {
  const config = options.config;
  const repo = options.repo ?? createRepository();
  const models = options.models ?? createModelCatalog(config.modelConfigPath);
  models.list();
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? createLogger(config.logLevel, config.secrets);
  const runtime =
    options.runtime ??
    createRuntimeSettings({
      config,
      db: options.db,
      repo,
      models,
      now,
    });
  const upstream =
    options.upstream ??
    createUpstream(config, {
      fetchImpl: options.fetchImpl,
      now,
      logger,
      resolve: () => runtime.effective(),
    });
  const failLimiter =
    options.failLimiter ?? createFailLimiter(config.authFailLimit, config.authFailWindowMs, () => now().getTime());
  const deps: AppDeps = {
    config,
    db: options.db,
    repo,
    logger,
    models,
    upstream,
    runtime,
    now,
    failLimiter,
  };

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    await next();
  });
  if (config.corsOrigins.length > 0) {
    app.use(
      '*',
      cors({
        origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins,
        allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Lingxi-Signature'],
        exposeHeaders: [
          'X-Request-Id',
          'X-Lingxi-Balance-Micros',
          'X-Lingxi-Cost-Micros',
          'X-Lingxi-Quota-Status',
          'X-Lingxi-Quota-Used',
          'X-Lingxi-Quota-Limit',
          'X-RateLimit-Limit',
          'X-RateLimit-Remaining',
          'Retry-After',
        ],
        maxAge: 86_400,
      }),
    );
  }
  app.use('*', secureHeaders());
  app.use(
    '*',
    bodyLimit({
      maxSize: config.maxBodyBytes,
      onError: (c) =>
        c.json(
          {
            error: {
              message: 'Request body is too large',
              type: 'invalid_request_error',
              code: 'body_too_large',
            },
          },
          413,
        ),
    }),
  );
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    const path = c.req.path;
    const fields = {
      request_id: c.get('requestId'),
      method: c.req.method,
      path,
      status: c.res.status,
      ms: Date.now() - started,
      key_prefix: c.get('auth')?.apiKey.keyPrefix,
    };
    if (path === '/health' || path === '/healthz') {
      logger.debug('request', fields);
    } else {
      logger.info('request', fields);
    }
  });

  app.onError((err, c) => {
    if (!c.req.header('x-request-id')) {
      const requestId = c.get('requestId');
      if (requestId) {
        c.header('X-Request-Id', requestId);
      }
    }
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    if (err instanceof ApiError) {
      for (const [key, value] of Object.entries(err.headers)) {
        c.header(key, value);
      }
      const payload = {
        request_id: c.get('requestId'),
        status: err.status,
        code: err.code,
        detail: err.logDetail,
      };
      if (err.status >= 500) {
        logger.error('api_error', payload);
      } else {
        logger.warn('api_error', payload);
      }
      return c.json(errorBody(err), err.status);
    }
    logger.error('unhandled', {
      request_id: c.get('requestId'),
      message: err instanceof Error ? err.message : 'error',
    });
    return c.json(
      { error: { message: 'Internal server error', type: 'server_error', code: 'internal_error' } },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' } }, 404),
  );

  registerHealth(app, deps);
  registerConsole(app);
  registerPaymentWebhook(app, deps);
  app.use('/admin/*', adminAuth(deps));
  registerAdminRoutes(app, deps);
  app.use('/v1/*', customerAuth(deps));
  registerOpenAiRoutes(app, deps);
  return app;
}
