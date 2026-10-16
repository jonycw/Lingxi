import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, issueCustomerKey, type TestContext } from './helpers.js';

describe('console', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.close();
  });

  it('serves the admin and customer consoles without an admin token', async () => {
    ctx = await createTestContext();
    const admin = await ctx.app.request('/admin/ui');
    expect(admin.status).toBe(200);
    expect(admin.headers.get('content-type')).toContain('text/html');
    const html = await admin.text();
    expect(html).toContain('灵犀');
    expect(html).not.toContain('dev-admin-token-change-me');

    const alias = await ctx.app.request('/console/admin');
    expect(alias.status).toBe(302);
    expect(alias.headers.get('location')).toBe('/admin/ui');

    const customer = await ctx.app.request('/console');
    expect(customer.status).toBe(200);
    expect(await customer.text()).toContain('灵犀对话台');

    const appAlias = await ctx.app.request('/app');
    expect(appAlias.status).toBe(302);
    expect(appAlias.headers.get('location')).toBe('/console');
  });

  it('returns HTML or a JSON index from / based on Accept', async () => {
    ctx = await createTestContext();
    const html = await ctx.app.request('/', { headers: { Accept: 'text/html' } });
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(await html.text()).toContain('/admin/ui');

    const json = await ctx.app.request('/', { headers: { Accept: 'application/json' } });
    expect(json.headers.get('content-type')).toContain('application/json');
    const body = (await json.json()) as { consoles: { admin: string; customer: string }; account: string };
    expect(body.consoles.admin).toBe('/admin/ui');
    expect(body.consoles.customer).toBe('/console');
    expect(body.account).toBe('/v1/me');
  });

  it('serves self-hosted assets and rejects paths outside the allowlist', async () => {
    ctx = await createTestContext();
    const css = await ctx.app.request('/console/static/console.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).not.toMatch(/https?:\/\//);

    const script = await ctx.app.request('/console/static/admin.js');
    expect(script.status).toBe(200);
    const adminSource = await script.text();
    expect(adminSource).not.toContain('dev-admin-token-change-me');
    expect(adminSource).toContain("'skills'");

    const chat = await ctx.app.request('/console/static/app.js');
    expect(chat.status).toBe(200);
    expect(await chat.text()).toContain('lingxi_skills');

    const traversal = await ctx.app.request('/console/static/..%2Fpackage.json');
    expect(traversal.status).toBe(404);
    const unknown = await ctx.app.request('/console/static/package.json');
    expect(unknown.status).toBe(404);
  });

  it('returns the signed-in account without the plaintext key', async () => {
    ctx = await createTestContext();
    const { key } = await issueCustomerKey(ctx.app, { credits: 4 });
    const res = await ctx.app.request('/v1/me', {
      headers: { Authorization: `Bearer ${key.key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      customer: { balance_credits: string };
      api_key: { prefix: string };
    };
    expect(body.object).toBe('lingxi.account');
    expect(body.customer.balance_credits).toBe('4');
    expect(body.api_key.prefix).toBe(key.prefix);
    expect(JSON.stringify(body)).not.toContain(key.key);

    const anon = await ctx.app.request('/v1/me');
    expect(anon.status).toBe(401);
  });
});
