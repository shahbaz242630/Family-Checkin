// Root Vitest config. `npm test` runs every project; `npm run test:coverage`
// adds V8 coverage across all of them. Individual projects can still be run
// with `vitest run --project <name>` or from their own workspace.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/backend/vitest.config.ts',
      {
        root: 'apps/mobile',
        test: {
          name: 'mobile',
          include: ['src/**/*.{spec,test}.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        root: 'packages/shared-types',
        test: {
          name: 'shared-types',
          include: ['**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'scripts',
          include: ['scripts/**/*.test.mjs'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      // Ratchet: set from the measured baseline on 2026-09-05 (lines 44.1%,
      // statements 43.4%, functions 45.7%, branches 36.7%). Raise as tests
      // land; lowering needs a reason in the PR.
      thresholds: {
        lines: 43,
        statements: 42,
        functions: 44,
        branches: 35,
      },
      include: ['apps/backend/src/**', 'apps/mobile/src/**', 'packages/shared-types/**', 'scripts/**'],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.*',
        '**/node_modules/**',
        // Process entry points and wiring modules exercised only by booting the app.
        'apps/backend/src/main.ts',
        'apps/backend/src/**/*.module.ts',
        'scripts/install-hooks.mjs',
        'scripts/format-staged.mjs',
        'scripts/gitleaks-local.mjs',
      ],
    },
  },
});
