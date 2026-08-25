import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `src/components/ui/**` son pruebas de componente: necesitan DOM y corren
    // con `npm run test:ui` (vitest.config.dom.ts). Si se cuelan aquí fallan en
    // bloque, porque este proyecto corre en `environment: 'node'`.
    exclude: ['e2e/**', 'tests/**', 'node_modules/**', 'src/components/ui/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
