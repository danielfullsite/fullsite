import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Configuración APARTE para pruebas de componente.
 *
 * El `vitest.config.ts` principal corre en `environment: 'node'` y ahí viven las
 * ~2,118 pruebas existentes. Cambiarle el entorno a jsdom las haría más lentas sin
 * ganar nada, así que las de DOM viven en su propio config y su propio script.
 *
 *   npm run test      → node, las de siempre
 *   npm run test:ui   → jsdom, componentes + lógica que necesita window
 *
 * El sufijo `.dom.test.ts` es para lógica que NO es un componente pero sí depende
 * de que exista `window` — por ejemplo el rescate offline del KDS, que revisa
 * `typeof window === 'undefined'` antes de leer IndexedDB. En el config de node
 * esa rama nunca se ejecuta y la prueba pasaría sin probar nada.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/components/ui/**/*.test.tsx', 'src/**/*.dom.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
