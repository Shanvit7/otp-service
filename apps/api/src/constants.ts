// ─── App ─────────────────────────────────────────────────────────────────────
export const APP = {
	NODE_ENV: process.env.NODE_ENV ?? 'development',
	IS_PROD: process.env.NODE_ENV === 'production',
} as const;

// ─── Server ──────────────────────────────────────────────────────────────────
export const SERVER = {
	PORT: Number(process.env.PORT ?? 3000),
	HOST: process.env.HOST ?? '0.0.0.0',
} as const;
