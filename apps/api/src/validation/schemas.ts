import { z } from 'zod';

export const generateRequestSchema = z.object({
	userId: z.string().min(1).max(128),
});

export const verifyRequestSchema = z.object({
	userId: z.string().min(1).max(128),
	code: z
		.string()
		.length(6)
		.regex(/^\d{6}$/),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;
