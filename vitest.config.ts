import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/ui/**/*.test.tsx'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    reporters: ['default'],
    projects: [
      {
        // Core and service tests run in Node, which is how the product runs.
        plugins: [react()],
        test: {
          name: 'core',
          globals: false,
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
        },
      },
      {
        // Interface tests render the real pages in a DOM.
        plugins: [react()],
        test: {
          name: 'ui',
          globals: false,
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.tsx'],
          setupFiles: ['tests/helpers/setup-dom.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/core/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
