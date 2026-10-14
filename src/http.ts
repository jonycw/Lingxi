import type { Context } from 'hono';
import { ApiError } from './errors.js';

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON', 'invalid_request_error', 'invalid_json');
  }
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Request body must be a JSON object', 'invalid_request_error', 'invalid_json');
  }
  return value as Record<string, unknown>;
}

export function pageParams(c: Context, defaultLimit: number, maxLimit: number): { limit: number; offset: number } {
  const url = new URL(c.req.url);
  const limit = parseBoundedInt(url.searchParams.get('limit'), 'limit', defaultLimit, 1, maxLimit);
  const offset = parseBoundedInt(url.searchParams.get('offset'), 'offset', 0, 0, 1_000_000);
  return { limit, offset };
}

function parseBoundedInt(raw: string | null, name: string, fallback: number, min: number, max: number): number {
  if (raw === null || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(
      400,
      `${name} must be an integer from ${min} to ${max}`,
      'invalid_request_error',
      'invalid_parameter',
    );
  }
  return value;
}

export function timeParam(c: Context, name: string): string | null {
  const raw = new URL(c.req.url).searchParams.get(name);
  if (raw === null || raw === '') {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${name} must be an ISO-8601 timestamp`, 'invalid_request_error', 'invalid_time');
  }
  return date.toISOString();
}

export function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) {
    throw new ApiError(
      400,
      `${name} must be a non-empty string up to ${max} characters`,
      'invalid_request_error',
      'invalid_parameter',
    );
  }
  return value.trim();
}

export function optionalNullableInt(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(
      400,
      `${name} must be an integer from ${min} to ${max}`,
      'invalid_request_error',
      'invalid_parameter',
    );
  }
  return value;
}

export function parseEmail(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(value)) {
    throw new ApiError(400, 'email must be a valid email address', 'invalid_request_error', 'invalid_email');
  }
  return value.trim();
}

const MAX_MICROS = 1_000_000_000_000_000;

export function parseCreditAmount(body: Record<string, unknown>, allowZero: boolean): number {
  const hasCredits = body.credits !== undefined || body.initial_credits !== undefined;
  const hasMicros = body.amount_micros !== undefined || body.initial_balance_micros !== undefined;
  const credits = body.credits ?? body.initial_credits;
  const micros = body.amount_micros ?? body.initial_balance_micros;
  if (hasCredits && hasMicros) {
    throw new ApiError(
      400,
      'Provide either credits or amount_micros, not both',
      'invalid_request_error',
      'invalid_amount',
    );
  }
  if (!hasCredits && !hasMicros) {
    if (allowZero) {
      return 0;
    }
    throw new ApiError(400, 'credits or amount_micros is required', 'invalid_request_error', 'invalid_amount');
  }
  const minimum = allowZero ? 0 : 1;
  const amountHint = allowZero ? 'a non-negative integer' : 'a positive integer';
  if (hasMicros) {
    if (typeof micros !== 'number' || !Number.isInteger(micros) || micros > MAX_MICROS || micros < minimum) {
      throw new ApiError(400, `amount_micros must be ${amountHint}`, 'invalid_request_error', 'invalid_amount');
    }
    return micros;
  }
  if (typeof credits !== 'number' || !Number.isInteger(credits) || credits > MAX_MICROS / 1_000_000 || credits < minimum) {
    throw new ApiError(400, `credits must be ${amountHint}`, 'invalid_request_error', 'invalid_amount');
  }
  return credits * 1_000_000;
}
