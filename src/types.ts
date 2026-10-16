export const MICROS_PER_CREDIT = 1_000_000;

export type CustomerStatus = 'active' | 'suspended';
export type KeyStatus = 'active' | 'revoked';
export type QuotaPeriod = 'month' | 'total';
export type UsageStatus = 'ok' | 'error';

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  status: CustomerStatus;
  balanceMicros: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiKeyRecord = {
  id: string;
  customerId: string;
  name: string;
  keyPrefix: string;
  status: KeyStatus;
  rateLimitRpm: number;
  rateLimitTpm: number;
  softQuotaTokens: number | null;
  hardQuotaTokens: number | null;
  quotaPeriod: QuotaPeriod;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type AuthContext = {
  customer: Customer;
  apiKey: ApiKeyRecord;
};

export type ModelDefinition = {
  id: string;
  upstream: string;
  ownedBy: string;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  enabled: boolean;
};

export type ModelOverride = {
  model: string;
  enabled: boolean | null;
  inputMicrosPerMillion: number | null;
  outputMicrosPerMillion: number | null;
  updatedAt: string;
};

export type BillableModel = {
  id: string;
  upstream: string;
  ownedBy: string;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type UsageEvent = {
  id: string;
  requestId: string;
  apiKeyId: string;
  keyPrefix: string;
  customerId: string;
  model: string;
  upstreamModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicros: number;
  status: UsageStatus;
  errorCode: string | null;
  latencyMs: number;
  stream: boolean;
  createdAt: string;
};

export type LedgerEntry = {
  id: string;
  customerId: string;
  deltaMicros: number;
  balanceAfterMicros: number;
  reason: string;
  refId: string | null;
  note: string | null;
  createdAt: string;
};

export type QuotaSnapshot = {
  totalTokens: number;
  requests: number;
  costMicros: number;
};

export type SkillPack = {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function formatCredits(micros: number): string {
  if (!Number.isSafeInteger(micros)) {
    return String(micros / MICROS_PER_CREDIT);
  }
  const negative = micros < 0;
  const abs = BigInt(Math.abs(micros));
  const whole = abs / BigInt(MICROS_PER_CREDIT);
  const frac = (abs % BigInt(MICROS_PER_CREDIT)).toString().padStart(6, '0').replace(/0+$/, '');
  const text = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function customerJson(customer: Customer): Record<string, unknown> {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    status: customer.status,
    balance_micros: customer.balanceMicros,
    balance_credits: formatCredits(customer.balanceMicros),
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
  };
}

export function apiKeyJson(key: ApiKeyRecord): Record<string, unknown> {
  return {
    id: key.id,
    customer_id: key.customerId,
    name: key.name,
    prefix: key.keyPrefix,
    status: key.status,
    rate_limit_rpm: key.rateLimitRpm,
    rate_limit_tpm: key.rateLimitTpm,
    soft_quota_tokens: key.softQuotaTokens,
    hard_quota_tokens: key.hardQuotaTokens,
    quota_period: key.quotaPeriod,
    created_at: key.createdAt,
    revoked_at: key.revokedAt,
    last_used_at: key.lastUsedAt,
  };
}

export function usageJson(event: UsageEvent, includeUpstream: boolean): Record<string, unknown> {
  return {
    id: event.id,
    request_id: event.requestId,
    api_key_id: event.apiKeyId,
    key_prefix: event.keyPrefix,
    customer_id: event.customerId,
    model: event.model,
    ...(includeUpstream ? { upstream_model: event.upstreamModel } : {}),
    prompt_tokens: event.promptTokens,
    completion_tokens: event.completionTokens,
    total_tokens: event.totalTokens,
    cost_micros: event.costMicros,
    status: event.status,
    error_code: event.errorCode,
    latency_ms: event.latencyMs,
    stream: event.stream,
    created_at: event.createdAt,
  };
}
