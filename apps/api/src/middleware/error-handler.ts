import type { AppErrorCode } from '@otp-service/core';
import { logger } from '@otp-service/logger';
import type { ErrorHandler } from 'hono';
import { APP } from '@/constants';

const KNOWN_CODES = new Set<AppErrorCode>([
	'RATE_LIMITED',
	'INVALID_CODE',
	'MAX_ATTEMPTS_EXCEEDED',
	'OTP_NOT_FOUND',
	'VALIDATION_ERROR',
	'INTERNAL_ERROR',
]);

const isKnownCode = (value: unknown): value is AppErrorCode =>
	typeof value === 'string' && KNOWN_CODES.has(value as AppErrorCode);

export const errorHandler: ErrorHandler = (err, c) => {
	const errObj = err as unknown as Record<string, unknown>;
	const code: AppErrorCode = isKnownCode(errObj.code) ? errObj.code : 'INTERNAL_ERROR';

	if (code === 'INTERNAL_ERROR') {
		logger.error({ err }, 'Unhandled error');
	}

	const message =
		APP.IS_PROD && code === 'INTERNAL_ERROR' ? 'An unexpected error occurred' : err.message;

	return c.json({ ok: false, code, message }, 500);
};
