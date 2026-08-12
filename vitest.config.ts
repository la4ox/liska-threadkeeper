import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // Auto-scroll timeout tests advance virtual clocks through long bounded
    // provider waits and need more than Vitest's five-second default on CI.
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // NOTE: `include` does not narrow the measured set on its own. With the
      // v8 provider the report still covers every file loaded during the run,
      // so anything outside src/ must be excluded explicitly below (ADR-019).
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/lib/types.ts', // Type definitions only
        // Entry shims: import-time side effect only (a few lines each).
        // All logic lives in popup/app.ts and content/bootstrap.ts, which ARE covered.
        'src/popup/index.ts',
        'src/content/index.ts',
        'test/**/*.ts', // Test infrastructure should not count toward coverage
      ],
      // Calibrated against the measured src-only figures (95.08 / 85.04 /
      // 97.82 / 96.87 on 2026-08-12), leaving a small margin.
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
});
