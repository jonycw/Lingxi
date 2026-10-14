import type { TokenUsage } from './types.js';

function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

/** Rough token estimate. CJK characters count as one token; other text uses ~4 characters. */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isCjk(code)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

export function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
    } else if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
      parts.push(part.text);
    }
  }
  return parts.join('');
}

export function estimateMessages(messages: unknown): number {
  if (!Array.isArray(messages)) {
    return 1;
  }
  let total = 0;
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    const record = message as { content?: unknown; role?: unknown };
    total += 4;
    total += estimateTokens(messageText(record.content));
    if (typeof record.role === 'string') {
      total += 1;
    }
  }
  return Math.max(1, total);
}

export function usageFromUnknown(value: unknown): TokenUsage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const prompt = record.prompt_tokens;
  const completion = record.completion_tokens;
  if (typeof prompt !== 'number' || typeof completion !== 'number') {
    return null;
  }
  const promptTokens = Math.max(0, Math.floor(prompt));
  const completionTokens = Math.max(0, Math.floor(completion));
  const totalRaw = record.total_tokens;
  const totalTokens =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw)
      ? Math.max(0, Math.floor(totalRaw))
      : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

export function zeroUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function extractDeltaText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return '';
  }
  let text = '';
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue;
    }
    const delta = (choice as { delta?: unknown }).delta;
    if (!delta || typeof delta !== 'object') {
      continue;
    }
    const content = (delta as { content?: unknown }).content;
    if (typeof content === 'string') {
      text += content;
    }
  }
  return text;
}
