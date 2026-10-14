import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { adminHeaders, createTestContext, issueCustomerKey, type TestContext } from './helpers.js';

describe('admin API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  test('creates a customer, lists keys without the secret, and records a manual credit', async () => {
    const created = await ctx.app.request('/admin/customers', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ name: 'Acme', email: 'ops@example.com', initial_credits: 2, note: 'opening' }),
    });
    expect(created.status).toBe(201);
    const customer = (await created.json()) as { id: string; balance_micros: number; balance_credits: string };
    expect(customer.balance_micros).toBe(2_000_000);
    expect(customer.balance_credits).toBe('2');

    const credited = await ctx.app.request(`/admin/customers/${customer.id}/credit`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ amount_micros: 500_000, note: 'top up' }),
    });
    expect(credited.status).toBe(200);
    expect(((await credited.json()) as { balance_micros: number }).balance_micros).toBe(2_500_000);

    const issued = await ctx.app.request(`/admin/customers/${customer.id}/keys`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ name: 'laptop' }),
    });
    expect(issued.status).toBe(201);
    const issuedBody = (await issued.json()) as { key: string; prefix: string };
    const listed = await ctx.app.request('/admin/customers?limit=10', { headers: adminHeaders() });
    const listBody = (await listed.json()) as { data: Array<{ id: string }> };
    expect(listBody.data.some((row) => row.id === customer.id)).toBe(true);

    const keys = await ctx.app.request(`/admin/customers/${customer.id}/keys`, { headers: adminHeaders() });
    const keyBody = (await keys.json()) as { data: Array<{ prefix: string; key?: string }> };
    expect(keyBody.data).toHaveLength(1);
    expect(keyBody.data[0]?.prefix).toBe(issuedBody.prefix);
    expect(keyBody.data[0]?.key).toBeUndefined();
    expect(JSON.stringify(keyBody)).not.toContain(issuedBody.key);

    const ledger = await ctx.app.request(`/admin/customers/${customer.id}/ledger`, { headers: adminHeaders() });
    const ledgerBody = (await ledger.json()) as { data: Array<{ reason: string; delta_micros: number }> };
    expect(ledgerBody.data.map((row) => row.reason).sort()).toEqual(['credit', 'credit']);
  });

  test('price overrides change the catalog and can be cleared', async () => {
    const updated = await ctx.app.request('/admin/prices', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({
        model: 'lingxi-fast',
        input_micros_per_million: 2_000_000,
        output_micros_per_million: 2_000_000,
      }),
    });
    expect(updated.status).toBe(200);
    const row = (await updated.json()) as { effective: { input_micros_per_million: number } };
    expect(row.effective.input_micros_per_million).toBe(2_000_000);

    const disabled = await ctx.app.request('/admin/prices', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ model: 'lingxi-pro', enabled: false }),
    });
    expect(disabled.status).toBe(200);
    const { key } = await issueCustomerKey(ctx.app);
    const hidden = await ctx.app.request('/v1/models', { headers: { Authorization: `Bearer ${key.key}` } });
    const models = (await hidden.json()) as { data: Array<{ id: string }> };
    expect(models.data.map((model) => model.id)).not.toContain('lingxi-pro');

    const cleared = await ctx.app.request('/admin/prices/lingxi-pro', { method: 'DELETE', headers: adminHeaders() });
    expect(cleared.status).toBe(200);
    const restored = await ctx.app.request('/v1/models', { headers: { Authorization: `Bearer ${key.key}` } });
    const again = (await restored.json()) as { data: Array<{ id: string }> };
    expect(again.data.map((model) => model.id)).toContain('lingxi-pro');
  });

  test('rejects invalid chat bodies', async () => {
    const { key } = await issueCustomerKey(ctx.app);
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(res.status).toBe(400);
  });
});
