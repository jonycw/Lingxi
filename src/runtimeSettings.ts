import type { AppConfig } from './config.js';
import type { Db, Executor } from './db/executor.js';
import type { Repository } from './db/repository.js';
import { ApiError } from './errors.js';
import type { ModelCatalog } from './models.js';

const KEY_BASE = 'upstream.base_url';
const KEY_SECRET = 'upstream.api_key';
const KEY_MOCK = 'upstream.mock';
const KEY_MAP = 'upstream.model_map';

const MODEL_NAME = /^[A-Za-z0-9._:/+-]{1,128}$/;

export type EffectiveUpstream = {
  baseUrl: string;
  apiKey: string;
  mock: boolean;
  mode: 'mock' | 'proxy';
  baseUrlSource: 'settings' | 'env';
  keySource: 'settings' | 'env' | 'none';
  mockSource: 'settings' | 'env';
};

export type UpstreamView = {
  object: 'lingxi.upstream';
  base_url: string;
  base_url_source: 'settings' | 'env';
  key_set: boolean;
  key_last4: string | null;
  key_source: 'settings' | 'env' | 'none';
  mock: boolean;
  mock_source: 'settings' | 'env';
  mode: 'mock' | 'proxy';
  models: Array<{
    id: string;
    file_upstream: string;
    upstream: string;
    source: 'settings' | 'file';
  }>;
};

export type UpstreamPatch = {
  reset?: boolean;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  mock?: boolean;
  models?: Array<{ id: string; upstream: string }>;
};

export type RuntimeSettings = {
  effective(): Promise<EffectiveUpstream>;
  view(): Promise<UpstreamView>;
  save(patch: UpstreamPatch): Promise<UpstreamView>;
  upstreamName(publicId: string, fallback: string): Promise<string>;
};

type SavedUpstream = {
  baseUrl: string;
  apiKey: string;
  mock: boolean | null;
  modelMap: Record<string, string>;
};

function rememberSecret(secrets: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed.length >= 8 && !secrets.includes(trimmed)) {
    secrets.push(trimmed);
  }
}

function last4(key: string): string | null {
  if (key.length < 8) {
    return null;
  }
  return key.slice(-4);
}

function parseModelMap(raw: string | null): Record<string, string> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function assertBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.length > 500) {
    throw new ApiError(400, 'base_url is too long', 'invalid_request_error', 'invalid_parameter');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError(400, 'base_url must be an http or https URL', 'invalid_request_error', 'invalid_parameter');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'base_url must be an http or https URL', 'invalid_request_error', 'invalid_parameter');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ApiError(
      400,
      'base_url must not include credentials, a query string, or a fragment',
      'invalid_request_error',
      'invalid_parameter',
    );
  }
  return trimmed;
}

function assertApiKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 512 || /\s/.test(trimmed) || trimmed.includes('•')) {
    throw new ApiError(
      400,
      'api_key must be 8 to 512 characters without spaces',
      'invalid_request_error',
      'invalid_parameter',
    );
  }
  return trimmed;
}

export function createRuntimeSettings(input: {
  config: AppConfig;
  db: Db;
  repo: Repository;
  models: ModelCatalog;
  now?: () => Date;
}): RuntimeSettings {
  const { config, db, repo, models } = input;
  const now = input.now ?? (() => new Date());

  async function readSaved(executor: Executor = db): Promise<SavedUpstream> {
    const [baseUrl, apiKey, mockRaw, mapRaw] = await Promise.all([
      repo.getSetting(executor, KEY_BASE),
      repo.getSetting(executor, KEY_SECRET),
      repo.getSetting(executor, KEY_MOCK),
      repo.getSetting(executor, KEY_MAP),
    ]);
    let mock: boolean | null = null;
    if (mockRaw === 'true') {
      mock = true;
    } else if (mockRaw === 'false') {
      mock = false;
    }
    return {
      baseUrl: (baseUrl ?? '').trim(),
      apiKey: (apiKey ?? '').trim(),
      mock,
      modelMap: parseModelMap(mapRaw),
    };
  }

  function combine(saved: SavedUpstream): EffectiveUpstream {
    if (saved.apiKey) {
      rememberSecret(config.secrets, saved.apiKey);
    }
    rememberSecret(config.secrets, config.upstreamApiKey);
    const baseUrl = (saved.baseUrl || config.upstreamBaseUrl).replace(/\/+$/, '');
    const apiKey = saved.apiKey || config.upstreamApiKey;
    const mock = saved.mock === null ? config.upstreamMock : saved.mock;
    return {
      baseUrl,
      apiKey,
      mock,
      mode: mock || apiKey.length === 0 ? 'mock' : 'proxy',
      baseUrlSource: saved.baseUrl ? 'settings' : 'env',
      keySource: saved.apiKey ? 'settings' : apiKey ? 'env' : 'none',
      mockSource: saved.mock === null ? 'env' : 'settings',
    };
  }

  function toView(live: EffectiveUpstream, saved: SavedUpstream): UpstreamView {
    return {
      object: 'lingxi.upstream',
      base_url: live.baseUrl,
      base_url_source: live.baseUrlSource,
      key_set: live.apiKey.length > 0,
      key_last4: last4(live.apiKey),
      key_source: live.keySource,
      mock: live.mock,
      mock_source: live.mockSource,
      mode: live.mode,
      models: models.list().map((model) => {
        const override = saved.modelMap[model.id];
        return {
          id: model.id,
          file_upstream: model.upstream,
          upstream: override || model.upstream,
          source: override ? 'settings' : 'file',
        };
      }),
    };
  }

  async function view(): Promise<UpstreamView> {
    const saved = await readSaved();
    return toView(combine(saved), saved);
  }

  return {
    async effective() {
      return combine(await readSaved());
    },
    view,
    async upstreamName(publicId, fallback) {
      const saved = await readSaved();
      return saved.modelMap[publicId] || fallback;
    },
    async save(patch) {
      if (patch.reset) {
        await db.transaction(async (tx) => {
          await repo.deleteSetting(tx, KEY_BASE);
          await repo.deleteSetting(tx, KEY_SECRET);
          await repo.deleteSetting(tx, KEY_MOCK);
          await repo.deleteSetting(tx, KEY_MAP);
        });
        return view();
      }

      const saved = await readSaved();
      const next: SavedUpstream = {
        baseUrl: patch.baseUrl === undefined ? saved.baseUrl : patch.baseUrl,
        apiKey: saved.apiKey,
        mock: patch.mock === undefined ? saved.mock : patch.mock,
        modelMap: patch.models === undefined ? { ...saved.modelMap } : {},
      };
      if (patch.clearApiKey) {
        next.apiKey = '';
      } else if (patch.apiKey !== undefined) {
        next.apiKey = patch.apiKey;
      }
      if (patch.models) {
        const known = new Set(models.list().map((model) => model.id));
        for (const row of patch.models) {
          if (!known.has(row.id)) {
            throw new ApiError(400, 'Model is not in the catalog', 'invalid_request_error', 'model_not_found');
          }
          const upstream = row.upstream.trim();
          if (!upstream) {
            continue;
          }
          if (!MODEL_NAME.test(upstream)) {
            throw new ApiError(400, 'upstream model name is invalid', 'invalid_request_error', 'invalid_parameter');
          }
          const fileUpstream = models.list().find((model) => model.id === row.id)?.upstream;
          if (upstream !== fileUpstream) {
            next.modelMap[row.id] = upstream;
          }
        }
      }

      const live = combine(next);
      if (!live.mock) {
        if (!live.apiKey) {
          throw new ApiError(
            400,
            'Turn mock off only when an upstream API key is saved here or set in UPSTREAM_API_KEY',
            'invalid_request_error',
            'upstream_key_required',
          );
        }
        assertBaseUrl(live.baseUrl);
      } else if (next.baseUrl) {
        assertBaseUrl(next.baseUrl);
      }

      const stamp = now().toISOString();
      await db.transaction(async (tx) => {
        if (next.baseUrl) {
          await repo.setSetting(tx, KEY_BASE, next.baseUrl, stamp);
        } else {
          await repo.deleteSetting(tx, KEY_BASE);
        }
        if (next.apiKey) {
          await repo.setSetting(tx, KEY_SECRET, next.apiKey, stamp);
        } else {
          await repo.deleteSetting(tx, KEY_SECRET);
        }
        if (next.mock === null) {
          await repo.deleteSetting(tx, KEY_MOCK);
        } else {
          await repo.setSetting(tx, KEY_MOCK, next.mock ? 'true' : 'false', stamp);
        }
        if (Object.keys(next.modelMap).length === 0) {
          await repo.deleteSetting(tx, KEY_MAP);
        } else {
          await repo.setSetting(tx, KEY_MAP, JSON.stringify(next.modelMap), stamp);
        }
      });
      if (next.apiKey) {
        rememberSecret(config.secrets, next.apiKey);
      }
      return view();
    },
  };
}

export function parseUpstreamPatch(body: Record<string, unknown>): UpstreamPatch {
  const patch: UpstreamPatch = {};
  if (body.reset === true) {
    patch.reset = true;
    return patch;
  }
  if (body.reset !== undefined && body.reset !== false) {
    throw new ApiError(400, 'reset must be a boolean', 'invalid_request_error', 'invalid_parameter');
  }
  if ('base_url' in body && body.base_url !== undefined) {
    if (typeof body.base_url !== 'string') {
      throw new ApiError(400, 'base_url must be a string', 'invalid_request_error', 'invalid_parameter');
    }
    patch.baseUrl = body.base_url.trim() ? assertBaseUrl(body.base_url) : '';
  }
  if ('api_key' in body && body.api_key !== undefined && body.api_key !== '') {
    if (typeof body.api_key !== 'string') {
      throw new ApiError(400, 'api_key must be a string', 'invalid_request_error', 'invalid_parameter');
    }
    patch.apiKey = assertApiKey(body.api_key);
  }
  if (body.clear_api_key === true) {
    if (patch.apiKey) {
      throw new ApiError(
        400,
        'Send either api_key or clear_api_key',
        'invalid_request_error',
        'invalid_parameter',
      );
    }
    patch.clearApiKey = true;
  } else if (body.clear_api_key !== undefined && body.clear_api_key !== false) {
    throw new ApiError(400, 'clear_api_key must be a boolean', 'invalid_request_error', 'invalid_parameter');
  }
  if ('mock' in body && body.mock !== undefined) {
    if (typeof body.mock !== 'boolean') {
      throw new ApiError(400, 'mock must be a boolean', 'invalid_request_error', 'invalid_parameter');
    }
    patch.mock = body.mock;
  }
  if ('models' in body && body.models !== undefined) {
    if (!Array.isArray(body.models)) {
      throw new ApiError(400, 'models must be an array', 'invalid_request_error', 'invalid_parameter');
    }
    patch.models = body.models.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new ApiError(400, 'each model mapping must be an object', 'invalid_request_error', 'invalid_parameter');
      }
      const record = row as { id?: unknown; upstream?: unknown };
      if (typeof record.id !== 'string' || !record.id.trim()) {
        throw new ApiError(400, 'model id is required', 'invalid_request_error', 'invalid_parameter');
      }
      if (typeof record.upstream !== 'string') {
        throw new ApiError(400, 'upstream model name must be a string', 'invalid_request_error', 'invalid_parameter');
      }
      return { id: record.id.trim(), upstream: record.upstream };
    });
  }
  if (
    patch.baseUrl === undefined &&
    patch.apiKey === undefined &&
    !patch.clearApiKey &&
    patch.mock === undefined &&
    patch.models === undefined
  ) {
    throw new ApiError(400, 'No upstream settings to update', 'invalid_request_error', 'invalid_parameter');
  }
  return patch;
}
