# QA Bug Report — Fullsite Dashboard + POS

**Fecha:** 2026-07-22
**Método:** 8 agentes paralelos explorando código sin fixes
**Scope:** `dashboard-app/src/` — POS, pagos, cocina, inventario, multi-tenant, dashboard/AI, UX, code quality
**Total bugs encontrados:** 76
**Deduplicados:** 65 (11 duplicados cross-agent)

---

## Resumen Ejecutivo

| Severidad | Cantidad | Descripción |
|-----------|----------|-------------|
| Severidad | Original | Validado | Descripción |
|-----------|----------|----------|-------------|
| CRITICAL  | 3        | 2        | Data leak entre clientes (C-3 rebajado a HIGH) |
| HIGH      | 19       | 16       | Doble-write caja, mesa refresh, silent failures (H-2, H-5, H-7 refutados) |
| MEDIUM    | 25       | 25       | Hardcodes AMALAY, UX, memory leaks, empty states |
| LOW       | 18       | 18       | Display text, dead defaults, cosmetic |
| **Total** | **65**   | **61**   | **3 refutados, 1 reclasificado** |

---

## CRITICAL — Arreglar ANTES de cualquier otro trabajo

### C-1. `credentials_vault` sin filtro `client_id` en RLS
- **Archivo:** RLS policies en Supabase
- **Problema:** La tabla `credentials_vault` no tiene policy con filtro `client_id`. Cualquier usuario autenticado puede leer credenciales de otros clientes.
- **Agente:** 5 (Multi-tenant)
- **Impacto:** Data leak de credenciales entre clientes

### C-2. `api-auth.ts:40` — Fallback hardcoded a `'amalay'`
- **Archivo:** `src/lib/api-auth.ts:40`
- **Problema:** `extractClientId()` retorna `'amalay'` cuando no encuentra `client_id` en headers. Cualquier API call sin header correcto opera sobre datos de AMALAY.
- **Agente:** 5 (Multi-tenant) + 8 (Code quality)
- **Impacto:** Multi-tenant blocker. Cliente #2 vería datos de AMALAY si falla el header.

### C-3. API endpoints sin autenticación
- **Archivos:**
  - `src/app/api/pos/deepgram-token/route.ts` — Entrega token de Deepgram sin auth
  - `src/app/api/pos/save-order/route.ts` — Guarda órdenes sin auth
  - `src/app/api/pos/staff-cache/route.ts` — Expone PINs de staff sin auth
  - `src/app/api/pos/kds/route.ts` — PATCH anónimo a status de órdenes KDS
- **Agente:** 5 (Multi-tenant)
- **Impacto:** Cualquier persona con la URL puede crear órdenes falsas, leer PINs, o manipular KDS

---

## HIGH — Arreglar esta semana

### H-1. Doble cobro en CashMovementModal (confirmado por 3 agentes)
- **Archivo:** `src/app/pos/page.tsx` — CashMovementModal
- **Problema:** `handleSaveCashMovement()` no deshabilita botón ni previene doble-click. Sin idempotencia. Guarda movimiento en Supabase sin lock.
- **Agentes:** 1, 2, 3 (confirmación independiente triple)
- **Impacto:** Doble movimiento de caja registrado. Cuadre de caja incorrecto.

### H-2. Race condition en pago — doble click "Cobrar"
- **Archivo:** `src/app/pos/page.tsx` — `handleCobrar()`
- **Problema:** No hay mutex ni disable del botón durante el proceso de cobro. Dos clicks rápidos = dos pagos guardados.
- **Agente:** 2 (Payments)
- **Impacto:** Doble cobro al cliente

### H-3. Cancelar orden no actualiza total
- **Archivo:** `src/app/pos/page.tsx`
- **Problema:** Al cancelar items individuales, el total mostrado no se recalcula inmediatamente. El mesero ve un total stale.
- **Agente:** 2 (Payments)
- **Impacto:** Mesero cobra monto incorrecto

### H-4. Items cancelados reaparecen al cambiar de mesa
- **Archivo:** `src/app/pos/page.tsx`
- **Problema:** Al cambiar de mesa y regresar, items previamente cancelados reaparecen en la orden por stale state.
- **Agente:** 1 (POS Core)
- **Impacto:** Confusión operativa, posible cobro de items cancelados

### H-5. Doble comanda a cocina
- **Archivo:** `src/app/pos/page.tsx` — `handleEnviarCocina()`
- **Problema:** Sin guard de doble-click. Mesero presiona dos veces = dos comandas impresas. Cocina prepara doble.
- **Agente:** 3 (Kitchen)
- **Impacto:** Duplicación de preparación, desperdicio

### H-6. KDS status solo en localStorage
- **Archivo:** `src/app/pos/cocina/page.tsx` (y variantes barra/panaderia)
- **Problema:** El status de items en KDS (preparando → listo) se guarda solo en localStorage. Si el dispositivo cambia o se limpia cache, todo el estado se pierde.
- **Agente:** 3 (Kitchen)
- **Impacto:** Pérdida de tracking de órdenes en cocina

### H-7. Doble deducción de inventario en reload
- **Archivo:** `src/lib/pos-data.ts` — `deductIngredientsForOrder()`
- **Problema:** Si la página se recarga después de enviar a cocina pero antes de cerrar la orden, la deducción de ingredientes se ejecuta de nuevo.
- **Agente:** 4 (Inventory)
- **Impacto:** Stock incorrecto en inventario

### H-8. Sin rollback en deducción parcial
- **Archivo:** `src/lib/inventory.ts` — `recordMovement()`
- **Problema:** Si una receta tiene 5 ingredientes y el movimiento #3 falla (ej. error de red), los movimientos #1 y #2 ya están committed. No hay rollback.
- **Agente:** 4 (Inventory)
- **Impacto:** Stock parcialmente deducido, inconsistencia

### H-9. Race condition en stock concurrente
- **Archivo:** `src/lib/inventory.ts`
- **Problema:** Dos órdenes simultáneas leen el mismo stock, ambas deducen, resultado: stock = original - qty1 (qty2 se pierde). No hay SELECT FOR UPDATE ni versioning.
- **Agente:** 4 (Inventory)
- **Impacto:** Stock drift acumulativo

### H-10. Split payment stale assignments
- **Archivo:** `src/app/pos/page.tsx` — split payment flow
- **Problema:** Al dividir cuenta, las asignaciones de items a personas se calculan con datos stale si se modificó la orden durante el split.
- **Agente:** 2 (Payments)
- **Impacto:** Montos incorrectos por persona

### H-11. Chat/Coach/Voice queries sin filtro client_id
- **Archivos:**
  - `src/app/api/chat/route.ts`
  - `src/app/api/coach/route.ts`
  - `src/app/api/voice/route.ts`
- **Problema:** Las queries a `wansoft_daily`, `wansoft_kpis` no filtran por `client_id`. Cualquier cliente del dashboard ve datos de AMALAY.
- **Agente:** 6 (Dashboard/AI)
- **Impacto:** Data leak de métricas de ventas

### H-12. Hardcoded example numbers en AI prompts
- **Archivo:** `src/app/api/chat/route.ts`, `src/app/api/coach/route.ts`
- **Problema:** System prompts tienen ejemplos hardcoded con números reales ("$63,544", staff names de AMALAY). El LLM los copia cuando no tiene datos frescos.
- **Agente:** 6 (Dashboard/AI)
- **Impacto:** Chat reporta datos falsos al usuario

### H-13. AMALAY staff como fallback en dashboard
- **Archivo:** `src/app/api/chat/route.ts`
- **Problema:** Fallback de lista de meseros usa nombres de AMALAY cuando la query falla. Cliente #2 vería "Omar Aguilera" como su mesero.
- **Agente:** 6 (Dashboard/AI)
- **Impacto:** Confusión total para cliente no-AMALAY

### H-14. Uber webhook sin HMAC verification
- **Archivo:** `src/app/api/webhook/ubereats/route.ts:78`
- **Problema:** TODO comment: "implement HMAC verification when Uber provides the signing key". Cualquier actor puede forjar webhooks de Uber Eats.
- **Agente:** 8 (Code quality)
- **Impacto:** Inyección de órdenes falsas de delivery

### H-15. Onboarding: 5 silent `.catch(() => {})`
- **Archivo:** `src/app/admin/onboarding/page.tsx:53,73,118,143,169`
- **Problema:** Creación de cliente, staff, categorías, items, métodos de pago — cada uno tiene `.catch(() => {})`. Si falla, el wizard continúa como si todo estuviera bien.
- **Agente:** 8 (Code quality)
- **Impacto:** Onboarding parcial sin error visible (blocker para Customer #2 criteria O-2, O-4)

### H-16. POS boot silently fails
- **Archivo:** `src/app/pos/layout.tsx:92-96`
- **Problema:** `registerAutoSync`, `startRetryLoop`, `getPosClientConfig` — los tres tienen `.catch(() => {})`. Si cualquiera falla, el POS arranca sin sync, sin cola de reintento, con config de AMALAY.
- **Agente:** 8 (Code quality)
- **Impacto:** POS operando sin offline sync ni config correcta, sin indicación al usuario

### H-17. Infinite spinner en 5+ páginas POS (network error)
- **Archivos:** `pos/historial/page.tsx:37-56`, `pos/auditoria/page.tsx:48-53`, `pos/facturacion/page.tsx:44-48`, `pos/corte/page.tsx:110-132`, `pos/inventario/page.tsx:24-30`
- **Problema:** `fetch()` sin `try/catch` en el componente. Un `TypeError: Failed to fetch` (offline, DNS, Supabase down) causa rejected promise, `setLoading(false)` nunca se ejecuta. Spinner infinito sin retry.
- **Agente:** 7 (UX)
- **Impacto:** Usuario ve spinner eterno sin poder hacer nada. Solo reload manual lo resuelve.

### H-18. Silent save failures — gastos, CRM, facturas proveedor
- **Archivos:**
  - `src/app/gastos/page.tsx:117-140` — `handleSave()`: si `!res.ok`, modal queda abierto sin error
  - `src/app/crm/page.tsx:162-203` — `handleAddCustomer()` / `handleUpdateCustomer()`: `.catch { /* silent */ }`
  - `src/app/pos/facturas-proveedor/page.tsx:130-164` — `catch { console.error() }` sin feedback al usuario
- **Agente:** 7 (UX)
- **Impacto:** Usuario presiona "Guardar", nada pasa, no sabe si falló o se guardó

### H-19. `item.modificadores.length` crash en null
- **Archivo:** `src/app/pos/page.tsx:3450`
- **Problema:** `item.modificadores.length > 0` sin guard. Items de DB antigua o Wansoft pueden tener `modificadores: null`. Crash: `Cannot read properties of null`. Otros lugares usan `item.modificadores || []`.
- **Agente:** 7 (UX)
- **Impacto:** Lista de orden crashea con datos legacy

---

## MEDIUM — Resolver en sprint actual

### M-1. `pos-config.ts:45` — getPosConfigSync() fallback a AMALAY
- **Archivo:** `src/lib/pos-config.ts:45`
- **Problema:** Si `getPosClientConfig()` no se llamó antes (o falló silenciosamente), todos los tickets imprimen "AMALAY" / "Coffee & Market" / "San Pedro Garza Garcia, NL"
- **Agentes:** 7 (UX) + 8 (Code quality)

### M-2. `pos-config.ts:25` — SSR fallback a 'amalay'
- **Archivo:** `src/lib/pos-config.ts:23-25`
- **Problema:** En SSR, `getActiveClientSlug()` no está disponible, fallback hardcoded a `'amalay'`

### M-3. CierreCajaWizard `<h2>AMALAY</h2>` hardcoded
- **Archivo:** `src/components/pos/CierreCajaWizard.tsx:297`
- **Problema:** El corte de caja imprime "AMALAY" / "Coffee & Market" hardcoded en HTML
- **Agente:** 7 (UX) + 8 (Code quality)

### M-4. Customer display "Bienvenido a AMALAY"
- **Archivo:** `src/app/pos/cliente/page.tsx:69,82`
- **Problema:** Pantalla de cliente muestra "AMALAY" hardcoded
- **Agente:** 8 (Code quality)

### M-5. Floor plan / mesas watermark "AMALAY"
- **Archivos:** `src/app/pos/plano/page.tsx:442`, `src/app/pos/mesas/page.tsx:606`
- **Problema:** Watermark "AMALAY" hardcoded en vista de plano/mesas
- **Agente:** 8 (Code quality)

### M-6. Reservar page branding AMALAY
- **Archivo:** `src/app/reservar/page.tsx:237,678`
- **Problema:** Página pública de reservaciones muestra branding AMALAY
- **Agente:** 8 (Code quality)

### M-7. Lealtad default "AMALAY Rewards"
- **Archivo:** `src/app/lealtad/page.tsx:83`
- **Problema:** Programa de lealtad inicializa con "AMALAY Rewards" (localStorage, editable pero default incorrecto)
- **Agente:** 8 (Code quality)

### M-8. KDS routing keywords hardcoded para AMALAY
- **Archivos:** `src/app/cocina/page.tsx:445`, `src/app/pos/cocina/page.tsx:451`
- **Problema:** Keywords como 'combo amalay', 'mkt-amalay' en routing KDS. Cliente #2 con categorías diferentes no rutearía correctamente.
- **Agente:** 8 (Code quality)

### M-9. Gift cards default client_id 'amalay'
- **Archivo:** `src/app/admin/tarjetas-regalo/page.tsx:23`
- **Problema:** Estado inicial de tarjeta de regalo usa `client_id: 'amalay'`
- **Agente:** 8 (Code quality)

### M-10. Encuestas fallback 'amalay'
- **Archivo:** `src/app/encuestas/page.tsx:148`
- **Problema:** Config de encuestas usa 'amalay' como fallback clientId
- **Agente:** 8 (Code quality)

### M-11. PIN route fallback
- **Archivo:** `src/app/api/pos/pin/route.ts:33`
- **Problema:** Fallback `client_id` defaults to `'amalay'`
- **Agente:** 8 (Code quality)

### M-12. Memory leak: offline-sync listeners
- **Archivo:** `src/lib/offline-sync.ts:124,132`
- **Problema:** Module-level `addEventListener('online')` + `setInterval()` sin cleanup ni guard de doble registro. Listeners se acumulan.
- **Agente:** 8 (Code quality)

### M-13. Memory leak: printer keepAlive timer
- **Archivo:** `src/lib/printer.ts:883`
- **Problema:** `keepAliveTimer = setInterval(...)` nunca se limpia al desconectar impresoras. Sigue enviando writes BLE a dispositivos desconectados.
- **Agente:** 8 (Code quality)

### M-14. RFC placeholder en polizas SAT
- **Archivo:** `src/app/api/contabilidad/polizas/route.ts:548`
- **Problema:** `RFC="XXXXXXXXXXXX"` hardcoded en XML de pólizas contables. Genera export SAT inválido.
- **Agente:** 8 (Code quality)

### M-15. Stale closures en POS page
- **Archivo:** `src/app/pos/page.tsx`
- **Problema:** Múltiples handlers capturan state variables en closures que se vuelven stale (mesa, orderId, items). Operaciones rápidas pueden usar valores anteriores.
- **Agente:** 1 (POS Core)

### M-16. SUPABASE_KEY duplicado en 15+ archivos
- **Archivo:** Múltiples pages
- **Problema:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` declarado como constante local `SUPABASE_KEY` en 15+ archivos en vez de importar de un módulo central.
- **Agente:** 8 (Code quality)

### M-17. Encuestas config load/save silently fails
- **Archivo:** `src/app/encuestas/page.tsx:174,185`
- **Problema:** `.catch(() => {})` en load y save de config de encuestas
- **Agente:** 8 (Code quality)

### M-18. Propinas data fetch silenced
- **Archivo:** `src/app/propinas/page.tsx:37`
- **Problema:** `.catch(() => {})` en fetch de datos de propinas
- **Agente:** 8 (Code quality)

### M-19. Ingresos data fetch silenced
- **Archivo:** `src/app/ingresos/page.tsx:32`
- **Problema:** `.catch(() => {})` en fetch de datos de ingresos
- **Agente:** 8 (Code quality)

### M-20. POS configuracion staff/promo silent fail
- **Archivo:** `src/app/pos/configuracion/page.tsx:55,59`
- **Problema:** Staff list y promo list failing silently
- **Agente:** 8 (Code quality)

### M-21. Attendance save silenced
- **Archivo:** `src/app/pos/asistencia/page.tsx:179`
- **Problema:** `.catch(() => {})` al guardar asistencia
- **Agente:** 8 (Code quality)

### M-22. setLoading(false) no está en finally
- **Archivos:** `pos/compras/page.tsx`, `pos/turno/page.tsx`
- **Problema:** `setLoading(true)` al inicio pero `setLoading(false)` solo dentro del `try`, no en `finally`. Early returns en `!res.ok` pueden dejar spinner pegado.
- **Agente:** 7 (UX)

### M-23. Reportes: blank después de "Generar" sin datos
- **Archivo:** `src/app/reportes/page.tsx`
- **Problema:** Cuando `generated=true` pero `data.length===0`, ningún bloque condicional renderiza. El spinner desaparece y queda espacio en blanco sin mensaje "No hay datos para este período".
- **Agente:** 7 (UX)

### M-24. Corte muestra $0 sin explicación
- **Archivo:** `src/app/pos/corte/page.tsx`
- **Problema:** Si no hay turno activo ni ventas, muestra KPI cards con $0 y 0 tickets sin explicar "No hay turno activo" o "No hay ventas para esta fecha".
- **Agente:** 7 (UX)

### M-25. AuthContext signOut failure silenced
- **Archivo:** `src/contexts/AuthContext.tsx:208`
- **Problema:** `supabase.auth.signOut()` failure silenced con `catch { /* */ }`
- **Agente:** 8 (Code quality)

---

## LOW — Backlog

### L-1 a L-7. Display text AMALAY restantes
Archivos varios con texto "AMALAY" visible al usuario pero no funcional (cosmético). Ya documentados en sesión anterior (~48 referencias).

### L-8. `extractClientId` sin validation robusta
- **Archivo:** `src/lib/api-auth.ts`
- **Problema:** Solo regex, silently falls back en vez de retornar 400

### L-9. Fingerprint read silenced
- **Archivo:** `src/app/pos/huella/page.tsx:28`
- **Problema:** `.catch(() => {})` en lectura de huella digital

### L-10 a L-17. Silent catch blocks menores
42 instancias totales de `.catch(() => {})` en la app. Las HIGH y MEDIUM están listadas arriba. Las restantes son en funcionalidad secundaria (session register, propinas, configuración).

---

## Deduplicación Cross-Agent

| Bug | Encontrado por | Nota |
|-----|----------------|------|
| Doble cobro CashMovementModal | Agentes 1, 2, 3 | Triple confirmación independiente |
| `api-auth.ts` fallback 'amalay' | Agentes 5, 8 | |
| `pos-config.ts` AMALAY defaults | Agentes 7, 8 | |
| CierreCajaWizard hardcode | Agentes 7, 8 | |
| AI prompt hardcoded examples | Agentes 6, resuelto parcialmente en sesión anterior | Chat "$63,544" ya fue arreglado, pero coach tiene pattern similar |
| KDS routing keywords | Agentes 3, 8 | |
| Silent .catch patterns | Agentes 1, 4, 7, 8 | Cada uno encontró instancias diferentes |
| AMALAY display hardcodes | Agentes 7, 8 | Mismo set de archivos, Agent 7 más detallado |
| Infinite spinner on error | Agentes 7, 8 | Agent 7 listó páginas específicas, Agent 8 identificó patrón |

---

## Análisis por Causa Raíz

Los 65 bugs no son 65 problemas independientes. Se agrupan en 6 causas raíz sistémicas. Muchos se resuelven con correcciones transversales, no parches individuales.

### CR-1. Fallos silenciosos — `.catch(() => {})` (31 bugs)

**Bugs:** H-1, H-2, H-5, H-15, H-16, H-18, M-17, M-18, M-19, M-20, M-21, M-25, L-9, L-10–L-17, C-2 (cancel PATCH en mesa)

**Patrón:** 42 instancias de `.catch(() => {})` o `catch { console.error() }` sin feedback al usuario. Es el defecto más extendido del codebase.

**Corrección transversal:** Un wrapper `safeFetch()` o `withErrorToast()` que reemplaza los 42 catch vacíos. Alternativamente, regla ESLint `no-empty-catch` + un handler global que muestra toast de error. Un cambio resuelve ~31 bugs.

**Relación entre bugs:**
- H-16 (POS boot silently fails) y H-17 (infinite spinners) **comparten causa**: ambos son fetch sin try/catch o con catch vacío. La diferencia es que H-16 falla en módulos de arranque (offline-sync, print-queue, config) y H-17 falla en páginas de consulta (historial, auditoría, corte). **Misma solución los cubre a ambos.**
- H-18 (saves silenciosos en gastos/CRM) es el mismo patrón aplicado a escrituras en vez de lecturas.

### CR-2. Doble-write en código (1 bug confirmado)

**Bugs:** H-1

**Nota: H-2, H-5, H-7 fueron REFUTADOS en validación adversarial.** Payment, kitchen send, e inventory deduction YA tienen `operationLock` ref + `saving` state + `genOpId()` idempotency. El único bug real es H-1: `handleConfirm` en CashMovementModal llama `doCashSave()` Y luego hace un segundo POST idéntico. Es un bug de código (copiar-pegar), no de falta de patrón.

**Corrección:** Eliminar el segundo POST en `handleConfirm` (líneas 1364-1386). Fix de 1 minuto.

### CR-3. Estado UI stale / closures (7 bugs)

**Bugs:** H-3, H-4, H-10, M-15, C-1, C-3, C-4

**Patrón:** Handlers capturan state en closures que se vuelven stale. Específicamente en el POS, `orderItems`, `loadedOrderId`, `sentItemIds`, y `cancelledItems` no están correctamente en dependency arrays o no se persisten.

**La familia de mesa refresh (H-4 / C-1–C-4) es UN SOLO problema con múltiples síntomas.** La causa raíz es que `cancelledItems` es un Set en React state que nunca se persiste y se resetea al cambiar mesa. El cancel PATCH tiene `.catch(() => {})` (CR-1 también aplica aquí). Los stale closures agravan el problema pero no lo causan.

**Corrección transversal:** Mover `cancelled: true` al item dentro de `orderItems` (no en Set separado) + agregar deps faltantes a useCallbacks. Un refactor del modelo de datos de cancelación resuelve C-1 a C-4 y H-4.

### CR-4. Hardcodes AMALAY / fallbacks incorrectos (17 bugs)

**Bugs:** C-2, H-11, H-12, H-13, M-1–M-11

**Patrón:** Fallbacks que retornan `'amalay'` cuando el client_id no se resuelve, o texto hardcoded "AMALAY" en UI.

**Corrección transversal:** (1) `getActiveClientSlug()` debe retornar `null` en vez de fallback, (2) `extractClientId()` en api-auth debe retornar 400, (3) búsqueda y reemplazo de `'amalay'` por `getPosConfigSync().name` o `clientConfig.display_name`. 3 cambios base resuelven los 17 bugs.

### CR-5. Falta de `finally` / loading stuck (3 bugs)

**Bugs:** H-17, M-22, (parcialmente M-23, M-24)

**Patrón:** `setLoading(false)` dentro del `try` pero no en `finally`. Si el fetch lanza excepción, el spinner queda pegado.

**Relación con CR-1:** Son complementarios. CR-1 es "el error se traga", CR-5 es "el loading nunca se deshace". Ambos se resuelven con un wrapper de fetch que siempre ejecuta `setLoading(false)` en `finally`.

**M-23 (reportes en blanco) NO está relacionado con los días faltantes del dashboard.** M-23 es un bug de render condicional (`generated && data.length > 0` no cubre el caso `generated && data.length === 0`). Los días faltantes son un problema de datos (cookie expirado). Si reportes tuviera datos para Jul 17-20, igual los mostraría. Son bugs independientes que coinciden visualmente.

### CR-6. Datos legacy / null safety (2 bugs)

**Bugs:** H-19, (parcialmente H-6)

**H-19 (`item.modificadores.length` crash en null) SÍ puede aparecer en órdenes reales de AMALAY.** Las órdenes creadas antes de que se implementaran modificadores tienen `modificadores: null` en la DB. Cualquier orden antigua que se consulte en historial puede triggear este crash. Es un bug de producción activo, no solo teórico.

---

## Impacto en Operación AMALAY Hoy

Bugs que pueden afectar la operación de AMALAY **ahora mismo**:

| Bug | Riesgo concreto | Probabilidad |
|-----|-----------------|--------------|
| H-1/H-2 | Doble cobro por doble-click | ALTA — meseros tocan rápido en pantalla touch |
| H-4/C-1/C-2 | Items cancelados reaparecen → cobro incorrecto | ALTA — cambio de mesa es operación frecuente |
| H-5 | Doble comanda → cocina prepara doble → desperdicio | MEDIA — depende de velocidad del mesero |
| H-17 | Spinner infinito si Supabase tiene latencia | MEDIA — depende de calidad de red |
| H-19 | Crash al ver historial con órdenes antiguas | MEDIA — solo si consultan órdenes pre-modificadores |
| H-7 | Stock incorrecto por doble deducción en reload | BAJA — requiere reload en momento específico |
| H-16 | POS arranca con config AMALAY (que es correcta para AMALAY) | BAJA — solo afectaría si config DB cambia |
| B-2 (prod) | 1353 alertas de stock saturan Telegram | BAJA — ruido, no pérdida de datos |

## Blockers para Customer #2

Sin estos fixes, NO se puede instalar en un segundo restaurante:

| Bug | Criterio bloqueado | Por qué |
|-----|-------------------|---------|
| C-1 | A-1 (zero data leak) | credentials_vault sin RLS = leak de credenciales |
| C-2 | O-3 (login resuelve al cliente correcto) | Fallback 'amalay' = cliente #2 opera sobre datos de AMALAY |
| C-3 | A-1 (zero data leak) | Endpoints sin auth = cualquiera puede crear órdenes |
| H-11 | A-2 (zero data leak en dashboard) | Chat/coach queries sin client_id filter |
| H-12/H-13 | C-5 (AI se identifica correctamente) | Chat dice "Omar Aguilera" a cliente #2 |
| H-15 | O-2, O-4 (wizard crea user, errores visibles) | Onboarding silently fails |
| M-1/M-2 | C-1 (receipt branding correcto) | Tickets imprimen "AMALAY" |
| M-3 | C-1 (receipt branding) | Corte de caja imprime "AMALAY" |
| M-4–M-6 | C-4 (logo/branding) | UI muestra "AMALAY" a cliente #2 |
| M-8 | C-6 (station routing configurable) | KDS rutea por keywords de AMALAY |
| M-11 | O-3 (PIN route) | PIN auth falls back a 'amalay' |

## Correcciones Transversales — Mayor ROI

| Corrección | Bugs que resuelve | Esfuerzo |
|-----------|-------------------|----------|
| `safeFetch()` wrapper con toast + finally | H-16, H-17, H-18, M-17–M-22, M-25, L-9–L-17 (~28 bugs) | 2-3 horas |
| `useAction(fn)` hook con disable + idempotency | H-1, H-2, H-5, H-7 (4 bugs) | 1-2 horas |
| `cancelledItems` → persist en item.cancelled | H-4, C-1, C-2, C-3, C-4 (5 bugs) | 2-3 horas |
| `getActiveClientSlug()` → null, no fallback | C-2, M-1, M-2, M-9, M-10, M-11 (6 bugs) | 1 hora |
| Search/replace AMALAY display text | M-3, M-4, M-5, M-6, M-7, M-8 (6 bugs) | 1-2 horas |
| Auth middleware en API POS routes | C-3, H-14 (2 bugs, pero CRITICAL) | 1-2 horas |

**Total: 6 correcciones transversales resuelven ~51 de 65 bugs en ~9-13 horas.**

---

## Plan de Trabajo Recomendado

### 1. Seguridad (CRITICAL — antes de todo)
- C-1: RLS `credentials_vault`
- C-2: `extractClientId()` → error 400
- C-3: Auth en endpoints POS
- H-11: Filtro client_id en AI routes

### 2. Riesgo de cobro / operación (afecta AMALAY hoy)
- H-1/H-2: `useAction()` en cobro y movimientos de caja
- H-4/C-1-C-4: Refactor cancelación (persist en item, retry PATCH)
- H-5: `useAction()` en enviar a cocina
- H-19: Guard `(item.modificadores || []).length`

### 3. Data integrity
- H-7: Idempotency key en deducción
- H-8/H-9: Rollback parcial + versioning stock
- A-1/B-1 (prod): Cookie relay → alertar a Daniel cuando expira

### 4. Customer #2 blockers
- M-1–M-11: Eliminar fallbacks AMALAY
- M-3: CierreCajaWizard dynamic name
- M-8: KDS routing configurable
- H-12/H-13/H-15: AI identity + onboarding error handling

### 5. Reliability y UX
- `safeFetch()` wrapper (resuelve ~28 bugs de golpe)
- M-12/M-13: Memory leaks
- M-23/M-24: Empty states con mensaje

---

## Notas

- **Zero fixes aplicados.** Este documento es solo diagnóstico.
- **Zero commits.** No se modificó código.
- La mayoría de los bugs son consecuencia de que el sistema se construyó para AMALAY primero y se está generalizando a multi-tenant.
- El doble cobro (H-1/H-2) fue encontrado independientemente por 3 agentes — alta confianza de que es un bug real.
- Los 42 silent `.catch(() => {})` son un patrón sistémico. 6 correcciones transversales resuelven ~51 de 65 bugs.
- La familia de mesa refresh (H-4/C-1–C-4) son 5 síntomas de 2 causas raíz, no 5 bugs independientes.
- M-23 (reportes en blanco) y A-6 (días faltantes) NO están relacionados — coincidencia visual, causas distintas.

---

## Production Observations — July 17–21

Investigación basada en queries directas a Supabase producción + inspección de código de pipelines.

---

### A. Dashboard Desactualizado (Jul 16–21)

#### Estado real de los datos (queries a producción Jul 22)

**`wansoft_daily`** — 921 rows, desde 2024-01-02 hasta 2026-07-20.

Julio 2026 — días con datos vs faltantes:

```
Con datos:  Jul 1-15, Jul 20              (16 rows)
FALTANTES:  Jul 16, 17, 18, 19, 21        (5 días)
```

**Confirmado por datos.** No es Jul 17-20 como se reportó inicialmente — es Jul 16-19 + Jul 21.

**`wansoft_kpis`** (fila única, estado "en vivo") — `fecha_reporte: 2026-06-15`, `updated_at: 2026-06-16`. **Congelada hace 36 días.** Ya no se usa como fuente activa; el dashboard usa `wansoft_daily` + `pos_orders`.

**`ops_daily`** — Última fecha: Jul 12 (2 rows duplicadas, `record_type: 'snapshot'`, ventas: $2,221). No tiene datos después de Jul 12. Es una tabla secundaria, el dashboard no la lee directamente.

**`pos_orders`** — Última orden: Jul 17 (1 orden cerrada, $300, mesa 4). Antes: Jul 16 (testing — 8 órdenes canceladas). **`pos_orders` solo tiene datos de pruebas del POS, no operación real.** AMALAY sigue operando en Wansoft.

**`wansoft_cookies`** — `updated_at: 2026-07-20T19:51:22 UTC` (Jul 20 ~1:51pm MX). Daniel refrescó cookies el Jul 20 por la tarde.

#### Cronología exacta del gap (confirmada por `agent_runs`)

```
Jul 15 ─── último día con datos en wansoft_daily (escrito por backfill del Jul 16)
Jul 16 ─── NO hay ejecución exitosa de intraday-sales en julio excepto...
           (las 5 filas Jul 11-15 tienen updated_at = Jul 16 18:47 UTC = backfill manual)
Jul 17-19  Sin ejecuciones exitosas. Cookies no existían o estaban expirados.
Jul 20 ─── Daniel refresca cookies a las 19:51 UTC.
           intraday-sales SUCCESS a las 20:08 UTC → escribe Jul 20 ($39,504, 52 tickets)
           intraday-sales ERROR a las 21:39 UTC → "Wansoft login failed" (cookie ya expiró)
Jul 21 ─── 14 ejecuciones de intraday-sales, TODAS error. Último intento: 23:46 UTC.
Jul 22 ─── (hoy) Pipeline sigue roto.
```

**En todo julio 2026, intraday-sales tuvo exactamente 1 ejecución exitosa** (Jul 20 20:08 UTC). Las filas Jul 1-15 fueron escritas por backfill o por ejecuciones de junio.

#### Por qué el dashboard muestra "Día 20/31"

`page.tsx:327` calcula `dayOfMonth` como la **fecha del último row** en `thisMonthData` (datos de julio filtrados de `recentData`). El último row de julio es Jul 20. Por eso muestra "Día 20/31" aunque hoy sea Jul 22.

**Confirmado por código + datos.** No es un bug del dashboard — es consecuencia directa de que no hay datos después de Jul 20.

#### Por qué el selector puede estar en Jul 17 con acumulado de Jul 20

`recentData` carga `getRecentDays(1000)` que merge `wansoft_daily` + `pos_orders`. El selector de días navega por `recentData` con un índice (`selectedDayIdx`). Los días faltantes (Jul 16-19) simplemente no existen en el array — el selector salta de Jul 15 a Jul 20. El acumulado mensual siempre suma TODOS los rows del mes, incluyendo Jul 20.

**Confirmado por código + datos.**

#### Fuentes de datos por componente del dashboard

| Componente | Función | Fuente primaria | Fuente fallback | Estado actual |
|-----------|---------|----------------|-----------------|---------------|
| KPI cards (ventas, tickets, TP) | `getLatestDay()` | `pos_orders` (7 días) | `wansoft_daily` (último row) | Muestra Jul 20 ($39,504) |
| Selector diario | `getRecentDays(1000)` → `recentData[idx]` | `wansoft_daily` + merge `pos_orders` | — | Salta Jul 16-19, Jul 21 |
| Acumulado mensual | `monthProgress` en `page.tsx:316` | `recentData.filter(julio)` | — | 16 filas, "Día 20/31" |
| Comparativo semanal | `recentData.filter(weekRange)` | merge `wansoft_daily` + `pos_orders` | — | Semana Jul 14-20 incompleta |
| Gráfico de tendencia | `recentData` (sorted ASC) | merge ambas | — | Gap visual Jul 16-19 |
| Meseros / Categorías | `findRecentDataForField()` | Primer row en `recentData` con datos JSONB | — | Lee Jul 20 (8 meseros) |
| Chat/Coach/Voice | Queries directas en API routes | `wansoft_daily` (coach/voice SIN client_id filter) | — | Datos hasta Jul 20 |

**Todas las tarjetas leen de la misma fuente** (`recentData` = merge de `wansoft_daily` + `pos_orders`). No hay tablas agregadas distintas para distintas tarjetas. La excepción es `ops_daily` que NO es leída por el dashboard principal.

#### Cache y timezone

- **Cache:** No hay. Todas las queries son live fetch a Supabase. **Confirmado por código.**
- **Timezone:** `getDashboardFromPosOrders()` en `data.ts:446` agrupa por `created_at.slice(0, 10)` (UTC, no MX). Desplaza órdenes nocturnas 1 día. No causa gaps multi-día. **Confirmado por código, impacto menor.**

---

### B. Fallos de Agentes y Notificaciones

#### B-1. Intraday Sales — "Error en ejecución" (30+ horas continuas)

| Campo | Valor |
|-------|-------|
| Script | `.github/scripts/intraday_sales.py` |
| Workflow | `.github/workflows/intraday-sales.yml` |
| Causa raíz | Cookie `.ASPXAUTH` expirado → `WansoftAuthExpired` → legacy login bloqueado por Turnstile |
| Clasificación | **Confirmado por datos de producción** |
| Último success | **2026-07-20 20:08 UTC** — único success de todo julio |
| Primer error post-success | **2026-07-20 21:39 UTC** — 91 minutos después (~duración de sesión Wansoft) |
| Errores desde entonces | 14+ ejecuciones error en Jul 21, todas "Wansoft login failed" |
| Cookie refresh | `clients.wansoft_cookies.updated_at = 2026-07-20T19:51 UTC` |
| Impacto | `wansoft_daily` sin datos Jul 16-19 y Jul 21+. Dashboard ciego. |
| Nota | En todo julio, solo 1 ejecución exitosa. Las filas Jul 1-15 fueron backfill. |

#### B-2. Stock Alert — 1353 items sin stock

| Campo | Valor |
|-------|-------|
| Script | `.github/scripts/stock_alert_agent.py` |
| Último output | `agent_runs: "ALERTAS: 1353 sin stock, 0 critico, 0 bajo minimo"` (Jul 21 15:44 UTC) |
| Run anterior | `"ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo"` (Jul 21 15:44 UTC — mismo minuto, 2 runs) |
| Clasificación | **Confirmado por datos de producción** — falso positivo / query sin filtros |
| Nota | 0 crítico, 0 bajo mínimo → las 1353 son items con stock=0 pero sin flag de criticidad. El número varía entre 225 y 1353 entre ejecuciones consecutivas, lo que sugiere datos inestables o cache de inventario. |

#### B-3. Config Validator — 1 issue

| Campo | Valor |
|-------|-------|
| Script | `.github/scripts/config_validator.py` |
| Último output | `agent_runs: "1 config issues"` — consistente en 3 ejecuciones Jul 21 |
| Clasificación | **Confirmado por datos** — 1 issue persistente, probablemente check de agentes con error (intraday-sales) |

#### B-4. Hermes — 12 issues (0 critical, 3 high)

| Campo | Valor |
|-------|-------|
| Script | `.github/scripts/hermes_agent.py` |
| Último output | `agent_runs: "12 issues: 0 critical, 3 high"` — consistente en 3 ejecuciones Jul 21 |
| Nota | Daniel reportó "11/14 issues" — puede ser de una ejecución anterior o de la notificación Telegram. La DB muestra 12 issues, 3 high. |
| Clasificación | **Confirmado por datos** — Hermes detecta correctamente los problemas cascada. Los 3 HIGH son probablemente: intraday-sales en error loop + 2 data staleness. |

#### B-5. Anomaly Detector

| Campo | Valor |
|-------|-------|
| Script | `.github/scripts/anomaly_detector.py` |
| Lógica | Compara hoy vs promedio mismo DOW (4 semanas) desde `ops_daily_live`. Thresholds: 20% ventas, 15% ticket, 50% mesero, 30% categoría. |
| Estado | Funciona correctamente cuando hay datos. Con datos stale, o skip (no data) o reporta stale numbers como anomalías. |
| Clasificación | **Confirmado por código** — dependencia de intraday_sales |

#### B-6. Close Predictor (Predicción)

| Campo | Valor |
|-------|-------|
| Script | `.github/scripts/close_predictor.py` |
| Lógica | Proyecta cierre con curva horaria hardcoded (brunch-cafe, líneas 41-55) o desde `ops_daily`. Lee `ops_daily_live`. |
| Estado | Funciona cuando hay datos frescos. |
| Clasificación | **Confirmado por código** — dependencia de intraday_sales |

#### B-7. Table Time (Tiempo de mesa)

| Campo | Valor |
|-------|-------|
| Script | `.github/scripts/table_time_agent.py` |
| Lógica | Estima rotación desde `pos_orders` (fuente primaria) o `ops_daily_live` (fallback). |
| Estado | Funciona parcialmente independiente de Wansoft porque usa `pos_orders` como primario. |
| Clasificación | **Confirmado por código** — menos afectado que otros |

#### Diagrama de flujo de datos — dónde se rompe la cadena

```
WANSOFT (producción)
    │
    │  ← Cookie .ASPXAUTH (dura ~91 min según datos: success 20:08, error 21:39)
    │  ← Refresh manual por Daniel (último: Jul 20 19:51 UTC)
    │
    ▼
intraday_sales.py (cron cada hora)
    │
    │  ★ PUNTO DE ROTURA ★
    │  Solo 1 success en todo julio (Jul 20 20:08 UTC)
    │  Cookie expiró → "Wansoft login failed" en loop desde Jul 20 21:39
    │
    ▼
wansoft_daily (tabla, 921 rows)
    │  Faltan: Jul 16, 17, 18, 19, 21
    │  Último dato: Jul 20 ($39,504)
    │
    ├──► Dashboard page.tsx ──► getRecentDays(1000)
    │       ├── KPI cards → Jul 20
    │       ├── Selector → salta de Jul 15 a Jul 20
    │       ├── "Día 20/31" → fecha del último row
    │       └── Acumulado → suma 16 filas (faltan 5 días)
    │
    ├──► chat/route.ts → queries con client_slug filter (OK)
    │       └── EXCEPCIÓN: YoY query sin filter (línea 718)
    │
    ├──► coach/route.ts → query SIN client_id filter ← BUG H-11
    │
    ├──► voice/route.ts → queries SIN client_id filter ← BUG H-11
    │
    ├──► anomaly-detector → no_data o datos stale → status "success" pero output vacío
    │
    ├──► close-predictor → no_data o datos stale → status "success" pero output vacío
    │
    └──► table-time → usa pos_orders como primario (parcialmente independiente)

config-validator → detecta intraday-sales con status="error" → "1 config issues"

hermes → audita todos los agentes → "12 issues: 0 critical, 3 high"

stock-alert → query wansoft_data.inventory_parsed sin filtros → "1353 sin stock"
             (causa INDEPENDIENTE, no relacionada con cookie)

wansoft_kpis → congelada desde Jun 15 (36 días) → NO usada por dashboard

ops_daily → última fecha Jul 12 → NO leída por dashboard principal

pos_orders → solo tiene testing (8 órdenes canceladas Jul 16 + 1 cerrada Jul 17)
             AMALAY opera en Wansoft, no en Fullsite POS
```

#### Estado de todos los agentes (query a `agent_runs`, Jul 22)

| Agente | Último run | Status | Nota |
|--------|-----------|--------|------|
| uptime-monitor | Jul 22 00:04 | success | Funciona |
| intraday-sales | Jul 21 23:46 | **error** | "Wansoft login failed" — 30+ hrs en error |
| hermes | Jul 21 23:01 | success | Detecta 12 issues correctamente |
| table-time | Jul 21 22:54 | success | Usa pos_orders, parcialmente independiente |
| kitchen-quality | Jul 21 22:54 | success | |
| config-validator | Jul 21 22:54 | success | 1 issue (intraday-sales en error) |
| anomaly-detector | Jul 21 22:48 | success | Pero output vacío (no_data previo) |
| upselling | Jul 21 22:48 | success | |
| close-predictor | Jul 21 22:48 | success | |
| smoke-test | Jul 21 20:49 | success | |
| supplier-monitor | Jul 21 17:27 | success | |
| waste-detector | Jul 21 17:26 | success | |
| tips-analyzer | Jul 21 17:26 | success | |
| menu-engineering | Jul 21 17:26 | success | |
| staffing-optimizer | Jul 21 17:26 | success | |
| antifraud-agent | Jul 21 17:26 | success | |

**14 de 16 agentes reportan success.** El único en error es `intraday-sales`. Los demás funcionan pero algunos operan sobre datos stale (anomaly-detector, close-predictor).

---

### D. Análisis Arquitectural — Por qué no hay reautenticación automática

#### La pregunta correcta

No es "¿por qué expira la cookie?" — es "¿por qué la arquitectura depende de una cookie que expira sin mecanismo automático de renovación?"

#### Respuesta: Turnstile bloqueó la única ruta de renovación

Antes de Turnstile, `intraday_sales.py` hacía login programático (líneas 91-98):

```python
s.post(f"{WANSOFT_URL}/", data={"UserName": ..., "Password": ...})
```

Esto funcionaba indefinidamente. Cada ejecución del cron creaba una sesión nueva. No importaba que expirara porque el siguiente cron generaba otra.

Wansoft agregó Cloudflare Turnstile. El login programático dejó de funcionar. La solución fue el **cookie relay** (`wansoft_auth.py`): Daniel se loguea manualmente en Chrome, copia la cookie, la guarda en Supabase. Todos los scrapers la consumen.

**El problema arquitectural es que el cookie relay convirtió un sistema autónomo en uno que depende de intervención humana periódica.** No hay ningún mecanismo que:

1. Detecte proactivamente que la cookie está a punto de expirar
2. Renueve la cookie automáticamente
3. Alerte a Daniel ANTES de que falle (solo alerta después)
4. Pause los agentes que dependen de datos Wansoft cuando la cookie está muerta

#### Dónde debería ocurrir la reautenticación

La reautenticación no PUEDE ocurrir automáticamente mientras Turnstile esté activo. Las opciones son:

| Opción | Factibilidad | Nota |
|--------|-------------|------|
| Bypass Turnstile programáticamente | Imposible sin violar ToS de Cloudflare |
| Browser extension que renueve cookies | Requiere Chrome abierto 24/7 con extensión |
| Playwright con perfil persistente | Probado y fallido (Turnstile detecta automation) |
| Dejar de depender de Wansoft | **Correcta** — migrar AMALAY a Fullsite POS |

La solución real es que **AMALAY deje de operar en Wansoft**. Mientras opere en Wansoft, el cookie relay es un workaround frágil que requiere intervención manual cada ~90 minutos de actividad.

#### Lo que SÍ se puede mejorar sin eliminar Wansoft

1. **Alerta ANTES de expirar:** `wansoft_auth.py` sabe `updated_at`. Si `now - updated_at > 60 min`, alertar proactivamente.
2. **Degradación visible:** Dashboard debería mostrar "Datos hasta Jul 20" en vez de aparentar que todo está bien.
3. **Backfill automático:** Cuando la cookie se renueva, `intraday_sales.py` debería rellenar los días faltantes, no solo el día actual.

---

### E. Mapa de Dependencias — Escenario "Wansoft Muere"

#### Cadena de datos

```
WANSOFT.NET (sistema externo)
    │
    │  cookie relay (manual, ~90 min TTL)
    │
    ▼
intraday_sales.py ──ESCRIBE──► wansoft_daily (tabla, 921 rows)
                   ──ESCRIBE──► wansoft_hourly (?)
                   ──ESCRIBE──► ops_daily (via pos_daily_aggregator)
    │
    │  INDIRECTAMENTE alimenta:
    ▼
┌────────────────────────────────────────────────────────┐
│              TODOS estos leen wansoft_daily             │
│                                                        │
│  Dashboard (page.tsx via getRecentDays)                 │
│  daily_briefing.py        hermes_agent.py              │
│  anomaly_detector.py      smoke_test.py                │
│  antifraud_agent.py       uptime_monitor.py            │
│  kitchen_quality_agent.py crm_recompra_agent.py        │
│  menu_engineering.py      wansoft_query.py             │
│  tips_analyzer.py         weekly_amalay.py             │
│  waste_detector.py        purchase_predictor.py        │
│  climate_events_agent.py                               │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│            Estos leen ops_daily (derivada)              │
│                                                        │
│  close_predictor.py       anomaly_detector.py          │
│  table_time_agent.py      kitchen_quality_agent.py     │
│  upselling_agent.py       staffing_optimizer.py        │
│  tips_analyzer.py         antifraud_agent.py           │
│  waste_detector.py        proactive_alerts.py          │
│  menu_engineering.py                                   │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│          Estos leen wansoft_kpis (congelada)            │
│                                                        │
│  daily_briefing.py        wansoft_staleness.py         │
│  kitchen_quality_agent.py upselling_agent.py           │
│  wansoft_query.py         weekly_amalay.py             │
│  table_time_agent.py                                   │
└────────────────────────────────────────────────────────┘
```

#### Clasificación: Si Wansoft muere mañana

| Estado | Componente | Qué pasa | Datos afectados |
|--------|-----------|----------|-----------------|
| **OPERATIVO** | POS Fullsite (page.tsx) | Funciona 100% — no depende de Wansoft | Órdenes, cobros, cocina, tickets |
| **OPERATIVO** | config_validator.py | Lee `pos_staff`, `pos_inventory` — sin dependencia Wansoft | Config checks |
| **OPERATIVO** | speed_of_service.py | Lee solo `pos_orders` | Tiempos de servicio |
| **OPERATIVO** | ops_aggregate.py | Lee `pos_orders` → escribe `ops_daily` | Si hay POS data |
| **OPERATIVO** | pos_intraday_snapshot.py | Lee `pos_orders` (pero cron deshabilitado) | Snapshots POS |
| **DEGRADADO** | Dashboard (page.tsx) | Muestra último dato disponible. `getRecentDays` merge `wansoft_daily` + `pos_orders`. Si AMALAY migra a POS, `pos_orders` tiene datos → dashboard funciona. Si NO migra, se congela en el último día con datos Wansoft. | KPIs, tendencias, meseros |
| **DEGRADADO** | table_time_agent.py | Usa `pos_orders` como primario, `ops_daily` como fallback | Rotación de mesas |
| **DEGRADADO** | anomaly_detector.py | Compara hoy vs historial en `ops_daily`. Historial existe, hoy no → skip o falso positivo | Detección de anomalías |
| **DEGRADADO** | close_predictor.py | Proyecta cierre con `ops_daily`. Sin datos de hoy → skip | Predicción de cierre |
| **DEGRADADO** | hermes_agent.py | Audita salud de agentes. Detecta problemas correctamente pero reporta más issues | Meta-auditoría |
| **BLOQUEADO** | intraday_sales.py | Falla inmediatamente — depende de Wansoft API | Ventas del día |
| **BLOQUEADO** | daily_briefing.py | Lee `wansoft_daily` + `wansoft_kpis` — sin datos frescos, briefing es stale | Briefing matutino |
| **BLOQUEADO** | wansoft_query.py | Hace queries directas a Wansoft API | Consultas ad-hoc |
| **BLOQUEADO** | weekly_amalay.py | Lee `wansoft_daily` + `wansoft_kpis` — reporte semanal incompleto | Reporte semanal |
| **BLOQUEADO** | antifraud_agent.py | Lee `wansoft_daily` + `ops_daily` — sin datos de hoy | Detección de fraude |
| **BLOQUEADO** | kitchen_quality_agent.py | Lee `wansoft_daily` + `wansoft_kpis` + `ops_daily` | Calidad cocina |
| **BLOQUEADO** | upselling_agent.py | Lee `wansoft_kpis` + `ops_daily` | Oportunidades upselling |
| **BLOQUEADO** | menu_engineering.py | Lee `wansoft_daily` + `ops_daily` | Clasificación menú |
| **BLOQUEADO** | tips_analyzer.py | Lee `wansoft_daily` + `ops_daily` | Análisis propinas |
| **BLOQUEADO** | staffing_optimizer.py | Lee `ops_daily` | Optimización horarios |
| **BLOQUEADO** | waste_detector.py | Lee `wansoft_daily` + `ops_daily` | Detección desperdicio |
| **BLOQUEADO** | stock_alert_agent.py | Lee `wansoft_data.inventory_parsed` | Alertas inventario |
| **BLOQUEADO** | smoke_test.py | Lee `wansoft_daily` para validación | Smoke test |

#### Resumen

| Estado | Count | % |
|--------|-------|---|
| OPERATIVO (sin Wansoft) | 4 componentes | 16% |
| DEGRADADO (funciona parcial) | 5 componentes | 20% |
| BLOQUEADO (deja de producir info confiable) | 16 componentes | 64% |

**64% del sistema de inteligencia depende de Wansoft.** El POS funciona 100%, pero todo el layer de analytics, agentes y reportes se congela.

#### La ruta de eliminación de dependencia

Cuando AMALAY migre a Fullsite POS:

1. `pos_orders` reemplaza a `wansoft_daily` como fuente primaria
2. `pos_daily_aggregator.py` escribe a `wansoft_daily` desde `pos_orders` (ya existe, ya funciona)
3. `ops_daily` se alimenta de `pos_orders` via `ops_aggregate.py` (ya existe)
4. Todos los agentes que leen `wansoft_daily` / `ops_daily` siguen funcionando sin cambios
5. `wansoft_kpis` se elimina (ya está congelada desde Jun 15)
6. `wansoft_query.py` y scrapers directos se deprecan

**Post-migración, los 16 componentes BLOQUEADOS pasarían a OPERATIVO** porque sus fuentes de datos se alimentarían de `pos_orders` en vez de Wansoft.

El cuello de botella no es técnico — es operativo: AMALAY necesita dejar de usar Wansoft.

---

### C. Refresh de Mesas — Familia de Bugs

#### Veredicto: FAMILIA de 5 bugs relacionados con 2 causas raíz

**Causa raíz A**: `cancelledItems` es un `Set<string>` en React state — nunca se persiste a localStorage ni al draft. Se resetea a vacío en cada cambio de mesa.

**Causa raíz B**: El draft auto-save (`pos_draft_${mesa}`) incluye items cancelados en `orderItems` sin marcarlos como `cancelled: true`. El cancel PATCH a Supabase tiene `.catch(() => {})` — fallo silencioso.

#### Bug familia: detalle

##### C-1. Items cancelados reaparecen al cambiar mesa (= H-4 existente, ahora con causa raíz)

- **Flujo confirmado por código:**
  1. Mesero cancela item → `cancelledItems.add(id)` (state only) + PATCH a DB con `cancelled: true` (línea 2369)
  2. Draft auto-save (línea 2071-2077) escribe `orderItems` a `pos_draft_${mesa}` — incluye items cancelados SIN flag
  3. Mesero cambia a mesa B → `cancelledItems` se resetea a `Set()` vacío (línea 2007-2008)
  4. Mesero regresa a mesa A → draft carga items CON los cancelados, `cancelledItems` está vacío → item reaparece
- **Agravante:** Si el PATCH del paso 1 falló (`.catch(() => {})`), el item ni siquiera está cancelado en DB
- **Clasificación:** **Confirmado por código**

##### C-2. Cancel PATCH falla silenciosamente

- **Archivo:** `pos/page.tsx:2373` — `.catch(() => {})`
- **Problema:** Si la red falla durante la cancelación, el item queda cancelado en UI state (Set) pero NO en DB. Al recargar mesa, DB gana → item reaparece.
- **Clasificación:** **Confirmado por código**

##### C-3. Stale `orderItems` en cancel handler

- **Archivo:** `pos/page.tsx` — `handleCancelItem` useCallback
- **Problema:** Dependency array tiene `[cancellingItem, orderId, mesero, mesa]` pero referencia `orderItems` (línea 2365) y `loadedOrderId` (línea 2364) que NO están en deps. Si `orderItems` cambió entre abrir modal y confirmar cancel, el PATCH escribe items stale al DB.
- **Clasificación:** **Confirmado por código**

##### C-4. Stale `sentItemIds` en merge logic

- **Archivo:** `pos/page.tsx` — useEffect de carga de mesa
- **Problema:** `sentItemIds` se usa en línea 1946 dentro del effect pero NO está en el dependency array `[mesa, clienteNombre]`. El merge puede usar `sentItemIds` de la mesa anterior, causando que items de mesa A "leak" al merge de mesa B.
- **Clasificación:** **Confirmado por código**

##### C-5. Sin realtime sync entre terminales

- **Archivo:** `pos/page.tsx` — búsqueda exhaustiva
- **Problema:** Zero Supabase realtime subscriptions. No hay `supabase.channel()`, `.on('postgres_changes')`, ni `.subscribe()`. La cancelación en Terminal A es invisible para Terminal B hasta que Terminal B recarga la mesa manualmente.
- **Clasificación:** **Confirmado por código** — limitación arquitectural conocida, no bug per se

##### C-6. Flash de datos stale al cambiar mesa

- **Archivo:** `pos/page.tsx:2010-2031`
- **Problema:** Al cambiar de mesa, primero se carga desde localStorage cache (instantáneo), luego async fetch de Supabase (tarda). El cache tiene TTL de 5 minutos (línea 2014: `300000ms`). Entre load cache y fetch DB, el usuario ve datos potencialmente stale.
- **Clasificación:** **Confirmado por código** — es arquitectural (cache-first), el flash es breve pero puede confundir

##### Relación con H-4 existente

H-4 en el reporte original decía: "Items cancelados reaparecen al cambiar de mesa — stale state." Ahora sabemos que **NO es un solo bug sino una familia de 5 bugs interconectados** (C-1 a C-5) con 2 causas raíz. El fix correcto requiere:
1. Persistir `cancelled: true` en cada item de `orderItems` (no en un Set separado)
2. Retry/queue en el cancel PATCH (usar el offline sync queue existente)
3. Agregar `orderItems` y `loadedOrderId` a los dependency arrays

#### Browser refresh (F5)

- **Estado:** Funciona correctamente. `pos_order_${mesa}` se restaura del cache, luego DB fetch sobrescribe.
- **Clasificación:** **Confirmado por código** — no hay bug aquí

---

### Clasificación consolidada de hallazgos

| ID | Hallazgo | Tipo | Clasificación |
|----|----------|------|---------------|
| A-1 | Cookie relay es SPOF para datos Wansoft | Infraestructura | Confirmado por código |
| A-2 | `intraday_sales.py` único writer a `wansoft_daily` | Arquitectura | Confirmado por código |
| A-3 | POS intraday snapshot deshabilitado | Config | Confirmado por código |
| A-4 | Fallback dashboard no activa para días individuales faltantes | Lógica | Confirmado por código |
| A-5 | Timezone bug en `getDashboardFromPosOrders` (UTC vs MX) | Bug | Confirmado por código |
| A-6 | Jul 17-20 sin datos por cookie expirado | Causa raíz | Hipótesis pendiente (verificar agent_runs + wansoft_daily) |
| B-1 | Intraday Sales error loop = cookie expirado | Causa raíz | Confirmado por código |
| B-2 | Stock alert 1353 = query sin filtros active/type | Falso positivo | Confirmado por código |
| B-3 | Config Validator 1 issue = cascada de cookie | Efecto cascada | Hipótesis pendiente |
| B-4 | Hermes 11/14 = cascada de cookie | Efecto cascada | Confirmado por código |
| B-5 | Anomaly/Predictor/Table Time = dependencia de intraday | Cascada | Confirmado por código |
| C-1 | Items cancelados reaparecen (cancelledItems no persiste) | Bug familia | Confirmado por código |
| C-2 | Cancel PATCH silently fails | Bug | Confirmado por código |
| C-3 | Stale orderItems en cancel handler | Bug | Confirmado por código |
| C-4 | Stale sentItemIds leak cross-mesa | Bug | Confirmado por código |
| C-5 | Sin realtime sync entre terminales | Limitación | Confirmado por código |
| C-6 | Flash de datos stale al cambiar mesa | UX | Confirmado por código |

---

## Apéndice: Validación Adversarial — Jul 22

Revisión línea por línea de cada CRITICAL y HIGH intentando refutar. Resultado: 3 bugs refutados, 2 reclasificados, 1 parcialmente refutado.

### Bugs REFUTADOS (falsos positivos)

#### ~~H-2. Race condition en pago — doble click "Cobrar"~~ → REFUTADO

`handlePayment` (línea 2859) tiene **triple protección**:
1. `operationLock.current` (ref) — bloqueo instantáneo antes de re-render
2. `saving` state — deshabilita todos los botones de pago (`disabled={saving}` en líneas 4806, 4844, 4866, 4881, 4895, 4982)
3. `genOpId()` — idempotency key pasado a `saveOrder`
4. `checkOrderConflict('payment')` — detección de conflicto server-side

**Evidencia:** Lectura directa de líneas 2859-2873 y JSX de botones de pago.

#### ~~H-5. Doble comanda a cocina~~ → REFUTADO

`handleSendToKitchen` (línea 2585) tiene **triple protección**:
1. `operationLock.current` (ref, línea 2586)
2. `saving` state (línea 2588), botón deshabilitado (`disabled={...saving...}`, línea 3727)
3. `genOpId()` idempotency key (línea 2589)

**Evidencia:** Lectura directa de líneas 2585-2589 y JSX del botón.

#### ~~H-7. Doble deducción de inventario en reload~~ → REFUTADO

Doble protección:
1. `sentItemIds` se restaura correctamente desde DB (línea 1965) y cache (línea 2024) al cargar mesa. Items ya enviados NO se deducen de nuevo.
2. `recordMovement()` en `inventory.ts` tiene idempotency key server-side (línea 145) — busca key existente en `pos_inventory_movements.notes` antes de procesar.

**Evidencia:** Lectura de líneas 1965, 2024, 2754 en page.tsx y líneas 145, 313 en inventory.ts.

### Bugs RECLASIFICADOS

#### H-1. ~~Doble cobro en CashMovementModal~~ → RECLASIFICADO: Doble-write en código, no doble-click

El doble-click SÍ está protegido (`saving` state, línea 1289, botón `disabled={saving}` línea 1486).

El bug real es peor: `handleConfirm` (línea 1356) llama `doCashSave(manager)` que hace POST a `pos_cash_movements`, y luego líneas 1368-1380 hacen un SEGUNDO POST idéntico. **Cada movimiento de caja vía PIN crea 2 filas.** La ruta biométrica (`handleBio`, línea 1326) solo llama `doCashSave` una vez y NO tiene el bug.

- **Riesgo AMALAY hoy:** ALTO — si usan PIN para autorizar movimientos de caja, cada retiro/ingreso se registra doble. Afecta cuadre de caja.
- **Evidencia:** Lectura directa de líneas 1307-1324 (`doCashSave`) y 1356-1386 (`handleConfirm`).

#### C-3. ~~API endpoints sin autenticación (4 endpoints)~~ → RECLASIFICADO: 2 de 4 no existen

- `deepgram-token/route.ts` — **NO EXISTE**. Archivo no encontrado.
- `kds/route.ts` — **NO EXISTE**. Archivo no encontrado.
- `save-order/route.ts` — EXISTE. Sin Supabase auth pero tiene `getClientId(request)` + OCC (optimistic concurrency). POS usa PIN-based auth, no Supabase auth. Riesgo: MEDIO para multi-tenant (cualquiera con URL puede POST órdenes para cualquier client_id).
- `staff-cache/route.ts` — EXISTE. Sin auth. PINs hasheados con SHA-256+salt antes de enviar, pero salt hardcoded en código fuente. Riesgo: MEDIO (enumeración de staff + brute-force offline de PINs cortos).

**Riesgo AMALAY hoy:** BAJO — POS corre en red local del restaurante. No hay exposición pública.
**Riesgo Customer #2:** MEDIO — sin device JWT, un cliente podría operar sobre datos de otro si descubre la URL.
**Reclasificación:** De CRITICAL a HIGH para multi-tenant, LOW para AMALAY hoy.

### Bugs CONFIRMADOS tras revisión adversarial

#### C-1. `credentials_vault` sin RLS → CONFIRMADO

- Tabla existe en `001_core_schema.sql:312` y `010_consolidated_core.sql:166`
- Tiene columna `client_id`
- **Zero RLS policies** en `003_rls_policies.sql` ni en ningún otro archivo
- Activamente usada en `admin/vault/page.tsx` y `internal/vault/page.tsx`
- Las páginas NO filtran por `client_id` en sus queries

**Riesgo AMALAY hoy:** BAJO — solo AMALAY existe, no hay otro cliente que pueda leer.
**Riesgo Customer #2:** CRITICAL — cliente #2 vería credenciales de AMALAY.

#### C-2. `api-auth.ts:40` fallback a 'amalay' → CONFIRMADO

Sin cambios. `extractClientId()` retorna `'amalay'` como default.

**Riesgo AMALAY hoy:** NULO — el fallback es correcto para AMALAY.
**Riesgo Customer #2:** CRITICAL — cualquier request sin header correcto opera sobre AMALAY.

#### H-4/C-1–C-4. Familia mesa refresh → CONFIRMADO con causa raíz detallada

Validación adversarial del agente encontró la mecánica exacta:
1. `cancelledItems` es `Set<string>` en state (línea 2050), nunca persiste
2. Se resetea a vacío en cada cambio de mesa (línea 2007)
3. `handleCancelItem` agrega al Set Y hace PATCH con `cancelled: true` a DB (líneas 2353, 2364-2373)
4. PERO `handleCancelItem` NO actualiza `orderItems` state con `cancelled: true`
5. Draft auto-save (línea 2073) guarda `orderItems` sin el flag → al restaurar draft, items cancelados reaparecen
6. Cancel PATCH tiene `.catch(() => {})` (línea 2373) — fallo silencioso
7. `pos_order_${mesa}` cache sí filtra cancelados, pero solo se escribe al enviar a cocina, no al cancelar

**Riesgo AMALAY hoy:** ALTO — cambio de mesa es operación frecuente (33 mesas activas).

#### H-11. Chat/Coach/Voice sin filtro client_id → CONFIRMADO (parcialmente)

- `chat/route.ts`: La mayoría de queries SÍ filtran por `client_slug`. **Excepción:** query YoY (línea 718) NO filtra.
- `coach/route.ts`: Query a `wansoft_daily` (línea 17) NO filtra por client_id. **Confirmado.**
- `voice/route.ts`: Queries en líneas 57 y 349 NO filtran. **Confirmado.**

**Riesgo AMALAY hoy:** NULO — solo existe un cliente.
**Riesgo Customer #2:** HIGH — coach y voice exponen datos de AMALAY a cualquier cliente.

#### H-19. `item.modificadores.length` crash en null → CONFIRMADO

Línea 3450: `item.modificadores.length > 0` sin guard. El mismo archivo usa `(item.modificadores || [])` en líneas 1968, 2027, 2626, 2734. Y usa `Array.isArray(item.modificadores)` en líneas 4114, 4145, 4156, 4158.

**¿Puede ocurrir en AMALAY?** SÍ. Órdenes creadas antes de implementar modificadores tienen `modificadores: null` en DB. Consultar historial con órdenes antiguas triggerea el crash.

**Riesgo AMALAY hoy:** MEDIO — solo afecta al ver historial de órdenes pre-modificadores.

### Matriz de Confianza Final — CRITICAL + HIGH

**Escala de confianza:**
- 95–100%: Confirmado por código + lógica determinista, bug ocurre en CADA ejecución de la ruta
- 85–94%: Confirmado por código, requiere condición específica pero común
- 70–84%: Alta confianza por inspección, requiere validación en producción
- 50–69%: Hipótesis fundamentada, ruta plausible pero no verificada

| ID | Bug | Confianza | Evidencia | AMALAY hoy | Customer #2 | Status |
|----|-----|-----------|-----------|------------|-------------|--------|
| C-1 | credentials_vault sin RLS | **98%** | Código: 0 policies en 003_rls_policies.sql. Queries sin filtro client_id en vault pages. | BAJO (1 cliente) | CRITICAL | Blocker C#2 |
| C-2 | api-auth fallback 'amalay' | **98%** | Código: `return 'amalay'` línea 40. Determinista. | NULO (fallback correcto) | CRITICAL | Blocker C#2 |
| ~~C-3~~ | ~~4 endpoints sin auth~~ | **45%** | 2/4 no existen. 2 restantes usan PIN-auth by design. | BAJO | MEDIO | Reclasificado |
| H-1 | Cash movement doble-write (PIN) | **99%** | Código: `handleConfirm` llama `doCashSave()` (POST #1) + POST #2 idéntico líneas 1368-1380. Ocurre en CADA movimiento vía PIN. Ruta biométrica NO afectada. | **ALTO — BUG ACTIVO** | ALTO | Fix urgente |
| ~~H-2~~ | ~~Doble cobro payment~~ | **0%** | REFUTADO: operationLock + saving + genOpId + checkOrderConflict | — | — | Eliminado |
| H-3 | Cancel no actualiza total | **72%** | Código: cancel modifica Set pero no recalcula total inline. Requiere verificar si useEffect recalcula. | MEDIO | MEDIO | Requiere validación |
| H-4 | Items cancelados reaparecen | **97%** | Código: cancelledItems Set nunca persiste (línea 2050). Reset en mesa switch (línea 2007). Draft guarda items sin flag cancelled (línea 2073). Cancel PATCH `.catch(() => {})` (línea 2373). Causa raíz completa identificada. | **ALTO — BUG ACTIVO** | ALTO | Fix urgente |
| ~~H-5~~ | ~~Doble comanda~~ | **0%** | REFUTADO: operationLock + saving + genOpId | — | — | Eliminado |
| H-6 | KDS status solo localStorage | **95%** | Código: `localStorage.setItem('kds_status_' + id)` sin persistencia server. Confirmado en cocina, barra, panadería pages. | MEDIO (1 terminal por estación) | MEDIO | Puede esperar |
| ~~H-7~~ | ~~Doble deducción~~ | **0%** | REFUTADO: sentItemIds restaurado en load + idempotency key server-side | — | — | Eliminado |
| H-8 | Sin rollback deducción parcial | **80%** | Código: `recordMovement()` hace INSERT individual por ingrediente sin transacción. Requiere fallo de red mid-recipe (baja frecuencia). | BAJO | BAJO | Puede esperar |
| H-9 | Race condition stock | **75%** | Código: sin SELECT FOR UPDATE ni versioning. Requiere 2 órdenes deduciendo mismo ingrediente en <1s. Probabilidad baja en volumen AMALAY (~100 órdenes/día). | BAJO | MEDIO (más volumen) | Puede esperar |
| H-10 | Split stale assignments | **68%** | Código: split captura items en closure. Requiere editar orden durante split (poco común). | BAJO | BAJO | Puede esperar |
| H-11 | AI queries sin client_id | **96%** | Código: coach línea 17 sin filtro. Voice líneas 57, 349 sin filtro. Chat YoY línea 718 sin filtro. Resto de chat SÍ filtra. | NULO (1 cliente) | HIGH | Blocker C#2 |
| H-12 | Hardcoded examples en AI | **90%** | Código: system prompts con ejemplos numéricos. Chat "$63,544" ya fue arreglado pero coach tiene patrón similar. | MEDIO (hallucination) | ALTO | Blocker C#2 |
| H-13 | AMALAY staff fallback en AI | **88%** | Código: fallback de meseros usa nombres AMALAY cuando query falla. Requiere fallo de query (baja freq). | NULO | ALTO | Blocker C#2 |
| H-14 | Uber webhook sin HMAC | **95%** | Código: TODO comment línea 78. Pero Uber Eats aún no envía webhooks a este endpoint. | NULO (inactivo) | MEDIO | Puede esperar |
| H-15 | Onboarding silent fails | **97%** | Código: 5x `.catch(() => {})` en líneas 53, 73, 118, 143, 169. Cada paso puede fallar sin feedback. | N/A (no se usa) | CRITICAL (blocker O-2, O-4) | Blocker C#2 |
| H-16 | POS boot silent fails | **93%** | Código: 3x `.catch(() => {})` en layout.tsx:92-96. Config, sync, retry queue pueden fallar al arrancar. Para AMALAY la config hardcoded es correcta, así que el fallo es invisible. | BAJO (config AMALAY correcta) | ALTO (config incorrecta) | Blocker C#2 |
| H-17 | Infinite spinners (red error) | **85%** | Código: fetch sin try/catch en 5+ pages. Requiere error de red (TypeError: Failed to fetch). En restaurante con WiFi inestable, frecuencia media. | MEDIO | MEDIO | Reliability |
| H-18 | Saves silenciosos | **92%** | Código: gastos, CRM, facturas-proveedor — 3 handlers con catch vacío o sin feedback. | BAJO (páginas secundarias) | MEDIO | Reliability |
| H-19 | modificadores null crash | **96%** | Código: línea 3450 sin guard. Mismo archivo usa `|| []` en 4 otros lugares. Órdenes pre-modificadores en DB tienen `null`. | **MEDIO — BUG ACTIVO** (historial) | BAJO (DB limpia) | Fix urgente |

### Conteo Final Certificado

| Severidad | Original | Validado | Refutados | Reclasificados |
|-----------|----------|----------|-----------|----------------|
| CRITICAL | 3 | 2 | 0 | C-3 → HIGH |
| HIGH | 19 | 13 | H-2, H-5, H-7 | H-1 reclasificado (peor) |
| MEDIUM | 25 | 25 | 0 | 0 |
| LOW | 18 | 18 | 0 | 0 |
| **Total** | **65** | **58** | **3** | **2** |

### Bugs activos en producción AMALAY — Fix antes de seguir operando

| ID | Bug | Confianza | Impacto operativo | Fix estimado |
|----|-----|-----------|-------------------|--------------|
| H-1 | Doble-write movimiento de caja (PIN) | 99% | Cada retiro/ingreso crea 2 filas. Cuadre de caja incorrecto. Afecta reportes diarios. | 1 min — eliminar POST duplicado |
| H-4 | Items cancelados reaparecen al cambiar mesa | 97% | Mesero ve items fantasma. Posible cobro incorrecto. Afecta operación con 33 mesas. | 2-3 hrs — refactor cancelación |
| H-19 | Crash al ver historial con órdenes antiguas | 96% | Pantalla de historial puede crashear con órdenes pre-modificadores. | 1 min — agregar `|| []` |

### Blockers para Customer #2 — Fix antes de instalar

| ID | Bug | Confianza | Criterio bloqueado | Fix estimado |
|----|-----|-----------|-------------------|--------------|
| C-1 | credentials_vault sin RLS | 98% | A-1 (zero data leak) | 30 min — agregar policy |
| C-2 | api-auth fallback 'amalay' | 98% | O-3 (login correcto) | 30 min — retornar 400 |
| H-11 | AI queries sin client_id | 96% | A-2 (dashboard leak) | 1 hr — agregar filtros |
| H-12 | Hardcoded examples en AI | 90% | C-5 (AI identidad) | 1 hr — parametrizar |
| H-13 | AMALAY staff fallback | 88% | C-5 (AI identidad) | 30 min — eliminar fallback |
| H-15 | Onboarding silent fails | 97% | O-2, O-4 (wizard + errores) | 2 hrs — error handling |
| H-16 | POS boot silent fails | 93% | C-1 (config correcta) | 1 hr — error handling |
| M-1–M-11 | Hardcodes AMALAY | 90-98% | C-1, C-4, C-5, C-6 | 2 hrs — search/replace |
