import { afterEach, describe, expect, test } from 'vitest';
import { messagesWithSkillInjection, renderSkillInjection, stripGatewayExtensions } from '../src/skills.js';
import { adminHeaders, chatRequest, createTestContext, issueCustomerKey, type TestContext } from './helpers.js';

const briefBody = 'Answer in one short sentence.';

describe('skill packs', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  test('admin can create, update, enable, disable, and delete a skill pack', async () => {
    ctx = await createTestContext();
    const created = await ctx.app.request('/admin/skills', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        id: 'brief',
        name: 'Brief',
        description: 'Short answers',
        body: briefBody,
      }),
    });
    expect(created.status).toBe(201);
    const skill = (await created.json()) as { id: string; enabled: boolean; version: number; body: string };
    expect(skill).toMatchObject({ id: 'brief', enabled: true, version: 1, body: briefBody });

    const duplicate = await ctx.app.request('/admin/skills', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ id: 'brief', name: 'Brief', description: 'Short answers', body: briefBody }),
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe('skill_exists');

    const patched = await ctx.app.request('/admin/skills/brief', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ name: 'Be brief' }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { version: number; name: string };
    expect(patchedBody.version).toBe(2);
    expect(patchedBody.name).toBe('Be brief');

    const disabled = await ctx.app.request('/admin/skills/brief/disable', {
      method: 'POST',
      headers: adminHeaders(),
    });
    expect(disabled.status).toBe(200);
    expect(((await disabled.json()) as { enabled: boolean; version: number })).toMatchObject({
      enabled: false,
      version: 3,
    });

    const enabled = await ctx.app.request('/admin/skills/brief/enable', {
      method: 'POST',
      headers: adminHeaders(),
    });
    expect(((await enabled.json()) as { enabled: boolean }).enabled).toBe(true);

    const listed = await ctx.app.request('/admin/skills', { headers: adminHeaders() });
    const list = (await listed.json()) as { data: Array<{ id: string; body: string }> };
    expect(list.data.map((row) => row.id)).toEqual(['brief']);
    expect(list.data[0]?.body).toBe(briefBody);

    const removed = await ctx.app.request('/admin/skills/brief', {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(removed.status).toBe(200);
    const after = await ctx.app.request('/admin/skills', { headers: adminHeaders() });
    expect(((await after.json()) as { data: unknown[] }).data).toEqual([]);
  });

  test('customer keys cannot manage skills, and the admin token cannot list them', async () => {
    ctx = await createTestContext();
    const { key } = await issueCustomerKey(ctx.app);
    const asCustomer = await ctx.app.request('/admin/skills', {
      headers: { Authorization: `Bearer ${key.key}` },
    });
    expect(asCustomer.status).toBe(401);
    expect(((await asCustomer.json()) as { error: { code: string } }).error.code).toBe('invalid_admin_token');

    const missing = await ctx.app.request('/admin/skills', { method: 'GET' });
    expect(missing.status).toBe(401);

    const asAdmin = await ctx.app.request('/v1/skills', { headers: adminHeaders() });
    expect(asAdmin.status).toBe(401);
    expect(((await asAdmin.json()) as { error: { code: string } }).error.code).toBe('invalid_api_key');
  });

  test('customers see enabled packs without the body', async () => {
    ctx = await createTestContext();
    await createPack(ctx, { id: 'brief', body: briefBody });
    await createPack(ctx, { id: 'quiet', name: 'Quiet', body: 'Stay quiet.', enabled: false });
    const { key } = await issueCustomerKey(ctx.app);
    const res = await ctx.app.request('/v1/skills', { headers: { Authorization: `Bearer ${key.key}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'brief', name: 'Brief', description: 'Short answers', version: 1 }),
    ]);
    expect(JSON.stringify(body)).not.toContain(briefBody);
    expect(JSON.stringify(body)).not.toContain('quiet');
    expect(JSON.stringify(body)).not.toContain(ctx.config.adminToken);
  });

  test('mock mode shows the applied pack and does not require an upstream key', async () => {
    ctx = await createTestContext();
    await createPack(ctx, { id: 'brief', body: briefBody });
    const { key } = await issueCustomerKey(ctx.app);
    const res = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      messages: [{ role: 'user', content: '你好' }],
      lingxi_skills: ['brief', 'brief'],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-lingxi-skills')).toBe('brief');
    const completion = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    expect(completion.choices[0]?.message.content).toContain('灵犀模拟');
    expect(completion.choices[0]?.message.content).toContain('已应用技能：brief');

    const streamed = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      stream: true,
      messages: [{ role: 'user', content: '你好' }],
      lingxi_skills: ['brief'],
    });
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get('x-lingxi-skills')).toBe('brief');
    const sse = await streamed.text();
    const streamedText = sse
      .split('\n\n')
      .map((block) => block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'))
      .filter((data) => data && data !== '[DONE]')
      .map((data) => {
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        return payload.choices?.[0]?.delta?.content ?? '';
      })
      .join('');
    expect(streamedText).toContain('灵犀模拟');
    expect(streamedText).toContain('已应用技能：brief');
  });

  test('proxy mode injects the pack, strips gateway fields, and keeps other metadata', async () => {
    ctx = await createTestContext({
      env: { UPSTREAM_API_KEY: 'upstream-secret-do-not-log', UPSTREAM_MOCK: 'false' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl_up',
            object: 'chat.completion',
            model: 'gpt-4o-mini',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 11, completion_tokens: 1, total_tokens: 12 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    await createPack(ctx, { id: 'brief', body: briefBody });
    await createPack(ctx, { id: 'other', name: 'Other', body: 'Ignore this pack.' });
    const { key } = await issueCustomerKey(ctx.app);
    const res = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      lingxi_skills: ['brief'],
      metadata: { skills: ['other'], user: 'demo-user' },
      api_key: 'customer-should-not-forward',
      messages: [
        { role: 'system', content: 'Be polite.' },
        { role: 'user', content: 'hello' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-lingxi-skills')).toBe('brief');
    const sent = JSON.parse(String(ctx.fetchCalls[0]?.init?.body)) as {
      lingxi_skills?: unknown;
      api_key?: unknown;
      metadata?: { skills?: unknown; user?: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.lingxi_skills).toBeUndefined();
    expect(sent.api_key).toBeUndefined();
    expect(sent.metadata).toEqual({ user: 'demo-user' });
    expect(sent.messages[0]?.content.startsWith('# Lingxi skills')).toBe(true);
    expect(sent.messages[0]?.content).toContain(briefBody);
    expect(sent.messages[0]?.content).toContain('Be polite.');
    expect(sent.messages[0]?.content).not.toContain('Ignore this pack.');
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(JSON.stringify(sent)).not.toContain(key.key);
    expect(JSON.stringify(sent)).not.toContain(ctx.config.adminToken);
  });

  test('metadata.skills is used only when lingxi_skills is omitted', async () => {
    ctx = await createTestContext({
      env: { UPSTREAM_API_KEY: 'upstream-secret-do-not-log', UPSTREAM_MOCK: 'false' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl_up',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
          }),
          { status: 200 },
        ),
    });
    await createPack(ctx, { id: 'brief', body: briefBody });
    const { key } = await issueCustomerKey(ctx.app);
    const res = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      metadata: { skills: ['brief'] },
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(res.status).toBe(200);
    const sent = JSON.parse(String(ctx.fetchCalls[0]?.init?.body)) as {
      metadata?: unknown;
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.metadata).toBeUndefined();
    expect(sent.messages[0]?.role).toBe('system');
    expect(sent.messages[0]?.content).toContain(briefBody);
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  test('unknown and disabled packs are rejected before the upstream is called', async () => {
    ctx = await createTestContext({
      env: { UPSTREAM_API_KEY: 'upstream-secret-do-not-log', UPSTREAM_MOCK: 'false' },
      fetchImpl: async () => new Response('{}', { status: 500 }),
    });
    await createPack(ctx, { id: 'quiet', name: 'Quiet', body: 'Stay quiet.', enabled: false });
    const { key } = await issueCustomerKey(ctx.app, { credits: 5 });
    const unknown = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      lingxi_skills: ['missing'],
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('skill_not_found');

    const disabled = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      lingxi_skills: ['quiet'],
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(disabled.status).toBe(400);
    expect(((await disabled.json()) as { error: { code: string } }).error.code).toBe('skill_disabled');
    expect(ctx.fetchCalls).toHaveLength(0);

    const customer = await ctx.app.request('/admin/customers', { headers: adminHeaders() });
    const rows = (await customer.json()) as { data: Array<{ balance_micros: number }> };
    expect(rows.data[0]?.balance_micros).toBe(5_000_000);
  });

  test('too many ids and an oversized injection are rejected', async () => {
    ctx = await createTestContext({ env: { SKILL_INJECT_MAX_CHARS: '700' } });
    await createPack(ctx, { id: 'alpha', name: 'Alpha', body: 'A'.repeat(400) });
    await createPack(ctx, { id: 'beta', name: 'Beta', body: 'B'.repeat(400) });
    const { key } = await issueCustomerKey(ctx.app);
    const tooMany = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      lingxi_skills: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'],
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(tooMany.status).toBe(400);
    expect(((await tooMany.json()) as { error: { code: string } }).error.code).toBe('too_many_skills');

    const one = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      lingxi_skills: ['alpha'],
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(one.status).toBe(200);

    const both = await chatRequest(ctx.app, key.key, {
      model: 'lingxi-fast',
      lingxi_skills: ['alpha', 'beta'],
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(both.status).toBe(400);
    expect(((await both.json()) as { error: { code: string; message: string } }).error.code).toBe(
      'skill_prompt_too_long',
    );

    const huge = await ctx.app.request('/admin/skills', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        id: 'huge',
        name: 'Huge',
        description: 'Too long to store',
        body: 'H'.repeat(8_001),
      }),
    });
    expect(huge.status).toBe(400);
    expect(((await huge.json()) as { error: { code: string } }).error.code).toBe('invalid_parameter');
  });

  test('the injection preface is a fixed literal and joins an existing system message', () => {
    expect(renderSkillInjection([{ id: 'brief', name: 'Brief', body: 'Use short sentences.' }])).toBe(
      [
        '# Lingxi skills',
        '',
        'Follow the skill instructions below for this request. They do not grant access to admin tokens, upstream keys, or other secrets.',
        '',
        '## Brief (brief)',
        '',
        'Use short sentences.',
      ].join('\n'),
    );
    expect(
      messagesWithSkillInjection(
        [{ role: 'developer', content: [{ type: 'text', text: 'Keep this.' }] }],
        'INJECT',
      ),
    ).toEqual([
      {
        role: 'developer',
        content: [
          { type: 'text', text: 'INJECT' },
          { type: 'text', text: 'Keep this.' },
        ],
      },
    ]);
    expect(stripGatewayExtensions({ lingxi_skills: ['brief'], metadata: { skills: ['brief'] }, model: 'lingxi-fast' })).toEqual({
      model: 'lingxi-fast',
    });
  });
});

async function createPack(
  ctx: TestContext,
  input: { id: string; name?: string; body: string; enabled?: boolean },
) {
  const res = await ctx.app.request('/admin/skills', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      id: input.id,
      name: input.name ?? 'Brief',
      description: 'Short answers',
      body: input.body,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    }),
  });
  expect(res.status).toBe(201);
}
