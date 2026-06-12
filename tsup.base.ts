import type { Options } from 'tsup';

export const baseConfig: Options = {
	format: ['esm'],
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
};
