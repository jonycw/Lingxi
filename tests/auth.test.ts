import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { adminHeaders, chatRequest, createTestContext, issueCustomerKey, type TestContext } from './helpers.js';

describe('authentication', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  test('health is public and reports mock upstream', async () => {
    const res = await ctx.app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string; upstream: string; database: { status: string } };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('lingxi');
    expect(body.upstream).toBe('mock');
    expect(body.database.status).toBe('ok');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('customer routes require a valid bearer key', async () => {
    const missing = await ctx.app.request('/v1/models');
    expect(missing.status).toBe(401);
    const missingBody = (await missing.json()) as { error: { code: string } };
    expect(missingBody.error.code).toBe('invalid_api_key');

    const bad = await ctx.app.request('/v1/models', { headers: { Authorization: 'Bearer lx_not-a-real-key' } });
    expect(bad.status).toBe(401);

    const { key } = await issueCustomerKey(ctx.app);
    const ok = await ctx.app.request('/v1/models', { headers: { Authorization: `Bearer ${key.key}` } });
    expect(ok.status).toBe(200);
    const models = (await ok.json()) as { data: Array<{ id: string; owned_by: string }> };
    expect(models.data.map((model) => model.id)).toContain('lingxi-fast');
    expect(JSON.stringify(models)).not.toContain('gpt-4o');
  });

  test('revoked keys are rejected', async () => {
    const { key } = await issueCustomerKey(ctx.app);
    const revoked = await ctx.app.request(`/admin/keys/${key.id}/revoke`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    expect(revoked.status).toBe(200);
    const afterRevoke = await ctx.app.request('/v1/models', { headers: { Authorization: `Bearer ${key.key}` } });
    expect(afterRevoke.status).toBe(401);
    expect(((await afterRevoke.json()) as { error: { code: string } }).error.code).toBe('key_revoked');
  });

  test('admin token and customer keys are not interchangeable', async () => {
    const { key } = await issueCustomerKey(ctx.app);
    const asAdmin = await ctx.app.request('/admin/customers', {
      headers: { Authorization: `Bearer ${key.key}` },
    });
    expect(asAdmin.status).toBe(401);
    const asCustomer = await ctx.app.request('/v1/models', {
      headers: { Authorization: 'Bearer test-admin-token-value' },
    });
    expect(asCustomer.status).toBe(401);
    const missingAdmin = await ctx.app.request('/admin/customers');
    expect(missingAdmin.status).toBe(401);
  });

  test('failed authentication is rate limited per client address', async () => {
    await ctx.close();
    ctx = await createTestContext({ env: { AUTH_FAIL_LIMIT: '2', TRUST_PROXY: 'true' } });
    const hit = (forwarded: string) =>
      ctx.app.request('/v1/models', {
        headers: { Authorization: 'Bearer lx_nope', 'X-Forwarded-For': forwarded },
      });
    expect((await hit('203.0.113.1')).status).toBe(401);
    expect((await hit('203.0.113.1')).status).toBe(401);
    expect((await hit('203.0.113.1')).status).toBe(429);
    expect((await hit('203.0.113.2')).status).toBe(401);
  });

  test('a suspended customer cannot call chat', async () => {
    const { customer, key } = await issueCustomerKey(ctx.app);
    const patched = await ctx.app.request(`/admin/customers/${customer.id}`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(patched.status).toBe(200);
    const res = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('account_suspended');
  });
});
