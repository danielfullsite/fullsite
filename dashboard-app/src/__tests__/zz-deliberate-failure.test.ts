// PRUEBA ADVERSARIAL DE LA PROTECCIÓN DE RAMA — ARCHIVO TEMPORAL, NO MERGEAR.
//
// Objetivo: demostrar empíricamente que un check `test` en ROJO BLOQUEA el merge.
// Leer el YAML no prueba nada; esto sí. Se borra en cuanto quede la evidencia.
import { describe, it, expect } from 'vitest'

describe('PRUEBA DELIBERADA — debe fallar', () => {
  it('falla a propósito para verificar que la protección de rama bloquea', () => {
    expect(1).toBe(2)
  })
})
