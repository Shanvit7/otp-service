import pino from 'pino';

import { APP, LOG } from '@/constants';

export const logger = pino(
	{
		level: LOG.LEVEL,
		base: { pid: process.pid },
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level: (label: string) => ({ level: label }),
		},
	},
	APP.IS_PROD
		? undefined
		: pino.transport({
				target: 'pino-pretty',
				options: {
					colorize: true,
					translateTime: 'SYS:HH:MM:ss',
					ignore: 'pid,hostname',
				},
			}),
);

export type Logger = typeof logger;

export const createChildLogger = (bindings: Record<string, unknown>): Logger =>
	logger.child(bindings) as Logger;
