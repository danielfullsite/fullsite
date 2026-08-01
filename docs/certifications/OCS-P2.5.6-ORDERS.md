# OCS P2.5.6 — Órdenes / Flujo Principal: Certificación

> **Status:** CERTIFIED — 2026-07-31  
> **Suite:** Operational Certification Suite v1  
> **Módulo:** Orders / Flujo Principal (envío a cocina, descuentos, cobro, drafts, precio)  
> **Rama:** main  
> **Autor:** Daniel Ramonfaur

---

## Veredicto

**CERTIFICADO PARA AVANZAR.** Un gap identificado (ORD-GAP-01) fue resuelto. 229 tests pasan. TypeScript limpio. Paridad Wansoft offline alcanzada en todos los ejes del flujo principal.

---

## Gaps auditados y resolución

### ORD-GAP-01 — IVA rate no wireable desde config de cliente · PASS

**Problema:** `getPosClientConfig()` en `layout.tsx` cargaba `ivaRate` desde Supabase (`clients.iva_rate`) pero nunca llamaba a `setIvaRate()`. El módulo `pos-constants.ts` siempre devolvía `IVA_RATE = 0` sin importar la configuración del cliente. Clients con IVA (p.ej. 16%) mostrarían $0.00 de IVA en sus tickets.

**Solución:** `pos/layout.tsx:120-125` — después de cargar `cfg`, el bootstrap llama `setIvaRate(cfg.ivaRate)` dinámicamente. El singleton `_posConfig` ya tenía el valor correcto; solo faltaba propagarlo al módulo de constantes.

```ts
import('@/lib/pos-config').then(m => m.getPosClientConfig()).then(async cfg => {
  if (cfg?.logoUrl) setLogoSrc(cfg.logoUrl)
  if (cfg?.ivaRate !== undefined) {
    const { setIvaRate } = await import('@/lib/pos-constants')
    setIvaRate(cfg.ivaRate)
  }
}).catch(() => {})
```

**Impacto en AMALAY:** Ninguno (`iva_rate = 0` en BD, default correcto). Gap afectaría únicamente clients con IVA explícito.

**Consumidores de `getIvaRate()`:** `pos-calculations.ts`, `printer.ts` (ticket HTML, ESC/P, comanda), `pos-arqueo.ts`.

---

## Áreas auditadas — sin gaps

### 1. Envío a cocina (online vs. offline) · PASS

- **Online:** `handleSendToKitchen` (page.tsx:2760) → `saveOrder(order, opId)` con `save_operation_id` para idempotencia
- **Offline queue:** `saveOrder` → `queueOperation(..., 'APP_API')` → retorna `OFFLINE_QUEUED`; page.tsx:2946 trata cola como éxito, UI marca items como enviados, imprime via bridge LAN
- **Race condition prevention:** `operationLock.current` (line 2761) previene doble-envío; `comanda_batch_id` (line 2854) estampa cada batch
- **Phantom order prevention:** Si `!loadedOrderId`, re-chequea Supabase antes de crear nueva orden (line 2774)
- **KDS local broadcast:** Evento `ORDER_SENT` a `127.0.0.1:7717` en ambas ramas (online line 3016, offline line 2973)

### 2. Autorización de descuentos y cancelaciones · PASS

- **Manager PIN gate:** `verifyManagerPin(pin)` (page.tsx:918) antes de aplicar cualquier descuento; PBKDF2 offline-capable
- **Razón de cancelación:** Capturada en `CancelModal.reason` state, propagada a `handleCancelItem(reason, managerName)` (page.tsx:2436)
- **Audit log:** `logAudit()` registra `action`, `reason`, `approved_by: managerName`, todos los detalles del item (lines 2440-2445)
- **Shadow event:** `publishEvent()` con `requestedBy`, `approvedBy`, `reason` (line 2451)

### 3. Pago dividido (split payment) · PASS

- **Pagos acumulados:** `mixtoPagos[]` se acumula en UI; `pagos[]` construido en page.tsx:3234 como `mixtoPagos` o `[{metodo, monto}]` según método
- **Validación centavo a centavo:** `pos-data.ts:1338-1346` — `sum(pagos.monto) === total + propina` en cents; retorna `PAYMENT_MISMATCH` si no coincide
- **UI enforcement:** Botón Cobrar deshabilitado si `restante > 0.009` (page.tsx:5516)

### 4. Drafts / persistencia de mesa · PASS

- **Auto-save:** `useEffect` en page.tsx:2160 guarda `pos_draft_${mesa}` con `ts: Date.now()` en cada cambio de `orderItems`
- **TTL 4 horas:** Constante `14_400_000` ms (line 2037) — commit 4764c10 extendió de 30min a 4h
- **Crash recovery:** Al montar, lee draft de localStorage; si TTL válido y `items.length > 0`, restaura (lines 2034-2045)
- **Orden guardada (8h):** `pos_order_${mesa}` con TTL `28_800_000` ms para carga instantánea al regresar a la mesa
- **IDB backup:** `pos-offline-db.ts` — store `orders` en IndexedDB v4, índice por `mesa` y `status`

### 5. Cálculo de precios · PASS

- **Función canónica:** `calcOrderTotals(items, discount)` en `pos-calculations.ts:26` — única fuente de verdad para subtotal, IVA, total
- **Modificadores incluidos:** `precioExtra` calculado de `agregarOptions` y sumado al precio base antes de crear el OrderItem (page.tsx:283)
- **Combos expandidos:** Ítems de combo se expanden como `OrderItem` individuales con precio propio (page.tsx:4436-4447); totales los incluyen naturalmente
- **IVA dinámico:** `getIvaRate()` lee `_dynamicIvaRate` (ahora wired desde config vía ORD-GAP-01 fix)

### 6. RecoverableOperation — clasificación correcta · N/A

- Orders son **TYPE B** (internal, LAN-first) — no requieren `RecoverableOperation`
- Idempotencia garantizada por `save_operation_id` (stable `opId = genOpId()` generado una vez por intento de envío)
- `RecoverableOperation` se reserva para TYPE A (pagos externos: MP Point, Stripe)

---

## Evidencia de tests

| Suite | Cobertura | Tests | Resultado |
|---|---|---|---|
| `pos-critical.test.ts` | Cancel after fire, Print Queue, Pago Mixto + Descuento, Promos, Combos, Cash movements | ~50 | PASS |
| `pos-offline-resilience.test.ts` | Order data integrity, IVA calc, JSON roundtrip, PIN cache, payment validation, offline queue | ~30 | PASS |
| `pos-print.test.ts` | `getIvaRate()` default, `setIvaRate()` override, receipt generation | ~13 | PASS |
| Suite completa | Todos los módulos POS | 229 | 229/229 PASS |

---

## Archivos modificados

| Archivo | Tipo | Descripción |
|---|---|---|
| `src/app/pos/layout.tsx` | MOD | Wire `setIvaRate(cfg.ivaRate)` al bootstrap de config |

---

## Paridad Wansoft offline

| Dimensión | Wansoft | Fullsite | Delta |
|---|---|---|---|
| Envío offline | Cola local en SQL Server | IDB queue + bridge LAN broadcast | = igual |
| Idempotencia | `ORDER_ID` único por SQL Server | `save_operation_id` + OCC revision | = igual |
| Descuento con autorización | Código de gerente en pantalla | PIN PBKDF2 offline-capable | ↑ superior |
| Cancelación auditada | Log en BD local | `logAudit()` + shadow event + audit table | ↑ superior |
| IVA configurable | % en configuración de restaurante | `setIvaRate()` desde `clients.iva_rate` | = igual |
| Draft persistente | Sin draft explícito (BD siempre) | 4h localStorage + 8h cache + IDB | ↑ superior |
| Split payment | Método multi-pago en Wansoft | `pagos[]` con validación centavo | = igual |

---

## Pendientes E4 (integración física)

- [ ] Verificar IVA en ticket impreso con cliente que tenga `iva_rate > 0` en BD
- [ ] Prueba de split payment en hardware AMALAY: Tarjeta + Efectivo, importes exactos
- [ ] Confirmar que draft de 4h sobrevive cierre de browser y reapertura en terminal física

---

## Suite P2.5 — Estado general

| Módulo | Cert | Gaps | Fecha |
|---|---|---|---|
| P2.5.4 — Caja | CERTIFIED | CAJ-GAP-01..04 resueltos | 2026-07-31 |
| P2.5.5 — KDS | CERTIFIED | KDS-GAP-01..04 resueltos | 2026-07-31 |
| P2.5.6 — Órdenes | CERTIFIED | ORD-GAP-01 resuelto | 2026-07-31 |

---

## Siguiente módulo

**P2.5.7 — Pagos (cobro, métodos, propinas, MP Point)**
