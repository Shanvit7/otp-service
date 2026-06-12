// ─── App ─────────────────────────────────────────────────────────────────────
export const APP = {
	NODE_ENV: process.env.NODE_ENV ?? 'development',
	IS_PROD: process.env.NODE_ENV === 'production',
} as const;

// ─── Logger ───────────────────────────────────────────────────────────────────
export const LOG = {
	LEVEL: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
} as const;
