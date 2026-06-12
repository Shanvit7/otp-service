import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const otpGenerateCounter = new Counter({
	name: 'otp_generate_total',
	help: 'Total OTP generation attempts',
	labelNames: ['result'] as const,
	registers: [registry],
});

export const otpVerifyCounter = new Counter({
	name: 'otp_verify_total',
	help: 'Total OTP verification attempts',
	labelNames: ['result'] as const,
	registers: [registry],
});

export const httpDuration = new Histogram({
	name: 'http_request_duration_seconds',
	help: 'HTTP request latency in seconds',
	labelNames: ['method', 'path', 'status'] as const,
	buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
	registers: [registry],
});
