import { defineConfig } from 'tsup';

import { baseConfig } from '../../tsup.base.js';

export default defineConfig({
	...baseConfig,
	entry: ['src/index.ts'],
	// apps don't need .d.ts output
	dts: false,
});
