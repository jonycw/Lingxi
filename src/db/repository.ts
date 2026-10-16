import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';
import { computeCostMicros } from '../billingCost.js';
import type {
  ApiKeyRecord,
  Customer,
  CustomerStatus,
  KeyStatus,
  LedgerEntry,
  ModelOverride,
  QuotaPeriod,
  QuotaSnapshot,
  SkillPack,
  UsageEvent,
  UsageStatus,
} from '../types.js';
import type { Db, Executor } from './executor.js';

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  balance_micros: number | string | bigint;
  created_at: string;
  updated_at: string;
};

type KeyRow = {
  id: string;
  customer_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  status: string;
  rate_limit_rpm: number | string | bigint;
  rate_limit_tpm: number | string | bigint;
  soft_quota_tokens: number | string | bigint | null;
  hard_quota_tokens: number | string | bigint | null;
  quota_period: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

type AuthRow = KeyRow & {
  customer_name: string;
  customer_email: string | null;
  customer_status: string;
  customer_balance_micros: number | string | bigint;
  customer_created_at: string;
  customer_updated_at: string;
};

type OverrideRow = {
  model: string;
  enabled: number | string | bigint | null;
  input_micros_per_million: number | string | bigint | null;
  output_micros_per_million: number | string | bigint | null;
  updated_at: string;
};

type UsageRow = {
  id: string;
  request_id: string;
  api_key_id: string;
  key_prefix: string;
  customer_id: string;
  model: string;
  upstream_model: string;
  prompt_tokens: number | string | bigint;
  completion_tokens: number | string | bigint;
  total_tokens: number | string | bigint;
  cost_micros: number | string | bigint;
  status: string;
  error_code: string | null;
  latency_ms: number | string | bigint;
  stream: number | string | bigint;
  created_at: string;
};

type LedgerRow = {
  id: string;
  customer_id: string;
  delta_micros: number | string | bigint;
  balance_after_micros: number | string | bigint;
  reason: string;
  ref_id: string | null;
  note: string | null;
  created_at: string;
};

type QuotaRow = {
  total_tokens: number | string | bigint;
  requests: number | string | bigint;
  cost_micros: number | string | bigint;
};

type SkillRow = {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: number | string | bigint;
  version: number | string | bigint;
  created_at: string;
  updated_at: string;
};

function num(value: number | string | bigint | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  throw new Error('Expected a numeric column');
}

function numOrNull(value: number | string | bigint | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return num(value);
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status as CustomerStatus,
    balanceMicros: num(row.balance_micros),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKey(row: KeyRow): ApiKeyRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    status: row.status as KeyStatus,
    rateLimitRpm: num(row.rate_limit_rpm),
    rateLimitTpm: num(row.rate_limit_tpm),
    softQuotaTokens: numOrNull(row.soft_quota_tokens),
    hardQuotaTokens: numOrNull(row.hard_quota_tokens),
    quotaPeriod: row.quota_period as QuotaPeriod,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

function mapOverride(row: OverrideRow): ModelOverride {
  return {
    model: row.model,
    enabled: row.enabled === null || row.enabled === undefined ? null : num(row.enabled) === 1,
    inputMicrosPerMillion: numOrNull(row.input_micros_per_million),
    outputMicrosPerMillion: numOrNull(row.output_micros_per_million),
    updatedAt: row.updated_at,
  };
}

function mapUsage(row: UsageRow): UsageEvent {
  return {
    id: row.id,
    requestId: row.request_id,
    apiKeyId: row.api_key_id,
    keyPrefix: row.key_prefix,
    customerId: row.customer_id,
    model: row.model,
    upstreamModel: row.upstream_model,
    promptTokens: num(row.prompt_tokens),
    completionTokens: num(row.completion_tokens),
    totalTokens: num(row.total_tokens),
    costMicros: num(row.cost_micros),
    status: row.status as UsageStatus,
    errorCode: row.error_code,
    latencyMs: num(row.latency_ms),
    stream: num(row.stream) === 1,
    createdAt: row.created_at,
  };
}

function mapSkill(row: SkillRow): SkillPack {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    enabled: num(row.enabled) === 1,
    version: num(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLedger(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    customerId: row.customer_id,
    deltaMicros: num(row.delta_micros),
    balanceAfterMicros: num(row.balance_after_micros),
    reason: row.reason,
    refId: row.ref_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

const USAGE_SELECT = `SELECT u.id, u.request_id, u.api_key_id, k.key_prefix, u.customer_id, u.model,
  u.upstream_model, u.prompt_tokens, u.completion_tokens, u.total_tokens, u.cost_micros, u.status,
  u.error_code, u.latency_ms, u.stream, u.created_at
  FROM usage_events u
  JOIN api_keys k ON k.id = u.api_key_id`;

async function getCustomer(db: Executor, id: string): Promise<Customer | null> {
  const row = await db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', [id]);
  return row ? mapCustomer(row) : null;
}

async function applyBalance(
  tx: Executor,
  input: {
    customerId: string;
    deltaMicros: number;
    reason: string;
    refId: string | null;
    note: string | null;
    now: string;
    ledgerId?: string;
    allowNegative?: boolean;
  },
): Promise<Customer> {
  const customer = await getCustomer(tx, input.customerId);
  if (!customer) {
    throw new ApiError(404, 'Customer not found', 'invalid_request_error', 'customer_not_found');
  }
  const balanceAfter = customer.balanceMicros + input.deltaMicros;
  if (!Number.isSafeInteger(balanceAfter)) {
    throw new ApiError(400, 'Balance overflow', 'invalid_request_error', 'balance_overflow');
  }
  if (!input.allowNegative && balanceAfter < 0) {
    throw new ApiError(400, 'Balance cannot go negative', 'invalid_request_error', 'insufficient_balance');
  }
  await tx.run('UPDATE customers SET balance_micros = ?, updated_at = ? WHERE id = ?', [
    balanceAfter,
    input.now,
    input.customerId,
  ]);
  if (input.deltaMicros !== 0) {
    await tx.run(
      `INSERT INTO ledger (id, customer_id, delta_micros, balance_after_micros, reason, ref_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.ledgerId ?? randomUUID(),
        input.customerId,
        input.deltaMicros,
        balanceAfter,
        input.reason,
        input.refId,
        input.note,
        input.now,
      ],
    );
  }
  const updated = await getCustomer(tx, input.customerId);
  if (!updated) {
    throw new ApiError(404, 'Customer not found', 'invalid_request_error', 'customer_not_found');
  }
  return updated;
}

export type CreateCustomerInput = {
  name: string;
  email: string | null;
  initialMicros: number;
  note: string | null;
  now: string;
};

export type CreateKeyInput = {
  customerId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  rateLimitRpm: number;
  rateLimitTpm: number;
  softQuotaTokens: number | null;
  hardQuotaTokens: number | null;
  quotaPeriod: QuotaPeriod;
  now: string;
};

export type KeyPatch = {
  name?: string;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
  softQuotaTokens?: number | null;
  hardQuotaTokens?: number | null;
  quotaPeriod?: QuotaPeriod;
};

export type UsageWrite = {
  requestId: string;
  apiKeyId: string;
  customerId: string;
  model: string;
  upstreamModel: string;
  promptTokens: number;
  completionTokens: number;
  status: UsageStatus;
  errorCode: string | null;
  latencyMs: number;
  stream: boolean;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  quotaPeriod: QuotaPeriod;
  rateWindowStart: number;
  now: string;
};

export type UsageQuery = {
  customerId?: string | null;
  apiKeyId?: string | null;
  from?: string | null;
  to?: string | null;
  limit: number;
  offset: number;
};

export function periodKeyFor(period: QuotaPeriod, now: Date): string {
  if (period === 'total') {
    return 'total';
  }
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function createRepository() {
  return {
    getCustomer,
    async createCustomer(db: Db, input: CreateCustomerInput): Promise<Customer> {
      const id = randomUUID();
      return db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO customers (id, name, email, status, balance_micros, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 0, ?, ?)`,
          [id, input.name, input.email, input.now, input.now],
        );
        if (input.initialMicros > 0) {
          await applyBalance(tx, {
            customerId: id,
            deltaMicros: input.initialMicros,
            reason: 'credit',
            refId: null,
            note: input.note ?? 'initial balance',
            now: input.now,
          });
        }
        const created = await getCustomer(tx, id);
        if (!created) {
          throw new Error('Customer insert failed');
        }
        return created;
      });
    },
    async listCustomers(db: Executor, limit: number, offset: number): Promise<Customer[]> {
      const rows = await db.all<CustomerRow>(
        'SELECT * FROM customers ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset],
      );
      return rows.map(mapCustomer);
    },
    async updateCustomer(
      db: Executor,
      id: string,
      patch: { name?: string; email?: string | null; status?: CustomerStatus; now: string },
    ): Promise<Customer | null> {
      const existing = await getCustomer(db, id);
      if (!existing) {
        return null;
      }
      const name = patch.name ?? existing.name;
      const email = patch.email === undefined ? existing.email : patch.email;
      const status = patch.status ?? existing.status;
      await db.run('UPDATE customers SET name = ?, email = ?, status = ?, updated_at = ? WHERE id = ?', [
        name,
        email,
        status,
        patch.now,
        id,
      ]);
      return getCustomer(db, id);
    },
    async creditCustomer(
      db: Db,
      input: { customerId: string; amountMicros: number; note: string | null; now: string },
    ): Promise<Customer> {
      return db.transaction((tx) =>
        applyBalance(tx, {
          customerId: input.customerId,
          deltaMicros: input.amountMicros,
          reason: 'credit',
          refId: null,
          note: input.note,
          now: input.now,
        }),
      );
    },
    async listLedger(db: Executor, customerId: string, limit: number, offset: number): Promise<LedgerEntry[]> {
      const rows = await db.all<LedgerRow>(
        'SELECT * FROM ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [customerId, limit, offset],
      );
      return rows.map(mapLedger);
    },
    async createKey(db: Executor, input: CreateKeyInput): Promise<ApiKeyRecord> {
      const id = randomUUID();
      await db.run(
        `INSERT INTO api_keys (
          id, customer_id, name, key_prefix, key_hash, status, rate_limit_rpm, rate_limit_tpm,
          soft_quota_tokens, hard_quota_tokens, quota_period, created_at, revoked_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          id,
          input.customerId,
          input.name,
          input.keyPrefix,
          input.keyHash,
          input.rateLimitRpm,
          input.rateLimitTpm,
          input.softQuotaTokens,
          input.hardQuotaTokens,
          input.quotaPeriod,
          input.now,
        ],
      );
      const created = await this.getKeyById(db, id);
      if (!created) {
        throw new Error('API key insert failed');
      }
      return created;
    },
    async getKeyById(db: Executor, id: string): Promise<ApiKeyRecord | null> {
      const row = await db.get<KeyRow>('SELECT * FROM api_keys WHERE id = ?', [id]);
      return row ? mapKey(row) : null;
    },
    async listKeys(db: Executor, customerId: string): Promise<ApiKeyRecord[]> {
      const rows = await db.all<KeyRow>(
        'SELECT * FROM api_keys WHERE customer_id = ? ORDER BY created_at DESC',
        [customerId],
      );
      return rows.map(mapKey);
    },
    async getAuthByHash(db: Executor, keyHash: string): Promise<{ customer: Customer; apiKey: ApiKeyRecord } | null> {
      const row = await db.get<AuthRow>(
        `SELECT k.*, c.name AS customer_name, c.email AS customer_email, c.status AS customer_status,
                c.balance_micros AS customer_balance_micros, c.created_at AS customer_created_at,
                c.updated_at AS customer_updated_at
         FROM api_keys k
         JOIN customers c ON c.id = k.customer_id
         WHERE k.key_hash = ?`,
        [keyHash],
      );
      if (!row) {
        return null;
      }
      return {
        apiKey: mapKey(row),
        customer: {
          id: row.customer_id,
          name: row.customer_name,
          email: row.customer_email,
          status: row.customer_status as CustomerStatus,
          balanceMicros: num(row.customer_balance_micros),
          createdAt: row.customer_created_at,
          updatedAt: row.customer_updated_at,
        },
      };
    },
    async updateKey(db: Executor, id: string, patch: KeyPatch): Promise<ApiKeyRecord | null> {
      const existing = await this.getKeyById(db, id);
      if (!existing) {
        return null;
      }
      await db.run(
        `UPDATE api_keys SET name = ?, rate_limit_rpm = ?, rate_limit_tpm = ?, soft_quota_tokens = ?,
         hard_quota_tokens = ?, quota_period = ? WHERE id = ?`,
        [
          patch.name ?? existing.name,
          patch.rateLimitRpm ?? existing.rateLimitRpm,
          patch.rateLimitTpm ?? existing.rateLimitTpm,
          patch.softQuotaTokens === undefined ? existing.softQuotaTokens : patch.softQuotaTokens,
          patch.hardQuotaTokens === undefined ? existing.hardQuotaTokens : patch.hardQuotaTokens,
          patch.quotaPeriod ?? existing.quotaPeriod,
          id,
        ],
      );
      return this.getKeyById(db, id);
    },
    async revokeKey(db: Executor, id: string, now: string): Promise<ApiKeyRecord | null> {
      const existing = await this.getKeyById(db, id);
      if (!existing) {
        return null;
      }
      if (existing.status !== 'revoked') {
        await db.run(`UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ?`, [now, id]);
      }
      return this.getKeyById(db, id);
    },
    async getModelOverride(db: Executor, model: string): Promise<ModelOverride | null> {
      const row = await db.get<OverrideRow>('SELECT * FROM model_overrides WHERE model = ?', [model]);
      return row ? mapOverride(row) : null;
    },
    async listModelOverrides(db: Executor): Promise<ModelOverride[]> {
      const rows = await db.all<OverrideRow>('SELECT * FROM model_overrides ORDER BY model ASC');
      return rows.map(mapOverride);
    },
    async upsertModelOverride(
      db: Executor,
      input: {
        model: string;
        enabled: boolean | null;
        inputMicrosPerMillion: number | null;
        outputMicrosPerMillion: number | null;
        now: string;
      },
    ): Promise<void> {
      if (
        input.enabled === null &&
        input.inputMicrosPerMillion === null &&
        input.outputMicrosPerMillion === null
      ) {
        await db.run('DELETE FROM model_overrides WHERE model = ?', [input.model]);
        return;
      }
      await db.run(
        `INSERT INTO model_overrides (model, enabled, input_micros_per_million, output_micros_per_million, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(model) DO UPDATE SET
           enabled = excluded.enabled,
           input_micros_per_million = excluded.input_micros_per_million,
           output_micros_per_million = excluded.output_micros_per_million,
           updated_at = excluded.updated_at`,
        [
          input.model,
          input.enabled === null ? null : input.enabled ? 1 : 0,
          input.inputMicrosPerMillion,
          input.outputMicrosPerMillion,
          input.now,
        ],
      );
    },
    async deleteModelOverride(db: Executor, model: string): Promise<boolean> {
      const result = await db.run('DELETE FROM model_overrides WHERE model = ?', [model]);
      return result.changes > 0;
    },
    async getQuota(db: Executor, apiKeyId: string, period: string): Promise<QuotaSnapshot> {
      const row = await db.get<QuotaRow>(
        'SELECT total_tokens, requests, cost_micros FROM quota_usage WHERE api_key_id = ? AND period_key = ?',
        [apiKeyId, period],
      );
      if (!row) {
        return { totalTokens: 0, requests: 0, costMicros: 0 };
      }
      return {
        totalTokens: num(row.total_tokens),
        requests: num(row.requests),
        costMicros: num(row.cost_micros),
      };
    },
    async consumeRateSlot(
      db: Executor,
      apiKeyId: string,
      windowStart: number,
    ): Promise<{ requests: number; tokens: number }> {
      const row = await db.get<{ requests: number | string | bigint; tokens: number | string | bigint }>(
        `INSERT INTO rate_windows (api_key_id, window_start, requests, tokens)
         VALUES (?, ?, 1, 0)
         ON CONFLICT(api_key_id, window_start) DO UPDATE SET
           requests = rate_windows.requests + 1
         RETURNING requests, tokens`,
        [apiKeyId, windowStart],
      );
      if (!row) {
        throw new Error('Rate window insert failed');
      }
      return { requests: num(row.requests), tokens: num(row.tokens) };
    },
    async recordUsage(
      db: Db,
      input: UsageWrite,
    ): Promise<{ costMicros: number; balanceMicros: number; quota: QuotaSnapshot }> {
      const costMicros =
        input.status === 'ok'
          ? computeCostMicros(
              input.promptTokens,
              input.completionTokens,
              input.inputMicrosPerMillion,
              input.outputMicrosPerMillion,
            )
          : 0;
      const totalTokens = input.status === 'ok' ? input.promptTokens + input.completionTokens : 0;
      return db.transaction(async (tx) => {
        const usageId = randomUUID();
        if (costMicros !== 0) {
          await applyBalance(tx, {
            customerId: input.customerId,
            deltaMicros: -costMicros,
            reason: 'usage',
            refId: usageId,
            note: input.model,
            now: input.now,
            allowNegative: true,
          });
        }
        await tx.run(
          `INSERT INTO usage_events (
            id, request_id, api_key_id, customer_id, model, upstream_model, prompt_tokens,
            completion_tokens, total_tokens, cost_micros, status, error_code, latency_ms, stream, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            usageId,
            input.requestId,
            input.apiKeyId,
            input.customerId,
            input.model,
            input.upstreamModel,
            input.status === 'ok' ? input.promptTokens : 0,
            input.status === 'ok' ? input.completionTokens : 0,
            totalTokens,
            costMicros,
            input.status,
            input.errorCode,
            input.latencyMs,
            input.stream ? 1 : 0,
            input.now,
          ],
        );
        const period = periodKeyFor(input.quotaPeriod, new Date(input.now));
        await tx.run(
          `INSERT INTO quota_usage (
            api_key_id, period_key, prompt_tokens, completion_tokens, total_tokens, requests, cost_micros
          ) VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(api_key_id, period_key) DO UPDATE SET
            prompt_tokens = quota_usage.prompt_tokens + excluded.prompt_tokens,
            completion_tokens = quota_usage.completion_tokens + excluded.completion_tokens,
            total_tokens = quota_usage.total_tokens + excluded.total_tokens,
            requests = quota_usage.requests + excluded.requests,
            cost_micros = quota_usage.cost_micros + excluded.cost_micros`,
          [
            input.apiKeyId,
            period,
            input.status === 'ok' ? input.promptTokens : 0,
            input.status === 'ok' ? input.completionTokens : 0,
            totalTokens,
            costMicros,
          ],
        );
        if (input.status === 'ok' && totalTokens > 0) {
          await tx.run(
            `INSERT INTO rate_windows (api_key_id, window_start, requests, tokens)
             VALUES (?, ?, 0, ?)
             ON CONFLICT(api_key_id, window_start) DO UPDATE SET
               tokens = rate_windows.tokens + excluded.tokens`,
            [input.apiKeyId, input.rateWindowStart, totalTokens],
          );
        }
        await tx.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [input.now, input.apiKeyId]);
        const customer = await getCustomer(tx, input.customerId);
        const quota = await this.getQuota(tx, input.apiKeyId, period);
        return {
          costMicros,
          balanceMicros: customer?.balanceMicros ?? 0,
          quota,
        };
      });
    },
    async listUsage(db: Executor, query: UsageQuery): Promise<UsageEvent[]> {
      const where: string[] = [];
      const params: Array<string | number | null> = [];
      if (query.customerId) {
        where.push('u.customer_id = ?');
        params.push(query.customerId);
      }
      if (query.apiKeyId) {
        where.push('u.api_key_id = ?');
        params.push(query.apiKeyId);
      }
      if (query.from) {
        where.push('u.created_at >= ?');
        params.push(query.from);
      }
      if (query.to) {
        where.push('u.created_at < ?');
        params.push(query.to);
      }
      const sql = `${USAGE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
      params.push(query.limit, query.offset);
      const rows = await db.all<UsageRow>(sql, params);
      return rows.map(mapUsage);
    },
    async summarizeUsage(
      db: Executor,
      query: { customerId?: string | null; from?: string | null; to?: string | null },
    ): Promise<
      Array<{
        customerId: string;
        apiKeyId: string;
        keyPrefix: string;
        model: string;
        requests: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costMicros: number;
      }>
    > {
      const where: string[] = [];
      const params: Array<string | number | null> = [];
      if (query.customerId) {
        where.push('u.customer_id = ?');
        params.push(query.customerId);
      }
      if (query.from) {
        where.push('u.created_at >= ?');
        params.push(query.from);
      }
      if (query.to) {
        where.push('u.created_at < ?');
        params.push(query.to);
      }
      const sql = `SELECT u.customer_id, u.api_key_id, k.key_prefix, u.model,
          COUNT(*) AS requests,
          SUM(u.prompt_tokens) AS prompt_tokens,
          SUM(u.completion_tokens) AS completion_tokens,
          SUM(u.total_tokens) AS total_tokens,
          SUM(u.cost_micros) AS cost_micros
        FROM usage_events u
        JOIN api_keys k ON k.id = u.api_key_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY u.customer_id, u.api_key_id, k.key_prefix, u.model
        ORDER BY cost_micros DESC`;
      const rows = await db.all<{
        customer_id: string;
        api_key_id: string;
        key_prefix: string;
        model: string;
        requests: number | string | bigint;
        prompt_tokens: number | string | bigint;
        completion_tokens: number | string | bigint;
        total_tokens: number | string | bigint;
        cost_micros: number | string | bigint;
      }>(sql, params);
      return rows.map((row) => ({
        customerId: row.customer_id,
        apiKeyId: row.api_key_id,
        keyPrefix: row.key_prefix,
        model: row.model,
        requests: num(row.requests),
        promptTokens: num(row.prompt_tokens),
        completionTokens: num(row.completion_tokens),
        totalTokens: num(row.total_tokens),
        costMicros: num(row.cost_micros),
      }));
    },
    async applyPayment(
      db: Db,
      input: {
        externalId: string;
        provider: string;
        customerId: string;
        amountMicros: number;
        note: string | null;
        now: string;
      },
    ): Promise<{ applied: boolean; balanceMicros: number }> {
      return db.transaction(async (tx) => {
        const customer = await getCustomer(tx, input.customerId);
        if (!customer) {
          throw new ApiError(404, 'Customer not found', 'invalid_request_error', 'customer_not_found');
        }
        const ledgerId = randomUUID();
        const inserted = await tx.get<{ external_id: string }>(
          `INSERT INTO payment_receipts (external_id, provider, customer_id, amount_micros, ledger_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(external_id) DO NOTHING
           RETURNING external_id`,
          [input.externalId, input.provider, input.customerId, input.amountMicros, ledgerId, input.now],
        );
        if (!inserted) {
          const current = await getCustomer(tx, input.customerId);
          return { applied: false, balanceMicros: current?.balanceMicros ?? customer.balanceMicros };
        }
        const updated = await applyBalance(tx, {
          customerId: input.customerId,
          deltaMicros: input.amountMicros,
          reason: 'payment',
          refId: input.externalId,
          note: input.note,
          now: input.now,
          ledgerId,
        });
        return { applied: true, balanceMicros: updated.balanceMicros };
      });
    },
    async getSetting(db: Executor, key: string): Promise<string | null> {
      const row = await db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
      return row?.value ?? null;
    },
    async setSetting(db: Executor, key: string, value: string, now: string): Promise<void> {
      await db.run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, now],
      );
    },
    async deleteSetting(db: Executor, key: string): Promise<void> {
      await db.run('DELETE FROM app_settings WHERE key = ?', [key]);
    },
    async listSkills(db: Executor, enabledOnly: boolean): Promise<SkillPack[]> {
      const sql = enabledOnly
        ? 'SELECT * FROM skills WHERE enabled = 1 ORDER BY name ASC, id ASC'
        : 'SELECT * FROM skills ORDER BY name ASC, id ASC';
      const rows = await db.all<SkillRow>(sql);
      return rows.map(mapSkill);
    },
    async getSkill(db: Executor, id: string): Promise<SkillPack | null> {
      const row = await db.get<SkillRow>('SELECT * FROM skills WHERE id = ?', [id]);
      return row ? mapSkill(row) : null;
    },
    async getSkillsByIds(db: Executor, ids: readonly string[]): Promise<SkillPack[]> {
      if (ids.length === 0) {
        return [];
      }
      const placeholders = ids.map(() => '?').join(', ');
      const rows = await db.all<SkillRow>(`SELECT * FROM skills WHERE id IN (${placeholders})`, ids);
      return rows.map(mapSkill);
    },
    async createSkill(
      db: Executor,
      input: { id: string; name: string; description: string; body: string; enabled: boolean; now: string },
    ): Promise<SkillPack> {
      await db.run(
        `INSERT INTO skills (id, name, description, body, enabled, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [input.id, input.name, input.description, input.body, input.enabled ? 1 : 0, input.now, input.now],
      );
      const created = await this.getSkill(db, input.id);
      if (!created) {
        throw new Error('Skill insert failed');
      }
      return created;
    },
    async updateSkill(
      db: Executor,
      input: { id: string; name: string; description: string; body: string; enabled: boolean; now: string },
    ): Promise<SkillPack | null> {
      const result = await db.run(
        `UPDATE skills
         SET name = ?, description = ?, body = ?, enabled = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
        [input.name, input.description, input.body, input.enabled ? 1 : 0, input.now, input.id],
      );
      if (result.changes === 0) {
        return null;
      }
      return this.getSkill(db, input.id);
    },
    async deleteSkill(db: Executor, id: string): Promise<boolean> {
      const result = await db.run('DELETE FROM skills WHERE id = ?', [id]);
      return result.changes > 0;
    },
    async listAllKeys(
      db: Executor,
      limit: number,
      offset: number,
    ): Promise<Array<ApiKeyRecord & { customerName: string }>> {
      const rows = await db.all<KeyRow & { customer_name: string }>(
        `SELECT k.*, c.name AS customer_name
         FROM api_keys k
         JOIN customers c ON c.id = k.customer_id
         ORDER BY k.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset],
      );
      return rows.map((row) => ({ ...mapKey(row), customerName: row.customer_name }));
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
