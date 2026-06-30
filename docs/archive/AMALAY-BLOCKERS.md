> **ARCHIVED.** Replaced by: `operations/GO-LIVE-CHECKLIST.md`
>
> This document is kept for historical reference only.

# AMALAY BLOCKERS

> Cada fix debe cumplir 4 condiciones:
> 1. Problema demostrado con evidencia en el código
> 2. Escenario reproducible
> 3. Test de certificación que falle antes y pase después
> 4. Cambio mínimo sin aumentar complejidad

---

## GRUPO A — Resolver ANTES de operar AMALAY

---

### A1. handleVoidOrder no persiste en DB

**Por qué es riesgo real:**
`page.tsx:1964-1971` — El void hace `fetch(PATCH)` dentro de `try/catch { /* offline */ }`. El catch no encola nada. Si la red falla, la UI se limpia (L1973-1980) pero la orden sigue como `enviada` en Supabase. Puede cobrarse otra vez.

**Cómo reproducirlo:**
1. Abrir mesa con orden enviada
2. Desconectar internet
3. Anular orden (PIN + razón)
4. Reconectar internet
5. Abrir la misma mesa → orden sigue activa

**Restaurante afectado:** Cualquiera. Basta un corte de internet de 2 seg.

**Probabilidad:** Media
**Impacto:** P0-B (puede perder dinero — doble cobro)

**Cambio mínimo:**
Reemplazar `fetch(PATCH)` directo por `updateOrderStatus()` que ya tiene offline queue (pos-data.ts:1101-1141). No limpiar UI hasta confirmar.

**Tiempo:** 30 min
**Test:** Nuevo: `VOID-OFFLINE-01` — void con red caída, reconectar, verificar status=cancelada en DB
**Estado:** Pendiente

---

### A2. syncAll abandona órdenes después de 5 retries

**Por qué es riesgo real:**
`pos-offline-db.ts:217` — `if (item.retries >= 5) continue`. El item queda en IndexedDB como zombie. Nadie lo sabe. Si el usuario limpia datos del browser, la orden se pierde para siempre.

**Cómo reproducirlo:**
1. Desconectar internet
2. Enviar 1 orden
3. Reconectar con Supabase caído (o schema error)
4. Esperar 5 ciclos de syncAll
5. Verificar: orden sigue en IndexedDB pero nunca se reintenta

**Restaurante afectado:** Cualquiera con internet inestable.

**Probabilidad:** Baja (requiere 5 fallas consecutivas)
**Impacto:** P0-A (puede perder ventas)

**Cambio mínimo:**
Para items donde `table === 'pos_orders'`: no aplicar el cap de 5. Seguir retrying. Para el resto: mantener cap pero agregar `console.warn` visible.

**Tiempo:** 30 min
**Test:** Nuevo: `SYNC-NOLIMIT-01` — simular 10+ fallas, verificar que órdenes siguen en cola
**Estado:** Pendiente

---

### A3. logAudit fire-and-forget para operaciones críticas

**Por qué es riesgo real:**
`pos-data.ts:1268-1270` — `catch { return false }`. 9 operaciones críticas de anti-fraude (voids, descuentos, retiros, cobros) pierden su audit log si la red falla. Eduardo's agente anti-fraude depende de datos completos.

**Cómo reproducirlo:**
1. Desconectar internet
2. Cancelar un item (PIN + razón)
3. Reconectar
4. Verificar pos_audit_log → no hay registro de la cancelación

**Restaurante afectado:** Cualquiera. Especialmente relevante para AMALAY donde Eduardo monitorea fraude.

**Probabilidad:** Alta (cualquier blip de red durante operación sensible)
**Impacto:** P0-C (puede perder datos de auditoría)

**Cambio mínimo:**
Crear función `queueAuditIfFailed()` que use `queueOperation()` existente como fallback cuando `logAudit()` falla. Aplicar solo a las 9 operaciones críticas, no a las 25.

**Tiempo:** 2 hrs
**Test:** Nuevo: `AUDIT-OFFLINE-01` — logAudit offline, reconectar, verificar que audit se sincroniza
**Estado:** Pendiente

---

### A4. CierreCajaWizard no verifica res.ok

**Por qué es riesgo real:**
`CierreCajaWizard.tsx:191-209` — Ambos `fetch()` (POST cierre + PATCH turno) ignoran el status code. Un 400 o 500 pasa silencioso. `onComplete()` se llama sin confirmar que los datos se guardaron.

**Cómo reproducirlo:**
1. Abrir cierre de caja
2. Contar billetes/monedas
3. Simular error de Supabase (ej: schema mismatch en una columna)
4. Confirmar cierre → wizard dice "éxito" pero nada se guardó

**Restaurante afectado:** Cualquiera. Si Supabase tiene un blip durante cierre.

**Probabilidad:** Baja
**Impacto:** P0-B (cierre perdido, caja no cuadra)

**Cambio mínimo:**
Agregar `if (!res.ok) throw new Error()` después de cada fetch. El catch existente (L226-228) ya muestra "Error al guardar".

**Tiempo:** 30 min
**Test:** `CRT-06` — cerrar turno, verificar pos_cierres Y pos_turnos actualizados
**Estado:** Pendiente

---

### A5. No hay auto-sync on reconnect

**Por qué es riesgo real:**
No hay listener de `navigator.onLine` ni `online` event en `pos-offline-db.ts`. Si la red se cae y regresa, las órdenes encoladas no se sincronizan hasta que alguien dispare `syncAll()` manualmente (o el OfflineIndicator lo haga en su polling, si está montado).

**Cómo reproducirlo:**
1. Desconectar internet
2. Enviar 2 órdenes (quedan en IndexedDB)
3. Reconectar internet
4. Esperar 30 seg
5. Verificar pos_orders → las órdenes no aparecen (esperan trigger manual)

**Restaurante afectado:** Cualquiera con internet intermitente.

**Probabilidad:** Media
**Impacto:** P0-A (órdenes no se sincronizan, cocina no las ve en KDS)

**Cambio mínimo:**
En `pos-offline-db.ts`: agregar `window.addEventListener('online', () => syncAll())` al inicializar.

**Tiempo:** 15 min
**Test:** `OFF-02` — reconectar internet, verificar sync automático sin interacción
**Estado:** Pendiente

---

### A6. opId es código muerto

**Por qué es riesgo real:**
`page.tsx:2089,2219` — `genOpId()` genera un UUID pero se asigna a variable local `opId` que nunca se usa. Da falsa sensación de idempotencia. No hay idempotencia end-to-end real.

**Cómo reproducirlo:**
1. Buscar `opId` en page.tsx → 2 asignaciones, 0 usos

**Restaurante afectado:** Ninguno directamente (es código muerto). Pero confunde al desarrollador.

**Probabilidad:** N/A
**Impacto:** P1 (deuda técnica, falsa seguridad)

**Cambio mínimo:**
Eliminar las 2 líneas de `const opId = genOpId()` y la función `genOpId`. O adjuntar `opId` a la orden para future-proof.

**Tiempo:** 10 min
**Test:** N/A — es limpieza de código
**Estado:** Pendiente

---

## GRUPO B — Resolver antes del segundo restaurante

---

### B1. Merge mesas sin PIN ni atomicidad

**Por qué es riesgo real:**
`mesas/page.tsx:288-341` — Cualquier mesero puede fusionar mesas sin autorización. Actor en audit = "Sistema". Dos PATCHs sin transacción.

**Cambio mínimo:** Agregar `verifyManagerPin()` antes de merge. Cambiar actor a nombre real.
**Tiempo:** 1 hr
**Estado:** Pendiente

---

### B2. Supabase anon key sin RLS

**Por qué es riesgo real:**
La key está en el bundle del browser. Sin RLS, cualquier persona con la key accede a TODAS las tablas de TODOS los clientes.

**Cambio mínimo:** Habilitar RLS en todas las tablas con policy `client_id = current_setting('app.client_id')`.
**Tiempo:** 4-6 hrs
**Estado:** Pendiente

---

### B3. Inventario race condition (SET vs decrement)

**Por qué es riesgo real:**
`pos-data.ts:1678` — `updateInventoryStock` usa SET absoluto. Dos terminales simultáneas pierden una deducción.

**Cambio mínimo:** Supabase RPC con `UPDATE SET stock = stock - $1`.
**Tiempo:** 3 hrs
**Estado:** Pendiente

---

### B4. Retiro/depósito sin offline queue

**Por qué es riesgo real:**
Si la red falla durante un retiro, el efectivo sale de la caja pero el sistema no lo registra.

**Cambio mínimo:** Usar `queueOperation()` en el catch del CashMovementModal.
**Tiempo:** 1 hr
**Estado:** Pendiente

---

### B5. Server-side auth para operaciones sensibles

**Por qué es riesgo real:**
Discounts, cancellations, voids son enforced solo client-side. API directa los bypasea.

**Cambio mínimo:** Edge Functions para cancel/void/discount que validen PIN server-side.
**Tiempo:** 8-12 hrs
**Estado:** Pendiente

---

## GRUPO C — Solo cuando haya decenas de restaurantes

---

### C1. JWT per-user authentication

Reemplazar anon key + PIN por tokens JWT individuales. Necesario para compliance y multi-tenant seguro.

### C2. Event-driven architecture

Reemplazar fire-and-forget con event bus. publishEvent como path primario, no secundario.

### C3. Decomposición de page.tsx (4000+ líneas)

Necesario para que múltiples desarrolladores trabajen sin conflictos.

### C4. Connection pooling para 100+ restaurantes

Supabase free tier tiene límites. 100 restaurantes × 3 terminales = necesita plan pro + pgBouncer.

### C5. Monitoring y alerting dashboard

Dead letter queue, sync failures, inventory drift, cierre reconciliation.

### C6. Inventory deduction as server-side batch

Reemplazar 50 HTTP calls con un solo RPC.

---

## RESUMEN

| Grupo | Issues | Tiempo total | Deadline |
|---|---|---|---|
| **A** | 6 issues | ~4 hrs | Antes de operar AMALAY |
| **B** | 5 issues | ~17 hrs | Antes del restaurante #2 |
| **C** | 6 issues | Semanas | Cuando haya 10+ restaurantes |

---

## TRACKING

| ID | Título | Grupo | Estado |
|---|---|---|---|
| A1 | handleVoidOrder no persiste | A | Pendiente |
| A2 | syncAll abandona órdenes | A | Pendiente |
| A3 | logAudit sin retry (9 críticos) | A | Pendiente |
| A4 | CierreCaja no verifica res.ok | A | Pendiente |
| A5 | No auto-sync on reconnect | A | Pendiente |
| A6 | opId código muerto | A | Pendiente |
| B1 | Merge sin PIN | B | Pendiente |
| B2 | RLS por client_id | B | Pendiente |
| B3 | Inventario race condition | B | Pendiente |
| B4 | Cash movements offline | B | Pendiente |
| B5 | Server-side auth | B | Pendiente |
