import { OTP, REDIS } from '@/constants';
import { redis } from '@/redis/client';
import { verifyOtpScript } from '@/redis/scripts';
import { RedisKeys } from '@/redis-keys';
import type { VerifyResult } from '@/types';

const prefix = `${REDIS.KEY_PREFIX}:`;

export const verifyOtp = async (userId: string, candidateCode: string): Promise<VerifyResult> => {
	const keys = [
		`${prefix}${RedisKeys.otpCode(userId)}`,
		`${prefix}${RedisKeys.otpAttempts(userId)}`,
	];

	const args = [candidateCode, String(OTP.MAX_ATTEMPTS)];

	const result = (await redis.eval(verifyOtpScript, keys.length, ...keys, ...args)) as string;

	switch (result) {
		case 'OK':
			return { ok: true };
		case 'OTP_NOT_FOUND':
			return { ok: false, reason: 'OTP_NOT_FOUND' };
		case 'MAX_ATTEMPTS_EXCEEDED':
			return { ok: false, reason: 'MAX_ATTEMPTS_EXCEEDED' };
		default:
			return { ok: false, reason: 'INVALID_CODE' };
	}
};
