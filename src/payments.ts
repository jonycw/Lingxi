import { createHmac } from 'node:crypto';
import { ApiError } from './errors.js';
import { safeEqual, clientIp } from './auth.js';
import type { AppDeps, LingxiApp } from './appTypes.js';
import { formatCredits } from './types.js';

export function signWebhook(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyWebhookSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) {
    return false;
  }
  return safeEqual(signWebhook(secret, rawBody), header.trim());
}

export function registerPaymentWebhook(app: LingxiApp, deps: AppDeps): void {
  app.post('/admin/payments/webhook', async (c) => {
    if (!deps.config.paymentWebhookSecret) {
      throw new ApiError(404, 'Not found', 'invalid_request_error', 'not_found');
    }
    const ip = clientIp(c, deps.config.trustProxy);
    const raw = await c.req.text();
    if (!verifyWebhookSignature(deps.config.paymentWebhookSecret, raw, c.req.header('x-lingxi-signature'))) {
      const gate = deps.failLimiter.check(`payment:${ip}`);
      if (gate.limited) {
        throw new ApiError(429, 'Too many failed payment callbacks', 'authentication_error', 'rate_limited', {
          'Retry-After': String(gate.retryAfterSeconds),
        });
      }
      throw new ApiError(401, 'Invalid payment signature', 'authentication_error', 'invalid_signature');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError(400, 'Payment body must be JSON', 'invalid_request_error', 'invalid_json');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'Payment body must be a JSON object', 'invalid_request_error', 'invalid_json');
    }
    const body = parsed as Record<string, unknown>;
    const externalId = body.external_id;
    const customerId = body.customer_id;
    const amount = body.amount_micros;
    if (typeof externalId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(externalId)) {
      throw new ApiError(400, 'external_id is invalid', 'invalid_request_error', 'invalid_external_id');
    }
    if (typeof customerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(customerId)) {
      throw new ApiError(400, 'customer_id is invalid', 'invalid_request_error', 'invalid_customer_id');
    }
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000_000_000) {
      throw new ApiError(400, 'amount_micros must be a positive integer', 'invalid_request_error', 'invalid_amount');
    }
    const note = body.note === undefined || body.note === null ? null : body.note;
    if (note !== null && (typeof note !== 'string' || note.length > 500)) {
      throw new ApiError(400, 'note must be a string up to 500 characters', 'invalid_request_error', 'invalid_note');
    }
    const provider =
      typeof body.provider === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(body.provider) ? body.provider : 'hmac-json';
    const result = await deps.repo.applyPayment(deps.db, {
      externalId,
      provider,
      customerId,
      amountMicros: amount,
      note,
      now: deps.now().toISOString(),
    });
    return c.json({
      object: 'lingxi.payment',
      applied: result.applied,
      external_id: externalId,
      balance_micros: result.balanceMicros,
      balance_credits: formatCredits(result.balanceMicros),
    });
  });
}
