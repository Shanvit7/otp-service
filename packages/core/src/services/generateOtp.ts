import { OTP, RATE_LIMIT, REDIS } from '@/constants';
import { generateOtpCode } from '@/otp/generate';
import { redis } from '@/redis/client';
import { generateOtpScript } from '@/redis/scripts';
import { RedisKeys } from '@/redis-keys';
import type { GenerateResult, RateLimitWindow } from '@/types';

const prefix = `${REDIS.KEY_PREFIX}:`;

export const generateOtp = async (userId: string): Promise<GenerateResult> => {
	const code = generateOtpCode();

	const keys = [
		`${prefix}${RedisKeys.rateLimit(userId, 'minute')}`,
		`${prefix}${RedisKeys.rateLimit(userId, 'hour')}`,
		`${prefix}${RedisKeys.rateLimit(userId, 'day')}`,
		`${prefix}${RedisKeys.otpCode(userId)}`,
		`${prefix}${RedisKeys.otpAttempts(userId)}`,
	];

	const args = [
		code,
		String(RATE_LIMIT.PER_MINUTE),
		String(RATE_LIMIT.PER_HOUR),
		String(RATE_LIMIT.PER_DAY),
		String(OTP.TTL_SECONDS),
	];

	const result = (await redis.eval(generateOtpScript, keys.length, ...keys, ...args)) as string[];

	if (result[0] === 'RATE_LIMITED') {
		return {
			ok: false,
			reason: 'RATE_LIMITED',
			window: result[1] as RateLimitWindow,
			retryAfterSeconds: Number(result[2]),
		};
	}

	return { ok: true, otpTtlSeconds: OTP.TTL_SECONDS };
};
