import { defineConfig } from 'vitest/config';

// Coverage settings live in the root vitest.config.ts (projects mode).
export default defineConfig({
  test: {
    name: 'backend',
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Keeps the run readable: the services log the failures the specs drive on purpose (CB-047).
    setupFiles: ['./src/shared/testing/silence-nest-logger.ts'],
  },
});
