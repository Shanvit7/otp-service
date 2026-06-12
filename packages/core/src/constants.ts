// ─── Redis ───────────────────────────────────────────────────────────────────
export const REDIS = {
	URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
	KEY_PREFIX: process.env.REDIS_KEY_PREFIX ?? 'otp',
} as const;

// ─── OTP ─────────────────────────────────────────────────────────────────────
export const OTP = {
	TTL_SECONDS: Number(process.env.OTP_TTL_SECONDS ?? 300), // 5 min
	MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
	DIGITS: 6,
} as const;

// ─── Rate Limit ───────────────────────────────────────────────────────────────
export const RATE_LIMIT = {
	PER_MINUTE: Number(process.env.RATE_LIMIT_MINUTE ?? 3),
	PER_HOUR: Number(process.env.RATE_LIMIT_HOUR ?? 10),
	PER_DAY: Number(process.env.RATE_LIMIT_DAY ?? 20),
} as const;
