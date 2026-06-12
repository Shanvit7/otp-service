export const generateOtpCode = (): string =>
	Math.floor(100_000 + Math.random() * 900_000).toString();
