import type { ServerType } from '@hono/node-server';
import { serve } from '@hono/node-server';
import { logger } from '@otp-service/logger';
import { createApp } from '@/app';
import { APP, SERVER } from '@/constants';
import { validateStartup } from '@/startup';

validateStartup();

const app = createApp();

const server: ServerType = serve(
	{ fetch: app.fetch, port: SERVER.PORT, hostname: SERVER.HOST },
	() => {
		logger.info({ port: SERVER.PORT, env: APP.NODE_ENV }, 'API server started');
	},
);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = (signal: string): void => {
	logger.info({ signal }, 'Shutdown signal received');
	server.close(() => {
		logger.info('Graceful shutdown complete');
		process.exit(0);
	});
	setTimeout(() => {
		logger.warn('Shutdown timeout — forcing exit');
		process.exit(1);
	}, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
