# Guion de validación — AMALAY, domingo 2026-08-31 (antes de abrir)

> Misión: NO es ir a arreglar — es VALIDAR que los fixes de la semana funcionan en las
> cajas reales. 20-25 min. Participantes: Daniel + Eduardo. Congelar evidencia: foto o
> video de cada paso marcado 📸.

## Antes de salir de casa (Daniel, 5 min)
- [ ] ⚠️ **NO instalar ningún Electron este domingo.** El build de main (1.3.6) es MÁS
      VIEJO que lo instalado (1.3.11) y le quitaría a Eduardo sus fixes (bridge Rappi,
      fallback kds_queue, modo expo). Las dos líneas divergieron; la reconciliación
      (→1.3.12) es una sesión aparte con validación — ver
      docs/pos/PLAN-RECONCILIACION-ELECTRON.md. La visita valida la CAPA WEB.
- [ ] Llevar este guion impreso o en el teléfono.

## Fase 0 — Actualizar (5 min, con internet)
1. En CAJA: abrir el POS → **F5 dos veces** (la 1ª instala el Service Worker nuevo, la 2ª lo usa).
2. En KDS web (si aplica): F5 dos veces.
3. Electron/Pedro: NO tocar (queda 1.3.11). Solo 📸 de Ajustes → versión, para el registro.
   Nota esperada: si el KDS de ELECTRON aún cruza comandas viejas, es el pendiente conocido
   del instalador reconciliado (el KDS web ya filtra por turno; el Electron lo hará en 1.3.12).

## Fase 1 — Turnos limpios (3 min, con internet)
4. `/pos/turno`: si aparece la tarjeta ámbar "Hay N turnos abiertos" → cerrar los huérfanos
   con el botón. 📸
5. Cerrar el turno viejo del 25-ago con **Corte Z real** (contar caja). Verificar que el
   historial muestre el chip verde **Z #1**. 📸
6. Abrir turno nuevo con fondo contado.

## Fase 2 — Offline (10 min) ⚠️ el corazón de la visita
7. **Desconectar el módem** (WAN muerta, LAN viva — el escenario exacto de Eduardo).
8. En CAJA: abrir mesa nueva → agregar 2 platillos (uno con modificador obligatorio) → enviar.
   - ✅ Esperado: la comanda **imprime en ≤2-3 segundos** (antes: 7+ seg). ⏱️📸
   - ✅ El KDS muestra la comanda, y **solo** comandas del turno actual (nada viejo). 📸
9. Repetir con una segunda orden. Cobrar una en efectivo.
10. Entrar/salir del POS con PIN — debe sentirse fluido (sin esperas de 3 seg).
11. En KDS: avanzar la comanda de estado. ✅ Sin órdenes "fantasma" de turnos anteriores.

## Fase 3 — Reconexión (5 min)
12. Reconectar el módem. Esperar 1-2 min.
13. En `/pos/historial` (o dashboard): verificar que las órdenes offline aparecen
    sincronizadas, sin duplicados. 📸
14. `/pos/turno`: Corte X — verificar números coherentes con lo cobrado.

## Veredicto (llenar en sitio)
| # | Prueba | PASA / FALLA | Nota |
|---|---|---|---|
| 8 | Imprime ≤3 s sin WAN | | |
| 8b | KDS solo turno actual | | |
| 10 | POS fluido offline | | |
| 13 | Sync sin duplicados | | |
| 5 | Corte Z + folio Z #1 | | |

- **Todo PASA** → los hallazgos de Eduardo quedan **validados en campo** (registrar commit
  y versión del instalador en docs/offline/TEST-MATRIX.md).
- **Algo FALLA** → NO improvisar fix en sitio: foto + descripción exacta → Claude lo
  reproduce y arregla por el ciclo normal.

## Mensaje corto para reenviar a Eduardo
> Eduardo — ya quedaron los fixes de lo que reportaste: el envío a impresoras/KDS ya no
> espera 7 seg sin internet, el KDS ya solo muestra comandas del turno actual, y en
> POS→Turno ya puedes cerrar turnos duplicados tú mismo. El domingo vamos temprano a
> validarlo con el módem apagado (20 min) y de paso cerramos el turno viejo con su Corte Z.
