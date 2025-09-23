import { resolve } from 'path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@convex": resolve(__dirname, "../convex"),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
})
