# POS FLOW AUDIT — Análisis Completo de Operación
> Fecha: 2026-07-23
> Alcance: 14 flujos completos del POS + comparativa operacional vs Wansoft
> Método: Lectura directa de código + WANSOFT-POS-BIBLE.md + CAJA-SPEC.md + DATA-MODEL.md
> Propósito: Identificar dónde el flujo rompe el contexto operacional. No mejoras cosméticas — riesgos reales de operación en un restaurante real.

---

## Flujo canónico esperado

```
Usuario → Turno → Mesa → Orden → Cocina → Cobro → Cierre
```

Cada paso debe **requerir** el anterior. El sistema no puede permitir saltar pasos sin una razón documentada y justificada.

---

## Resumen ejecutivo

Fullsite tiene una implementación sólida del happy path. El problema no es lo que hace — es lo que permite saltarse. Hay **7 puntos donde el flujo canónico se rompe** sin que el sistema lo impida:

1. Un mesero puede construir una orden entera sin turno activo (el rechazo llega hasta "Enviar")
2. Una orden puede pagarse sin que todos los ítems hayan sido enviados a cocina (edge case con cache)
3. El turno puede cerrarse con órdenes abiertas en mesa (sin guard)
4. La transferencia de mesa no requiere autenticación (la UI la disfraza como PIN prompt)
5. El historial tiene una factura completamente desacoplada de las órdenes (cantidad manual, sin linkage)
6. El monitor de sync lee localStorage pero la sync queue real está en IndexedDB — puede reportar cero pendientes cuando no lo son
7. El corte falla silenciosamente si no hay internet — muestra ceros sin error visible

Además hay **9 capacidades que Wansoft tiene y Fullsite no** que un restaurante esperaría de un POS maduro, clasificadas por prioridad.

---

## 1. LOGIN (PIN, Huella, Recuperación de sesión)

### Estado actual

**PIN:** funciona correctamente. POST a `/api/pos/pin`, fallback a cache de 15 min en localStorage si está offline. Chequeo de sesión concurrente en otros terminales via `pos_sessions`. Heartbeat cada 2 minutos.

**Huella:** Dos sistemas independientes que no se hablan entre sí:
- Sistema A (HID DigitalPersona, puerto 7717) — es el que se usa en el LOGIN. Credenciales en `pos_fingerprint_staff`.
- Sistema B (WebAuthn platform authenticator) — se enrolla en `/pos/huella` pero NUNCA se usa para login. Credenciales en `pos_biometric_credentials`. **Código muerto.**

**Recuperación de sesión:** Si el usuario recarga antes de 30 min de inactividad, la sesión se restaura desde `sessionStorage` sin verificar si hay conflicto de terminal. El chequeo de concurrencia solo corre en el login inicial.

**Bloqueo por intentos:** 5 intentos incorrectos bloquean por 1 minuto. El bloqueo vive en React state — un reload lo resetea.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| L-01 | WebAuthn credentials enrolladas en `/pos/huella` nunca se usan en login — código muerto | P1 |
| L-02 | Session restore post-reload no verifica conflicto de terminal concurrente | P1 |
| L-03 | Lockout por intentos fallidos resetea al recargar la página | P2 |
| L-04 | KDS paths (`/pos/cocina`, `/pos/barra`, `/pos/kds`) bypasean auth completamente — cualquiera puede verlos | P2 |

### Wansoft vs Fullsite

| Capacidad | Wansoft | Fullsite | Implementar? |
|---|---|---|---|
| Bloqueo de pantalla por operación | Configurable (OFF en AMALAY) | No existe — el terminal queda abierto | P2 — agregar config |
| Segunda pantalla cliente | Existe como hardware | No | P3 — post PMF |

---

## 2. APERTURA Y CAMBIO DE TURNO

### Estado actual

**Abrir turno:** Existen DOS implementaciones independientes:
- `TurnoGate.handleOpen()` → usa `openTurno()` de `pos-data`, IDs deterministas, escribe audit log
- `TurnoPage.handleOpenTurno()` → escribe directo a Supabase REST, ID generado como `Date.now().toString(36) + random`, sin audit log estándar

Ambas escriben a la misma tabla `pos_turnos` pero con distintas shapes y semánticas.

**Quién puede abrir turno:** admin, gerente, cajero. Los meseros y capitanes esperan en pantalla "Esperando turno" con polling de 5 segundos.

**Cerrar turno:** Pasa por `CierreCajaWizard`. Verifica sync queue pendiente. Pero **no verifica si hay órdenes abiertas** — solo la sync queue. Si hay una mesa con cuenta activa al momento del cierre, la orden queda con `turno_id` apuntando a un turno ya cerrado. Sin path de reconciliación.

**Turno stale:** Si el turno tiene más de 24 horas, se detecta como stale y bloquea hasta que un cajero/gerente decida cerrar + abrir nuevo o continuar.

**Clock-in de personal:** `StaffShiftPanel` pide PIN para clock-in. Bug: guarda `staff_id: pin` (el valor del PIN numérico en el campo de UUID del staff). El campo debería ser el UUID del staff member, no su PIN.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| T-01 | Dos implementaciones de "abrir turno" con IDs y shapes distintos | P1 |
| T-02 | Cierre de turno no verifica órdenes abiertas — órdenes pueden quedar huérfanas | P0 |
| T-03 | `StaffShiftPanel` guarda el PIN numérico en `staff_id` del shift record | P1 |
| T-04 | capitan bloqueado en turno stale aunque debería operar | P2 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Fondo de caja declarado al abrir | El cajero declara el efectivo físico con el que empieza | Punto de control de efectivo desde el arranque | Sí — `fondo_inicial` | Ya implementado | — |
| Registro de intentos de corte | `spInsIntentoCorteZ` registra CADA intento con monto declarado | Audita si alguien intentó cuadrar con montos falsos | No | Sí — P2 | Después de cutover |
| Auto-fill fondo con Z anterior | Fondo del nuevo turno = efectivo real que quedó en caja del Z anterior | Elimina declaración manual cuando el cajero deja el dinero en caja | No | Opcional — P3 | Post PMF |
| Horas máximas de turno | Alerta y SP especial si turno excede N horas | Detecta olvidos de cierre antes de que los números cuadren mal | Parcial (alerta a 18h) | Agregar bloqueo configurable | P2 |
| Corte de mesero | Cada mesero tiene su propio corte con ventas, propinas, liquidación | Mesero sabe cuánto debe devolver al pool y cuánto se queda | No existe como flujo | Sí — P1 | Antes de segundo cliente |

---

## 3. SELECCIÓN DE MESA

### Estado actual

El usuario llega a `/pos/mesas`, selecciona una mesa y navega a `/pos?mesa=N`. El componente principal carga la orden existente para esa mesa desde Supabase (o desde draft en localStorage).

**Guard de turno en selección de mesa:** No existe. Un mesero puede seleccionar cualquier mesa y construir una orden completa sin turno activo. El rechazo llega en `handleSendToKitchen` ("No hay turno activo. Un encargado debe abrir turno"). Puede pasar 20 minutos capturando antes de descubrir que no puede enviar.

**Guard de identidad:** No existe a nivel de navegación. Si `pos_staff` no está en sessionStorage, `staffRole` defaultea a `'cajero'` y la app continúa funcionando. No hay redirect al login.

**Guard de rol en mesas:** cajero no puede abrir mesas vacías (silencioso — no hace nada al tocar una mesa vacía). Cualquier otro rol puede abrir cualquier mesa.

**Mesa concurrente:** No hay lock de acceso. Dos terminales pueden abrir la misma mesa simultáneamente. La concurrencia se resuelve en el servidor via OCC al guardar.

**URL como source of truth:** Si el usuario navega a `/pos` sin parámetros, carga mesa 1 por defecto. Si mesa 1 tiene una orden activa, se carga y podría modificarse accidentalmente.

**Semáforo visual:** Existe styling básico por estado en la lista de mesas, pero no con la lógica de semáforo granular de Wansoft (abierta/impresa/por cobrar como estados diferenciados).

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| M-01 | No hay verificación de turno en selección de mesa — mesero captura sin turno hasta que intenta enviar | P1 |
| M-02 | `/pos` sin parámetros carga mesa 1 por defecto — puede cargar orden real accidentalmente | P1 |
| M-03 | No hay tipo de orden (mesa/llevar/domicilio) — todo es "mesa" implícitamente | P1 |
| M-04 | Identidad de staff no se verifica en la ruta de mesas — defaultea a cajero silenciosamente | P1 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Tipo de orden en creación | Al crear: seleccionar Mesa / Para llevar / Domicilio / Recoger | Flujos distintos por tipo (cliente, dirección, impresión) | No — solo "mesa" implícita | Sí | P1 |
| Selección de mesero en la orden | Mesero se selecciona de lista al crear la orden, no es el usuario logueado | Cajero puede capturar en nombre de cualquier mesero | Parcial (dropdown de mesero existe pero no es obligatorio) | Revisar flujo | P1 |
| "Cerrar con código de barras" | Escanear ticket físico → directo a cobro | Elimina búsqueda de la orden en lista con horas pico | No | Sí, con QR | P2 |
| Semáforo visual de mesas | Puntos rojo/verde/morado por estado de la cuenta | El cajero ve panorama completo sin entrar a cada mesa | Parcial | Mejorar | P2 |
| Nombre de cliente obligatorio para para llevar | Se pide al crear | Trazabilidad y pickup sin confusión | No | Sí junto con tipo de orden | P1 |

---

## 4. CREACIÓN Y EDICIÓN DE ÓRDENES

### Estado actual

**Creación:** La orden no existe en DB hasta el primer "Enviar a cocina". Antes de eso, vive en localStorage como draft (30 min TTL). La creación es implícita — no hay una acción explícita de "nueva orden".

**Adición de ítems:** Categoría → item → ModifierModal → confirm → ítem en ticket. Dos sistemas de modificadores coexisten:
- Legacy (hardcoded por categoría)
- DB-driven (grupos con required/optional, min/max)

Si existen grupos DB, reemplazan al legacy. Si no, legacy aplica. No hay transición documentada.

**Edición pre-envío:** Completamente libre — cantidad, silla, modificadores.

**Edición post-envío:** Bloqueada via UI (botones deshabilitados). Se pueden agregar ítems nuevos. Enviando de nuevo solo imprime los nuevos ítems.

**Guard "enviar antes de cobrar":** Existe: `sentItemIds.size === 0 && !loadedOrderId` → bloquea pago. Problema: cuando la orden se carga desde localStorage cache, todos los ítems cached se marcan como `sentItemIds` automáticamente, independientemente de si realmente fueron enviados a DB. El guard puede bypassearse si el cache tiene datos pero la orden no existe en DB.

**Personas y mesero:** No se validan antes de enviar. El sistema acepta `personas=0` y `mesero=''`.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| O-01 | Cache pre-popula `sentItemIds` → guard "enviar antes de cobrar" bypasseable | P1 |
| O-02 | No hay validación de mesero o personas antes del envío | P2 |
| O-03 | Dos sistemas de modificadores sin documentación de precedencia | P2 |
| O-04 | Draft tiene TTL de 30 min — si el turno dura más de 30 min, el draft se pierde antes de enviarse | P2 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Tiempos como partidas | "1er TIEMPO" es un ítem $0 en el ticket, marcador explícito de ronda | KDS y reportes pueden distinguir rondas de cocina | Parcial (`comanda_batches` existe) | Mejorar visibilidad | P2 |
| Tipos de precio por tipo de orden | Mismo platillo con precio diferente en mesa, delivery, happy hour | Flexibilidad de pricing sin duplicar el catálogo | No | Sí — P1 para delivery | P1 |
| Botón duplicar partida | Copia rápida de un ítem ya en el ticket | Velocidad en captura de grupos con ítems repetidos | No | Sí | P2 |
| Apurar | Imprime comanda de urgencia para un ítem | Comunicación sin palabras entre sala y cocina | No | P2 | P2 |
| Firebutton (disparar tiempo) | Envía a cocina solo el siguiente tiempo/ronda | Control granular de ritmo de servicio | No | P1 para servicio a la carta | P1 |
| Seleccionar todos los que apliquen descuento | Multi-select de ítems elegibles para descuento | Descuentos masivos en grupos grandes | No | P2 | P2 |

---

## 5. COCINA / KDS

### Estado actual

**Tres páginas separadas:** `/pos/kds`, `/pos/cocina`, `/pos/barra`. Cada una con su propia implementación. No hay KDS unificado.

**Polling a 2 segundos en todos.** No hay Supabase Realtime (websocket). Latencia máxima: 2 segundos entre envío del POS y aparición en KDS.

**Batch awareness:** Solo `cocina/page.tsx` divide las órdenes por `comanda_batch_id`. El KDS (`kds/page.tsx`) y Barra (`barra/page.tsx`) muestran toda la orden como una tarjeta sin distinción de rondas.

**Ruteo de estación:** Dos implementaciones distintas de la lógica de ruteo:
- `kds/page.tsx` tiene su propia `STATION_KEYWORDS` + `getStation()` — mapea `caja` → `panaderia`
- `cocina/page.tsx` y `barra/page.tsx` usan `getStationByName()` de `pos-constants.ts` — `caja` es su propia estación

Si un ítem tiene `station='caja'`, aparecerá en tabs distintos según en qué pantalla de kitchen lo busques.

**Estado de ítems:**
- `kds/page.tsx`: persiste estado por ítem a Supabase (`kds_item_status`)
- `cocina/page.tsx`: guarda estado por ítem solo en localStorage — se pierde al refrescar o en otro dispositivo
- `barra/page.tsx`: no tiene estado por ítem — solo puede avanzar la orden completa

**Reimpresión desde cocina:** No existe. Si una comanda se pierde (papel atascado, impresora offline al enviar), la cocina no puede reimprimir desde su pantalla. El mesero debe ir al POS, encontrar la orden, y reimprimir.

**Auto-archivo:** `cocina/page.tsx` marca automáticamente como `entregada` las órdenes con más de 4 horas en estado enviada/preparando — escribe a DB. `kds/page.tsx` las filtra solo en el cliente — no escribe a DB. Comportamiento divergente entre pantallas.

**Offline:** `cocina` y `barra` muestran banner amarillo de offline. `kds` no muestra nada — parece online aunque esté cacheando datos locales.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| K-01 | No hay comanda reprint desde cocina/barra/kds — blocker operacional real | P0 |
| K-02 | KDS y Barra no son batch-aware — mezclan rondas en una sola tarjeta | P1 |
| K-03 | Lógica de ruteo de estación duplicada y divergente entre kds y cocina/barra | P1 |
| K-04 | Estado de ítems en `cocina` en localStorage — se pierde en refresh y no sincroniza | P1 |
| K-05 | Auto-archivo de órdenes: cocina escribe a DB, kds solo filtra — comportamiento diferente | P1 |
| K-06 | `kds/page.tsx` no tiene indicador offline | P2 |
| K-07 | `barra` sin estado por ítem — barista no puede marcar drinks individuales como listos | P2 |
| K-08 | `KitchenTimer` calcula avg prep time usando `created_at → closed_at` (tiempo de mesa, no de cocina) | P2 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Comanda de cancelación en la impresora original | Al cancelar un ítem, imprime aviso en la impresora del routing original del ítem | La cocina sabe inmediatamente que no debe preparar | Sí — `printCancelToStation()` | Ya implementado | — |
| Impresoras como KDS (sin pantalla visual) | Wansoft no tiene pantalla en cocina — todo es papel | Costo cero de hardware, robustez (no hay pantalla que se rompa) | Fullsite tiene ambas opciones | Mantener dualidad | — |
| Preticket con propinas sugeridas | El preticket impreso incluye 10%/15%/18% calculados | Sube el promedio de propina sin pedirle nada al cajero | No | Sí | P2 |
| "Apurar" en KDS | Botón que comunica urgencia sin palabras | Reduce necesidad de comunicación verbal cocina-sala | No | Sí | P2 |

---

## 6. COBRO

### Estado actual

**Métodos soportados:** Efectivo, Tarjeta (MercadoPago Point Smart o Getnet manual), Transferencia, métodos custom de `pos_payment_methods`.

**Pago mixto:** Funcionando. Puede combinar cualquier número de formas hasta que `restante ≤ 0.009`.

**Guard de monto mínimo:** Cash tiene guard UI (botón deshabilitado hasta que recibido >= total). Tarjeta y otros no validan monto.

**Split de cuenta:** Funciona por ítems (hasta 6 cuentas) y parejo (por N personas). Las cuentas se guardan como órdenes separadas en DB con ID `{orderId}-C{n}`.

**Propina:** Se captura antes de seleccionar método. Preset 0/10/15/20% o valor libre. Se almacena en `pos_orders.propina` separado del total.

**Drawer kick:** Automático via print bridge al completar el pago en efectivo.

**Guard doble pago:** `operationLock.current` + OCC antes de guardar.

**Monto de cambio:** No se guarda en el registro de la orden — solo en audit log. No se puede reconstruir cuánto cambio se dio desde el historial de órdenes.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| C-01 | Cambio (cashback) no se guarda en la orden — imposible reconstruir en disputas | P2 |
| C-02 | Sin guard de monto para tarjeta — el cajero puede presionar "Cobrado" con cualquier monto | P1 |
| C-03 | Propinas excluidas de `efectivoEsperado` en CierreCajaWizard — descuadre sistemático | P1 |
| C-04 | Sin denominaciones en conteo de efectivo del wizard — solo total | P2 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Botón "Auto" en cobro | Asigna todo el saldo pendiente al método seleccionado en un toque | Velocidad en hora pico — elimina escribir el monto | No | Sí | P1 |
| Integración bancaria nativa | Terminal bancaria integrada en el flujo: el POS envía el monto, la terminal lo cobra | Elimina error humano de teclear monto en terminal | Parcial (MercadoPago Point Smart) | Extender a Getnet/otros | P1 |
| Descuento porcentaje abierto en cobro | Descuento libre en pantalla de cobro | Flexibilidad para gerente sin volver a editar la orden | Parcial (existe en edición de orden) | Revisar flujo | P2 |
| Tipos de precio por orden | El mismo platillo puede costar diferente en delivery vs mesa vs evento | Sin confusión de precio, sin duplicar catálogo | No | P1 — crítico para delivery | P1 |
| Cortesías con razón obligatoria | Toda cortesía requiere texto de razón | Audit trail de cortesías sin configuración adicional | Sí — CancelModal pide razón | Revisar que sea obligatorio | P2 |
| Anticipos / pagos programados | Toma un adelanto antes del evento, aplica al cobro final | Eventos y banquetes con flujo limpio | No | P3 | Post PMF |

---

## 7. FACTURACIÓN (CFDI)

### Estado actual

La factura es un módulo completamente independiente en `/pos/facturacion`. No está vinculada a ninguna orden. El monto se ingresa manualmente.

**Flujo:** El cajero llena RFC, razón social, régimen, uso CFDI, email y monto. Guarda en Supabase con estado `pendiente`. Luego toca "Timbrar" que llama a `/api/factura/timbrar` → Facturama.

**Reintentos:** Si Facturama falla en el timbrado, el estado queda en `error` con mensaje y hay botón de retry. Correcto.

**Problema crítico:** Si Facturama falla en el `createCFDIRequest` (el primer paso de guardar en Supabase), la solicitud se pierde completamente — no hay queue ni retry para la creación.

**Sin linkage de orden:** No hay `order_id` en las solicitudes de CFDI. No se puede:
- Autorellenar el monto desde una orden
- Detectar si ya se facturó esta orden
- Reconstruir qué consumió el cliente que pide factura

**Sin límite temporal:** El SAT requiere que el CFDI se emita dentro del mismo mes para la mayoría de regímenes. El sistema no aplica ninguna restricción temporal.

**CSD vence 2026-08-03** — 11 días desde la auditoría. Blocker absoluto de facturación.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| F-01 | CSD vence 2026-08-03 — todas las facturas fallarán | P0 |
| F-02 | Sin `order_id` en factura — no se puede detectar doble facturación | P1 |
| F-03 | Monto de factura es manual — error humano sin validación contra la orden real | P1 |
| F-04 | `createCFDIRequest` falla sin retry si Supabase está offline | P1 |
| F-05 | Sin límite temporal para solicitar factura — riesgo fiscal | P2 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Factura desde la terminal POS | El cajero puede emitir factura directo desde la pantalla de cobro | No requiere que el cliente vaya al portal web | Sí — `/pos/facturacion` | Ya implementado | — |
| QR en ticket para autofactura | El cliente escanea y va al portal de autofactura | Descongestiona al cajero en hora pico | Parcial (existe QR en `/pos/qr`) | Conectar con Facturama | P1 |
| Factura agrupada | Un cliente puede agrupar múltiples consumos en una sola factura | Clientes corporativos con múltiples mesas | No | Post PMF | P3 |
| Reporte de conciliación ventas vs facturas | Cuánto vendí vs cuánto facturé | Cierre fiscal mensual sin sorpresas | No | Sí — P2 | P2 |
| Nota de crédito con motivos SAT | 4 motivos de cancelación de CFDI según normativa | Compliance fiscal sin proceso manual | No | Sí — P2 | P2 |

---

## 8. DELIVERY Y PICKUP

### Estado actual

**Delivery:** El módulo `/pos/delivery` muestra órdenes de Uber Eats y Rappi únicamente. El restaurante puede avanzar el estado de `nueva → preparando → lista`. Los estados finales (`en_ruta`, `entregada`, `cancelada`) son read-only — los gestiona la plataforma.

No hay integración real-time con las plataformas — la página poll a `delivery_orders` cada 10 segundos. No hay webhook. Un cliente hace un pedido en Rappi y aparece en Fullsite con hasta 10 segundos de delay (si algo inserta en `delivery_orders` — el mecanismo de inserción no fue verificado en este análisis).

No hay alerta en el POS principal cuando llega una orden de delivery — el cajero debe estar mirando el módulo de delivery.

**Pickup:** No existe como flujo. No hay tipo de orden "para llevar", no hay nombre de cliente para pickup, no hay distinción entre comer en mesa y llevarse la comida.

**Tipo de orden en el POS:** No existe. Toda orden creada desde el POS es "de mesa" implícitamente. No hay campo de tipo de orden en `pos_orders`.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| D-01 | No existe flujo de pickup (para llevar) — no se puede registrar ni rastrear | P1 |
| D-02 | No hay alerta en POS principal cuando llega orden de delivery | P1 |
| D-03 | No hay integración en tiempo real con plataformas (solo polling) | P2 |
| D-04 | Delivery sin integración en KDS — las órdenes de plataforma no aparecen en cocina | P1 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Tipo de orden en creación | Mesa / Para llevar / Domicilio / Recoger como tipos | Flujos, impresiones y precios distintos por tipo | No | P1 — blocker funcional | P1 |
| Badge en toolbar para delivery | Número de órdenes de delivery pendientes visible desde el POS | El cajero no necesita ir al módulo de delivery para saber que llegó algo | No | P1 | P1 |
| Módulo de repartidores | Asignación de repartidores propios, billete/cambio por repartidor | Domicilio propio con trazabilidad financiera | No (AMALAY no tiene delivery propio) | P3 | Post PMF |
| Menus distintos por plataforma | Platillos disponibles según plataforma (Rappi vs UberEats vs mesa) | Menú diferenciado sin duplicar catálogo | No | P2 | P2 |
| Marcas virtuales | Un restaurante opera como múltiples marcas en apps de delivery | Maximizar revenue con una sola cocina | No | P3 | Post PMF |
| Pedidos programados (FechaEntrega) | Orden para el jueves a las 7pm capturada hoy | Eventos y catering sin flujo manual | No | P3 | Post PMF |

---

## 9. CANCELACIONES

### Estado actual

**Cancelación de ítem:** Funciona correctamente y es el flujo más sólido del POS.
1. Requiere PIN o huella de gerente/admin
2. Pregunta si se preparó (merma / devolución / error operativo)
3. Imprime aviso en la impresora del routing original del ítem
4. Escribe audit log con quien autorizó y la razón
5. Publica evento al event store

**Anulación de orden completa:** Similar. Requiere PIN/huella gerente. Revierte inventario de ítems enviados. OCC para evitar conflictos concurrentes.

**Post-pago:** No existe ningún mecanismo para cancelar o revertir una orden que ya fue cobrada (`cerrada`). Una vez cerrada, es inmutable desde el POS.

**Delivery:** No hay cancelación posible desde el módulo de delivery. Las cancelaciones de plataformas son estados read-only.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| CX-01 | No hay cancelación post-pago — ni para gerentes | P1 |
| CX-02 | No hay cancelación desde el módulo de delivery | P2 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| Catalogo de razones predefinidas | Lista configurable de razones de cancelación (no texto libre) | Estandariza las razones para reportes de calidad | Parcial (texto libre) | Agregar catálogo | P2 |
| Cancelar ventas de días anteriores | Configurable OFF/ON | Revertir cobros con error del día anterior | No | P2 — solo con permisos | P2 |
| Reporte de cancelaciones por razón | Análisis de qué se cancela y por qué | KPI de calidad de cocina | Audit log existe pero no hay reporte | P2 | P2 |

---

## 10. REIMPRESIONES

### Estado actual

**Ticket de cuenta:** Existe botón de reimpresión en el POS activo. Requiere que el mesero tenga la orden seleccionada. Desde el historial también se puede reimprimir el ticket de cualquier día. Funciona bien.

**Comanda de cocina:** No existe reimpresión de comanda desde ninguna pantalla de cocina. Si una comanda se pierde (atasque de papel, impresora offline al momento de enviar), la cocina no tiene forma de recuperarla sin que el mesero haga algo desde el POS. Y desde el POS tampoco hay un botón explícito de "reimprimir comanda" — solo "Enviar" que enviaría ítems nuevos.

**Factura CFDI:** Existe en `/pos/facturacion` via la lista de solicitudes. PDF disponible cuando está emitida.

**Voucher bancario:** No existe.

**Corte:** No existe reimpresión de cortes históricos.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| R-01 | No hay reimpresión de comanda desde cocina — blocker en caso de error de impresora | P0 |
| R-02 | No hay reimpresión de voucher bancario desde el POS | P2 |
| R-03 | No hay reimpresión de cortes anteriores | P2 |

---

## 11. OFFLINE

### Estado actual

**Funcionamiento offline:** Bueno. IndexedDB respalda menú, órdenes, inventario. Las operaciones se queuen. Al reconectar, `syncAll()` replaya la cola. `OfflineIndicator` muestra el estado.

**KDS offline:** `cocina` y `barra` muestran banner offline. `kds/page.tsx` no muestra nada — el chef no sabe si está viendo datos en caché.

**Stale write conflicts:** Si dos terminales modifican la misma orden offline y luego sincronizan, uno de los dos terminará con `STALE_WRITE_CONFLICT`. Este ítem queda en la cola con `conflict: true`. No hay UI de resolución — el gerente no sabe qué pasó sin ir al monitor y ver el contador.

**"Limpiar cola":** Aparece cuando hay >5 ítems pendientes. No tiene diálogo de confirmación. Borrar la cola elimina operaciones sin sincronizar permanentemente.

**Boot offline:** La Electron app carga desde la URL de Vercel. Si no hay internet al iniciar, la app no puede arrancar. Esto es un bloqueante de nivel P0 para el deploy físico.

**Monitor vs IndexedDB:** El monitor de sync lee desde `localStorage.pos_offline_queue`. La sync queue real está en IndexedDB via `pos-offline-db`. Si la queue tiene datos en IDB pero nada en localStorage, el monitor reporta 0 pendientes cuando en realidad hay operaciones sin sincronizar.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| OF-01 | Boot offline no funciona — Electron carga desde Vercel URL | P0 |
| OF-02 | Monitor lee localStorage, sync queue real está en IDB — reporta datos incorrectos | P1 |
| OF-03 | No hay UI de resolución para stale write conflicts | P1 |
| OF-04 | "Limpiar cola" sin confirmación, threshold bajo (5 ítems) | P1 |
| OF-05 | KDS no muestra indicador offline | P2 |

---

## 12. RECUPERACIÓN DESPUÉS DE SINCRONIZAR

### Estado actual

La recuperación es automática: `window.addEventListener('online', goOnline)` → `syncAll()`. No requiere acción del usuario.

Cada ítem en la cola tiene clasificación de error: `TRANSIENT_RETRYABLE` (reintenta), `STALE_WRITE_CONFLICT` (terminal, requiere intervención), `TERMINAL_NON_RETRYABLE` (malformado, no puede recuperarse).

El problema es post-sincronización: `STALE_WRITE_CONFLICT` se queda en la cola con `conflict: true` y no hay UI para que el gerente decida qué hacer. El monitor muestra el conteo total pero no qué operaciones están en conflicto.

**El corte** falla silenciosamente si no hay internet cuando se consulta — no hay fallback a IDB. La pantalla muestra ceros sin mensaje de error.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| S-01 | No hay UI de resolución de conflictos de sincronización | P1 |
| S-02 | Corte falla silenciosamente offline — zeros sin error visible | P1 |

---

## 13. CIERRE DE TURNO

### Estado actual

`CierreCajaWizard`:
1. Verifica sync queue — bloquea si hay pendientes retryables
2. Pide conteo de efectivo (total, sin denominaciones)
3. Calcula diferencia vs `efectivoEsperado` — verde/ámbar/rojo visual pero nunca bloquea
4. Pide PIN de gerente para confirmar
5. Escribe `pos_cierres` y cierra `pos_turnos`

**El gap más importante:** `efectivoEsperado = fondoInicial + efectivoVentas + depositos - retiros`. No incluye propinas. El corte (`/pos/corte`) sí incluye propinas en la fórmula de arqueo con la misma lógica de Wansoft (propinas de tarjeta restan del efectivo esperado). Las dos pantallas del mismo sistema usan fórmulas distintas.

**Órdenes abiertas:** No se verifica si hay órdenes con `status != 'cerrada'` al momento del cierre. Un cierre puede dejar órdenes "vivas" con `turno_id` apuntando a un turno cerrado.

**Failure parcial:** Si `pos_cierres` se guarda pero `pos_turnos.closed_at` falla, queda en estado inconsistente. El sistema muestra el error específico pero no hay retry automático ni rollback.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| CT-01 | `efectivoEsperado` en wizard excluye propinas — fórmula distinta a corte | P1 |
| CT-02 | Cierre no verifica órdenes abiertas — pueden quedar huérfanas | P0 |
| CT-03 | Sin denominaciones en conteo de efectivo | P2 |

### Wansoft vs Fullsite

| Capacidad | Qué hace Wansoft | Problema que resuelve | Fullsite | Implementar? | Prioridad |
|---|---|---|---|---|---|
| 5 tipos de corte | X (parcial), Turno, Z, Global, Mesero | Flexibilidad para distintas necesidades de cierre | Parcial (X y Turno) | Agregar Mesero | P2 |
| Corte de mesero | Liquidación por mesero: ventas, propinas, lo que debe devolver | Cierre de caja completo con transparencia para el mesero | No | P1 | P1 |
| Arqueo por forma de pago | No solo efectivo — concilia CADA método de pago | Detecta descuadres de Rappi, UberEats, Getnet por separado | Parcial (corte tiene desglose) | Agregar a wizard | P2 |
| Registro de intentos de corte | Cada intento (exitoso o no) se registra con el monto declarado | Detecta si alguien intenta cuadrar declarando montos falsos | No | P2 | P2 |
| Envío del corte por email | El corte Z se envía automáticamente al gerente/dueño | El dueño sabe el resultado aunque no esté presente | No | P1 | P1 |

---

## 14. CORTES (X / Z)

### Estado actual

El corte en `/pos/corte` es la parte más completa del sistema:
- Dos modos: por turno activo o por día calendario
- Desglose financiero completo: subtotal, IVA, descuentos, propinas, métodos de pago
- Ventas por mesero con propinas
- Fórmula de arqueo correcta (incluye propinas como Wansoft)
- Lista de órdenes cerradas con opción de reapertura (con PIN de gerente)
- CSV export

**El problema: falla silenciosamente offline.** Si Supabase es inaccesible, `getOrders()` retorna `[]` y el corte muestra todos los KPIs en cero sin mensaje de error. Un cajero que intenta cerrar durante una falla de red no sabrá si realmente vendió $0 o si hay un problema de conectividad.

### Gaps críticos

| ID | Gap | Severidad |
|---|---|---|
| CR-01 | Corte offline muestra zeros sin mensaje de error — cajero no puede distinguir error de verdad | P1 |
| CR-02 | No hay reimpresión de cortes anteriores | P2 |
| CR-03 | Sin corte global (consolidación de múltiples terminales) | P3 |

---

## Resumen de todos los gaps — Priorización

### P0 — Bloqueantes para producción

| ID | Gap | Área |
|---|---|---|
| T-02 | Cierre de turno sin verificar órdenes abiertas | Turno |
| CT-02 | Cierre de turno sin verificar órdenes abiertas | Cierre |
| K-01 | No hay reimpresión de comanda desde cocina | KDS |
| F-01 | CSD Facturama vence 2026-08-03 | Facturación |
| OF-01 | Boot offline no funciona (Electron carga desde Vercel) | Offline |
| R-01 | No hay reimpresión de comanda (gap de kitche operacional) | Reprints |

### P1 — Afectan la operación diaria

| ID | Gap | Área |
|---|---|---|
| L-01 | WebAuthn enrollado pero nunca usado para login | Auth |
| L-02 | Session restore skips concurrent terminal check | Auth |
| T-01 | Dos implementaciones de apertura de turno | Turno |
| T-03 | StaffShiftPanel guarda PIN como staff_id (corrupción de datos) | Turno |
| M-01 | No hay guard de turno en selección de mesa | Mesa |
| M-02 | `/pos` sin params carga mesa 1 por defecto | Mesa |
| M-03 | No existe tipo de orden (llevar, domicilio, mesa) | Mesa |
| O-01 | Cache bypasea guard "enviar antes de cobrar" | Orden |
| K-02 | KDS/Barra no son batch-aware | KDS |
| K-03 | Lógica de ruteo duplicada y divergente | KDS |
| K-04 | Estado de ítems en cocina en localStorage (no cross-device) | KDS |
| K-05 | Auto-archivo divergente entre cocina y kds | KDS |
| C-02 | Sin guard de monto en pago con tarjeta | Cobro |
| C-03 | Propinas excluidas del efectivoEsperado en wizard | Cobro |
| F-02 | Sin linkage order_id en factura | Facturación |
| F-03 | Monto de factura es manual | Facturación |
| F-04 | createCFDIRequest sin retry offline | Facturación |
| D-01 | No existe flujo de pickup | Delivery |
| D-02 | No hay alerta en POS principal para delivery | Delivery |
| D-04 | Delivery no integrado al KDS | Delivery |
| CX-01 | No hay cancelación post-pago | Cancelaciones |
| OF-02 | Monitor lee localStorage, queue real en IDB | Offline |
| OF-03 | Sin UI de resolución de stale write conflicts | Offline |
| OF-04 | Limpiar cola sin confirmación | Offline |
| S-01 | Sin UI de resolución de conflictos post-sync | Sync |
| S-02 | Corte falla silenciosamente offline | Sync |
| CT-01 | fórmula efectivoEsperado excluye propinas en wizard | Cierre |
| CR-01 | Corte muestra zeros sin error cuando offline | Corte |

### P2 — Calidad y completitud

| ID | Gap |
|---|---|
| L-03 | Lockout resetea en reload |
| L-04 | KDS paths bypasean auth |
| T-04 | capitan bloqueado en turno stale |
| M-04 | Identidad de staff no verificada en ruta de mesas |
| O-02 | Sin validación de mesero/personas |
| O-03 | Dos sistemas de modificadores sin documentación |
| O-04 | Draft TTL 30 min — puede perderse antes de enviar |
| K-06 | KDS sin indicador offline |
| K-07 | Barra sin estado por ítem |
| K-08 | KitchenTimer mide tiempo de mesa no de cocina |
| C-01 | Cambio no guardado en la orden |
| C-04 | Sin denominaciones en conteo de cierre |
| F-05 | Sin límite temporal para solicitar factura |
| D-03 | Sin realtime con plataformas delivery |
| CX-02 | Sin cancelación desde delivery |
| R-02 | Sin reimpresión de voucher bancario |
| R-03 | Sin reimpresión de cortes históricos |
| CT-03 | Sin denominaciones en conteo de wizard |
| CR-02 | Sin reimpresión de cortes anteriores |

---

## Análisis Wansoft — Capacidades que un restaurante esperaría

### Tier 1 — Deben estar antes de expandir a más clientes

| Capacidad Wansoft | Problema que resuelve | Fullsite hoy | Recomendación |
|---|---|---|---|
| Tipo de orden (mesa/llevar/domicilio/recoger) | Flujos distintos, precios distintos, tracking distinto por tipo | No existe | Implementar en la creación de orden como campo obligatorio |
| Badge de delivery en toolbar | El cajero nunca pierde una orden de plataforma | No existe | Contador en el sidebar con polling |
| Corte de mesero | Liquidación transparente para el staff | No existe | Agregar al módulo de corte |
| Envío de corte por email | El dueño sabe el resultado de cada turno aunque no esté | No existe | Supabase Edge Function al cerrar turno |
| Comanda reprint desde cocina | Recuperarse de fallas de impresora sin depender del mesero | No existe | Botón "reimprimir" en KDS/cocina con bridge |

### Tier 2 — Mejoran operación pero no son bloqueantes

| Capacidad Wansoft | Problema que resuelve | Fullsite hoy | Recomendación |
|---|---|---|---|
| Botón "Auto" en cobro | Velocidad en hora pico | No existe | Un botón que llena el campo con el total restante |
| Propinas sugeridas en preticket | Sube el promedio de propina sin pedirle nada al cajero | No existe | Campo en config de ticket + cálculo al imprimir |
| Intentos de corte Z registrados | Detecta fraude de cajero que declara montos falsos | No existe | Tabla de intentos vs cierre exitoso |
| Precios por tipo de orden (TipoPrecio) | Delivery a precio diferente que mesa | No existe | Campo de precio alternativo en el catálogo |
| Menus por plataforma de delivery | Catálogo diferente en Rappi vs UberEats vs mesa | No existe | Campo de plataforma en la disponibilidad del ítem |
| Reporte de conciliación ventas vs facturas | Cierre fiscal mensual | No existe | Vista de monto vendido vs monto facturado |
| Escalation in-place para permisos | Gerente autoriza sin cerrar sesión del cajero | Parcial — cancela con PIN pero es modal separado | Mejorar UX del flujo de autorización |

### Tier 3 — Post-PMF / segundo cliente

| Capacidad Wansoft | Recomendación |
|---|---|
| CxC (Cuentas por Cobrar) | Después de PMF |
| Anticipos para eventos | Post PMF |
| Módulo de repartidores propios | Solo si cliente tiene delivery propio |
| Marcas virtuales | Post PMF |
| CashDro (maquina contadora) | Hardware opcional post PMF |
| Segundo visor cliente | Hardware opcional |

---

## Dónde se rompe el flujo canónico — Mapa visual

```
Usuario → Turno → Mesa → Orden → Cocina → Cobro → Cierre

   ↑           ↑         ↑         ↑          ↑        ↑
   
[L-02]     [T-01]    [M-01]    [O-01]     [K-01]   [CT-02]
Session    2 impls   Sin       Cache      Sin      Cierre sin
restore    de open   guard     bypasea    reprint  verificar
skips      turno     turno     guard      comanda  ordenes
conflict                       send               abiertas
check
                   [M-03]               [C-03]   [CT-01]
                   Sin tipo             Propinas  Propinas
                   de orden             fuera de  fuera de
                               [K-02]   arqueo    arqueo
                   [M-02]     KDS no
                   /pos sin   batch
                   params →   aware
                   mesa 1
```

Los cortes más graves son los que dejan al sistema en estado inconsistente:
- **T-02 / CT-02**: Turno cerrado + órdenes abiertas → `turno_id` huérfano, sin path de reconciliación
- **O-01**: Cache bypasea guard → pago sin envío real a cocina → ítem nunca preparado pero cobrado
- **OF-02**: Monitor muestra 0 pendientes cuando IDB tiene operaciones → supervisor tiene falsa sensación de seguridad

---

## Recomendaciones de acción — Orden sugerido

### Sprint inmediato (antes del siguiente turno en producción)
1. **OPS-01 en Gap Tracker** — Renovar CSD Facturama (acción de Daniel, no código)
2. **CT-02** — Agregar verificación de órdenes abiertas antes de permitir cierre de turno
3. **K-01** — Implementar reprint de comanda desde KDS/cocina

### Sprint 1 (antes de expandir a segundo restaurante)
4. **M-03** — Tipo de orden (mesa / para llevar / domicilio / recoger) en creación
5. **T-03** — Fix StaffShiftPanel: guardar `staff.id` en lugar del PIN
6. **C-03** — Corregir fórmula `efectivoEsperado` incluyendo propinas en CierreCajaWizard
7. **OF-02** — Corregir monitor para leer de IndexedDB en lugar de localStorage
8. **S-02** — Agregar fallback a IDB en corte cuando Supabase falla offline
9. **D-01/D-02** — Badge de delivery en sidebar + tipo de orden para llevar

### Sprint 2 (calidad antes de onboarding masivo)
10. Corte de mesero (liquidación por turno)
11. Envío de corte por email al gerente
12. Linkage `order_id` en facturas CFDI
13. Reimpresión de cortes anteriores
14. UI de resolución de stale write conflicts
15. Botón "Auto" en cobro

---

_Fuentes verificadas: 14 archivos de código leídos directamente | WANSOFT-POS-BIBLE.md | CAJA-SPEC.md | DATA-MODEL.md | WANSOFT-BIBLE.md_
_Este documento reemplaza cualquier análisis previo sobre el flujo del POS._
_Próxima revisión: después de cerrar los gaps P0 del sprint inmediato._
