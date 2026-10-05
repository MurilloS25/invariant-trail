import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}',
      'examples/**/*.test.ts',
    ],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
  },
});
