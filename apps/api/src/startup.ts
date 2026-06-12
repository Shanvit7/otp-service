import { logger } from '@otp-service/logger';
import { SERVER } from '@/constants';

export const validateStartup = (): void => {
	if (!Number.isInteger(SERVER.PORT) || SERVER.PORT < 1024 || SERVER.PORT > 65535) {
		logger.fatal({ check: 'PORT', value: SERVER.PORT }, 'Startup validation failed');
		process.exit(1);
	}

	const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
	try {
		new URL(redisUrl);
	} catch {
		logger.fatal({ check: 'REDIS_URL', value: redisUrl }, 'Startup validation failed');
		process.exit(1);
	}
};
