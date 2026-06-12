import { createChildLogger } from '@otp-service/logger';
import type { MiddlewareHandler } from 'hono';

export const requestLogger: MiddlewareHandler = async (c, next) => {
	const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
	const log = createChildLogger({ requestId, method: c.req.method, path: c.req.path });

	c.set('logger', log);
	c.set('requestId', requestId);

	const start = Date.now();
	await next();

	log.info({ status: c.res.status, durationMs: Date.now() - start, requestId }, 'request');
};
