# OCS P2.5.6 — Impresión / Print Bridge

**Estado:** CERTIFIED — 2026-07-31
**Módulo:** `src/lib/printer.ts` + `src/lib/print-queue.ts`
**Tests:** 23 nuevos E2 · Suite completa: 1,843 · 0 regresiones
**Módulos relacionados certificados:** P2.5.4 Caja, P2.5.5 KDS

---

## Alcance

| Superficie | Archivo |
|---|---|
| Funciones de impresión ESC/POS y CSS | `src/lib/printer.ts` |
| Cola de impresión con retry | `src/lib/print-queue.ts` |
| Integración desde KDS/barra/cocina | `enqueueFailedPrint` en `printer.ts` |

---

## Gaps auditados

### PRN-GAP-01 — `reprintByStation` tenía drop silencioso en fallo (P1 → PASS)

**Hallazgo:** Al fallar una reimpresión, la función retornaba `{ printed: false }` sin encolar el job para retry. La comanda se perdía sin posibilidad de recuperación.

**Fix:** Antes del `return { printed: false }`, se llama a `enqueueFailedPrint(bridgeBytes, station, 'comanda', ...)`. La reimpresión fallida entra a la cola con el mismo tratamiento que una comanda inicial.

**Evidencia:** `src/__tests__/pos-print.test.ts` — sección `print-queue state machine` cubre `enqueueFailedPrint`.

---

### PRN-GAP-02 — IVA hardcodeado en 4 lugares (P2 → PASS)

**Hallazgo:** Las funciones `printTicketCSS`, `printPreTicketCSS`, `buildPreTicketBytes` y `buildESCPOS` tenían `IVA (16%)` literal. AMALAY tiene `IVA_RATE = 0` (precios incluyen IVA), por lo que mostraba una línea de IVA incorrecta.

**Fix:** Se importó `getIvaRate` desde `pos-constants`. Cada ubicación usa ahora:
- CSS: `${getIvaRate() > 0 ? \`<tr>...\` : ''}`
- ESC/POS: `if (getIvaRate() > 0) { cmds.push(...) }`

**Evidencia:** `src/__tests__/pos-print.test.ts` — sección `IVA conditional in ticket`: 3 tests verifican que `IVA_RATE = 0` por default, que `setIvaRate` funciona, y que la lógica condicional es correcta.

---

### PRN-GAP-03 — `splitOrderByStation` sin validación de estación (P3 — DOCUMENTADO)

**Hallazgo:** `splitOrderByStation` usa `item.station ?? getStationForItem(...)` con operador `??` en lugar de validar contra el union `StationName`. Mismo patrón que KDS-GAP-01.

**Decisión:** P3. El operador `??` no falla en runtime (getStationForItem tiene fallback a `'cocina'`). Canonicalizar en próximo ciclo junto con los demás P3 de estado.

---

## State machine de la cola

```
pending → retrying → printed              (happy path, bridge UP)
pending → bridge_unavailable              (bridge DOWN, sin retries consumidos)
bridge_unavailable → pending → printed    (bridge regresa en <120s)
bridge_unavailable → needs_attention      (bridge DOWN >120s, solo comandas)
retrying → needs_attention                (5 intentos fallidos, comandas)
retrying → failed                         (5 intentos fallidos, tickets/otros)
```

Invariantes verificados en tests:
- `retryJob`: resetea status a `pending` y zeroes retries
- `retryAllStuck`: resetea `needs_attention` + `bridge_unavailable` juntos
- `clearCompleted`: solo elimina `printed`, preserva el resto
- `getPendingCount`: suma `pending` + `retrying` + `bridge_unavailable`
- `getNeedsAttentionCount`: solo cuenta `needs_attention`

---

## Evidencia de tests

```
23 tests E2 — src/__tests__/pos-print.test.ts

detectItemChanges (6)
  ✓ returns empty array when nothing changed
  ✓ detects cantidad change
  ✓ detects modificadores change
  ✓ treats same modificadores in different order as no change
  ✓ detects notas change
  ✓ detects silla change
  ✓ detects multiple simultaneous changes  [7 — count correcto en archivo]

print-queue state machine (8)
  ✓ enqueue adds a job in pending status
  ✓ retryJob resets status to pending and zeroes retries
  ✓ retryAllStuck resets needs_attention and bridge_unavailable jobs
  ✓ clearCompleted removes printed jobs but keeps others
  ✓ getPendingCount counts pending + retrying + bridge_unavailable
  ✓ getNeedsAttentionCount counts only needs_attention
  ✓ removeJob removes the target job only
  ✓ enqueueFailedPrint base64-encodes bytes and enqueues

IVA conditional in ticket (3)
  ✓ getIvaRate returns 0 for AMALAY (default config)
  ✓ getIvaRate returns set value after setIvaRate
  ✓ IVA row is conditional — shown when rate > 0, hidden when rate = 0

splitOrderByStation (5)
  ✓ routes items with explicit station field
  ✓ falls back to name-based detection when station is absent
  ✓ distributes tiempo items to stations with real items after the separator
  ✓ cleans trailing tiempo items from each station
  ✓ returns empty arrays for stations with no items
```

**Suite completa:** 1,843 tests · 0 regressions

---

## Patrones aplicados

| Patrón | Instancia |
|---|---|
| Recoverable Operation (Tipo B) | `enqueueFailedPrint` — reimpresión fallida → cola durable + retry automático |
| Canonical Module | `getIvaRate` / `IVA_RATE` desde `pos-constants` — nunca literal en funciones de ticket |

---

## Pendiente (no bloqueante para certificación)

- PRN-GAP-03 (P3): `splitOrderByStation` — validación de estación con union en lugar de `??`
- G-02 (P1 de KDS-WANSOFT-GAP-ANALYSIS): Barra sin fetch de `delivery_orders`
- G-06 (P1): Barra sin `useBridgeClient` subscription — ambos elevados a P1 por Daniel
