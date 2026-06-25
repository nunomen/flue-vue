import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		include: ['test/**/*.test.ts'],
		restoreMocks: true,
		clearMocks: true,
		typecheck: {
			enabled: true,
			checker: 'vue-tsc',
			include: ['test/**/*.test-d.ts'],
			tsconfig: './tsconfig.json',
		},
	},
});

