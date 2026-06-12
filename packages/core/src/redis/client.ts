import { createChildLogger } from '@otp-service/logger';
import Redis from 'ioredis';
import { REDIS } from '@/constants';

const log = createChildLogger({ module: 'redis' });

export const createRedisClient = (): Redis => {
	const client = new Redis(REDIS.URL, {
		keyPrefix: `${REDIS.KEY_PREFIX}:`,
		lazyConnect: false,
	});

	client.on('connect', () => {
		log.info('Redis connected');
	});

	client.on('error', (err: Error) => {
		log.error({ err }, 'Redis error');
	});

	return client;
};

export const redis: Redis = createRedisClient();
