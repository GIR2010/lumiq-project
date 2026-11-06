import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __SYS__: 'false' },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
});
