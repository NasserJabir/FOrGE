import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['src/kernel/**', 'src/lib/**'],
      exclude: ['src/**/*.d.ts', 'src/cli/**', 'src/planes/**'],
      thresholds: {
        // NFR-11: >=90% branch coverage on src/kernel/**; 100% on canonical JSON/hash/verify
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
      reporter: ['text', 'json', 'html'],
    },
    projects: [
      {
        // Unit + provocation + property tests
        test: {
          name: 'forge',
          include: ['tests/**/*.test.ts'],
        },
      },
    ],
  },
});
