import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from './errors.js';
import type { AppDeps, AppVariables } from './appTypes.js';

export function hashApiKey(apiKey: string, pepper: string): string {
  return createHash('sha256').update(pepper, 'utf8').update('\0', 'utf8').update(apiKey, 'utf8').digest('hex');
}

export function generateApiKey(): string {
  return `lx_${randomBytes(32).toString('base64url')}`;
}

export function keyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12);
}

export function parseBearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) {
        return first.slice(0, 128);
      }
    }
  }
  const realIp = c.req.header('x-real-ip');
  if (realIp && !trustProxy) {
    return 'local';
  }
  if (realIp && trustProxy) {
    return realIp.slice(0, 128);
  }
  return 'local';
}

function tooMany(retryAfterSeconds: number): ApiError {
  return new ApiError(429, 'Too many failed authentication attempts', 'authentication_error', 'rate_limited', {
    'Retry-After': String(retryAfterSeconds),
  });
}

export function customerAuth(deps: AppDeps): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const ip = clientIp(c, deps.config.trustProxy);
    const token = parseBearer(c.req.header('authorization'));
    if (!token) {
      const gate = deps.failLimiter.check(`customer:${ip}`);
      if (gate.limited) {
        throw tooMany(gate.retryAfterSeconds);
      }
      throw new ApiError(401, 'Missing API key. Send Authorization: Bearer lx_...', 'authentication_error', 'invalid_api_key');
    }
    const auth = await deps.repo.getAuthByHash(deps.db, hashApiKey(token, deps.config.keyHashPepper));
    if (!auth) {
      const gate = deps.failLimiter.check(`customer:${ip}`);
      if (gate.limited) {
        throw tooMany(gate.retryAfterSeconds);
      }
      throw new ApiError(401, 'Invalid API key', 'authentication_error', 'invalid_api_key');
    }
    if (auth.apiKey.status !== 'active') {
      throw new ApiError(401, 'API key has been revoked', 'authentication_error', 'key_revoked');
    }
    if (auth.customer.status !== 'active') {
      throw new ApiError(403, 'Customer account is suspended', 'permission_error', 'account_suspended');
    }
    c.set('auth', auth);
    await next();
  };
}

export function adminAuth(deps: AppDeps): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const ip = clientIp(c, deps.config.trustProxy);
    const token = parseBearer(c.req.header('authorization'));
    if (!token || !safeEqual(token, deps.config.adminToken)) {
      const gate = deps.failLimiter.check(`admin:${ip}`);
      if (gate.limited) {
        throw tooMany(gate.retryAfterSeconds);
      }
      throw new ApiError(401, 'Invalid admin token', 'authentication_error', 'invalid_admin_token');
    }
    await next();
  };
}
