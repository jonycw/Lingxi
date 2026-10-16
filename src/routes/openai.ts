import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import { authorizeChat, listPublicModels, resolveBillableModel, type GateResult } from '../billing.js';
import { ApiError } from '../errors.js';
import { pageParams, readJson } from '../http.js';
import { periodKeyFor } from '../db/repository.js';
import { applyChatSkills, listSkillPacks, skillCustomerJson } from '../skills.js';
import { estimateMessages, estimateTokens, extractDeltaText, zeroUsage } from '../tokens.js';
import { formatCredits, usageJson, type TokenUsage } from '../types.js';
import { upstreamRequestBody } from '../upstream.js';
import type { AppDeps, AppVariables, LingxiApp } from '../appTypes.js';

const ROLES = new Set(['system', 'user', 'assistant', 'tool', 'developer', 'function']);
const CATALOG_CREATED = 1_735_689_600;

function parseChat(body: unknown, deps: AppDeps): { model: string; stream: boolean; raw: Record<string, unknown> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Request body must be a JSON object', 'invalid_request_error', 'invalid_json');
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.model !== 'string' || raw.model.trim() === '') {
    throw new ApiError(400, 'model is required', 'invalid_request_error', 'model_required');
  }
  if (raw.model.length > 128) {
    throw new ApiError(400, 'model is too long', 'invalid_request_error', 'model_required');
  }
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    throw new ApiError(400, 'messages must be a non-empty array', 'invalid_request_error', 'messages_required');
  }
  if (raw.messages.length > deps.config.maxMessages) {
    throw new ApiError(
      400,
      `messages exceeds the limit of ${deps.config.maxMessages}`,
      'invalid_request_error',
      'too_many_messages',
    );
  }
  for (const message of raw.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new ApiError(400, 'Each message must be an object', 'invalid_request_error', 'invalid_message');
    }
    const role = (message as { role?: unknown }).role;
    if (typeof role !== 'string' || !ROLES.has(role)) {
      throw new ApiError(400, 'Message role is invalid', 'invalid_request_error', 'invalid_message_role');
    }
  }
  if (raw.stream !== undefined && typeof raw.stream !== 'boolean') {
    throw new ApiError(400, 'stream must be a boolean', 'invalid_request_error', 'invalid_stream');
  }
  for (const field of ['max_tokens', 'max_completion_tokens'] as const) {
    const value = raw[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new ApiError(400, `${field} must be a positive integer`, 'invalid_request_error', 'invalid_max_tokens');
    }
    if (value > deps.config.maxCompletionTokens) {
      throw new ApiError(
        400,
        `${field} exceeds the gateway limit of ${deps.config.maxCompletionTokens}`,
        'invalid_request_error',
        'max_tokens_exceeded',
      );
    }
  }
  return { model: raw.model, stream: raw.stream === true, raw };
}

function applyGateHeaders(c: Context<{ Variables: AppVariables }>, gate: GateResult): void {
  c.header('X-Lingxi-Quota-Status', gate.quotaStatus);
  c.header('X-Lingxi-Quota-Used', String(gate.usedTokens));
  if (gate.hardQuota !== null) {
    c.header('X-Lingxi-Quota-Limit', String(gate.hardQuota));
  }
  c.header('X-RateLimit-Limit', String(gate.rateLimit.limit));
  c.header('X-RateLimit-Remaining', String(gate.rateLimit.remaining));
}

export function registerOpenAiRoutes(app: LingxiApp, deps: AppDeps): void {
  app.get('/v1/models', async (c) => {
    const models = await listPublicModels(deps);
    return c.json({
      object: 'list',
      data: models.map((model) => ({
        id: model.id,
        object: 'model',
        created: CATALOG_CREATED,
        owned_by: model.ownedBy,
      })),
    });
  });

  app.get('/v1/me', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new ApiError(401, 'Invalid API key', 'authentication_error', 'invalid_api_key');
    }
    const customer = (await deps.repo.getCustomer(deps.db, auth.customer.id)) ?? auth.customer;
    const key = (await deps.repo.getKeyById(deps.db, auth.apiKey.id)) ?? auth.apiKey;
    const period = periodKeyFor(key.quotaPeriod, deps.now());
    const quota = await deps.repo.getQuota(deps.db, key.id, period);
    return c.json({
      object: 'lingxi.account',
      customer: {
        id: customer.id,
        name: customer.name,
        status: customer.status,
        balance_micros: customer.balanceMicros,
        balance_credits: formatCredits(customer.balanceMicros),
      },
      api_key: {
        id: key.id,
        name: key.name,
        prefix: key.keyPrefix,
        status: key.status,
        rate_limit_rpm: key.rateLimitRpm,
        rate_limit_tpm: key.rateLimitTpm,
        soft_quota_tokens: key.softQuotaTokens,
        hard_quota_tokens: key.hardQuotaTokens,
        quota_period: key.quotaPeriod,
      },
      quota: {
        period: key.quotaPeriod,
        period_key: period,
        total_tokens: quota.totalTokens,
        requests: quota.requests,
        cost_micros: quota.costMicros,
        soft_quota_tokens: key.softQuotaTokens,
        hard_quota_tokens: key.hardQuotaTokens,
      },
    });
  });

  app.get('/v1/usage', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new ApiError(401, 'Invalid API key', 'authentication_error', 'invalid_api_key');
    }
    const page = pageParams(c, 50, 200);
    const events = await deps.repo.listUsage(deps.db, {
      apiKeyId: auth.apiKey.id,
      limit: page.limit,
      offset: page.offset,
    });
    const period = periodKeyFor(auth.apiKey.quotaPeriod, deps.now());
    const quota = await deps.repo.getQuota(deps.db, auth.apiKey.id, period);
    const customer = await deps.repo.getCustomer(deps.db, auth.customer.id);
    const balance = customer?.balanceMicros ?? auth.customer.balanceMicros;
    return c.json({
      object: 'list',
      balance_micros: balance,
      balance_credits: formatCredits(balance),
      quota: {
        period: auth.apiKey.quotaPeriod,
        period_key: period,
        total_tokens: quota.totalTokens,
        requests: quota.requests,
        cost_micros: quota.costMicros,
        soft_quota_tokens: auth.apiKey.softQuotaTokens,
        hard_quota_tokens: auth.apiKey.hardQuotaTokens,
      },
      data: events.map((event) => usageJson(event, false)),
    });
  });

  app.get('/v1/skills', async (c) => {
    const skills = await listSkillPacks(deps, true);
    return c.json({ object: 'list', data: skills.map(skillCustomerJson) });
  });

  app.post('/v1/chat/completions', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      throw new ApiError(401, 'Invalid API key', 'authentication_error', 'invalid_api_key');
    }
    const parsed = parseChat(await readJson(c), deps);
    const model = await resolveBillableModel(deps, parsed.model);
    if (!model) {
      throw new ApiError(
        404,
        `The model '${parsed.model}' does not exist or is not enabled`,
        'invalid_request_error',
        'model_not_found',
      );
    }
    const prepared = await applyChatSkills(deps, parsed.raw);
    const gate = await authorizeChat(deps, auth, deps.now());
    const started = Date.now();
    const body = upstreamRequestBody(
      { ...parsed.raw, messages: prepared.messages },
      model.upstream,
      parsed.stream,
    );
    if (prepared.appliedIds.length > 0) {
      c.header('X-Lingxi-Skills', prepared.appliedIds.join(','));
    }
    let billed = false;
    const record = async (input: { status: 'ok' | 'error'; usage: TokenUsage; errorCode: string | null; stream: boolean }) => {
      if (billed) {
        return null;
      }
      billed = true;
      try {
        return await deps.repo.recordUsage(deps.db, {
          requestId: c.get('requestId'),
          apiKeyId: auth.apiKey.id,
          customerId: auth.customer.id,
          model: model.id,
          upstreamModel: model.upstream,
          promptTokens: input.usage.promptTokens,
          completionTokens: input.usage.completionTokens,
          status: input.status,
          errorCode: input.errorCode,
          latencyMs: Math.max(0, Date.now() - started),
          stream: input.stream,
          inputMicrosPerMillion: model.inputMicrosPerMillion,
          outputMicrosPerMillion: model.outputMicrosPerMillion,
          quotaPeriod: auth.apiKey.quotaPeriod,
          rateWindowStart: gate.windowStart,
          now: deps.now().toISOString(),
        });
      } catch (error) {
        deps.logger.error('billing_failed', {
          request_id: c.get('requestId'),
          message: error instanceof Error ? error.message : 'failed',
        });
        return null;
      }
    };

    const upstreamInput = {
      publicModel: model.id,
      upstreamModel: model.upstream,
      body,
      messages: prepared.messages,
      appliedSkillIds: prepared.appliedIds,
    };

    if (parsed.stream) {
      let session: Awaited<ReturnType<AppDeps['upstream']['openStream']>>;
      try {
        session = await deps.upstream.openStream(upstreamInput);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'upstream_error';
        await record({ status: 'error', usage: zeroUsage(), errorCode: code, stream: true });
        throw error;
      }
      applyGateHeaders(c, gate);
      return streamSSE(c, async (stream) => {
        let usage = zeroUsage();
        let content = '';
        let sawChunk = false;
        try {
          for await (const event of session.events()) {
            if (event.type === 'chunk') {
              sawChunk = true;
              content += extractDeltaText(event.payload);
              if (event.usage) {
                usage = event.usage;
              }
              await stream.writeSSE({ data: JSON.stringify(event.payload) });
            } else {
              usage = event.usage;
            }
          }
          if (usage.totalTokens === 0) {
            const promptTokens = estimateMessages(prepared.messages);
            const completionTokens = estimateTokens(content);
            usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
          }
          await stream.writeSSE({ data: '[DONE]' });
          await record({ status: 'ok', usage, errorCode: null, stream: true });
        } catch (error) {
          deps.logger.error('stream_failed', {
            request_id: c.get('requestId'),
            message: error instanceof Error ? error.message : 'failed',
          });
          if (!sawChunk) {
            await record({ status: 'error', usage: zeroUsage(), errorCode: 'stream_failed', stream: true });
            return;
          }
          if (usage.totalTokens === 0) {
            const promptTokens = estimateMessages(prepared.messages);
            const completionTokens = estimateTokens(content);
            usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
          }
          await record({ status: 'ok', usage, errorCode: null, stream: true });
        }
      });
    }

    try {
      const result = await deps.upstream.complete(upstreamInput);
      const bill = await record({ status: 'ok', usage: result.usage, errorCode: null, stream: false });
      applyGateHeaders(c, gate);
      if (bill) {
        c.header('X-Lingxi-Balance-Micros', String(bill.balanceMicros));
        c.header('X-Lingxi-Cost-Micros', String(bill.costMicros));
        c.header('X-Lingxi-Quota-Used', String(bill.quota.totalTokens));
      }
      return c.json(result.json);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'upstream_error';
      await record({ status: 'error', usage: zeroUsage(), errorCode: code, stream: false });
      throw error;
    }
  });
}
