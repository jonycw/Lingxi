import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import { ApiError } from './errors.js';
import type { EffectiveUpstream } from './runtimeSettings.js';
import type { Logger } from './logger.js';
import { scrubSecrets } from './redact.js';
import {
  estimateMessages,
  estimateTokens,
  extractDeltaText,
  messageText,
  usageFromUnknown,
  zeroUsage,
} from './tokens.js';
import type { TokenUsage } from './types.js';
import { VERSION } from './version.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type UpstreamRequest = {
  publicModel: string;
  upstreamModel: string;
  body: Record<string, unknown>;
  messages: unknown;
};

export type CompletionResult = {
  json: Record<string, unknown>;
  usage: TokenUsage;
};

export type StreamEvent =
  | { type: 'chunk'; payload: Record<string, unknown>; usage: TokenUsage | null }
  | { type: 'done'; usage: TokenUsage };

export type Upstream = {
  complete(input: UpstreamRequest): Promise<CompletionResult>;
  openStream(input: UpstreamRequest): Promise<{ events: () => AsyncGenerator<StreamEvent> }>;
};

function completionText(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
    return '';
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    return '';
  }
  return messageText((message as { content?: unknown }).content);
}

function withUsage(payload: Record<string, unknown>, usage: TokenUsage, publicModel: string): Record<string, unknown> {
  return {
    ...payload,
    model: publicModel,
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    },
  };
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return '';
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') {
      continue;
    }
    if ((message as { role?: unknown }).role === 'user') {
      return messageText((message as { content?: unknown }).content).slice(0, 200);
    }
  }
  return '';
}

export function buildMockCompletion(input: UpstreamRequest, now: Date): { json: Record<string, unknown>; usage: TokenUsage; text: string } {
  const echoed = lastUserText(input.messages);
  const text = echoed ? `（灵犀模拟）已收到：${echoed}` : '（灵犀模拟）上游未配置，这是一条本地模拟回复。';
  const promptTokens = estimateMessages(input.messages);
  const completionTokens = Math.max(1, estimateTokens(text));
  const usage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
  const created = Math.floor(now.getTime() / 1000);
  const json = {
    id: `chatcmpl_mock_${randomUUID()}`,
    object: 'chat.completion',
    created,
    model: input.publicModel,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    },
  };
  return { json, usage, text };
}

function createMockUpstream(now: () => Date): Upstream {
  return {
    async complete(input) {
      const built = buildMockCompletion(input, now());
      return { json: built.json, usage: built.usage };
    },
    async openStream(input) {
      const built = buildMockCompletion(input, now());
      const created = Math.floor(now().getTime() / 1000);
      const id = `chatcmpl_mock_${randomUUID()}`;
      const chunks: Record<string, unknown>[] = [
        {
          id,
          object: 'chat.completion.chunk',
          created,
          model: input.publicModel,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        },
      ];
      const piece = 12;
      for (let offset = 0; offset < built.text.length; offset += piece) {
        chunks.push({
          id,
          object: 'chat.completion.chunk',
          created,
          model: input.publicModel,
          choices: [{ index: 0, delta: { content: built.text.slice(offset, offset + piece) }, finish_reason: null }],
        });
      }
      chunks.push({
        id,
        object: 'chat.completion.chunk',
        created,
        model: input.publicModel,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: built.usage.promptTokens,
          completion_tokens: built.usage.completionTokens,
          total_tokens: built.usage.totalTokens,
        },
      });
      return {
        events: async function* events() {
          for (const payload of chunks) {
            yield { type: 'chunk' as const, payload, usage: usageFromUnknown(payload.usage) };
          }
          yield { type: 'done' as const, usage: built.usage };
        },
      };
    },
  };
}

async function* iterateSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = function* (block: string): Generator<string> {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) {
      yield data;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        yield* emit(raw);
        split = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, '\n');
    if (buffer.trim()) {
      yield* emit(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

function upstreamFailure(status: number, text: string, headers: Headers, secrets: readonly string[]): ApiError {
  const scrubbed = scrubSecrets(text, secrets).slice(0, 500);
  const retry = headers.get('retry-after');
  const extra: Record<string, string> = {};
  if (retry && /^\d+$/.test(retry)) {
    extra['Retry-After'] = retry;
  }
  if (status === 401 || status === 403) {
    return new ApiError(502, 'Gateway upstream authentication failed', 'upstream_error', 'upstream_auth', extra, scrubbed);
  }
  if (status === 429) {
    return new ApiError(429, 'Upstream rate limit exceeded', 'rate_limit_error', 'upstream_rate_limit', extra, scrubbed);
  }
  if (status === 404) {
    return new ApiError(404, 'Upstream model not found', 'invalid_request_error', 'model_not_found', extra, scrubbed);
  }
  if (status >= 400 && status < 500) {
    let message = 'Upstream rejected the request';
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === 'string') {
        message = scrubSecrets(parsed.error.message, secrets).slice(0, 300);
      }
    } catch {
      // Keep the generic client message.
    }
    return new ApiError(400, message, 'invalid_request_error', 'upstream_rejected', extra, scrubbed);
  }
  return new ApiError(502, 'Upstream request failed', 'upstream_error', 'upstream_error', extra, scrubbed);
}

function createProxyUpstream(
  config: AppConfig,
  fetchImpl: FetchLike,
  logger: Logger,
  resolve: () => Promise<EffectiveUpstream>,
): Upstream {
  const send = async (input: UpstreamRequest, stream: boolean): Promise<Response> => {
    const live = await resolve();
    const endpoint = `${live.baseUrl}/chat/completions`;
    const body = JSON.stringify(input.body);
    try {
      return await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${live.apiKey}`,
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
          'User-Agent': `lingxi-gateway/${VERSION}`,
        },
        body,
        signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const detail = scrubSecrets(error instanceof Error ? error.message : 'fetch failed', config.secrets).slice(0, 300);
      logger.warn('upstream_fetch_failed', { code: name || 'error' });
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ApiError(504, 'Upstream timeout', 'upstream_error', 'upstream_timeout', {}, detail);
      }
      throw new ApiError(502, 'Upstream request failed', 'upstream_error', 'upstream_unreachable', {}, detail);
    }
  };

  const readEvents = async function* (body: ReadableStream<Uint8Array>, input: UpstreamRequest): AsyncGenerator<StreamEvent> {
    let content = '';
    let usage: TokenUsage | null = null;
    for await (const data of iterateSse(body)) {
      if (data.trim() === '[DONE]') {
        break;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const payload: Record<string, unknown> = { ...(parsed as Record<string, unknown>), model: input.publicModel };
      const chunkUsage = usageFromUnknown(payload.usage);
      if (chunkUsage) {
        usage = chunkUsage;
      }
      content += extractDeltaText(payload);
      yield { type: 'chunk', payload, usage: chunkUsage };
    }
    if (!usage) {
      const promptTokens = estimateMessages(input.messages);
      const completionTokens = estimateTokens(content);
      usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    }
    yield { type: 'done', usage };
  };

  return {
    async complete(input) {
      const response = await send(input, false);
      const text = await response.text();
      if (!response.ok) {
        throw upstreamFailure(response.status, text, response.headers, config.secrets);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ApiError(502, 'Upstream returned an invalid response', 'upstream_error', 'upstream_invalid', {}, text.slice(0, 200));
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ApiError(502, 'Upstream returned an invalid response', 'upstream_error', 'upstream_invalid');
      }
      const record = parsed as Record<string, unknown>;
      const usage =
        usageFromUnknown(record.usage) ??
        (() => {
          const promptTokens = estimateMessages(input.messages);
          const completionTokens = estimateTokens(completionText(record));
          return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
        })();
      return { json: withUsage(record, usage, input.publicModel), usage };
    },
    async openStream(input) {
      const response = await send(input, true);
      if (!response.ok || !response.body) {
        const text = response.body ? await response.text() : '';
        throw upstreamFailure(response.status, text, response.headers, config.secrets);
      }
      const body = response.body;
      return { events: () => readEvents(body, input) };
    },
  };
}

export function createUpstream(
  config: AppConfig,
  options: {
    fetchImpl?: FetchLike;
    now: () => Date;
    logger: Logger;
    resolve?: () => Promise<EffectiveUpstream>;
  },
): Upstream {
  const resolve =
    options.resolve ??
    (async () => ({
      baseUrl: config.upstreamBaseUrl,
      apiKey: config.upstreamApiKey,
      mock: config.upstreamMock,
      mode: config.upstreamMode,
      baseUrlSource: 'env' as const,
      keySource: config.upstreamApiKey ? ('env' as const) : ('none' as const),
      mockSource: 'env' as const,
    }));
  const mock = createMockUpstream(options.now);
  const proxy = createProxyUpstream(config, options.fetchImpl ?? fetch, options.logger, resolve);
  return {
    async complete(input) {
      const live = await resolve();
      if (live.mode === 'mock') {
        return mock.complete(input);
      }
      return proxy.complete(input);
    },
    async openStream(input) {
      const live = await resolve();
      if (live.mode === 'mock') {
        return mock.openStream(input);
      }
      return proxy.openStream(input);
    },
  };
}

export function upstreamRequestBody(raw: Record<string, unknown>, upstreamModel: string, stream: boolean): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw, model: upstreamModel };
  delete next.api_key;
  delete next.apiKey;
  if (stream) {
    const existing = next.stream_options;
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    next.stream_options = { ...base, include_usage: true };
  }
  return next;
}

export { zeroUsage };
