import { defineConfig } from 'vitest/config'
import path from 'path'

// Eval de exactitud de la IA del dueño (docs/ai/IA-DEL-DUENO.md §3c): `npm run eval:ia`.
// Separada de vitest.config.ts a propósito (igual que vitest.jev-eval.config.ts): toca red
// (Groq real + Supabase de staging) y tarda minutos. Las pruebas de su puntaje y de su
// runner (evals/ia/*.test.ts, sin red) sí corren en la suite normal.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['evals/ia/**/*.eval.ts'],
    testTimeout: 90 * 60_000,
    // Una sola pregunta a la vez: el tope gratuito de Groq es por minuto.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
