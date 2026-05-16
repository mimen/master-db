import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
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
      '@': path.resolve(__dirname, 'app/src'),
      'react': path.resolve(__dirname, 'app/node_modules/react'),
      'react-dom': path.resolve(__dirname, 'app/node_modules/react-dom'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'app/node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, 'app/node_modules/react/jsx-runtime.js'),
    },
  },
});