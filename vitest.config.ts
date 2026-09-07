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
      // Ratchet (CB-055, "+5 per sprint"). Raised on 2026-09-07 after sprint 3
      // wave 2 measured lines 59.65%, statements 58.96%, functions 60.7%,
      // branches 53.0% — the floor sits a few points under the measurement so
      // an unrelated PR does not trip it. Raise as tests land; lowering needs a
      // reason in the PR.
      thresholds: {
        lines: 55,
        statements: 54,
        functions: 56,
        branches: 48,
      },
      include: ['apps/backend/src/**', 'apps/mobile/src/**', 'packages/shared-types/**', 'scripts/**'],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.*',
        '**/node_modules/**',
        // Build output of packages/shared-types; the TypeScript sources next to it are what is measured.
        'packages/shared-types/dist/**',
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
