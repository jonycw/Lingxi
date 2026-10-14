import { afterEach, describe, expect, test } from 'vitest';
import { adminHeaders, chatRequest, createTestContext, issueCustomerKey, type TestContext } from './helpers.js';

const savedKey = 'cursor-upstream-secret-value';
const envKey = 'env-upstream-secret-value';

function completionResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl_up',
      object: 'chat.completion',
      model: 'cursor-small',
      choices: [{ index: 0, message: { role: 'assistant', content: 'from-upstream' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('upstream settings', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.close();
  });

  test('admin can save a masked upstream key and the next chat uses it without a restart', async () => {
    ctx = await createTestContext({
      env: {
        UPSTREAM_API_KEY: '',
        UPSTREAM_BASE_URL: 'https://env.example/v1',
        UPSTREAM_MOCK: 'false',
      },
      fetchImpl: async () => completionResponse(),
    });

    const denied = await ctx.app.request('/admin/upstream');
    expect(denied.status).toBe(401);

    const before = await ctx.app.request('/admin/upstream', { headers: adminHeaders() });
    expect(before.status).toBe(200);
    const initial = (await before.json()) as { mode: string; key_set: boolean; key_source: string };
    expect(initial.mode).toBe('mock');
    expect(initial.key_set).toBe(false);
    expect(initial.key_source).toBe('none');
    expect(JSON.stringify(initial)).not.toContain('api_key');

    const saved = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({
        base_url: 'https://cursor.example/v1',
        api_key: savedKey,
        mock: false,
        models: [{ id: 'lingxi-fast', upstream: 'cursor-small' }],
      }),
    });
    expect(saved.status).toBe(200);
    const view = (await saved.json()) as {
      mode: string;
      key_set: boolean;
      key_last4: string;
      key_source: string;
      base_url: string;
      base_url_source: string;
      mock: boolean;
      models: Array<{ id: string; upstream: string; source: string }>;
    };
    expect(view.mode).toBe('proxy');
    expect(view.mock).toBe(false);
    expect(view.key_set).toBe(true);
    expect(view.key_last4).toBe('alue');
    expect(view.key_source).toBe('settings');
    expect(view.base_url).toBe('https://cursor.example/v1');
    expect(view.base_url_source).toBe('settings');
    expect(view.models.find((row) => row.id === 'lingxi-fast')).toMatchObject({
      upstream: 'cursor-small',
      source: 'settings',
    });
    expect(JSON.stringify(view)).not.toContain(savedKey);
    expect(view).not.toHaveProperty('api_key');
    expect(ctx.logs.join('\n')).not.toContain(savedKey);

    const health = await ctx.app.request('/health');
    expect(((await health.json()) as { upstream: string }).upstream).toBe('proxy');

    const { key } = await issueCustomerKey(ctx.app, { credits: 5 });
    const chat = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(chat.status).toBe(200);
    expect(ctx.fetchCalls).toHaveLength(1);
    const call = ctx.fetchCalls[0]!;
    expect(call.url).toBe('https://cursor.example/v1/chat/completions');
    expect(new Headers(call.init?.headers).get('authorization')).toBe(`Bearer ${savedKey}`);
    expect(JSON.parse(String(call.init?.body)).model).toBe('cursor-small');
    expect(ctx.logs.join('\n')).not.toContain(savedKey);
    expect(ctx.logs.join('\n')).not.toContain(key.key);

    const kept = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ mock: true }),
    });
    expect(kept.status).toBe(200);
    expect(((await kept.json()) as { mode: string; key_last4: string }).key_last4).toBe('alue');
    const mocked = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(mocked.status).toBe(200);
    expect(await mocked.json()).toMatchObject({
      choices: [{ message: { content: expect.stringContaining('灵犀模拟') } }],
    });
    expect(ctx.fetchCalls).toHaveLength(1);
  });

  test('saved settings override the env key and can fall back again', async () => {
    ctx = await createTestContext({
      env: {
        UPSTREAM_API_KEY: envKey,
        UPSTREAM_BASE_URL: 'https://env.example/v1',
        UPSTREAM_MOCK: 'false',
      },
      fetchImpl: async () => completionResponse(),
    });
    const seen = await ctx.app.request('/admin/upstream', { headers: adminHeaders() });
    const envView = (await seen.json()) as { key_source: string; key_last4: string; mode: string };
    expect(envView.mode).toBe('proxy');
    expect(envView.key_source).toBe('env');
    expect(envView.key_last4).toBe('alue');
    expect(JSON.stringify(envView)).not.toContain(envKey);

    const replaced = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({
        base_url: 'https://cursor.example/v1/',
        api_key: savedKey,
        mock: false,
      }),
    });
    expect(replaced.status).toBe(200);
    const { key } = await issueCustomerKey(ctx.app, { credits: 5 });
    const chat = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(chat.status).toBe(200);
    expect(ctx.fetchCalls[0]?.url).toBe('https://cursor.example/v1/chat/completions');
    expect(new Headers(ctx.fetchCalls[0]?.init?.headers).get('authorization')).toBe(`Bearer ${savedKey}`);

    const cleared = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ clear_api_key: true, base_url: '' }),
    });
    expect(cleared.status).toBe(200);
    const fallback = (await cleared.json()) as { key_source: string; base_url: string; base_url_source: string };
    expect(fallback.key_source).toBe('env');
    expect(fallback.base_url).toBe('https://env.example/v1');
    expect(fallback.base_url_source).toBe('env');
    expect(JSON.stringify(fallback)).not.toContain(savedKey);
    expect(JSON.stringify(fallback)).not.toContain(envKey);

    await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(ctx.fetchCalls[1]?.url).toBe('https://env.example/v1/chat/completions');
    expect(new Headers(ctx.fetchCalls[1]?.init?.headers).get('authorization')).toBe(`Bearer ${envKey}`);
    expect(ctx.logs.join('\n')).not.toContain(savedKey);
    expect(ctx.logs.join('\n')).not.toContain(envKey);
  });

  test('rejects a bad url, a short key, and a customer key', async () => {
    ctx = await createTestContext();
    const badUrl = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ base_url: 'not-a-url' }),
    });
    expect(badUrl.status).toBe(400);

    const shortKey = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ api_key: 'short' }),
    });
    expect(shortKey.status).toBe(400);

    const { key } = await issueCustomerKey(ctx.app, { credits: 1 });
    const asCustomer = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mock: true }),
    });
    expect(asCustomer.status).toBe(401);

    const reset = await ctx.app.request('/admin/upstream', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ reset: true }),
    });
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as { key_source: string }).key_source).toBe('none');
  });
});
