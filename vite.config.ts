/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import netlify from '@netlify/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    netlify({
      // Deno edge emulator crashes in this environment (--allow-scripts).
      // Serverless functions + blobs still run locally.
      edgeFunctions: { enabled: false },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
