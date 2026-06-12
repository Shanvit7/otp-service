import { generateOtp, verifyOtp } from '@otp-service/core';
import { Hono } from 'hono';
import { otpGenerateCounter, otpVerifyCounter } from '@/metrics';
import { generateRequestSchema, verifyRequestSchema } from '@/validation/schemas';

export const otpRouter = new Hono();

// ─── POST /otp/generate ───────────────────────────────────────────────────────
otpRouter.post('/generate', async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = generateRequestSchema.safeParse(body);

	if (!parsed.success) {
		return c.json({ ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message }, 400);
	}

	const result = await generateOtp(parsed.data.userId);

	if (!result.ok) {
		otpGenerateCounter.inc({ result: 'rate_limited' });
		return c.json(
			{
				ok: false,
				code: result.reason,
				window: result.window,
				retryAfterSeconds: result.retryAfterSeconds,
			},
			429,
		);
	}

	otpGenerateCounter.inc({ result: 'ok' });
	return c.json({ ok: true, otpTtlSeconds: result.otpTtlSeconds }, 200);
});

// ─── POST /otp/verify ─────────────────────────────────────────────────────────
otpRouter.post('/verify', async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = verifyRequestSchema.safeParse(body);

	if (!parsed.success) {
		return c.json({ ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message }, 400);
	}

	const result = await verifyOtp(parsed.data.userId, parsed.data.code);

	if (!result.ok) {
		const statusMap = {
			INVALID_CODE: 422,
			MAX_ATTEMPTS_EXCEEDED: 429,
			OTP_NOT_FOUND: 404,
		} as const;
		otpVerifyCounter.inc({ result: result.reason.toLowerCase() });
		return c.json({ ok: false, code: result.reason }, statusMap[result.reason]);
	}

	otpVerifyCounter.inc({ result: 'ok' });
	return c.json({ ok: true }, 200);
});
