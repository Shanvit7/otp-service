import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@/app';

// ─── Test Redis client (reads codes directly) ─────────────────────────────────
const testRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
	keyPrefix: `${process.env.REDIS_KEY_PREFIX ?? 'otp'}:`,
	lazyConnect: true,
});

const app = createApp();

const uid = (): string => `t-${Math.random().toString(36).slice(2, 9)}`;

const generate = (userId: string) =>
	app.request('/otp/generate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId }),
	});

const verify = (userId: string, code: string) =>
	app.request('/otp/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId, code }),
	});

beforeAll(async () => {
	await testRedis.connect();
});

afterAll(async () => {
	await testRedis.quit();
});

// ─── Health ───────────────────────────────────────────────────────────────────
describe('GET /health', () => {
	it('returns 200 with ok and uptime', async () => {
		const res = await app.request('/health');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(typeof body.uptime).toBe('number');
	});
});

// ─── Generation ───────────────────────────────────────────────────────────────
describe('POST /otp/generate', () => {
	it('returns 200 for valid userId', async () => {
		const res = await generate(uid());
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, otpTtlSeconds: 300 });
	});

	it('returns 400 for missing userId', async () => {
		const res = await app.request('/otp/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
	});

	it('returns 400 for empty userId', async () => {
		const res = await generate('');
		expect(res.status).toBe(400);
	});

	it('first 3 requests succeed (rate limit not yet hit)', async () => {
		const id = uid();
		for (let i = 0; i < 3; i++) {
			const res = await generate(id);
			expect(res.status).toBe(200);
		}
	});

	it('4th request in same minute returns 429 RATE_LIMITED', async () => {
		const id = uid();
		for (let i = 0; i < 3; i++) await generate(id);
		const res = await generate(id);
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toMatchObject({ ok: false, code: 'RATE_LIMITED', window: 'minute' });
	});
});

// ─── Verification ─────────────────────────────────────────────────────────────
describe('POST /otp/verify', () => {
	it('returns 200 with correct code', async () => {
		const id = uid();
		await generate(id);
		const code = (await testRedis.get(`otp:${id}:code`)) ?? '';
		expect(code).toMatch(/^\d{6}$/);

		const res = await verify(id, code);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true });
	});

	it('returns 422 for wrong code', async () => {
		const id = uid();
		await generate(id);
		const res = await verify(id, '000000');
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ ok: false, code: 'INVALID_CODE' });
	});

	it('returns 404 for unknown userId', async () => {
		const res = await verify(uid(), '123456');
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ ok: false, code: 'OTP_NOT_FOUND' });
	});

	it('returns 429 after 5 wrong attempts', async () => {
		const id = uid();
		await generate(id);
		for (let i = 0; i < 5; i++) await verify(id, '000000');
		const res = await verify(id, '000000');
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ ok: false, code: 'MAX_ATTEMPTS_EXCEEDED' });
	});

	it('returns 404 on replay after successful verify (single-use)', async () => {
		const id = uid();
		await generate(id);
		const code = (await testRedis.get(`otp:${id}:code`)) ?? '';
		await verify(id, code);
		const replay = await verify(id, code);
		expect(replay.status).toBe(404);
	});
});

// ─── Resend invalidation ──────────────────────────────────────────────────────
describe('Resend (invalidation)', () => {
	it('resend succeeds and old code is invalidated', async () => {
		const id = uid();
		await generate(id);
		const oldCode = (await testRedis.get(`otp:${id}:code`)) ?? '';

		await generate(id);
		const newCode = (await testRedis.get(`otp:${id}:code`)) ?? '';

		expect(newCode).toMatch(/^\d{6}$/);

		const res = await verify(id, oldCode);
		// old code is gone (overwritten) → INVALID_CODE
		expect([404, 422]).toContain(res.status);
	});
});
