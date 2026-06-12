import type { RateLimitWindow } from '@/types';

// Key patterns:
//   otp:{userId}:code          → OTP_TTL_SECONDS TTL
//   otp:{userId}:attempts      → OTP_TTL_SECONDS TTL (same window as OTP)
//   ratelimit:{userId}:minute  → 60 s TTL
//   ratelimit:{userId}:hour    → 3600 s TTL
//   ratelimit:{userId}:day     → 86400 s TTL

export const RedisKeys = {
	otpCode: (userId: string): string => `otp:${userId}:code`,
	otpAttempts: (userId: string): string => `otp:${userId}:attempts`,
	rateLimit: (userId: string, window: RateLimitWindow): string => `ratelimit:${userId}:${window}`,
} as const;
