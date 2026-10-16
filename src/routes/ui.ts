import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import type { LingxiApp } from '../appTypes.js';
import { SERVICE_NAME, VERSION } from '../version.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

const ASSETS: Record<string, string> = {
  'admin.html': 'text/html; charset=utf-8',
  'app.html': 'text/html; charset=utf-8',
  'home.html': 'text/html; charset=utf-8',
  'console.css': 'text/css; charset=utf-8',
  'ui.js': 'text/javascript; charset=utf-8',
  'admin.js': 'text/javascript; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'boot.js': 'text/javascript; charset=utf-8',
  'favicon.svg': 'image/svg+xml',
};

function notFound(c: Context) {
  return c.json({ error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' } }, 404);
}

function wantsHtml(accept: string | undefined): boolean {
  return (accept ?? '').toLowerCase().includes('text/html');
}

async function sendAsset(c: Context, name: string) {
  if (!Object.hasOwn(ASSETS, name) || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return notFound(c);
  }
  const type = ASSETS[name];
  const filePath = path.join(publicDir, name);
  if (path.dirname(filePath) !== publicDir) {
    return notFound(c);
  }
  let body: string;
  try {
    body = await readFile(filePath, 'utf8');
  } catch {
    return notFound(c);
  }
  c.header('Cache-Control', 'no-cache');
  return c.body(body, 200, { 'Content-Type': type });
}

export function registerConsole(app: LingxiApp): void {
  app.get('/', (c) => {
    if (wantsHtml(c.req.header('accept'))) {
      return sendAsset(c, 'home.html');
    }
    return c.json({
      service: SERVICE_NAME,
      version: VERSION,
      health: '/health',
      consoles: { admin: '/admin/ui', customer: '/console' },
      openai: '/v1/chat/completions',
      models: '/v1/models',
      skills: '/v1/skills',
      account: '/v1/me',
    });
  });

  const adminPage = (c: Context) => sendAsset(c, 'admin.html');
  app.get('/admin/ui', adminPage);
  app.get('/admin/ui/', adminPage);
  app.get('/console/admin', (c) => c.redirect('/admin/ui', 302));
  const customerPage = (c: Context) => sendAsset(c, 'app.html');
  app.get('/console', customerPage);
  app.get('/console/', customerPage);
  app.get('/app', (c) => c.redirect('/console', 302));
  app.get('/app/', (c) => c.redirect('/console', 302));
  app.get('/console/static/:file', (c) => sendAsset(c, c.req.param('file')));
}
