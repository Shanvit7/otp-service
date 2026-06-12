// ─── OTP Record ──────────────────────────────────────────────────────────────

export type OtpRecord = {
	readonly code: string; // 6-digit string e.g. "482031"
	readonly attempts: number; // mutable attempt counter
};

// ─── Rate Limit Window ────────────────────────────────────────────────────────

export type RateLimitWindow = 'minute' | 'hour' | 'day';

// ─── Service Results ──────────────────────────────────────────────────────────

export type GenerateResult =
	| { ok: true; otpTtlSeconds: number }
	| { ok: false; reason: 'RATE_LIMITED'; window: RateLimitWindow; retryAfterSeconds: number };

export type VerifyResult =
	| { ok: true }
	| { ok: false; reason: 'INVALID_CODE' | 'MAX_ATTEMPTS_EXCEEDED' | 'OTP_NOT_FOUND' };

// ─── App Error ────────────────────────────────────────────────────────────────

export type AppErrorCode =
	| 'RATE_LIMITED'
	| 'INVALID_CODE'
	| 'MAX_ATTEMPTS_EXCEEDED'
	| 'OTP_NOT_FOUND'
	| 'VALIDATION_ERROR'
	| 'INTERNAL_ERROR';

export type AppError = {
	readonly code: AppErrorCode;
	readonly message: string;
	readonly details?: unknown;
};
