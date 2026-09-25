import { defineConfig } from 'vitest/config'
import path from 'path'

// Corrida manual de comparación Jev vs reglas (docs/ai/jev/ARCHITECTURE.md §5).
// Separada de vitest.config.ts a propósito: no corre en CI y puede tocar red si JEV_LIVE=1.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/jev/eval/**/*.eval.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
