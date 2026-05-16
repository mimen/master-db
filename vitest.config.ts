import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.worktrees/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'convex/testModules.test.ts', // Exclude testModules file - uses Vite-specific import.meta.glob
    ],
  },
  resolve: {
    alias: {
      '@': '/convex',
    },
  },
});