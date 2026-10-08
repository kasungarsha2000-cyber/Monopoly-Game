import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/game-core/tests/**/*.test.ts', 'tests/network/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 30_000,
    reporters: ['default']
  }
});
