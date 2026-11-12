import { defineConfig } from 'vitest/config';

// Needs a running local Supabase (`pnpm --filter @trainmore/db db:start`) and its env.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
  },
});
