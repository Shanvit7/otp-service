import { serve } from '@hono/node-server';
import { logger } from '@otp-service/logger';
import { createApp } from '@/app';
import { APP, SERVER } from '@/constants';

const app = createApp();

serve({ fetch: app.fetch, port: SERVER.PORT, hostname: SERVER.HOST }, () => {
	logger.info({ port: SERVER.PORT, env: APP.NODE_ENV }, 'API server started');
});
