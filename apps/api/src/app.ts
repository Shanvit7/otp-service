import { logger } from '@otp-service/logger';
import { Hono } from 'hono';
import { errorHandler } from '@/middleware/error-handler';
import { healthRouter } from '@/routes/health';
import { otpRouter } from '@/routes/otp';

export const createApp = (): Hono => {
	const app = new Hono();

	// ─── Request logging middleware ───────────────────────────────────────────
	app.use('*', async (c, next) => {
		const start = Date.now();
		await next();
		logger.info(
			{
				method: c.req.method,
				path: c.req.path,
				status: c.res.status,
				ms: Date.now() - start,
			},
			'request',
		);
	});

	// ─── Routes ───────────────────────────────────────────────────────────────
	app.route('/otp', otpRouter);
	app.route('/', healthRouter);

	// ─── Error handler ────────────────────────────────────────────────────────
	app.onError(errorHandler);

	return app;
};
