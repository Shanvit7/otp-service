import { Hono } from 'hono';
import { httpDuration, registry } from '@/metrics';
import { errorHandler } from '@/middleware/error-handler';
import { requestLogger } from '@/middleware/logger';
import { healthRouter } from '@/routes/health';
import { otpRouter } from '@/routes/otp';

export const createApp = (): Hono => {
	const app = new Hono();

	// ─── Middleware ───────────────────────────────────────────────────────────
	app.use('*', requestLogger);

	app.use('*', async (c, next) => {
		const start = Date.now();
		await next();
		httpDuration.observe(
			{ method: c.req.method, path: c.req.path, status: String(c.res.status) },
			(Date.now() - start) / 1000,
		);
	});

	// ─── Routes ───────────────────────────────────────────────────────────────
	app.route('/otp', otpRouter);
	app.route('/', healthRouter);

	// ─── Metrics (internal — scraped by Prometheus) ───────────────────────────
	app.get('/metrics', async (c) => {
		c.header('Content-Type', registry.contentType);
		return c.body(await registry.metrics());
	});

	// ─── Error handler ────────────────────────────────────────────────────────
	app.onError(errorHandler);

	return app;
};
