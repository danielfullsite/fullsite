# AMALAY Field Batch #2 — Run Sheet

Este es el formato rápido para ejecutar en piso. El pack completo vive en:

`docs/customers/amalay/FIELD-BATCH-2-OFFLINE-PACK-2026-08-11.md`

## Roles

| Rol | Persona | Responsabilidad |
|---|---|---|
| Operador POS |  | Ejecuta PIN, turno, orden, cobro y corte |
| Observador KDS |  | Graba KDS y confirma llegada de comanda |
| Observador impresión |  | Graba ticket/comanda o cola de impresión |
| Cronista |  | Anota timestamps, IDs, PASS/FAIL y anomalías |

## Datos de inicio

| Campo | Valor |
|---|---|
| Fecha |  |
| Hora inicio |  |
| Commit/app instalada |  |
| Terminal usada |  |
| KDS usado |  |
| Impresora/bridge |  |
| PIN usado |  |
| Método de cobro de prueba |  |

## Secuencia minuto a minuto

| Min | Acción | Evidencia | PASS/FAIL | Nota |
|---:|---|---|---:|---|
| 0 | Video inicial: POS/KDS/impresora listos | Video |  |  |
| 5 | Login con PIN | Video/captura |  |  |
| 8 | Abrir o confirmar turno | Captura |  |  |
| 12 | Crear orden online | Order ID/captura |  |  |
| 15 | Enviar a KDS | Video KDS |  |  |
| 16 | Confirmar impresión/cola | Ticket/video |  |  |
| 20 | Cortar internet | Video |  |  |
| 23 | Crear/agregar orden offline | Captura |  |  |
| 28 | Enviar estando offline | KDS/cola/video |  |  |
| 32 | Reiniciar app/equipo sin internet | Video |  |  |
| 38 | Recuperar PIN/turno/orden | Captura |  |  |
| 45 | Reconectar internet | Video |  |  |
| 50 | Esperar sync y refrescar | Captura |  |  |
| 55 | Cobrar o confirmar cobro previo | Captura/recibo |  |  |
| 65 | Corte de turno | Captura corte |  |  |
| 75 | Conteo final data_loss/duplicates | Captura/query/log |  |  |

## Conteo final

| Métrica | Esperado | Resultado |
|---|---:|---:|
| Órdenes esperadas |  |  |
| Órdenes encontradas | Igual |  |
| Órdenes duplicadas | 0 |  |
| Pagos esperados |  |  |
| Pagos encontrados | Igual |  |
| Pagos duplicados | 0 |  |
| Print intents duplicados | 0 |  |
| Jobs pendientes sin explicación | 0 |  |
| Sync queue stuck | 0 |  |
| Corte cuadra | Sí |  |

## Verificación técnica rápida

En la Caja AMALAY, si hay terminal disponible, correr:

```bash
python3 scripts/offline/fleet_readiness_check.py --json
```

Si el Bridge corre en otra IP:

```bash
python3 scripts/offline/fleet_readiness_check.py --url http://192.168.1.71:7717/health --json
```

Adjuntar el JSON como evidencia. `PASS` o `WARN` documentado puede continuar; `FAIL` bloquea el cierre hasta explicar la causa.

## Resultado

Marcar solo uno:

- [ ] PASS — `data_loss=0`, `duplicates=0`, operación recuperada.
- [ ] FAIL — bloqueo P0, requiere fix mínimo y repetición completa.
- [ ] INCONCLUSIVE — faltó evidencia; repetir.

## Anomalías

| Hora | Qué pasó | Impacto | Evidencia | Acción |
|---|---|---|---|---|
|  |  |  |  |  |

## Regla de cierre

No declarar Field Batch #2 PASS sin:

- Video/capturas del recorrido completo.
- Corte final.
- Conteo final con `data_loss=0`.
- Conteo final con `duplicates=0`.
- Lista de anomalías cerrada o clasificada.
