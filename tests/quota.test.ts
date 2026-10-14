import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { adminHeaders, chatRequest, createTestContext, issueCustomerKey, type TestContext } from './helpers.js';

const message = { model: 'lingxi-fast', messages: [{ role: 'user', content: 'hello' }] };

describe('quota, rate limit, and balance', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  test('hard quota blocks before the upstream call and does not charge', async () => {
    const { customer, key } = await issueCustomerKey(ctx.app, {
      credits: 50,
      key: { hard_quota_tokens: 0, rate_limit_rpm: 100 },
    });
    const res = await chatRequest(ctx.app, key.key, message);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('quota_exceeded');
    expect(res.headers.get('x-lingxi-quota-status')).toBe('hard-exceeded');
    const usage = await ctx.app.request(`/admin/usage?customer_id=${customer.id}`, { headers: adminHeaders() });
    const usageBody = (await usage.json()) as { data: unknown[] };
    expect(usageBody.data).toHaveLength(0);
    const customerRes = await ctx.app.request(`/admin/customers/${customer.id}`, { headers: adminHeaders() });
    const current = (await customerRes.json()) as { balance_micros: number };
    expect(current.balance_micros).toBe(50_000_000);
  });

  test('soft quota warns and still serves the request', async () => {
    const { key } = await issueCustomerKey(ctx.app, { key: { soft_quota_tokens: 0 } });
    const res = await chatRequest(ctx.app, key.key, message);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-lingxi-quota-status')).toBe('soft-exceeded');
    const body = (await res.json()) as { usage: { total_tokens: number } };
    expect(body.usage.total_tokens).toBeGreaterThan(0);
  });

  test('per-key request rate limit returns 429', async () => {
    const { key } = await issueCustomerKey(ctx.app, { key: { rate_limit_rpm: 2 } });
    expect((await chatRequest(ctx.app, key.key, message)).status).toBe(200);
    expect((await chatRequest(ctx.app, key.key, message)).status).toBe(200);
    const blocked = await chatRequest(ctx.app, key.key, message);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limit_exceeded');
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  test('zero balance is rejected with 402', async () => {
    const { key } = await issueCustomerKey(ctx.app, { credits: 0 });
    const res = await chatRequest(ctx.app, key.key, message);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('insufficient_balance');
  });

  test('a successful call deducts the token price and records usage', async () => {
    const { customer, key } = await issueCustomerKey(ctx.app, { credits: 10 });
    const res = await chatRequest(ctx.app, key.key, message);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(body.model).toBe('lingxi-fast');
    expect(body.choices[0]?.message.content).toContain('灵犀模拟');
    const expectedCost = body.usage.prompt_tokens * 1 + body.usage.completion_tokens * 4;
    expect(res.headers.get('x-lingxi-cost-micros')).toBe(String(expectedCost));
    const balance = Number(res.headers.get('x-lingxi-balance-micros'));
    expect(balance).toBe(10_000_000 - expectedCost);

    const usage = await ctx.app.request(`/admin/usage?api_key_id=${key.id}`, { headers: adminHeaders() });
    const usageBody = (await usage.json()) as {
      data: Array<{ total_tokens: number; cost_micros: number; status: string; customer_id: string }>;
    };
    expect(usageBody.data).toHaveLength(1);
    expect(usageBody.data[0]?.status).toBe('ok');
    expect(usageBody.data[0]?.cost_micros).toBe(expectedCost);
    expect(usageBody.data[0]?.customer_id).toBe(customer.id);

    const self = await ctx.app.request('/v1/usage', { headers: { Authorization: `Bearer ${key.key}` } });
    const selfBody = (await self.json()) as { balance_micros: number; data: unknown[]; quota: { total_tokens: number } };
    expect(self.status).toBe(200);
    expect(selfBody.balance_micros).toBe(balance);
    expect(selfBody.quota.total_tokens).toBe(body.usage.total_tokens);
    expect(JSON.stringify(selfBody)).not.toContain('gpt-4o-mini');
  });
});
