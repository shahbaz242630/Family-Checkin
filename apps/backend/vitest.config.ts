import { defineConfig } from 'vitest/config';

// Coverage settings live in the root vitest.config.ts (projects mode).
export default defineConfig({
  test: {
    name: 'backend',
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
