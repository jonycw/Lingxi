import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { hashApiKey } from '../src/auth.js';
import { resolveSqlitePath } from '../src/paths.js';
import { adminHeaders, chatRequest, createTestContext, issueCustomerKey, type TestContext } from './helpers.js';
import { signWebhook } from '../src/payments.js';

describe('chat completions', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  test('streams a mock completion and records usage', async () => {
    ctx = await createTestContext();
    const { key } = await issueCustomerKey(ctx.app);
    const res = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      stream: true,
      messages: [{ role: 'user', content: '你好' }],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('data: [DONE]');
    expect(text).toContain('lingxi-fast');
    const usage = await ctx.app.request(`/admin/usage?api_key_id=${key.id}`, { headers: adminHeaders() });
    const body = (await usage.json()) as { data: Array<{ stream: boolean; total_tokens: number; status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.stream).toBe(true);
    expect(body.data[0]?.status).toBe('ok');
    expect(body.data[0]?.total_tokens).toBeGreaterThan(0);
  });

  test('unknown models are rejected', async () => {
    ctx = await createTestContext();
    const { key } = await issueCustomerKey(ctx.app);
    const res = await chatRequest(ctx.app, key.key, {
      model: 'not-a-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('model_not_found');
  });

  test('plaintext keys are not stored', async () => {
    ctx = await createTestContext();
    const { key } = await issueCustomerKey(ctx.app);
    await ctx.db.exec('PRAGMA wal_checkpoint(FULL)');
    const file = resolveSqlitePath(ctx.config.databaseUrl);
    const raw = readFileSync(file);
    expect(raw.includes(Buffer.from(key.key))).toBe(false);
    expect(raw.includes(Buffer.from(hashApiKey(key.key, '')))).toBe(true);
    expect(raw.includes(Buffer.from(key.prefix))).toBe(true);
  });

  test('proxy mode sends the owner key and mapped model, then bills upstream usage', async () => {
    const ownerKey = 'upstream-secret-do-not-log';
    ctx = await createTestContext({
      env: { UPSTREAM_API_KEY: ownerKey, UPSTREAM_MOCK: 'false' },
      fetchImpl: async (url, init) => {
        const body = JSON.parse(String(init?.body)) as { model?: string; stream?: boolean };
        if (body.stream) {
          const sse = [
            'data: {"id":"1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hi"}}]}',
            '',
            'data: {"id":"1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
            '',
            'data: [DONE]',
            '',
          ].join('\n');
          return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return new Response(
          JSON.stringify({
            id: 'chatcmpl_up',
            object: 'chat.completion',
            model: 'gpt-4o-mini',
            choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    const { customer, key } = await issueCustomerKey(ctx.app, { credits: 10 });
    const res = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(res.status).toBe(200);
    const completion = (await res.json()) as { model: string; usage: { total_tokens: number } };
    expect(completion.model).toBe('lingxi-fast');
    expect(completion.usage.total_tokens).toBe(7);
    expect(ctx.fetchCalls).toHaveLength(1);
    const call = ctx.fetchCalls[0]!;
    expect(call.url).toBe('https://upstream.example/v1/chat/completions');
    const headers = new Headers(call.init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${ownerKey}`);
    expect(headers.get('authorization')).not.toContain(key.key);
    const sent = JSON.parse(String(call.init?.body)) as { model: string };
    expect(sent.model).toBe('gpt-4o-mini');
    expect(JSON.stringify(call.init)).not.toContain(key.key);
    expect(ctx.logs.join('\n')).not.toContain(ownerKey);
    expect(ctx.logs.join('\n')).not.toContain(key.key);
    expect(ctx.logs.join('\n')).not.toContain(ctx.config.adminToken);

    const streamed = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      stream: true,
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(streamed.status).toBe(200);
    const sse = await streamed.text();
    expect(sse).toContain('"model":"lingxi-fast"');
    expect(sse).not.toContain('gpt-4o-mini');
    expect(sse).toContain('data: [DONE]');
    const usage = await ctx.app.request(`/admin/usage?customer_id=${customer.id}`, { headers: adminHeaders() });
    const rows = (await usage.json()) as { data: Array<{ total_tokens: number; stream: boolean }> };
    expect(rows.data.map((row) => row.total_tokens).sort()).toEqual([4, 7]);
  });

  test('upstream authentication failure is not charged', async () => {
    ctx = await createTestContext({
      env: { UPSTREAM_API_KEY: 'upstream-secret-do-not-log', UPSTREAM_MOCK: 'false' },
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'bad key sk-should-not-leak' } }), { status: 401 }),
    });
    const { customer, key } = await issueCustomerKey(ctx.app, { credits: 3 });
    const res = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('upstream_auth');
    expect(body.error.message).not.toContain('sk-should-not-leak');
    const customerRes = await ctx.app.request(`/admin/customers/${customer.id}`, { headers: adminHeaders() });
    expect(((await customerRes.json()) as { balance_micros: number }).balance_micros).toBe(3_000_000);
    const usage = await ctx.app.request(`/admin/usage?customer_id=${customer.id}`, { headers: adminHeaders() });
    const rows = (await usage.json()) as { data: Array<{ status: string; cost_micros: number }> };
    expect(rows.data[0]?.status).toBe('error');
    expect(rows.data[0]?.cost_micros).toBe(0);
    expect(ctx.logs.join('\n')).not.toContain('sk-should-not-leak');
  });
});

describe('payment webhook', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    await ctx?.close();
  });

  test('credits a customer once when the HMAC matches', async () => {
    const secret = 'payment-webhook-secret';
    ctx = await createTestContext({ env: { PAYMENT_WEBHOOK_SECRET: secret } });
    const { customer } = await issueCustomerKey(ctx.app, { credits: 1 });
    const payload = JSON.stringify({
      external_id: 'pay_1001',
      customer_id: customer.id,
      amount_micros: 2_500_000,
      provider: 'alipay',
      note: 'order 1001',
    });
    const post = (signature: string) =>
      ctx!.app.request('/admin/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lingxi-Signature': signature,
        },
        body: payload,
      });
    const ok = await post(signWebhook(secret, payload));
    expect(ok.status).toBe(200);
    const applied = (await ok.json()) as { applied: boolean; balance_micros: number };
    expect(applied.applied).toBe(true);
    expect(applied.balance_micros).toBe(1_000_000 + 2_500_000);
    const replay = await post(signWebhook(secret, payload));
    const again = (await replay.json()) as { applied: boolean; balance_micros: number };
    expect(replay.status).toBe(200);
    expect(again.applied).toBe(false);
    expect(again.balance_micros).toBe(applied.balance_micros);
    const bad = await post('sha256=deadbeef');
    expect(bad.status).toBe(401);
  });

  test('the webhook is hidden until a secret is configured', async () => {
    ctx = await createTestContext();
    const res = await ctx.app.request('/admin/payments/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});
