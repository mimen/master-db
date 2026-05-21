import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  // Env lives at the repo root (.env.local), where `convex dev` manages
  // CONVEX_DEPLOYMENT. Point Vite there so VITE_* vars resolve from one source.
  envDir: path.resolve(__dirname, ".."),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex": path.resolve(__dirname, "../convex"),
      // Stable-identity replacement for Radix's compose-refs (see the shim
      // for the React 19 infinite-loop it fixes). Applies to every Radix
      // primitive that merges refs.
      "@radix-ui/react-compose-refs": path.resolve(
        __dirname,
        "./src/lib/compose-refs.ts",
      ),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
})
