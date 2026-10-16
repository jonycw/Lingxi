import path from 'node:path';
import type { LogLevel } from './logger.js';

const EXAMPLE_ADMIN_TOKEN = 'dev-admin-token-change-me';

export type UpstreamMode = 'mock' | 'proxy';

export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  upstreamTimeoutMs: number;
  upstreamMock: boolean;
  upstreamMode: UpstreamMode;
  adminToken: string;
  corsOrigins: string[];
  maxBodyBytes: number;
  maxMessages: number;
  maxCompletionTokens: number;
  logLevel: LogLevel;
  keyHashPepper: string;
  modelConfigPath: string;
  allowPassthroughModels: boolean;
  defaultInputMicrosPerMillion: number;
  defaultOutputMicrosPerMillion: number;
  paymentWebhookSecret: string;
  authFailLimit: number;
  authFailWindowMs: number;
  usageRetentionDays: number;
  trustProxy: boolean;
  skillInjectMaxChars: number;
  secrets: string[];
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes') {
    return true;
  }
  if (value === 'false' || value === '0' || value === 'no') {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed === '*') {
    return ['*'];
  }
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseLogLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? 'info').trim().toLowerCase();
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  throw new Error('LOG_LEVEL must be debug, info, warn, or error');
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development').trim() || 'development';
  const adminToken = required(env, 'ADMIN_TOKEN');
  const databaseUrl = required(env, 'DATABASE_URL');
  if (nodeEnv === 'production') {
    if (adminToken === EXAMPLE_ADMIN_TOKEN || adminToken.length < 16) {
      throw new Error('ADMIN_TOKEN must be replaced and be at least 16 characters when NODE_ENV=production');
    }
  }

  const upstreamApiKey = (env.UPSTREAM_API_KEY ?? '').trim();
  const upstreamMock = boolEnv(env, 'UPSTREAM_MOCK', false);
  const upstreamMode: UpstreamMode = upstreamMock || upstreamApiKey.length === 0 ? 'mock' : 'proxy';
  const upstreamBaseUrl = (env.UPSTREAM_BASE_URL ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  if (upstreamMode === 'proxy' && !/^https?:\/\//i.test(upstreamBaseUrl)) {
    throw new Error('UPSTREAM_BASE_URL must be an http or https URL when an upstream key is set');
  }

  const keyHashPepper = env.KEY_HASH_PEPPER ?? '';
  const paymentWebhookSecret = (env.PAYMENT_WEBHOOK_SECRET ?? '').trim();
  const secrets = [adminToken, upstreamApiKey, keyHashPepper, paymentWebhookSecret].filter((value) => value.length >= 8);
  if (databaseUrl.includes('@')) {
    secrets.push(databaseUrl);
  }

  return {
    nodeEnv,
    host: (env.LINGXI_HOST ?? env.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
    port: intEnv(env, 'PORT', 8787, 1, 65535),
    databaseUrl,
    upstreamBaseUrl,
    upstreamApiKey,
    upstreamTimeoutMs: intEnv(env, 'UPSTREAM_TIMEOUT_MS', 120_000, 1000, 600_000),
    upstreamMock,
    upstreamMode,
    adminToken,
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
    maxBodyBytes: intEnv(env, 'MAX_BODY_BYTES', 1_048_576, 1024, 32_000_000),
    maxMessages: intEnv(env, 'MAX_MESSAGES', 200, 1, 10_000),
    maxCompletionTokens: intEnv(env, 'MAX_COMPLETION_TOKENS', 32_768, 1, 2_000_000),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    keyHashPepper,
    modelConfigPath: path.resolve(env.MODEL_CONFIG_PATH?.trim() || './config/models.json'),
    allowPassthroughModels: boolEnv(env, 'ALLOW_PASSTHROUGH_MODELS', false),
    defaultInputMicrosPerMillion: intEnv(env, 'DEFAULT_INPUT_MICROS_PER_MILLION', 1_000_000, 0, 1_000_000_000_000_000),
    defaultOutputMicrosPerMillion: intEnv(env, 'DEFAULT_OUTPUT_MICROS_PER_MILLION', 4_000_000, 0, 1_000_000_000_000_000),
    paymentWebhookSecret,
    authFailLimit: intEnv(env, 'AUTH_FAIL_LIMIT', 30, 1, 100_000),
    authFailWindowMs: 60_000,
    usageRetentionDays: intEnv(env, 'USAGE_RETENTION_DAYS', 0, 0, 3650),
    trustProxy: boolEnv(env, 'TRUST_PROXY', false),
    skillInjectMaxChars: intEnv(env, 'SKILL_INJECT_MAX_CHARS', 12_000, 256, 200_000),
    secrets,
  };
}
