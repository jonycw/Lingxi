import { ApiError } from './errors.js';
import { periodKeyFor } from './db/repository.js';
import type { AppDeps } from './appTypes.js';
import type { AuthContext, BillableModel, ModelDefinition } from './types.js';

export type GateResult = {
  quotaStatus: 'ok' | 'soft-exceeded';
  usedTokens: number;
  hardQuota: number | null;
  softQuota: number | null;
  rateLimit: { limit: number; remaining: number };
  balanceMicros: number;
  windowStart: number;
};

export async function resolveBillableModel(deps: AppDeps, modelId: string): Promise<BillableModel | null> {
  const fromFile = findFileModel(deps, modelId);
  if (!fromFile) {
    if (!deps.config.allowPassthroughModels) {
      return null;
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(modelId)) {
      return null;
    }
    return {
      id: modelId,
      upstream: modelId,
      ownedBy: 'passthrough',
      inputMicrosPerMillion: deps.config.defaultInputMicrosPerMillion,
      outputMicrosPerMillion: deps.config.defaultOutputMicrosPerMillion,
    };
  }
  const override = await deps.repo.getModelOverride(deps.db, modelId);
  const enabled = override?.enabled ?? fromFile.enabled;
  if (!enabled) {
    return null;
  }
  return {
    id: fromFile.id,
    upstream: fromFile.upstream,
    ownedBy: fromFile.ownedBy,
    inputMicrosPerMillion: override?.inputMicrosPerMillion ?? fromFile.inputMicrosPerMillion,
    outputMicrosPerMillion: override?.outputMicrosPerMillion ?? fromFile.outputMicrosPerMillion,
  };
}

function findFileModel(deps: AppDeps, modelId: string): ModelDefinition | undefined {
  return deps.models.list().find((model) => model.id === modelId);
}

export async function listPublicModels(deps: AppDeps): Promise<BillableModel[]> {
  const overrides = await deps.repo.listModelOverrides(deps.db);
  const byId = new Map(overrides.map((row) => [row.model, row]));
  const models: BillableModel[] = [];
  for (const model of deps.models.list()) {
    const override = byId.get(model.id);
    const enabled = override?.enabled ?? model.enabled;
    if (!enabled) {
      continue;
    }
    models.push({
      id: model.id,
      upstream: model.upstream,
      ownedBy: model.ownedBy,
      inputMicrosPerMillion: override?.inputMicrosPerMillion ?? model.inputMicrosPerMillion,
      outputMicrosPerMillion: override?.outputMicrosPerMillion ?? model.outputMicrosPerMillion,
    });
  }
  return models;
}

export async function authorizeChat(deps: AppDeps, auth: AuthContext, now: Date): Promise<GateResult> {
  const windowStart = Math.floor(now.getTime() / 60_000) * 60_000;
  return deps.db.transaction(async (tx) => {
    const customer = await deps.repo.getCustomer(tx, auth.customer.id);
    const apiKey = await deps.repo.getKeyById(tx, auth.apiKey.id);
    if (!customer || customer.status !== 'active') {
      throw new ApiError(403, 'Customer account is suspended', 'permission_error', 'account_suspended');
    }
    if (!apiKey || apiKey.status !== 'active') {
      throw new ApiError(401, 'API key has been revoked', 'authentication_error', 'key_revoked');
    }
    if (customer.balanceMicros <= 0) {
      throw new ApiError(402, 'Insufficient balance', 'insufficient_quota', 'insufficient_balance', {
        'X-Lingxi-Balance-Micros': String(customer.balanceMicros),
      });
    }
    const period = periodKeyFor(apiKey.quotaPeriod, now);
    const quota = await deps.repo.getQuota(tx, apiKey.id, period);
    if (apiKey.hardQuotaTokens !== null && quota.totalTokens >= apiKey.hardQuotaTokens) {
      throw new ApiError(429, 'Hard quota exceeded for this API key', 'insufficient_quota', 'quota_exceeded', {
        'X-Lingxi-Quota-Status': 'hard-exceeded',
        'X-Lingxi-Quota-Used': String(quota.totalTokens),
        'X-Lingxi-Quota-Limit': String(apiKey.hardQuotaTokens),
      });
    }
    const rate = await deps.repo.consumeRateSlot(tx, apiKey.id, windowStart);
    if (rate.requests > apiKey.rateLimitRpm) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + 60_000 - now.getTime()) / 1000));
      throw new ApiError(429, 'Rate limit exceeded for this API key', 'rate_limit_error', 'rate_limit_exceeded', {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(apiKey.rateLimitRpm),
        'X-RateLimit-Remaining': '0',
      });
    }
    if (rate.tokens >= apiKey.rateLimitTpm) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + 60_000 - now.getTime()) / 1000));
      throw new ApiError(429, 'Token rate limit exceeded for this API key', 'rate_limit_error', 'token_rate_limit_exceeded', {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(apiKey.rateLimitTpm),
        'X-RateLimit-Remaining': '0',
      });
    }
    const quotaStatus =
      apiKey.softQuotaTokens !== null && quota.totalTokens >= apiKey.softQuotaTokens ? 'soft-exceeded' : 'ok';
    return {
      quotaStatus,
      usedTokens: quota.totalTokens,
      hardQuota: apiKey.hardQuotaTokens,
      softQuota: apiKey.softQuotaTokens,
      rateLimit: {
        limit: apiKey.rateLimitRpm,
        remaining: Math.max(0, apiKey.rateLimitRpm - rate.requests),
      },
      balanceMicros: customer.balanceMicros,
      windowStart,
    };
  });
}
