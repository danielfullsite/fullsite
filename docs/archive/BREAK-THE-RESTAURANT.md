# BREAK THE RESTAURANT — QA Destructivo Pre-Cutover

> Fullsite POS — AMALAY Coffee & Market
> Fecha: 2026-07-04
> Cutover: Martes 8 julio 2026
> Objetivo: Encontrar escenarios donde el restaurante deja de operar o pierde confianza

---

## 1. POS (page.tsx — 4588 lineas)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **Doble click en "Cobrar"** | `operationLock.current` (useRef) bloquea el segundo click. `if (operationLock.current) return` en linea 2356. El lock se libera en linea 2482 o 2508. | ACEPTABLE | No. El ref es sincrono y previene la re-entrada correctamente. |
| **Cerrar tab durante cobro** | La orden se guarda con `saveOrder()` (linea 2428) ANTES de imprimir ticket. Si el tab se cierra despues del save pero antes del print, la orden queda como `cerrada` en BD pero sin ticket impreso. El cajero puede reimprimir desde el historial. Si se cierra ANTES del save, no pasa nada — la orden sigue abierta. | ACEPTABLE | No. El patron "save first, print after" es correcto. El ticket se puede reimprimir. |
| **50-100 items en una orden** | Sin limite en `setOrderItems`. El scroll funciona (`overflow-y-auto`). El ticket ESC/POS itera sin limite. El riesgo real es que un ticket de 100 items sea muy largo para el rollo de papel (80mm puede cortar). | BAJO | No bloquea. Verificar que el rollo no se acabe a mitad de ticket largo. |
| **Dos terminales abren la misma mesa** | Ambas navegan a `/pos?mesa=5`. Ambas llaman `loadMesaOrder` que hace fetch desde Supabase. Si la mesa esta vacia, ambas crean un `orderId` local con `generateId()` — IDs diferentes. Al enviar a cocina, el primero guarda con POST, el segundo tambien guarda con POST. **Resultado: DOS ordenes abiertas para la misma mesa.** checkOrderConflict (linea 2140) solo funciona si ya hay un `loadedOrderId` — en ordenes nuevas ambos tienen `loadedOrderId = null` y el check se skipea (`if (!loadedOrderId) return false`). | **BLOCKER** | **SI.** Dos meseros pueden crear ordenes fantasma en la misma mesa. El segundo envio deberia detectar que ya existe una orden abierta para esa mesa. Workaround martes: disciplina operativa — asignar mesas a meseros. |
| **Pagar una orden ya pagada desde otra terminal** | `checkOrderConflict` (linea 2151) verifica `rows[0].status === 'cerrada'` y bloquea con toast "Esta orden ya fue cerrada por otro usuario". | ACEPTABLE | No. Correctamente protegido. |
| **Precio cambia mientras orden esta abierta** | El precio se fija al momento de agregar el item (`item.price` del menu). Si el admin cambia el precio en BD, las ordenes en curso mantienen el precio original. No hay re-fetch de precios. | ACEPTABLE | Comportamiento correcto — el precio del momento de venta es el que aplica. |

---

## 2. KDS (cocina/page.tsx — 869 lineas)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **40 ordenes simultaneas** | `getKitchenOrders()` trae todas las ordenes con status `enviada/preparando/lista`. Se renderizan en un grid `grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Con 40 ordenes, hay scroll vertical. Auto-archive a las 4 horas (linea 118). **El render de 40 cards con items parseados puede ser lento** — cada card hace `JSON.parse(order.items)` en cada render (linea 576). | MEDIO | No bloquea pero puede sentirse lento. Considerar memoizar el parse. |
| **Dos pantallas KDS abiertas** | Ambas hacen polling independiente (`setInterval(fetchOrders, POLL_INTERVAL_KITCHEN)`). El `itemStatus` se guarda en **localStorage** (linea 300-335) — **compartido entre tabs del mismo browser.** Si dos tabs KDS estan en el mismo Chrome, comparten estado de items. Si estan en computadoras diferentes, cada una tiene su propio localStorage. **Problema: si chef A marca "preparando" en tab 1, tab 2 lo ve inmediatamente (localStorage compartido). Pero si son dos computadoras, los estados son independientes y no se sincronizan.** | **TRUST** | SI si usan 2 computadoras diferentes para KDS. Los estados de items divergen. Workaround martes: usar solo UN dispositivo KDS por estacion. |
| **Refresh KDS durante hora pico** | `itemStatus` se restaura de localStorage (linea 302-321). Incluye limpieza de entries >4 horas. Las ordenes se re-fetchean de Supabase. **El estado se recupera correctamente.** | ACEPTABLE | No. Correctamente implementado. |
| **localStorage lleno** | Todos los `localStorage.setItem` estan envueltos en `try/catch {}` vacios (lineas 294, 328, etc.). Si localStorage esta lleno, **el estado de items se pierde silenciosamente en el siguiente refresh.** No hay alerta al chef. | BAJO | Improbable que pase en produccion. localStorage tiene ~5MB. |
| **Orden cancelada desde POS mientras KDS muestra "preparando"** | El POS marca items como `cancelled: true` en el JSON de la orden. El KDS filtra `if (i.cancelled) return false` (linea 579). En el siguiente poll (1.5-2 seg), el item desaparece del KDS. **No hay notificacion visual al chef de que algo se cancelo — simplemente desaparece.** | **TRUST** | SI. El chef puede seguir preparando un platillo cancelado por 2 segundos. Deberia haber un flash rojo "CANCELADO: [item]". Workaround martes: comunicacion verbal cocina-caja. |

---

## 3. Offline & Sync (pos-offline-db.ts — 334 lineas)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **Supabase cae 5 minutos** | Las ordenes se guardan via `saveOrder()` que usa fetch directo a Supabase. Si falla, el POS tiene `queueOperation` para encolar en IndexedDB. El indicador offline (`OfflineIndicator`) muestra "X pendientes". Se puede seguir tomando ordenes. **Cobrar funciona** porque `handlePayment` llama `saveOrder` que encola si falla. | ACEPTABLE | Funciona como disenado. |
| **Crear 20 ordenes offline y reconectar** | `registerAutoSync` (linea 292) escucha `online` event y llama `syncAll()`. Procesa la queue secuencialmente. Cada item se intenta como POST/PATCH a Supabase. **Pero: si dos ordenes offline tienen el mismo mesa, se pueden crear duplicados** — cada una tiene ID unico (generado con `generateId()`) asi que no hay conflicto de ID, pero si hay dos ordenes abiertas para mesa 5. | **TRUST** | SI. Misma mesa offline puede duplicar ordenes. Es el mismo problema que el punto 1.1 (dos terminales misma mesa). |
| **409 Conflicts durante sync** | Para `pos_orders` con 409: intenta PATCH fallback (linea 240-264). Para otras tablas (audit, inventory): solo incrementa retry y loguea error. | ACEPTABLE | El 409 en orders se maneja razonablemente. |
| **5 retries fallidos** | `if (item.retries >= 5) continue` (linea 217). **El item se skipea para siempre.** No se borra, no se alerta al usuario, no se loguea de forma visible. Queda en la queue como zombie. | **TRUST** | **SI.** Datos se pierden silenciosamente. Ya identificado en FULL-AUDIT P2.5. Necesita toast rojo "X operaciones no sincronizadas". Workaround martes: monitorear consola del browser para `[offline-sync]` logs. |
| **Sync de audit logs falla** | `logAudit` es fire-and-forget (`catch { /* */ }`). Si falla, no se encola para retry. El audit log se pierde permanentemente. | MEDIO | No bloquea operacion pero pierde trazabilidad. Aceptable para dia 1. |

---

## 4. Print/Bridge (printer.ts + print-queue.ts)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **Bridge (localhost:7717) caido** | `isBridgeAvailable()` tiene timeout de 800ms y cache de 5 segundos. Si falla, cae a Bluetooth. Si no hay BT, encola en `print-queue` con `enqueueFailedPrint()`. La print-queue reintenta cada 15 segundos. Escalada: 2 minutos sin bridge = `needs_attention` para comandas. | ACEPTABLE | Correctamente implementado con fallback chain y escalada. |
| **Impresora offline** | Bridge retorna error HTTP, `bridgePrint` retorna false. Se encola para retry. El POS muestra toast "Impresora sin conexion: [estacion]". | ACEPTABLE | No. |
| **Comanda enviada, orden cancelada inmediatamente** | La comanda ya salio por la impresora. No hay mecanismo para imprimir automaticamente un "CANCELAR: [item]" en la estacion. El chef no se entera hasta el siguiente poll del KDS (2 seg). | MEDIO | No bloquea pero crea confusion momentanea. Workaround: comunicacion verbal. |
| **20 comandas en rapida sucesion** | `printByStation` agrega 200ms delay entre estaciones (`await new Promise(r => setTimeout(r, 200))`). Las escrituras pasan por `printChain` (cola global serializada, linea 185). Para bridge, cada print es un HTTP POST independiente. **No hay throttle en el lado del bridge.** 20 prints simultaneos al bridge podrian saturar la cola del bridge. | BAJO | Improbable con 2 terminales. El bridge de Node.js maneja requests secuencialmente por naturaleza. |
| **Print queue retry correcto** | La print-queue tiene state machine robusta: pending -> retrying -> printed/failed/needs_attention. Bridge-down no consume retries. Auto-recovery cuando bridge vuelve. Cloud sync opcional a Supabase. | ACEPTABLE | Bien implementado. |

---

## 5. Cobro (Payment flow)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **Split payment (parte efectivo, parte tarjeta)** | Soportado via `method === 'Mixto'` y `mixtoPagos` array (linea 2398). Cada pago se registra en `order.pagos`. El cajon abre si CUALQUIER pago incluye "efectivo" (linea 2431). | ACEPTABLE | Funciona correctamente. |
| **Cash drawer command falla** | `openCashDrawer()` retorna boolean. El cobro NO depende del cajon — la orden se cierra aunque el cajon no abra. El cajero abre con llave. | ACEPTABLE | Correcto — el cajon es auxiliar, no bloqueante. |
| **Cobrar con $0** | `handleCloseOrder` verifica `orderItems.length === 0` (linea 2344). Si hay items pero total = $0 (descuento 100%), `handlePayment` procede normalmente. `total` puede ser 0 si `discount >= subtotal`. Se genera ticket con total $0. | MEDIO | Funciona pero deberia haber confirmacion "El total es $0, deseas continuar?". Workaround: descuento 100% requiere PIN de gerente (protege el caso). |
| **Descuento del 100%** | `subtotalAfterDiscount = Math.max(0, subtotal - discount)` (linea 2135). IVA = 0. Total = 0. El cobro procede, ticket se imprime con $0. El descuento queda en audit log con `approved_by`. | ACEPTABLE | El PIN de gerente es la proteccion. |
| **Internet cae despues de cobrar pero antes de guardar** | `saveOrder(order)` (linea 2428) falla. `if (ok)` es false, cae a `else` (linea 2507) con toast "Error al cerrar cuenta" y libera el lock. **La orden NO se cierra.** El cajero puede reintentar. Si `saveOrder` tiene queue offline, se encola. | ACEPTABLE | El "save first" pattern protege este caso. |
| **Cobrar sin enviar a cocina** | `handleCloseOrder` (linea 2346): `if (sentItemIds.size === 0 && !loadedOrderId)` bloquea con toast "Primero envia la orden a cocina antes de cobrar". | ACEPTABLE | Correctamente bloqueado. |

---

## 6. Corte/Turno (turno/page.tsx)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **Cerrar turno sin ordenes** | El Corte X (linea 54-90) simplemente muestra $0 en todos los campos. El CierreCajaWizard es un componente dinamico — no verificado su comportamiento con 0 ordenes pero deberia funcionar (solo muestra totales). | ACEPTABLE | No bloquea. |
| **Ordenes abiertas al cerrar turno** | El CierreCajaWizard es un componente importado dinamicamente. **No se puede verificar sin leer ese componente**, pero el flujo del wizard no parece verificar ordenes abiertas antes de cerrar. Si hay ordenes abiertas (enviada/preparando/lista), se quedan huerfanas sin turno. | **TRUST** | **PROBABLE.** Necesita verificacion del CierreCajaWizard. Workaround martes: verificar manualmente que no hay mesas abiertas antes de cerrar turno. |
| **Dos personas cierran turno simultaneamente** | `handleOpenTurno` no tiene lock. Pero el cierre es via CierreCajaWizard que hace PATCH al turno existente. Si dos personas hacen PATCH simultaneo, el ultimo gana (last-write-wins). Solo un cierre se registra. | BAJO | Improbable con 2 personas. |
| **Corte X — clasificacion de pagos** | Linea 72-74: `if (m.includes('efectivo')) efectivo += ... else if (m.includes('transferencia')) transferencias += ... else tarjeta += ...`. **Pagos de Rappi, UberEats, cortesia, vales = TODO cae como "tarjeta".** | **TRUST** | **SI.** Ya identificado en FULL-AUDIT P1.3. El gerente va a notar numeros incorrectos. Fix: usar el tipo de metodo de pago (cash/card/transfer/platform/other) en vez de heuristica de strings. |

---

## 7. Permisos (pos-permissions.ts)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **Mesero accede a pagina de corte** | `canSee('corte')` mapea a `corte_turno` que es `false` para mesero (linea 153). El boton no se muestra en el nav. **Pero: no hay middleware server-side.** Un mesero puede navegar manualmente a `/pos/turno` y ver la pagina. La pagina no hace verificacion de permisos propia. | **TRUST** | SI. La proteccion es solo UI (ocultar botones). No hay enforcement en la pagina. Workaround martes: los meseros no conocen la URL. |
| **Mesero cancela una orden** | `can('cancelar_ordenes')` es `false` para mesero. El boton de cancelar no se muestra. Pero si alguien modifica sessionStorage para `role: "admin"`, puede cancelar. | **TRUST** | Ver punto 8 (sessionStorage manipulable). |
| **Cajero da descuentos** | `descuentos_ordenes_pct` es `false` para cajero (linea 151-152). El modal de descuento pide PIN de gerente INDEPENDIENTEMENTE del rol — el PIN verifica via API que sea admin/gerente. | ACEPTABLE | El PIN de gerente es la proteccion real, no el perfil de permisos. |
| **sessionStorage limpiada = permisos elevados?** | Si `sessionStorage.getItem('pos_staff')` retorna null, `staffRole` queda como default `'cajero'` (linea 1737). `getPermissions('cajero')` da permisos de cajero. **No hay escalacion a admin.** Si el rol es desconocido, `getPermissions` hace fallback a `mesero` (linea 189-191). | ACEPTABLE | No. El fallback es seguro (cajero o mesero, nunca admin). |

---

## 8. Login/Auth (api/pos/pin/route.ts)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **PIN que no existe** | El API retorna 401 "PIN incorrecto". Rate limit: 5 intentos por IP en 5 minutos. | ACEPTABLE | Correctamente protegido. |
| **Dos personas comparten el mismo PIN** | El query usa `limit=1`. Si dos empleados tienen el mismo PIN, siempre retorna el primero. **El segundo empleado no puede loguearse con su identidad real.** | MEDIO | Validar unicidad de PIN en la tabla pos_staff. Workaround martes: asegurar PINs unicos al insertar. |
| **sessionStorage editada manualmente** | Un usuario puede abrir DevTools, hacer `sessionStorage.setItem('pos_staff', '{"name":"Hacker","role":"admin"}')` y obtener permisos de admin. **No hay validacion server-side del rol en las operaciones del POS.** Las operaciones criticas (descuento, cancelacion) piden PIN de gerente como segunda capa, pero las demas (ver reportes, corte X, cambiar mesa) solo verifican el rol en sessionStorage. | **TRUST** | SI. El rol deberia validarse server-side en operaciones sensibles. Workaround martes: las terminales son fisicas en el restaurante, no accesibles al publico. El riesgo es interno (staff malicioso). |
| **POS_FALLBACK_PIN da acceso total** | Si pos_staff esta vacio (BLOCKER #1 del audit), TODOS usan el fallback PIN `2835` como Admin. Sin distincion de roles. Cualquiera puede cancelar, dar descuentos, cerrar turno. | **BLOCKER** | **SI.** Ya identificado como BLOCKER #1. Sin pos_staff poblado, no hay control de acceso. |

---

## 9. Mesas (mesas/page.tsx)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **Abrir mesa ya ocupada** | `handleMesaClick` simplemente hace `router.push('/pos?mesa=5')`. No hay check "esta mesa ya tiene orden". El POS carga la orden existente via `loadMesaOrder`. **Si la mesa tiene orden, la carga. Si no, crea nueva. Esto es correcto.** | ACEPTABLE | No. Navegar a mesa ocupada carga la orden existente. |
| **Dos terminales abren misma mesa vacia simultaneamente** | Ambas navegan a `/pos?mesa=5`. Ambas ven mesa vacia (no hay orden en BD todavia). Ambas generan `orderId` diferente con `generateId()`. Ambas permiten agregar items. Al enviar a cocina, ambas hacen POST con IDs diferentes. **Resultado: dos ordenes para mesa 5.** | **BLOCKER** | **SI.** Mismo problema que POS 1.4. No hay lock optimista en la creacion de ordenes por mesa. Workaround martes: disciplina operativa + asignar mesas. |

---

## 10. Facturacion (facturacion/page.tsx)

| Escenario | Que pasa en el codigo | Severidad | Fix necesario? |
|---|---|---|---|
| **CFDI sin Facturama configurado** | `handleTimbrar` llama al API `/api/factura/timbrar`. Si Facturama no esta configurado (no hay API key), el endpoint falla y retorna error. El POS muestra error en UI. No crashea. | ACEPTABLE | Facturama es $1,650 de setup (pendiente). La facturacion no es critica para dia 1. |
| **RFC invalido** | `validateRFC` (linea 58) usa regex: `/^[A-Z&]{3,4}\d{6}[A-Z0-9]{3}$/`. Valida formato antes de enviar. Si el formato es correcto pero el RFC no existe en SAT, Facturama retorna error al timbrar. | ACEPTABLE | Validacion de formato correcta. Validacion de existencia la hace Facturama. |

---

## RESUMEN EJECUTIVO

### BLOCKERS (el restaurante puede dejar de operar)

| # | Problema | Impacto | Fix |
|---|---|---|---|
| B1 | **pos_staff vacio** — todos entran como Admin, sin roles | Sin control de acceso, cualquiera cancela/descuenta | Poblar tabla antes del lunes noche |
| B2 | **Dos terminales pueden crear ordenes fantasma en misma mesa** | Items se pierden, cocina recibe dos comandas para la misma mesa | Agregar check "ya existe orden abierta para esta mesa" antes de crear nueva |

### TRUST ISSUES (datos se ven mal, gerente pierde confianza)

| # | Problema | Impacto | Fix |
|---|---|---|---|
| T1 | **Corte X clasifica Rappi/UberEats/cortesia como "tarjeta"** | Desglose de formas de pago incorrecto | Usar campo `type` de pos_payment_methods |
| T2 | **Sync silenciosamente descarta datos despues de 5 retries** | Ordenes/audit se pierden sin alerta | Agregar toast rojo visible |
| T3 | **KDS no notifica cancelaciones al chef** | Chef prepara platillo cancelado | Agregar indicador visual temporal "CANCELADO" |
| T4 | **Permisos son solo UI — sessionStorage manipulable** | Staff con conocimiento tecnico puede escalar permisos | Validacion server-side en operaciones sensibles |
| T5 | **Ordenes abiertas al cerrar turno** | Ordenes quedan huerfanas sin turno asignado | Verificar ordenes abiertas antes de permitir cierre |
| T6 | **Dos pantallas KDS en computadoras distintas no sincronizan estado de items** | Chef marca "preparando" en una, la otra no lo ve | Mover estado de items a Supabase en vez de localStorage |

### ACEPTABLE (manejado correctamente)

- Doble click en cobrar (lock con useRef)
- Tab cerrado durante cobro (save-first pattern)
- Bridge caido (fallback chain + print queue)
- Impresora offline (retry automatico)
- Descuento 100% (PIN de gerente requerido)
- sessionStorage limpiada (fallback a cajero, no admin)
- PIN inexistente (rate limit 5 intentos)
- Mesa ocupada (carga orden existente)
- RFC invalido (validacion regex)

---

## PRIORIDADES PARA EL LUNES (antes del cutover martes)

1. **P0: Poblar pos_staff** — sin esto NO proceder
2. **P0: Fix clasificacion de pagos en Corte X** — el gerente lo va a notar
3. **P1: Agregar check de mesa ya ocupada al crear orden nueva** — previene ordenes fantasma
4. **P2: Toast rojo cuando sync descarta operaciones** — visibilidad de datos perdidos
5. **P3: Todo lo demas es post-cutover**

---

> QA destructivo ejecutado: 2026-07-04
> Metodologia: lectura linea por linea del codigo fuente, no suposiciones
> Conclusion: 2 blockers, 6 trust issues, el resto aceptable
> El sistema es solido en su core. Los problemas son de edge cases multi-terminal y visibilidad de errores.
