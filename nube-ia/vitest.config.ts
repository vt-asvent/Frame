import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 40000, hookTimeout: 60000, pool: 'forks' } });
