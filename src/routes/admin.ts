import { generateApiKey, hashApiKey, keyPrefix } from '../auth.js';
import { ApiError } from '../errors.js';
import {
  asObject,
  optionalNullableInt,
  optionalString,
  pageParams,
  parseCreditAmount,
  parseEmail,
  readJson,
  timeParam,
} from '../http.js';
import { usageJson } from './openai.js';
import { apiKeyJson, customerJson, formatCredits, type ApiKeyRecord, type QuotaPeriod } from '../types.js';
import type { AppDeps, LingxiApp } from '../appTypes.js';
import type { KeyPatch } from '../db/repository.js';

const MAX_PRICE = 1_000_000_000_000_000;

function requireText(value: unknown, name: string, max: number): string {
  const parsed = optionalString(value, name, max);
  if (!parsed) {
    throw new ApiError(400, `${name} is required`, 'invalid_request_error', 'invalid_parameter');
  }
  return parsed;
}

function parseNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || value.length > 500) {
    throw new ApiError(400, 'note must be a string up to 500 characters', 'invalid_request_error', 'invalid_note');
  }
  return value;
}

function parseQuotaPeriod(value: unknown): QuotaPeriod | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'month' || value === 'total') {
    return value;
  }
  throw new ApiError(400, 'quota_period must be month or total', 'invalid_request_error', 'invalid_parameter');
}

function assertQuotaOrder(soft: number | null, hard: number | null): void {
  if (soft !== null && hard !== null && soft > hard) {
    throw new ApiError(
      400,
      'soft_quota_tokens cannot exceed hard_quota_tokens',
      'invalid_request_error',
      'invalid_quota',
    );
  }
}

async function requireCustomer(deps: AppDeps, id: string) {
  const customer = await deps.repo.getCustomer(deps.db, id);
  if (!customer) {
    throw new ApiError(404, 'Customer not found', 'invalid_request_error', 'customer_not_found');
  }
  return customer;
}

async function catalog(deps: AppDeps) {
  const overrides = await deps.repo.listModelOverrides(deps.db);
  const byId = new Map(overrides.map((row) => [row.model, row]));
  return deps.models.list().map((model) => {
    const override = byId.get(model.id) ?? null;
    const enabled = override?.enabled ?? model.enabled;
    const input = override?.inputMicrosPerMillion ?? model.inputMicrosPerMillion;
    const output = override?.outputMicrosPerMillion ?? model.outputMicrosPerMillion;
    return {
      id: model.id,
      upstream: model.upstream,
      owned_by: model.ownedBy,
      enabled,
      file: {
        enabled: model.enabled,
        input_micros_per_million: model.inputMicrosPerMillion,
        output_micros_per_million: model.outputMicrosPerMillion,
      },
      override: override
        ? {
            enabled: override.enabled,
            input_micros_per_million: override.inputMicrosPerMillion,
            output_micros_per_million: override.outputMicrosPerMillion,
            updated_at: override.updatedAt,
          }
        : null,
      effective: {
        enabled,
        input_micros_per_million: input,
        output_micros_per_million: output,
      },
    };
  });
}

function ledgerJson(entry: {
  id: string;
  customerId: string;
  deltaMicros: number;
  balanceAfterMicros: number;
  reason: string;
  refId: string | null;
  note: string | null;
  createdAt: string;
}) {
  return {
    id: entry.id,
    customer_id: entry.customerId,
    delta_micros: entry.deltaMicros,
    balance_after_micros: entry.balanceAfterMicros,
    balance_after_credits: formatCredits(entry.balanceAfterMicros),
    reason: entry.reason,
    ref_id: entry.refId,
    note: entry.note,
    created_at: entry.createdAt,
  };
}

export function registerAdminRoutes(app: LingxiApp, deps: AppDeps): void {
  app.post('/admin/customers', async (c) => {
    const body = asObject(await readJson(c));
    const name = requireText(body.name, 'name', 200);
    const email = 'email' in body && body.email !== undefined ? parseEmail(body.email) : null;
    const initialMicros = parseCreditAmount(
      {
        credits: body.initial_credits,
        amount_micros: body.initial_balance_micros,
      },
      true,
    );
    const customer = await deps.repo.createCustomer(deps.db, {
      name,
      email,
      initialMicros,
      note: parseNote(body.note),
      now: deps.now().toISOString(),
    });
    return c.json(customerJson(customer), 201);
  });

  app.get('/admin/customers', async (c) => {
    const page = pageParams(c, 50, 200);
    const customers = await deps.repo.listCustomers(deps.db, page.limit, page.offset);
    return c.json({ object: 'list', data: customers.map(customerJson) });
  });

  app.get('/admin/customers/:id', async (c) => {
    const customer = await requireCustomer(deps, c.req.param('id'));
    const keys = await deps.repo.listKeys(deps.db, customer.id);
    return c.json({ ...customerJson(customer), keys: keys.map(apiKeyJson) });
  });

  app.patch('/admin/customers/:id', async (c) => {
    const id = c.req.param('id');
    await requireCustomer(deps, id);
    const body = asObject(await readJson(c));
    const patch: { name?: string; email?: string | null; status?: 'active' | 'suspended'; now: string } = {
      now: deps.now().toISOString(),
    };
    if ('name' in body) {
      patch.name = requireText(body.name, 'name', 200);
    }
    if ('email' in body) {
      patch.email = parseEmail(body.email);
    }
    if ('status' in body) {
      if (body.status !== 'active' && body.status !== 'suspended') {
        throw new ApiError(400, 'status must be active or suspended', 'invalid_request_error', 'invalid_parameter');
      }
      patch.status = body.status;
    }
    if (patch.name === undefined && patch.email === undefined && patch.status === undefined) {
      throw new ApiError(400, 'No customer fields to update', 'invalid_request_error', 'invalid_parameter');
    }
    const updated = await deps.repo.updateCustomer(deps.db, id, patch);
    if (!updated) {
      throw new ApiError(404, 'Customer not found', 'invalid_request_error', 'customer_not_found');
    }
    return c.json(customerJson(updated));
  });

  app.post('/admin/customers/:id/credit', async (c) => {
    const id = c.req.param('id');
    await requireCustomer(deps, id);
    const body = asObject(await readJson(c));
    const amountMicros = parseCreditAmount(body, false);
    const customer = await deps.repo.creditCustomer(deps.db, {
      customerId: id,
      amountMicros,
      note: parseNote(body.note),
      now: deps.now().toISOString(),
    });
    return c.json(customerJson(customer));
  });

  app.get('/admin/customers/:id/ledger', async (c) => {
    const id = c.req.param('id');
    await requireCustomer(deps, id);
    const page = pageParams(c, 50, 200);
    const entries = await deps.repo.listLedger(deps.db, id, page.limit, page.offset);
    return c.json({ object: 'list', data: entries.map(ledgerJson) });
  });

  app.post('/admin/customers/:id/keys', async (c) => {
    const customerId = c.req.param('id');
    await requireCustomer(deps, customerId);
    const body = asObject(await readJson(c));
    const name = body.name === undefined ? 'default' : requireText(body.name, 'name', 100);
    const rateLimitRpm = optionalNullableInt(body.rate_limit_rpm, 'rate_limit_rpm', 1, 100_000) ?? 60;
    const rateLimitTpm = optionalNullableInt(body.rate_limit_tpm, 'rate_limit_tpm', 1, 100_000_000) ?? 100_000;
    if (body.rate_limit_rpm === null || body.rate_limit_tpm === null) {
      throw new ApiError(400, 'rate limits cannot be null', 'invalid_request_error', 'invalid_parameter');
    }
    const soft = optionalNullableInt(body.soft_quota_tokens, 'soft_quota_tokens', 0, MAX_PRICE) ?? null;
    const hard = optionalNullableInt(body.hard_quota_tokens, 'hard_quota_tokens', 0, MAX_PRICE) ?? null;
    const quotaPeriod = parseQuotaPeriod(body.quota_period) ?? 'month';
    assertQuotaOrder(soft, hard);
    const plaintext = generateApiKey();
    const record = await deps.repo.createKey(deps.db, {
      customerId,
      name,
      keyPrefix: keyPrefix(plaintext),
      keyHash: hashApiKey(plaintext, deps.config.keyHashPepper),
      rateLimitRpm,
      rateLimitTpm,
      softQuotaTokens: soft,
      hardQuotaTokens: hard,
      quotaPeriod,
      now: deps.now().toISOString(),
    });
    return c.json(
      {
        ...apiKeyJson(record),
        key: plaintext,
        warning: 'Store this key now. It will not be shown again.',
      },
      201,
    );
  });

  app.get('/admin/customers/:id/keys', async (c) => {
    const customerId = c.req.param('id');
    await requireCustomer(deps, customerId);
    const keys = await deps.repo.listKeys(deps.db, customerId);
    return c.json({ object: 'list', data: keys.map(apiKeyJson) });
  });

  app.patch('/admin/keys/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await deps.repo.getKeyById(deps.db, id);
    if (!existing) {
      throw new ApiError(404, 'API key not found', 'invalid_request_error', 'key_not_found');
    }
    if (existing.status === 'revoked') {
      throw new ApiError(409, 'Revoked API keys cannot be updated', 'invalid_request_error', 'key_revoked');
    }
    const body = asObject(await readJson(c));
    const patch: KeyPatch = {};
    if ('name' in body) {
      patch.name = requireText(body.name, 'name', 100);
    }
    if ('rate_limit_rpm' in body) {
      const value = optionalNullableInt(body.rate_limit_rpm, 'rate_limit_rpm', 1, 100_000);
      if (value === undefined || value === null) {
        throw new ApiError(400, 'rate_limit_rpm must be an integer', 'invalid_request_error', 'invalid_parameter');
      }
      patch.rateLimitRpm = value;
    }
    if ('rate_limit_tpm' in body) {
      const value = optionalNullableInt(body.rate_limit_tpm, 'rate_limit_tpm', 1, 100_000_000);
      if (value === undefined || value === null) {
        throw new ApiError(400, 'rate_limit_tpm must be an integer', 'invalid_request_error', 'invalid_parameter');
      }
      patch.rateLimitTpm = value;
    }
    if ('soft_quota_tokens' in body) {
      patch.softQuotaTokens = optionalNullableInt(body.soft_quota_tokens, 'soft_quota_tokens', 0, MAX_PRICE) ?? null;
    }
    if ('hard_quota_tokens' in body) {
      patch.hardQuotaTokens = optionalNullableInt(body.hard_quota_tokens, 'hard_quota_tokens', 0, MAX_PRICE) ?? null;
    }
    if ('quota_period' in body) {
      const period = parseQuotaPeriod(body.quota_period);
      if (!period) {
        throw new ApiError(400, 'quota_period must be month or total', 'invalid_request_error', 'invalid_parameter');
      }
      patch.quotaPeriod = period;
    }
    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, 'No key fields to update', 'invalid_request_error', 'invalid_parameter');
    }
    const soft = patch.softQuotaTokens === undefined ? existing.softQuotaTokens : patch.softQuotaTokens;
    const hard = patch.hardQuotaTokens === undefined ? existing.hardQuotaTokens : patch.hardQuotaTokens;
    assertQuotaOrder(soft, hard);
    const updated = await deps.repo.updateKey(deps.db, id, patch);
    return c.json(apiKeyJson(updated as ApiKeyRecord));
  });

  app.post('/admin/keys/:id/revoke', async (c) => {
    const updated = await deps.repo.revokeKey(deps.db, c.req.param('id'), deps.now().toISOString());
    if (!updated) {
      throw new ApiError(404, 'API key not found', 'invalid_request_error', 'key_not_found');
    }
    return c.json(apiKeyJson(updated));
  });

  app.get('/admin/usage/summary', async (c) => {
    const customerId = new URL(c.req.url).searchParams.get('customer_id');
    const rows = await deps.repo.summarizeUsage(deps.db, {
      customerId,
      from: timeParam(c, 'from'),
      to: timeParam(c, 'to'),
    });
    return c.json({
      object: 'list',
      data: rows.map((row) => ({
        customer_id: row.customerId,
        api_key_id: row.apiKeyId,
        key_prefix: row.keyPrefix,
        model: row.model,
        requests: row.requests,
        prompt_tokens: row.promptTokens,
        completion_tokens: row.completionTokens,
        total_tokens: row.totalTokens,
        cost_micros: row.costMicros,
      })),
    });
  });

  app.get('/admin/usage', async (c) => {
    const page = pageParams(c, 100, 1000);
    const url = new URL(c.req.url);
    const events = await deps.repo.listUsage(deps.db, {
      customerId: url.searchParams.get('customer_id'),
      apiKeyId: url.searchParams.get('api_key_id'),
      from: timeParam(c, 'from'),
      to: timeParam(c, 'to'),
      limit: page.limit,
      offset: page.offset,
    });
    return c.json({ object: 'list', data: events.map((event) => usageJson(event, true)) });
  });

  app.get('/admin/prices', async (c) => {
    return c.json({ object: 'list', data: await catalog(deps) });
  });

  app.get('/admin/models', async (c) => {
    return c.json({ object: 'list', data: await catalog(deps) });
  });

  app.put('/admin/prices', async (c) => {
    const body = asObject(await readJson(c));
    const modelId = requireText(body.model, 'model', 128);
    if (!deps.models.list().some((model) => model.id === modelId)) {
      throw new ApiError(404, 'Model is not in the catalog', 'invalid_request_error', 'model_not_found');
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      throw new ApiError(400, 'enabled must be a boolean', 'invalid_request_error', 'invalid_parameter');
    }
    const input = optionalNullableInt(body.input_micros_per_million, 'input_micros_per_million', 0, MAX_PRICE);
    const output = optionalNullableInt(body.output_micros_per_million, 'output_micros_per_million', 0, MAX_PRICE);
    if (body.enabled === undefined && input === undefined && output === undefined) {
      throw new ApiError(
        400,
        'Provide enabled, input_micros_per_million, or output_micros_per_million',
        'invalid_request_error',
        'invalid_parameter',
      );
    }
    const existing = await deps.repo.getModelOverride(deps.db, modelId);
    const enabled = body.enabled === undefined ? (existing?.enabled ?? null) : body.enabled;
    const nextInput = input === undefined ? (existing?.inputMicrosPerMillion ?? null) : input;
    const nextOutput = output === undefined ? (existing?.outputMicrosPerMillion ?? null) : output;
    await deps.repo.upsertModelOverride(deps.db, {
      model: modelId,
      enabled,
      inputMicrosPerMillion: nextInput,
      outputMicrosPerMillion: nextOutput,
      now: deps.now().toISOString(),
    });
    const rows = await catalog(deps);
    return c.json(rows.find((row) => row.id === modelId));
  });

  app.delete('/admin/prices/:model', async (c) => {
    const modelId = c.req.param('model');
    if (!deps.models.list().some((model) => model.id === modelId)) {
      throw new ApiError(404, 'Model is not in the catalog', 'invalid_request_error', 'model_not_found');
    }
    await deps.repo.deleteModelOverride(deps.db, modelId);
    const rows = await catalog(deps);
    return c.json(rows.find((row) => row.id === modelId));
  });
}
