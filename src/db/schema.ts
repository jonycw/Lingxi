import type { Db } from './executor.js';

/**
 * SQL shared by SQLite and Postgres.
 * Identifiers stay unquoted snake_case. Money and counters are BIGINT.
 * SQLite treats BIGINT as INTEGER. Postgres returns int8 as a parsed number.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    status TEXT NOT NULL,
    balance_micros BIGINT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    rate_limit_rpm INTEGER NOT NULL,
    rate_limit_tpm INTEGER NOT NULL,
    soft_quota_tokens BIGINT,
    hard_quota_tokens BIGINT,
    quota_period TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_unique ON api_keys(key_hash)`,
  `CREATE INDEX IF NOT EXISTS api_keys_customer ON api_keys(customer_id)`,
  `CREATE TABLE IF NOT EXISTS model_overrides (
    model TEXT PRIMARY KEY,
    enabled INTEGER,
    input_micros_per_million BIGINT,
    output_micros_per_million BIGINT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    api_key_id TEXT NOT NULL REFERENCES api_keys(id),
    customer_id TEXT NOT NULL REFERENCES customers(id),
    model TEXT NOT NULL,
    upstream_model TEXT NOT NULL,
    prompt_tokens BIGINT NOT NULL,
    completion_tokens BIGINT NOT NULL,
    total_tokens BIGINT NOT NULL,
    cost_micros BIGINT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    latency_ms INTEGER NOT NULL,
    stream INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS usage_events_created ON usage_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS usage_events_customer_created ON usage_events(customer_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS usage_events_key_created ON usage_events(api_key_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS quota_usage (
    api_key_id TEXT NOT NULL REFERENCES api_keys(id),
    period_key TEXT NOT NULL,
    prompt_tokens BIGINT NOT NULL,
    completion_tokens BIGINT NOT NULL,
    total_tokens BIGINT NOT NULL,
    requests BIGINT NOT NULL,
    cost_micros BIGINT NOT NULL,
    PRIMARY KEY (api_key_id, period_key)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_windows (
    api_key_id TEXT NOT NULL REFERENCES api_keys(id),
    window_start BIGINT NOT NULL,
    requests INTEGER NOT NULL,
    tokens BIGINT NOT NULL,
    PRIMARY KEY (api_key_id, window_start)
  )`,
  `CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    delta_micros BIGINT NOT NULL,
    balance_after_micros BIGINT NOT NULL,
    reason TEXT NOT NULL,
    ref_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_customer_created ON ledger(customer_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS payment_receipts (
    external_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    amount_micros BIGINT NOT NULL,
    ledger_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1') ON CONFLICT(key) DO NOTHING`,
];

export async function migrate(
  db: Db,
  options?: { now?: Date; usageRetentionDays?: number },
): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.exec(statement);
  }
  const now = options?.now ?? new Date();
  const rateCutoff = now.getTime() - 2 * 24 * 60 * 60 * 1000;
  await db.run('DELETE FROM rate_windows WHERE window_start < ?', [rateCutoff]);
  const retention = options?.usageRetentionDays ?? 0;
  if (retention > 0) {
    const cutoff = new Date(now.getTime() - retention * 24 * 60 * 60 * 1000).toISOString();
    await db.run('DELETE FROM usage_events WHERE created_at < ?', [cutoff]);
  }
}
