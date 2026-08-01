# OCS P2.5.8 — Pagos / Cobro / Propinas / MP Point: Certificación

> **Status:** CERTIFIED — 2026-07-31  
> **Suite:** Operational Certification Suite v1  
> **Módulo:** Pagos completo — efectivo, tarjeta, transferencia, mixto, propinas, split, MP Point, recovery, offline, reconciliación  
> **Rama:** main  
> **Autor:** Daniel Ramonfaur

---

## Veredicto

**CERTIFICADO PARA AVANZAR.** Un gap P0 (PAY-GAP-01) identificado y resuelto. Dos P2 documentados, no bloqueantes. 1 843 tests pasan. TypeScript limpio. Todos los criterios de certificación cubiertos.

---

## Gaps auditados y resolución

### PAY-GAP-01 — IVA dinámico no propagado a cálculos de pago · P0 PASS

**Problema:** `pos-calculations.ts` importaba `IVA_RATE` como constante en lugar de llamar `getIvaRate()`. La función canónica `calcOrderTotals()` y las funciones de split (`calcSplitParejo`, `calcSplitItems`) usaban el valor estático (0 para AMALAY) ignorando la configuración dinámica por cliente. Siete sitios adicionales en `pos/page.tsx` hacían lo mismo: live total display, `handlePayment`, y dos bloques de UI de split.

**Alcance real del bug:**
- `pos-calculations.ts:7` — import `IVA_RATE` → `getIvaRate`
- `pos-calculations.ts:30,119,131,151` — 4 usos en `calcOrderTotals`, `calcSplitParejo`, `calcSplitItems`
- `pos/page.tsx:41` — import `IVA_RATE` → `getIvaRate`
- `pos/page.tsx:2753` — live total display
- `pos/page.tsx:3256,3259` — `payTotal` y `payIva` en `handlePayment`
- `pos/page.tsx:4806` — split parejo display
- `pos/page.tsx:4870` — split items display por cuenta
- `pos/page.tsx:5201,5204` — cobro modal

**Solución:** Reemplazados todos los usos directos de `IVA_RATE` por llamadas a `getIvaRate()`. El valor se propaga desde `clients.iva_rate` → `getPosClientConfig()` → `setIvaRate()` en `layout.tsx` bootstrap (fix previo ORD-GAP-01).

**Impacto en AMALAY:** Ninguno (`iva_rate = 0`, comportamiento idéntico). Bloqueaba cualquier cliente con IVA explícito.

---

### PAY-GAP-02 — Ticket duplicado en crash MP entre save y clearMpRecovery · P2 DOCUMENTADO

**Escenario:** MP captura pago → `saveOrder(ok:true)` → ticket impreso → app crasha antes de `clearMpRecovery()` → operador reinicia → banner recovery aparece → reintento → `saveOrder` retorna `ok:true` (idempotente) → ticket se imprime de nuevo.

**Mitigación existente:** El reintento usa el mismo `opId` → BD no duplica el registro. Solo el ticket se imprime dos veces. Para cobros con tarjeta, no hay cajón de por medio. El escenario requiere acción del operador (confirmar que el pago ya fue registrado en la pantalla o en el corte del turno).

**Decisión:** Aceptable. El comentario en código (page.tsx:3435) lo documenta explícitamente. El riesgo de doble cobro al cliente NO existe gracias a `save_operation_id`. Solo se duplica el comprobante físico.

---

### PAY-GAP-03 — Total no recalculado server-side desde items · P2 DOCUMENTADO

**Escenario:** `saveOrder` valida `sum(pagos.monto) === total + propina` en centavos, pero no recalcula `total` de forma independiente a partir de los items. Un cliente bugueado podría enviar `total: 0` con `pagos: [{monto: 0}]` y pasaría la validación.

**Mitigación existente:** Hardware controlado (una sola ubicación, terminales gestionadas). RLS filtra por `client_id`. La suma de pagos sí se valida. La auditoría de corte detectaría cualquier desviación.

**Decisión:** P2. Para mitigación completa: añadir recálculo server-side en `/api/pos/save-order` con precios desde `pos_menu_items`. Backlog.

---

## Áreas auditadas — sin gaps

### 1. Idempotencia del pago · PASS

- `opId = genOpId()` generado UNA VEZ al inicio de `handlePayment` (line 3218)
- `_mpOpId` reutiliza el opId original en recovery flows — mismo ID = misma operación
- `save_operation_id` enviado en payload → dedup en BD; `saveOrder` retorna `ok:true` en replay sin duplicar registro
- `operationLock.current` bloquea doble-tap/doble-intento concurrente

### 2. Pago capturado por proveedor, no registrado en Fullsite · PASS

- **Flujo MP:** `updateMpRecovery({state: 'MP_APPROVED', opId: recoveryOpId})` persiste a localStorage ANTES de llamar `handlePayment` (line 5324)
- Si `handlePayment` falla: `updateMpRecovery({state: 'RECONCILIATION_REQUIRED'})` → banner visible al operador
- Si app crasha: recovery se carga con `loadMpRecovery()` en mount (con `ATTENTION_STATES` incluyendo `MP_APPROVED`)
- El operador ve el banner, presiona retry → mismo opId → `saveOrder` idempotente → pago registrado
- `needsOperatorAttention()` bloquea nuevos cobros mientras recovery está pendiente (COB-017)

### 3. Efectivo offline · PASS

- `saveOrder` → `OFFLINE_QUEUED` → page.tsx:3308 abre cajón, imprime ticket, muestra toast
- Todos los items marcados como pagados en UI
- `getPendingQueue()` actualiza contador de sync pendiente
- Al reconectar: queue se sincroniza automáticamente via `registerAutoSync()`

### 4. Tarjeta manual (Getnet standalone) offline · PASS

- `setShowCardConfirm(true)` → muestra monto en pantalla para teclear en terminal física
- Operador confirma → `handlePayment('Tarjeta de crédito')` → `saveOrder` → si offline: `OFFLINE_QUEUED`
- Queue se sincroniza al reconectar

### 5. MP Point offline · PASS

- Si `!navigator.onLine` en el catch: toast "Sin conexión — pago con terminal no disponible offline" (line 5357)
- Fallback explícito — no hay intento de cobro MP sin internet. Correcto.

### 6. Reconciliación pagos al centavo · PASS

- `pos-data.ts:1338-1345`: `sum(pagos.monto) === total + propina` en centavos exactos
- `PAYMENT_MISMATCH` retornado si no coincide — UI no puede avanzar
- Button cobrar deshabilitado si `restante > 0.009` (mixto)

### 7. Split parejo — centavo exacto · PASS

- `calcSplitParejo` (pos-calculations.ts:111): cuentas 1..N-1 pagan `round(total/N)`, la última paga el remanente exacto para evitar pérdida de centavos
- `IVA_RATE` reemplazado por `getIvaRate()` como parte de PAY-GAP-01

### 8. Split por items — prorrateo de descuento · PASS

- `calcSplitItems` prorratea el descuento global según la fracción del subtotal que representa cada cuenta
- Cada cuenta crea su propia orden en BD con `id = orderId-C${cuenta}` y `orderRevision: 0`

### 9. Propinas por método de pago · PASS

- Propina incluida en `pagos[].monto` para pago simple: `[{ metodo, monto: payTotal + propina }]`
- `pos-arqueo.ts:computeOrderSummary` separa `propinaEfectivo` de `propinaTarjeta` para el arqueo
- Validación: `expected = toCents(total) + toCents(propina)` — propina correctamente excluida del total de venta

### 10. Cajón · PASS

- `openCashDrawer()` ÚNICAMENTE cuando `pagos.some(p => p.metodo.toLowerCase().includes('efectivo'))`
- En online path (line 3325): dentro de `if (ok)` — no dispara en error
- En offline path (line 3308): antes de encolar — local bridge disponible sin WAN
- En retry MP: `method = 'Tarjeta de crédito'` → condición no se cumple → sin cajón

### 11. Ticket final — no duplica normal · PASS

- `handlePrintTicket(order)` en `if (ok)` (line 3362) — solo en éxito confirmado
- Para split: imprime ticket por cuenta, avanza al siguiente sin reset total hasta última cuenta
- Ver PAY-GAP-02 para el único caso de duplicación (crash entre save y clearMpRecovery)

### 12. Estado de orden consistente · PASS

- `status: 'cerrada'`, `closed_at: new Date()` enviados al guardar pago (pos-data.ts:1366)
- Reset completo de estado local después de pago: `orderItems`, `sentItemIds`, `discount`, `propina`, `mixtoPagos`, `orderId = generateId()` (lines 3380-3402)
- `localStorage.removeItem(pos_order_${mesa})` limpia cache de mesa (line 3387)

### 13. Refresh/reinicio durante pago · PASS

- Estado de pago en progreso no persiste entre reloads (react state)
- MP recovery persiste en localStorage: banner visible, retry disponible con mismo opId
- Orden persistida en cache `pos_order_${mesa}` con 8h TTL — mesero puede reabrir la mesa
- Turno persiste en BD — sin pérdida de contexto de caja

### 14. STALE_WRITE_CONFLICT post-pago · PASS (con P2 doc)

- Línea 3297-3300: `if (saveResult.conflict)` → toast + return — no cierra cuenta
- Para flujo MP en recovery: `handlePayment` retorna sin throw → `clearMpRecovery()` NO se llama → recovery en `MP_APPROVED` → operador puede ver estado y escalar a manual review
- **P2**: No existe auto-resolución de conflict + MP recovery simultáneos. Requiere revisión manual del operador.

---

## Evidencia de tests

| Suite | Cobertura | Tests | Resultado |
|---|---|---|---|
| `pos-critical.test.ts` | Pago Mixto + Descuento, split payment, promos, offline | ~50 | PASS |
| `pos-calculations.test.ts` | `calcOrderTotals`, `calcSplitParejo`, `calcSplitItems` con IVA 0 y 16% | ~35 | PASS |
| `pos-offline-resilience.test.ts` | Payment validation, offline queue, IVA calc | ~30 | PASS |
| `pos-arqueo.test.ts` | `computeOrderSummary` con propinas mixtas | 14 | PASS |
| Suite completa | 46 archivos, todos los módulos POS | 1 843 | 1 843/1 843 PASS |

---

## Archivos modificados

| Archivo | Tipo | Descripción |
|---|---|---|
| `src/lib/pos-calculations.ts` | MOD | `IVA_RATE` → `getIvaRate()` en `calcOrderTotals`, `calcSplitParejo`, `calcSplitItems` |
| `src/app/pos/page.tsx` | MOD | `IVA_RATE` → `getIvaRate()` en 7 sitios (display, `handlePayment`, split UI) |

---

## Paridad Wansoft — Pagos

| Dimensión | Wansoft | Fullsite | Delta |
|---|---|---|---|
| Métodos | Tarjeta, efectivo, transferencia, Uber | Tarjeta, efectivo, transferencia, Uber, Mixto | ↑ superior |
| Split de cuenta | No disponible (por mesa completa) | Split parejo + split por items | ↑ superior |
| IVA configurable | % por restaurante en configuración | `clients.iva_rate` → `setIvaRate()` | = igual |
| Recovery de terminal | Manual (operador llama soporte) | COB-017 banner + retry automático + manual review | ↑ superior |
| Propinas | Separadas en corte | Separadas por método (`pos-arqueo.ts`) | = igual |
| Idempotencia | SQL Server garantiza ID único | `save_operation_id` + OCC revision | = igual |
| Offline cash | SQL Server local (sin WAN) | IDB queue + bridge local | = igual |
| Cajón | Solo efectivo | Solo efectivo (condición `includes('efectivo')`) | = igual |
| Ticket duplicado | N/A (BD local) | Posible solo en crash MP (tarjeta, sin cajón) | = acceptable |

---

## Pendientes E4 (integración física)

- [ ] Prueba split parejo en hardware: 2 personas, monto impar → centavo en última cuenta
- [ ] Prueba propina en tarjeta: verificar que aparece en `propinasNoEfectivo` del arqueo
- [ ] Prueba crash durante MP: desconectar browser entre MP approval y Fullsite record → verificar banner recovery en reload
- [ ] Prueba pago mixto offline: tarjeta + efectivo → sin internet → queue sincroniza al reconectar
- [ ] Verificar IVA en ticket con `iva_rate = 0.16` en BD de staging

---

## Suite P2.5 — Estado general

| Módulo | Cert | Gaps | Fecha |
|---|---|---|---|
| P2.5.4 — Caja | CERTIFIED | CAJ-GAP-01..04 resueltos | 2026-07-31 |
| P2.5.5 — KDS | CERTIFIED | KDS-GAP-01..04 resueltos | 2026-07-31 |
| P2.5.6 — Impresión | CERTIFIED | PRN-GAP-01..03 resueltos | 2026-07-31 |
| P2.5.7 — Órdenes | CERTIFIED | ORD-GAP-01 resuelto | 2026-07-31 |
| P2.5.8 — Pagos | CERTIFIED | PAY-GAP-01 resuelto · PAY-GAP-02/03 P2 doc | 2026-07-31 |

---

## Siguiente módulo

**P2.5.9 — Offline / Sync** (smoke test físico pendiente — OC-12 bloqueante)
