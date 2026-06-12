import { Hono } from 'hono';

export const healthRouter = new Hono();

healthRouter.get('/health', (c) => {
	return c.json({ ok: true, uptime: process.uptime() }, 200);
});
