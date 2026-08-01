# POS V2 SPEC — Especificación Canónica del Sistema de Órdenes
> Versión: 2.1 — 2026-07-23
> Estado: **ARCHITECTURE FREEZE** — modelo congelado. Todo cambio al modelo de datos, ownership boundaries o catálogo de eventos requiere un RFC aprobado por Daniel antes de modificar esta spec.
> Propósito: Contrato de diseño que define qué debe ser el POS, no qué es hoy.
> Todo gap entre esta spec y el código actual es una deuda técnica documentada.
> Cambios v1→v2: C01 C02 C03 C04 C05 C07 C08 C09 G1 G2 G3 G4 — ver referencias por sección.

---

## Principios de diseño

1. **La Mesa es un atributo operativo de la Orden, no su identidad.** [C02] Mesa es un campo que aplica cuando `tipo=mesa`. La navegación del mesero sigue centrada en el mapa de mesas; lo que cambia es que la identidad canónica es la Orden (UUID), no el número de mesa. El restaurante piensa en mesas — el sistema también, pero la mesa no es la raíz.

2. **Cada paso del flujo requiere el anterior.** No se puede estar en el paso N sin haber completado el N-1. El sistema enforcea esto — no solo advierte.

3. **La identidad del operador es condición de toda acción.** Ninguna mutación al sistema puede ocurrir sin `staff_id` verificado. No hay mutaciones anónimas.

4. **El turno es la unidad de accountability financiero.** Toda orden lleva `turno_id`. Sin turno activo, el sistema no permite crear órdenes — punto.

5. **Offline no degrada la experiencia — la preserva.** La operación continúa sin internet. La sincronización es posterior y verificable.

6. **Un error jamás silencia información.** Un fallo técnico siempre muestra al operador qué falló, qué datos pueden haberse perdido, y qué hacer.

---

## Flujo obligatorio

```
[1] Auth   → Usuario identificado con huella o PIN
[2] Turno  → Turno activo verificado
[3] Orden  → Tipo elegido + ítems capturados  ← tipo es el primer campo al crear, no un paso separado
[4] Cocina → Comanda enviada y recibida
[5] Cobro  → Pago registrado
[6] Cierre → Turno cerrado con arqueo
```

[C01] El tipo de orden es el **primer campo obligatorio al crear una orden**, no un paso entre Turno y Orden.
No hay estado de "orden sin tipo" — la selección del tipo abre el formulario de creación.
Cada flecha es un guard. Si el guard no pasa, el sistema bloquea con un mensaje específico. No hay bypass.

---

## Entidades del dominio

### 1. Staff (usuario operativo)

```typescript
interface Staff {
  id: string            // UUID
  client_id: string     // tenant
  name: string          // nombre visible
  role: StaffRole       // ver jerarquía
  pin_hash: string      // hash del PIN, nunca el PIN en texto
  fingerprint_id?: string   // ID del HID DigitalPersona
  active: boolean
}

type StaffRole = 'admin' | 'gerente' | 'cajero' | 'capitan' | 'mesero'

// Jerarquía de permisos (ascendente):
// mesero < cajero < capitan < gerente < admin
// Un rol con nivel N tiene todos los permisos de niveles < N
```

### 2. Turno

```typescript
interface Turno {
  id: string            // UUID
  client_id: string     // tenant
  terminal_id: string   // identificador de la terminal
  abierto_por: string   // staff.name de quien abrió
  fondo_inicial: number // efectivo declarado al abrir
  opened_at: string     // timestamp ISO
  closed_at?: string    // null si activo
  closed_by?: string    // staff.name de quien cerró
  fondo_final?: number  // efectivo contado al cierre
  efectivo_sistema?: number  // calculado por el sistema
  diferencia?: number   // fondo_final - efectivo_sistema
  status: 'activo' | 'cerrado'
}
```

**Invariantes del turno:**
- Solo puede haber un turno `activo` por terminal en cualquier momento [HECHO — verificado via `pos_sessions`]
- Un turno NO puede cerrarse con órdenes abiertas sin escalation de gerente [C03 — GUARD-08 es soft block; ver sección Guards]
- El cierre requiere PIN de `gerente` o `admin`
- La duración máxima de un turno es 18 horas (alerta) / configurable

### 3. Orden — entidad raíz

```typescript
interface Order {
  id: string            // UUID generado cliente, persistido en DB
  client_id: string     // tenant
  turno_id: string      // FK a pos_turnos — NUNCA null
  save_operation_id: string  // idempotency key — generado al crear
  
  // Identidad de la orden
  tipo: OrderType       // OBLIGATORIO — ver tipos abajo
  status: OrderStatus   // ver máquina de estados

  // Contexto operativo [C05]
  mesero_id: string     // UUID del staff mesero responsable (para reporting, corte y liquidación)
  mesero_nombre: string // snapshot del nombre en el momento de venta (para display e historial)
  staff_id?: string     // UUID del staff logueado al crear — puede diferir de mesero_id cuando el cajero captura en nombre de un mesero
  terminal_id: string   // terminal donde se creó

  // Campos tipo-específicos (ver reglas por tipo)
  mesa?: number         // solo tipo='mesa'
  cliente_nombre?: string   // obligatorio para llevar/recoger/domicilio
  cliente_telefono?: string // obligatorio para domicilio propio
  personas?: number     // solo tipo='mesa', mínimo 1
  fecha_entrega?: string    // obligatorio para tipo='recoger'
  delivery_platform?: DeliveryPlatform  // para tipo='domicilio'

  // Contenido
  items: OrderItem[]    // JSONB en DB
  comanda_batches: Record<string, string[]>  // batch_id → [item_ids]
  kds_item_status?: Record<string, KDSStatus>  // solo KDS escribe aquí

  // Control de concurrencia
  order_revision: number     // OCC — incrementa en cada save exitoso
  expected_revision: number  // enviado por el cliente, verificado por el RPC

  // Propósito financiero — no modifica el canal operativo [G3]
  order_purpose: OrderPurpose  // default: 'venta'
  staff_beneficiario_id?: string    // solo consumo_interno: UUID del empleado que recibe
  staff_beneficiario_nombre?: string // snapshot del nombre
  purpose_razon?: string            // obligatorio para consumo_interno y cortesia

  // Financiero
  subtotal: number
  iva: number
  total: number
  descuento?: number
  propina?: number
  metodo_pago?: string
  pagos?: PaymentLeg[]  // para pago mixto

  // CFDI
  cfdi_request_id?: string  // FK a pos_cfdi_requests si se emitió factura

  // Audit
  created_at: string
  closed_at?: string
  last_inventory_processed_revision?: number
  last_inventory_complete_revision?: number
  inventory_status?: 'COMPLETE' | 'BLOCKED' | 'PENDING' | 'SKIPPED'
}

type OrderType = 'mesa' | 'llevar' | 'recoger' | 'domicilio'
// [C06] Los 4 tipos son distintos y se mantienen. llevar vs recoger difieren operativamente:
// llevar = cliente espera ahora. recoger = cliente llega en el futuro (requiere fecha_entrega).
// El KDS los trata diferente. El ticket y la comanda los muestran diferente.

type OrderPurpose = 'venta' | 'consumo_interno' | 'cortesia'
// [G3] Describe el propósito financiero, no el canal operativo.
// consumo_interno: comida de personal — deduce inventario, excluida de ventas comerciales.
// cortesia: cortesía al cliente — deduce inventario, cuenta como gasto de marketing.
// Antes de fijar el flujo de captura, confirmar cómo registra AMALAY estos casos hoy.

type DeliveryPlatform = 'rappi' | 'ubereats' | 'propio'
```

### 4. Máquina de estados de la Orden

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
[BORRADOR]          │   solo en localStorage, nunca en DB     │
    │               └─────────────────────────────────────────┘
    │ Enviar a cocina (guard: turno activo + ítems > 0 + mesero)
    ↓
[ENVIADA]           en DB — al menos un batch enviado a cocina
    │
    │ KDS: cocina empieza a preparar
    ↓
[PREPARANDO]        kitchen screen avanza el estado
    │
    │ KDS: cocina termina
    ↓
[LISTA]             lista para servir — notificación al mesero
    │
    │ Mesero confirma entrega (opcional, puede skipearse)
    ↓
[ENTREGADA]         servida en mesa — no bloquea el pago
    │
    │ Cobro completado (guard: total cobrado >= total con propina)
    ↓
[CERRADA]           terminal — no editable salvo gerente

Transiciones de cancelación (solo hacia adelante en el tiempo):
[ENVIADA | PREPARANDO | LISTA | ENTREGADA] → [CANCELADA]
  guard: PIN gerente o admin
  acción: reversa de inventario para ítems preparados

[ENVIADA] → [CANCELADA]
  guard: mesero mismo (sin escalation, antes de que cocina empiece)
  acción: sin reversa de inventario

[CERRADA] → [ENVIADA]  (REOPEN)
  guard: PIN gerente
  acción: limpia closed_at, metodo_pago. NO revierte inventario.
  riesgo: documentado — puede causar doble deducción en reconciliación
```

**Invariantes de la máquina de estados:**
- Los estados solo avanzan — nunca retroceden (excepción: REOPEN por gerente)
- `CERRADA` es terminal salvo REOPEN
- `CANCELADA` es terminal — no hay descancelación
- El sistema NO puede registrar un pago si el status es `CANCELADA`
- `BORRADOR` nunca existe en la base de datos

### 5. OrderItem

```typescript
interface OrderItem {
  id: string            // UUID local
  product_id: string    // FK a pos_menu
  name: string          // nombre en el momento de venta (snapshot)
  quantity: number      // > 0
  unit_price: number    // precio en el momento de venta (snapshot)
  modifiers: Modifier[]
  notes?: string
  silla?: number        // para split de cuenta por silla
  station: KitchenStation   // destino de comanda
  comanda_batch_id: string  // a qué tiempo pertenece
  sent: boolean         // fue enviado a cocina al menos una vez
  cancelled: boolean    // fue cancelado
  voided: boolean       // fue anulado (error operativo, no afecta métricas)
  cancel_reason?: string
  cancel_approved_by?: string
  cancel_timestamp?: string
}

type KitchenStation = 'cocina' | 'barra' | 'caja'

interface Modifier {
  group_id: string
  group_name: string
  option_id: string
  option_name: string
  price_delta: number   // 0 si sin costo
}
```

---

## Reglas por tipo de orden

### tipo = 'mesa'

| Campo | Requerido | Regla |
|---|---|---|
| `mesa` | Sí | Número entero 1–999 |
| `personas` | Sí | Mínimo 1 |
| `mesero` | Sí | De la lista de staff activos |
| `cliente_nombre` | No | Opcional |
| `fecha_entrega` | No | N/A |

**Comportamiento específico:**
- El mapa de mesas solo muestra órdenes con `tipo='mesa'`
- Split de cuenta por silla solo aplica a `tipo='mesa'`
- Al completar el pago, la mesa queda disponible inmediatamente (ningún estado de "limpieza")
- El ticket impreso muestra: "Mesa N" en el header

### tipo = 'llevar'

| Campo | Requerido | Regla |
|---|---|---|
| `mesa` | No | Siempre null |
| `cliente_nombre` | Sí | Texto libre, mínimo 2 caracteres |
| `personas` | No | N/A |
| `fecha_entrega` | No | Si se especifica, activa alerta a esa hora |

**Comportamiento específico:**
- El ticket impreso muestra: "PARA LLEVAR — [cliente_nombre]" como header prominente
- La lista de pedidos para llevar es una vista separada del mapa de mesas
- La comanda imprime el nombre del cliente en letras grandes para identificar la bolsa
- Si la orden lleva más de 30 minutos en `lista` sin ser cobrada, el POS emite alerta visual

### tipo = 'recoger'

| Campo | Requerido | Regla |
|---|---|---|
| `mesa` | No | Siempre null |
| `cliente_nombre` | Sí | |
| `cliente_telefono` | Recomendado | Para notificar cuando esté lista |
| `fecha_entrega` | Sí | Timestamp de cuándo va a recoger el cliente |

**Comportamiento específico:**
- La orden puede crearse con horas o días de anticipación
- El POS emite alerta 15 minutos antes de `fecha_entrega`
- Las órdenes de recoger futuras no aparecen en el KDS hasta N minutos antes (configurable por tipo de producto)
- El ticket y la comanda muestran prominentemente la hora de recogida

### tipo = 'domicilio'

**Sub-tipo A: Plataforma (Rappi, UberEats)**

| Campo | Requerido | Regla |
|---|---|---|
| `cliente_nombre` | Sí | Viene de la plataforma |
| `delivery_platform` | Sí | `rappi` | `ubereats` |
| `mesa` | No | Null |

- Las órdenes de plataforma se crean automáticamente vía webhook/scraper — no por el cajero
- El POS solo avanza el estado de preparación (nueva → preparando → lista)
- El módulo de delivery muestra estas órdenes separadas del POS principal
- Un badge en el sidebar muestra el conteo de órdenes pendientes de plataformas
- Las órdenes de plataforma SÍ aparecen en el KDS, bajo la estación correspondiente, con badge de la plataforma

**Sub-tipo B: Domicilio propio (AMALAY no usa — futuro)**

| Campo | Requerido | Regla |
|---|---|---|
| `cliente_nombre` | Sí | |
| `cliente_telefono` | Sí | |
| `direccion` | Sí | Texto libre |
| `delivery_platform` | Sí | `propio` |

---

## Matriz de permisos

Jerarquía: `mesero` < `cajero` < `capitan` < `gerente` < `admin`

| Acción | mesero | cajero | capitan | gerente | admin |
|---|---|---|---|---|---|
| Ver mapa de mesas / listas | ✓ | ✓ | ✓ | ✓ | ✓ |
| Crear orden (cualquier tipo) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agregar ítems a orden propia | ✓ | ✓ | ✓ | ✓ | ✓ |
| Enviar a cocina | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cancelar ítem propio pre-cocina | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Cancelar ítem post-cocina** | escalation | escalation | ✓ | ✓ | ✓ |
| **Anular ítem (error operativo)** | — | escalation | ✓ | ✓ | ✓ |
| **Anular orden completa** | — | — | — | ✓ | ✓ |
| Cobrar (cerrar cuenta) | — | ✓ | ✓ | ✓ | ✓ |
| Aplicar descuento del catálogo | — | — | ✓ | ✓ | ✓ |
| Aplicar descuento % libre | — | — | — | ✓ | ✓ |
| Aplicar cortesía | — | — | — | ✓ | ✓ |
| Transferir ítem entre órdenes | — | — | ✓ | ✓ | ✓ |
| Transferir mesa (toda la orden) | — | ✓ | ✓ | ✓ | ✓ |
| Reabrir orden cerrada | — | — | — | ✓ | ✓ |
| Abrir turno | — | ✓ | — | ✓ | ✓ |
| Corte X (parcial) | — | ✓ | — | ✓ | ✓ |
| Cierre de turno (cierre Z) | — | ✓ | — | ✓ | ✓ |
| Ver corte de turno | — | ✓ | — | ✓ | ✓ |
| Abrir cajón manualmente | — | ✓ | — | ✓ | ✓ |
| Ver monitor de sistema | — | ✓ | — | ✓ | ✓ |
| Gestionar catálogo | — | — | — | — | ✓ |
| Gestionar staff | — | — | — | — | ✓ |

**Regla de escalation in-place:**
Cuando un mesero o cajero intenta una acción que requiere un nivel superior, el sistema muestra en pantalla un campo de PIN. El gerente escribe su PIN SIN cerrar la sesión del mesero. La acción se registra con: `actor: [mesero]`, `approved_by: [gerente]`, `timestamp`, `reason`. El mesero no ve el PIN del gerente.

**Limitación conocida:** La escalation in-place asume que el gerente está físicamente presente en la terminal.

**Diseño futuro V3 — Autorización remota [C08]:**
El mesero toca "Solicitar autorización remota" → el gerente recibe una notificación push en su dispositivo con el detalle de la acción solicitada → aprueba remotamente → la terminal del mesero se desbloquea. La arquitectura existente (Supabase Realtime + push notifications) soporta este flujo sin cambios fundamentales. Esto es un diferenciador respecto a Wansoft. No implementar en V2; documentar aquí para que el diseño de V2 no lo impida.

---

## Guards — lo que nunca puede saltarse

Los guards son verificaciones que el sistema ejecuta antes de permitir avanzar al siguiente paso. Son invariantes del negocio, no validaciones de UX.

```
GUARD-01: AUTH
  Condición: staff identificado (PIN o huella verificada contra DB)
  Aplica a: toda acción en el POS
  Error si falla: redirect a pantalla de login
  No hay bypass. No hay sesión "vacía".

GUARD-02: TURNO ACTIVO
  Condición: existe un turno con status='activo' en esta terminal
  Aplica a: crear orden, enviar a cocina, cobrar
  Error si falla: "No hay turno activo. [Nombre del rol con permiso] debe abrir el turno."
  El mesero espera en pantalla con polling. El cajero ve el formulario de apertura.
  Timing del check: en el momento de intentar crear la orden, NO después de capturar ítems.

GUARD-03: TIPO DE ORDEN OBLIGATORIO
  Condición: tipo in ('mesa', 'llevar', 'recoger', 'domicilio')
  Aplica a: creación de toda orden
  Error si falla: el flujo de creación no avanza hasta que se selecciona el tipo
  No hay tipo "default" — el usuario debe elegir explícitamente.

GUARD-04: CAMPOS REQUERIDOS POR TIPO
  Condición: ver tabla "Reglas por tipo de orden"
  Aplica a: primer envío a cocina (no al capturar ítems)
  Error si falla: modal con campo faltante específico

GUARD-05: ÍTEMS MÍNIMOS
  Condición: activeItems.length > 0
  Aplica a: enviar a cocina
  Error si falla: "Agrega al menos un platillo antes de enviar."

GUARD-06: ENVIAR ANTES DE COBRAR [C04 — corregido]
  Condición: loadedOrderId !== null AND sentItemIds.size > 0
  Aplica a: cobro
  Error si falla: "Envía la orden a cocina antes de cobrar."
  Implementación: si loadedOrderId (UUID confirmado por DB) existe → la orden está persitida.
    Si sentItemIds.size > 0 → hay ítems confirmados como enviados. No se requiere roundtrip a DB.
  Causa raíz que motivó este cambio: el cache pre-poblaba sentItemIds aunque la orden nunca
    llegara a DB. La corrección es que el cache NUNCA marque un ítem como sent=true
    si loadedOrderId es null. Con esa regla, la verificación local es suficiente y el guard
    no añade latencia al flujo de cobro.

GUARD-07: TOTAL COBRADO >= TOTAL
  Condición: suma de pagos aplicados >= total + propina
  Aplica a: confirmar cobro
  Error si falla: el botón de confirmar permanece deshabilitado (no toast)

GUARD-08: ÓRDENES ABIERTAS PARA CIERRE (SOFT BLOCK) [C03 — cambiado de hard block]
  Condición: no existen órdenes con status in ('enviada','preparando','lista','entregada') para este turno_id
  Aplica a: iniciar CierreCajaWizard
  Si la condición falla → SOFT BLOCK, no hard block:
    1. Muestra lista de órdenes abiertas: número de mesa/nombre cliente, status, total, mesero responsable
    2. Mensaje: "Hay N órdenes abiertas. Puedes cerrarlas primero o continuar con autorización de gerente."
    3. Opción A: volver al POS y cerrar las órdenes
    4. Opción B (solo gerente o admin): escalation in-place
       → PIN de gerente/admin en pantalla (sin cerrar sesión del cajero)
       → Segunda confirmación: "Vas a cerrar el turno con N órdenes abiertas. Quedarán registradas como pendientes."
       → Nota obligatoria (texto libre, mínimo 10 caracteres, ej. "Mesa 7 postre, esperan a Ramón")
       → Las órdenes abiertas se registran en pos_cierres.ordenes_pendientes (array de order_ids)
  Invariantes post-escalation:
    - Las órdenes huérfanas NUNCA desaparecen del mapa de mesas (la mesa sigue marcada como ocupada)
    - Las órdenes huérfanas siguen siendo accesibles desde historial y cobrables en el siguiente turno
    - Al abrir el siguiente turno: banner de alerta "El turno anterior cerró con N órdenes abiertas" + lista expandible
    - Las órdenes del turno anterior cobradas en el nuevo turno quedan referenciadas por su order_id original

GUARD-09: SYNC QUEUE VACÍA PARA CIERRE
  Condición: no hay items en sync_queue con error_class not in ('STALE_WRITE_CONFLICT', 'TERMINAL_NON_RETRYABLE')
  Aplica a: iniciar CierreCajaWizard
  Error si falla: "Hay N operaciones pendientes de sincronizar. Espera o revisa el monitor."

GUARD-10: PIN GERENTE PARA CIERRE
  Condición: PIN verificado contra DB, rol mínimo 'cajero' con permiso 'corte_z'
  Aplica a: confirmar CierreCajaWizard
  Error si falla: "PIN incorrecto o rol insuficiente."
```

---

## KDS — Especificación de cocina

### Principios
- El KDS es la pantalla de cocina. Las impresoras térmicas son el respaldo del KDS, no su reemplazo.
- Un ítem puede aparecer en múltiples estaciones si su routing así lo define.
- El KDS debe ser batch-aware: mostrar las rondas (tiempos) como unidades discretas, no mezclar ítems de distintos envíos.

### Estaciones
```typescript
type KitchenStation = 'cocina' | 'barra' | 'caja'
// 'caja' = market/retail — generalmente no aparece en KDS
```

### Routing de ítem a estación
Prioridad (aplicar en orden):
1. `item.station` — campo explícito guardado al agregar el ítem (fuente de verdad)
2. Lookup en `pos_menu.station` — configuración del catálogo
3. `isBeverage(item.name)` — keywords de bebida → 'barra'
4. Default: 'cocina'

Una sola implementación de esta lógica en `pos-constants.ts`. Ningún módulo duplica esta lógica.

### Ciclo de vida de un batch
```
mesero captura ítems → asigna comanda_batch_id → envía
KDS muestra el batch como una tarjeta separada
cocina marca ítems del batch como preparando → lista
cuando TODOS los ítems del batch están lista: el batch se considera completo
```

### Estados de ítem en KDS
```typescript
type KDSItemStatus = 'pendiente' | 'preparando' | 'listo'
```
- El KDS escribe a `pos_orders.kds_item_status` (JSONB: `{item_id: KDSItemStatus}`)
- El POS de ventas NUNCA escribe a `kds_item_status`
- `kds_item_status` se preserva entre recargas y entre terminales (sincronizado via Supabase)

### Reimpresión de comanda desde KDS
- Toda pantalla de cocina (cocina, barra, KDS) tiene un botón "Reimprimir" por tarjeta de orden
- La reimpresión envía la comanda del batch específico a la impresora de la estación correspondiente
- La comanda reimpresa lleva header "★ REIMPRESIÓN ★" y el timestamp original del envío
- No requiere PIN — es operación de cocina sin impacto financiero

### Auto-archivo
- Órdenes con más de 4 horas en `enviada` o `preparando` sin progreso: una sola implementación en el servidor (Edge Function o cron) las archiva como `entregada`.
- Ningún cliente aplica auto-archivo localmente. Un solo lugar escribe este estado.

### Timers
- Color: verde < 10 min, ámbar 10–20 min, rojo > 20 min (configurable por restaurante)
- El tiempo corre desde `created_at` de la orden (no desde el batch, no desde la pantalla de cocina)
- El avg. prep time se calcula como `lista_at - batch_created_at` — no `closed_at - created_at`

### Indicador offline en KDS
- Todas las pantallas de cocina muestran "Sin conexión — datos locales" cuando `navigator.onLine === false`
- El estado local es operable: las marcas de "preparando"/"listo" se queuan y sincronizan

---

## Cobro — Especificación de pago

### Flujo canónico de cobro
```
1. Mesero/cajero toca "Cobrar" → guard GUARD-06 verifica status en DB
2. Sistema muestra pantalla de cobro con: total, IVA, descuento, propina, saldo
3. Cajero selecciona tipo de propina (0/10/15/20% o monto libre)
4. Cajero selecciona método de pago:
   a. Efectivo → ingresa monto recibido → sistema calcula cambio
   b. Tarjeta → ingresa monto cobrado en terminal bancaria → confirma "Aprobado"
   c. Mixto → repite (a) o (b) hasta que saldo = 0
5. Al confirmar: saveOrder(status='cerrada'), drawer kick, print ticket
```

### Botón "Auto"
- En la pantalla de cobro, con un método seleccionado, el botón "Auto" llena el campo de monto con el saldo pendiente exacto.
- Elimina el paso de teclear el monto cuando la orden se paga íntegramente con un método.

### Fórmula de arqueo (única en todo el sistema)
```
efectivo_esperado =
  fondo_inicial
  + ventas_efectivo
  + propinas_efectivo
  + depositos_turno
  - retiros_turno
  - propinas_no_efectivo   // propinas de tarjeta que se pagan en efectivo al mesero
```

Esta misma fórmula aplica en `CierreCajaWizard` y en `/pos/corte`. No puede diverger.

### Cambio
- El monto de cambio entregado al cliente se guarda en la orden: `pos_orders.cambio_entregado`
- Permite reconstruir en disputas cuánto cambio se dio

### Registro de cobro
```typescript
interface PaymentLeg {
  method_id: string       // FK a pos_payment_methods
  method_name: string     // snapshot del nombre
  amount: number          // monto aplicado
  propina: number         // propina para este método (puede ser 0)
  received?: number       // solo para efectivo: monto físico recibido
  cambio?: number         // solo para efectivo: vuelto
  reference?: string      // número de autorización / voucher
}
```

### Pago mixto
- Se pueden combinar N métodos hasta que `sum(legs.amount + legs.propina) >= total + propina_total`
- El botón de confirmar se habilita solo cuando el saldo es ≤ 0.009 (tolerancia de redondeo)

### Split de cuenta [C07]

**Regla fundamental:** El split de cuenta es una operación **exclusivamente financiera**. Ocurre al momento de cobrar, no antes. El KDS **siempre opera sobre la orden original pre-split**. La cocina nunca conoce las cuentas hijas. El split no genera comandas nuevas ni cancela las existentes.

- Por ítems: hasta 6 cuentas, cada ítem asignado a una cuenta
- Parejo: N cuentas con el total dividido equitativamente (penny-rounding en la última)
- Cada cuenta hija es una `pos_orders` separada con ID `{orderId}-C{n}`, creada al momento de cobrar
- El inventario se deduce solo de la cuenta C1 (para llevar/parejo) o por cuenta (por ítems)
- Las cuentas hijas no aparecen en el KDS ni en la vista de mesas — son una ficción de cobro

### Preticket [G1 — P1]

El preticket es la cuenta impresa que el mesero lleva al cliente para revisión antes de cobrar. No cierra la cuenta, no cambia el status de la orden, no reenvía a cocina.

**Disponibilidad:** cualquier orden con `status in ('enviada', 'preparando', 'lista', 'entregada')`.

**Formato del ticket:**
- Header: "CUENTA — FAVOR DE REVISAR" (no "TICKET" ni "NOTA")
- Ítems con cantidad, nombre y precio
- Subtotal / IVA / Total
- Propinas sugeridas: 10% / 15% / 20% calculadas sobre el subtotal
- Identificador escaneable (QR) que contiene el `order_id` — al escanearlo desde el POS, navega directamente a la pantalla de cobro de esa orden, sin buscar en el mapa de mesas
- Timestamp de impresión

**Comportamiento:**
- No requiere PIN
- La orden sigue abierta después de imprimir el preticket
- Si el cliente quiere agregar algo: el mesero regresa al POS, agrega, vuelve a imprimir
- El cajero puede escanear el QR del preticket → navegación directa a cobro [G4]

**Pendiente de validación en campo:** confirmar exactamente cómo registra AMALAY la cuenta hoy (¿el mesero la lleva de memoria? ¿imprime algo de Wansoft?). El modelo de datos no espera esa confirmación.

---

## Retiros y Depósitos de Caja [G2]

**Estado en Fullsite:** `pos_cash_movements` **ya existe** en V1 y su inclusión en el arqueo fue corregida previamente.

**Acción requerida — RCA del flujo existente antes de cualquier cambio:**
Antes de diseñar o modificar cualquier cosa, auditar el estado actual de `pos_cash_movements`:
1. ¿Qué permisos requiere crear un retiro o depósito? (¿PIN de gerente obligatorio?)
2. ¿Requiere razón escrita? ¿Hay catálogo de razones predefinidas?
3. ¿Los movimientos se encolan en IDB cuando Supabase está offline?
4. ¿Se registran en el audit log?
5. ¿Existe opción de imprimir comprobante del movimiento?
6. ¿El movimiento abre el cajón de efectivo?
7. ¿Los campos `depositos_turno` y `retiros_turno` en la fórmula de arqueo se calculan desde esta tabla?

Solo documentar o corregir lo que el RCA revele como faltante. No rediseñar si el flujo existente es correcto.

---

## Consumo Interno y Cortesías [G3]

Las órdenes de consumo interno (comida de personal) y cortesías usan `order_purpose` para distinguirse de ventas comerciales, manteniendo los mismos 4 `OrderType`. El canal operativo no cambia; lo que cambia es el tratamiento financiero.

**Reglas para `order_purpose = 'consumo_interno'`:**
- Requiere `staff_beneficiario_id` (UUID del empleado) y `purpose_razon` (texto libre)
- Sí deduce inventario (el costo real de los ingredientes se registra en food cost)
- **No entra en ventas comerciales** — no suma a `ventas_efectivo`, `ventas_tarjeta` ni totales del turno
- Se muestra separado en el corte: línea "Consumo interno: $X (N órdenes)"
- Se incluye en food cost como costo real de ingredientes consumidos
- No genera CFDI
- Método de pago: "consumo_interno" — no afecta el arqueo de efectivo

**Reglas para `order_purpose = 'cortesia'`:**
- Requiere `purpose_razon` (texto libre, ej. "error de cocina", "cliente frecuente")
- Sí deduce inventario
- No entra en ventas comerciales
- Se muestra separado en el corte: línea "Cortesías: $X (N órdenes)"
- No genera CFDI
- Requiere PIN de gerente o admin para crear

**Pendiente de validación en campo:** confirmar cómo registra AMALAY la comida de personal hoy (¿cortesía 100%? ¿sin registro?). El modelo no espera esa confirmación.

---

## Routing de Órdenes [Decisión C02]

La navegación del mesero sigue centrada en mesas. El mapa continúa siendo el punto de entrada principal para `tipo=mesa`.

**Reglas de navegación:**
- **Mesa vacía:** tocar mesa → inicia creación de orden con `tipo=mesa` y `mesa=N` pre-seleccionados
- **Mesa ocupada:** tocar mesa → el sistema resuelve el `order_id` activo de esa mesa → navega a `/pos/o/{orderId}`
- **Entrada directa:** `/pos?mesa=N` sigue funcionando — si hay orden activa, redirige a `/pos/o/{orderId}`; si no, inicia creación
- **Identidad canónica:** toda orden existente se identifica por `/pos/o/{orderId}`, no por número de mesa
- **Para llevar / recoger / domicilio:** botones separados en la pantalla principal → selector de tipo → formulario de creación → `/pos/o/{orderId}` al guardar

**Compatibilidad:** todos los links `?mesa=N` existentes en tickets, QR, o code interno se resuelven correctamente con redirect.

---

## Cancelaciones — Especificación

### Cancelar ítem individual

```
Estado del ítem → Quién puede cancelar → Acción de inventario
pre-cocina (sent=false) → mesero mismo (sin escalation) → sin impacto
post-cocina (sent=true) → gerente PIN (escalation in-place) → pregunta si se preparó:
  "Sí, se preparó" → reversa de inventario (merma registrada)
  "No, no salió" → sin impacto de inventario
  "Error operativo" → anulado (no afecta métricas, sin reversa)
```

**Todo ítem cancelado requiere razón escrita.** No hay cancelación silenciosa.
La razón se elige de un catálogo predefinido + opción "Otro" con campo libre.

**Impresión de cancelación:**
La comanda de cancelación se imprime en la misma impresora/estación que la comanda original del ítem.
Formato: header "★ CANCELADO", nombre del ítem, razón, nombre del mesero, nombre del gerente autorizador, hora.

### Anular orden completa
- Solo gerente o admin
- Requiere PIN
- Revierte inventario de todos los ítems con `sent=true`
- No disponible después de `status='cerrada'`
- Publica evento `orders.voided.v1` al event store

### Post-pago
- No existe cancelación de una orden `cerrada` desde el POS (solo gerente con proceso manual documentado)
- Si hay error de cobro, el flujo es: reabrir → ajustar → cerrar → generar nota de crédito CFDI si aplica

---

## Offline / Sincronización — Especificación

### Principio Transaction A / B (canónico)

```
Transaction A (crítico — debe completarse antes de responder 200):
  1. Persistir orden → r1_save_order_idempotent (idempotencia via save_operation_id)
  2. Reconciliación → r1_reconcile_order (idempotencia via last_inventory_processed_revision)

Transaction B (best-effort — puede fallar y reintentarse):
  3. Deducción de inventario → si falla: 503 INVENTORY_POSTPROCESS_RETRYABLE
  4. Auditoría detallada
  5. [Futuro: fidelización, analytics, IA, food cost]
```

Un 503 `INVENTORY_POSTPROCESS_RETRYABLE` significa: **Transaction A completó** (la orden está guardada), Transaction B está pendiente. La sync queue reintentará. Nunca significa que la orden se perdió.

### Clasificación de errores de sync

```typescript
type SyncErrorClass =
  | 'TRANSIENT_RETRYABLE'    // red, timeout → reintenta automáticamente
  | 'STALE_WRITE_CONFLICT'   // OCC conflict → requiere resolución manual del gerente
  | 'TERMINAL_NON_RETRYABLE' // payload malformado → no puede recuperarse, se descarta
```

### UI de sync queue

**Estado: sincronizado**
- Indicador verde o ausente. No molesta al operador.

**Estado: sincronizando (pendientes > 0)**
- Indicador ámbar con contador. Botón "Reintentar ahora" manual.

**Estado: conflicto (STALE_WRITE_CONFLICT)**
- Indicador rojo. Texto: "N operación(es) requieren atención del gerente."
- Panel expandible con: qué operación conflictuó, cuándo, mesa/orden afectada.
- Opciones gerente: "Descartar mi versión" (acepta lo que hay en DB) o "Ver diferencia" (futuro).

**Estado: terminal (TERMINAL_NON_RETRYABLE)**
- Indicador gris. Texto: "N operación(es) no pudieron procesarse. Contacta soporte."
- No bloquean el cierre de turno.

**"Limpiar cola":**
- Solo disponible para el gerente (requiere PIN)
- Diálogo de confirmación explícito: "Estás a punto de descartar N operaciones. Esta acción no puede deshacerse."
- Registra en audit log: quién limpió, cuántas operaciones, hora.

### Monitor de sistema

El monitor lee de IndexedDB (no de localStorage). Muestra:
- Pending count en `sync_queue` (IDB)
- Failed count por clase de error
- Última sincronización exitosa (timestamp)
- Estado de la print bridge (online/offline + uptime)
- Estado de la huella (bridge disponible)
- Estado de Supabase (último ping exitoso)
- Turno activo (fondo, abierto por, duración)

### Audit trail offline [C09]

Los eventos de auditoría (cancelaciones, anulaciones, transferencias, descuentos, cortesías, movimientos de caja) son **mutaciones de primera clase** en la sync queue, no llamadas directas a Supabase.

**Regla:** todo evento de auditoría se persiste en IndexedDB **antes** de ejecutar la acción sensible.

**Si el encolamiento en IDB falla:** la acción se bloquea. No hay operación que deje rastro cero.

**Implementación:**
- Transporte: `SUPABASE_REST` en la sync queue, igual que las órdenes
- Un error de encolamiento de auditoría es `TERMINAL_NON_RETRYABLE` → alerta visible en pantalla para el gerente
- `logAudit()` nunca llama directamente a Supabase REST — siempre encola en IDB primero
- La sync queue sincroniza auditoría en el mismo batch que las mutaciones de órdenes del turno

### Boot offline
- La Electron app embebe el bundle de Next.js. No depende de internet para arrancar.
- Al iniciar offline: el POS arranca con el último menu/inventario cacheado en IDB.
- Al reconectar: `syncAll()` corre automáticamente + refresh de catálogos.

---

## Cierre de turno — Especificación

### Flujo del CierreCajaWizard

```
Paso 1: Verificaciones previas (automáticas, no interactivas) [C03]
  - Guard GUARD-08 (soft block): órdenes abiertas
      → Si hay órdenes abiertas: muestra lista + opción de volver O escalation de gerente
      → Si gerente escala: PIN in-place + segunda confirmación + nota obligatoria
      → Las órdenes abiertas quedan en pos_cierres.ordenes_pendientes
  - Guard GUARD-09 (hard block): sync queue vacía de retryables → error si falla, wizard no avanza
  Si GUARD-09 falla: wizard no avanza. Muestra el problema específico.

Paso 2: Conteo de efectivo
  - Campo de total declarado (número)
  - Desglose por denominación (opcional pero registrado si se llena)
  - Sistema muestra efectivo_esperado con la fórmula canónica (incluye propinas)
  - Diferencia: verde (≤$10) / ámbar ($10–$50) / rojo (>$50)
  - Si diferencia rojo: campo de justificación obligatorio

Paso 3: Corte de meseros (si hay personal con clock-in activo)
  - Muestra ventas, propinas y liquidación por mesero
  - Gerente confirma propinas cobradas en efectivo que se pagan al mesero

Paso 4: PIN de gerente
  - Requiere `corte_z` permission
  - Campo de PIN

Paso 5: Confirmación y cierre
  - Guarda en pos_cierres
  - Cierra pos_turnos (closed_at, closed_by, fondo_final, efectivo_sistema, diferencia)
  - Registra intento de cierre en pos_cierre_intentos (siempre — éxito o fallo)
  - Cierra clock-in activos de personal
  - Imprime ticket de cierre (configurable: siempre / nunca / al confirmar)
  - Envía cierre por email al gerente (si configurado)
```

### Registro de intentos de cierre
```typescript
interface CierreIntento {
  turno_id: string
  intentado_en: string      // timestamp
  intentado_por: string     // staff.name
  efectivo_declarado: number
  diferencia: number
  exitoso: boolean
  error?: string            // motivo si no fue exitoso
  ordenes_pendientes?: string[]  // [C03] order_ids de órdenes que quedaron abiertas al cerrar
  cierre_con_ordenes_abiertas?: boolean
  cierre_autorizado_por?: string // gerente que autorizó el soft block
  cierre_nota?: string      // nota obligatoria cuando hay órdenes pendientes
}
```
Esto permite auditar si un cajero intentó cuadrar el cierre varias veces con montos diferentes, y registra qué órdenes quedaron huérfanas cuando el gerente forzó el cierre.

### Corte de mesero (nuevo en V2)
Al cierre del turno, para cada mesero que tuvo órdenes:
- Total de ventas
- Total de propinas cobradas (por método)
- Propinas en efectivo recibidas (ya tiene el mesero)
- Propinas en tarjeta que el restaurante debe pagarle al mesero
- Saldo a pagar / cobrar al mesero

Este corte se imprime por mesero (o en pantalla si no hay impresora asignada).

---

## Facturación (CFDI) — Especificación

### Linkage con la orden

Toda factura CFDI debe estar vinculada a una o más órdenes:
```typescript
interface CFDIRequest {
  id: string
  client_id: string
  order_ids: string[]     // la factura puede cubrir múltiples órdenes (V2)
  total: number           // autocompletado desde la suma de las órdenes
  // ...
}
```

**En V2:** El cajero selecciona la(s) orden(es) a facturar. El total se autocompleta. No hay campo de monto libre.

**Protección doble facturación:** Si una orden ya tiene `cfdi_request_id`, el sistema advierte antes de generar otra.

### Flujo post-pago

- Un QR en el ticket lleva al portal de autofactura: `factura.fullsite.mx/{order_id}/{short_token}`
- El cliente ingresa su RFC y la factura se genera automáticamente (sin intervención del cajero)
- El portal valida que la solicitud se hace dentro del mismo mes fiscal

### Reintento offline
Si `createCFDIRequest` falla (Supabase offline): la solicitud se queua en IndexedDB y se reintenta al reconectar, igual que las órdenes.

---

## Capacidades Wansoft — Decisiones explícitas

### INCORPORAR en V2

| Capacidad | Por qué | Prioridad |
|---|---|---|
| Tipo de orden obligatorio (mesa/llevar/recoger/domicilio) | Sin esto no hay flujos distintos, precios distintos, ni trazabilidad por tipo. Es la base de todo lo demás. | P0 — bloquea V2 |
| Guard de órdenes abiertas en cierre de turno | Hoy se pueden cerrar turnos con mesas activas. Eso corrompe `turno_id`. | P0 |
| Reimpresión de comanda desde cocina | Si la impresora falla al enviar, la cocina queda sin información. Hoy no hay forma de recuperarlo. | P0 |
| Badge de delivery en sidebar | Sin alerta visible, el cajero pierde órdenes de plataformas. | P1 |
| Botón "Auto" en cobro | Velocidad en hora pico. Elimina un paso de tecleo. | P1 |
| Corte de mesero al cierre de turno | Liquidación transparente de propinas y ventas por persona. | P1 |
| Envío de corte por email al gerente | El dueño tiene visibilidad del resultado de cada turno sin estar presente. | P1 |
| Registro de intentos de cierre | Auditoría de fraude: detecta si el cajero intentó cuadrar con montos falsos. | P1 |
| Fórmula de arqueo canónica (incluye propinas) | Hoy el wizard y el corte tienen fórmulas distintas. Eso es un bug. | P1 |
| Linkage order_id en facturas CFDI | Sin esto, doble facturación es posible y el monto es manual. | P1 |
| Delivery integrado en KDS | Las órdenes de Rappi/UberEats deben aparecer en cocina. Hoy no lo hacen. | P1 |
| Preticket (imprimir cuenta sin cerrar) | El mesero muestra el monto al cliente para revisión antes de cobrar. Incluye propinas sugeridas y QR para cobro directo. [G1] | P1 |
| Retiros y depósitos de caja formales | pos_cash_movements ya existe. RCA del flujo pendiente: permisos, PIN, razón, offline, impresión, cajón, arqueo. [G2] | P1 |
| Consumo interno / comida de personal | Vía order_purpose='consumo_interno'. Deduce inventario, excluido de ventas, visible en corte y food cost. [G3] | P2 |
| Cobro por QR (scan-to-pay) | Cajero escanea QR del preticket → navega directo a cobro. Sin hardware adicional. [G4] | P2 |
| Propinas sugeridas en preticket | Incluidas en el preticket (G1). | P1 |
| Tipos de precio por tipo de orden | Mismo platillo a diferente precio en delivery vs mesa. | P2 |
| Menus configurables por plataforma | Qué platillos aparecen en Rappi vs UberEats vs mesa. | P2 |

### POSPONER — con fecha de revisión

| Capacidad | Por qué posponer | Cuándo revisitar |
|---|---|---|
| Pagos anticipados / depósitos para eventos | AMALAY no hace eventos. Ningún cliente actual lo necesita. | Cuando un cliente lo pida |
| CxC (Cuentas por Cobrar) | Agrega complejidad a conciliación. No hay demanda actual. | Cuando un cliente corporativo lo requiera |
| Módulo de repartidores propios | AMALAY usa plataformas. No hay domicilio propio. | Si un cliente tiene delivery propio |
| Marcas virtuales | Complejidad alta, valor para casos específicos de dark kitchen. | Post-PMF |
| Báscula integrada (COM) | Hardware especializado no en la roadmap de terminales. | Con la terminal propia |
| Segundo visor cliente | Hardware en plan de terminal propia. | Con la terminal propia |
| CashDro (maquina contadora de efectivo) | Hardware de alto costo, AMALAY no lo tiene. | Post-PMF |

### NO INCORPORAR — por qué Fullsite lo resuelve mejor

| Capacidad Wansoft | Cómo Fullsite lo resuelve mejor |
|---|---|
| Reportes como Excel exportado | Dashboard en tiempo real con IA. Wansoft exporta para análisis manual; Fullsite analiza y alerta automáticamente. |
| Audit log como feature opcional (OFF por default) | En Fullsite el audit trail es una invariante del sistema — no es configurable. Todo deja rastro. |
| Sincronización periódica (hasta 48h de delay) | Fullsite es real-time con offline-first. La sincronización ocurre en segundos, no en horas. |
| Alertas de inventario como reporte consultable | Fullsite envía alertas proactivas. El gerente no necesita ir a buscar el problema. |
| "Depurar BD" expuesto al cajero | El mantenimiento del sistema es transparente para el operador — no es responsabilidad del cajero. |

---

## Schema — cambios requeridos en DB para V2

### Tabla `pos_orders` — nuevas columnas

```sql
ALTER TABLE pos_orders
  -- Tipo de orden [C01, C06]
  ADD COLUMN tipo text NOT NULL DEFAULT 'mesa'
    CHECK (tipo IN ('mesa', 'llevar', 'recoger', 'domicilio')),
  -- Propósito financiero [G3]
  ADD COLUMN order_purpose text NOT NULL DEFAULT 'venta'
    CHECK (order_purpose IN ('venta', 'consumo_interno', 'cortesia')),
  ADD COLUMN staff_beneficiario_id text,      -- UUID del empleado (consumo_interno)
  ADD COLUMN staff_beneficiario_nombre text,  -- snapshot del nombre
  ADD COLUMN purpose_razon text,              -- obligatorio para consumo_interno y cortesia
  -- Mesero con integridad referencial [C05]
  ADD COLUMN mesero_id text,          -- UUID del staff mesero responsable
  ADD COLUMN mesero_nombre text,      -- snapshot del nombre al momento de la venta
  -- Campos tipo-específicos
  ADD COLUMN cliente_nombre text,
  ADD COLUMN cliente_telefono text,
  ADD COLUMN fecha_entrega timestamptz,
  ADD COLUMN delivery_platform text
    CHECK (delivery_platform IN ('rappi', 'ubereats', 'propio') OR delivery_platform IS NULL),
  -- Financiero
  ADD COLUMN cambio_entregado numeric(10,2),
  ADD COLUMN cfdi_request_id uuid REFERENCES pos_cfdi_requests(id);
```

**Migración de datos existentes:**
```sql
-- Toda orden existente es tipo='mesa' (invariante retroactiva)
UPDATE pos_orders SET tipo = 'mesa' WHERE tipo IS NULL;
UPDATE pos_orders SET order_purpose = 'venta' WHERE order_purpose IS NULL;
-- mesero_nombre desde el campo mesero existente (si existe)
UPDATE pos_orders SET mesero_nombre = mesero WHERE mesero_id IS NULL AND mesero IS NOT NULL;
-- Eliminar defaults después de la migración
ALTER TABLE pos_orders ALTER COLUMN tipo DROP DEFAULT;
ALTER TABLE pos_orders ALTER COLUMN order_purpose DROP DEFAULT;
```

### Tabla nueva: `pos_cierre_intentos`
```sql
CREATE TABLE pos_cierre_intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  turno_id text NOT NULL REFERENCES pos_turnos(id),
  intentado_en timestamptz NOT NULL DEFAULT now(),
  intentado_por text NOT NULL,
  efectivo_declarado numeric(10,2),
  diferencia numeric(10,2),
  exitoso boolean NOT NULL,
  error text,
  -- [C03] campos para cierre con órdenes pendientes
  ordenes_pendientes text[] DEFAULT '{}',          -- order_ids de órdenes huérfanas
  cierre_con_ordenes_abiertas boolean DEFAULT false,
  cierre_autorizado_por text,   -- staff.name del gerente que autorizó el soft block
  cierre_nota text              -- nota obligatoria cuando ordenes_pendientes > 0
);
```

### Tabla `pos_cfdi_requests` — nueva columna
```sql
ALTER TABLE pos_cfdi_requests
  ADD COLUMN order_ids text[] DEFAULT '{}';
```

---

## Migración desde V1 — Path de implementación

### Lo que NO cambia
- La API `/api/pos/save-order` y su contrato Transaction A/B
- El modelo de sync queue (IndexedDB + `syncAll()`)
- Los RPC de Supabase (`r1_save_order`, `r1_reconcile_order`)
- Los Bibles como fuente de verdad

### Lo que cambia (priorizado)

**Fase P0 — Antes del próximo sprint de features:**
1. Renovar CSD Facturama (acción de Daniel, no código)
2. Guard GUARD-08 como soft block: lista de órdenes, escalation gerente, nota obligatoria, ordenes_pendientes en cierre [C03]
3. Reprint de comanda desde pantallas de KDS/cocina/barra

**Fase V2-A — Modelo de orden (tipo + propósito + mesero):**
4. Schema `pos_orders`: columnas `tipo`, `order_purpose`, `mesero_id`, `mesero_nombre`, `staff_beneficiario_*`, `purpose_razon` + migración
5. Selector de tipo de orden como primer paso al crear (no pantalla separada — primer campo del form) [C01]
6. Validaciones y campos requeridos por tipo en el formulario de creación
7. URL routing: `/pos/o/{orderId}` como identidad canónica; mapa de mesas resuelve order_id al tocar mesa ocupada; `?mesa=N` sigue funcionando con redirect [C02]
8. Corrección del cache: `sentItemIds` nunca se marca `true` sin `loadedOrderId` confirmado [C04]
9. RCA de `pos_cash_movements`: auditar permisos, PIN, razón, offline, impresión, cajón, arqueo — documentar o corregir lo que falte [G2]

**Fase V2-B — Flujo de cobro y cierre:**
10. Preticket: imprimir cuenta sin cerrar, propinas sugeridas, QR con order_id para cobro directo [G1]
11. Fórmula de arqueo canónica unificada (CierreCajaWizard y /pos/corte usan la misma)
12. `cambio_entregado` guardado en la orden
13. Registro de intentos de cierre (`pos_cierre_intentos`) con campos de órdenes pendientes
14. Corte de mesero al cierre de turno (usando `mesero_id` para reporting exacto)
15. Envío de cierre por email
16. Banner de alerta al abrir turno cuando el turno anterior cerró con órdenes pendientes [C03]
17. Flujo de `order_purpose` (consumo_interno / cortesia) con validación de campos requeridos [G3]

**Fase V2-C — Cocina y delivery:**
18. Batch awareness en KDS y Barra
19. Badge de delivery en sidebar con conteo live
20. Órdenes de plataformas en el KDS con badge visual
21. Botón "Auto" en pantalla de cobro
22. Audit trail vía sync queue (logAudit → IDB, no Supabase directo) [C09]

**Fase V2-D — Facturación y quality:**
23. Linkage `order_ids` en CFDIRequest
24. Monitorizar IndexedDB (no localStorage) en el monitor
25. UI de resolución de stale write conflicts
26. Cobro por QR: escanear preticket → navegar directo a cobro [G4]

---

## Decisiones resueltas — registro de cambios v1→v2

Todas las decisiones abiertas de v1 quedaron cerradas en la sesión de revisión crítica del 2026-07-23.

| Decisión | Resolución | Referencia |
|---|---|---|
| URL routing | `/pos?mesa=N` como punto de entrada al mapa. Identidad canónica: `/pos/o/{orderId}`. Mesa ocupada → resuelve orderId y redirige. Backward-compat con redirects. | C02 |
| Propinas en preticket | Sí — 10%/15%/20% calculadas sobre subtotal, en el preticket. | G1 |
| `mesa` en URL vs estado | El número de mesa es un campo de la orden. La URL de la orden usa orderId. El param `?mesa=N` es solo un punto de entrada al mapa. | C02 |
| Llevar vs Recoger — ¿1 tipo o 2? | 4 tipos distintos. La distinción es operativa: `llevar` = cliente espera ahora; `recoger` = cliente llega en el futuro. El KDS y el ticket los tratan diferente. | C06 |
| Tipos de precio en V2 | Posponer. Cuando un cliente lo requiera activamente. | Wansoft POSPONER |
| Flujo de turno con órdenes abiertas | GUARD-08 soft block. Gerente puede cerrar con órdenes abiertas mediante escalation + nota obligatoria. Órdenes huérfanas no desaparecen del mapa. | C03 |
| Consumo interno como OrderType | No. Usa `order_purpose = 'consumo_interno'` preservando 4 tipos. Pendiente: confirmar cómo registra AMALAY hoy. | G3 |
| Retiros y depósitos | `pos_cash_movements` ya existe. Requiere RCA del flujo existente antes de cambiar nada. | G2 |
| Verificación DB antes de cobrar | Eliminar el roundtrip. Corregir el cache en origen: `sentItemIds` nunca se marca `true` sin `loadedOrderId`. | C04 |
| Mesero como string vs UUID | `mesero_id` (UUID) + `mesero_nombre` (snapshot), separados de `staff_id`. | C05 |

---

## Ownership Boundaries — Dueño canónico de cada dato

Cada tabla y campo tiene un único módulo dueño. Solo el módulo dueño puede escribir directamente en sus datos. Los demás módulos leen a través de eventos, nunca mediante mutaciones directas.

### Mapa de ownership

| Módulo | Tablas / Campos que posee | Puede escribir | No puede escribir |
|---|---|---|---|
| **POS** | `pos_orders` (todos los campos excepto `kds_item_status`), `pos_turnos`, `pos_cierres`, `pos_cierre_intentos`, `pos_cash_movements`, `pagos[]` (JSONB en order) | Todo lo listado | `kds_item_status`, tablas de inventario, `pos_cfdi_requests` (solo FK pointer) |
| **KDS** | `pos_orders.kds_item_status` (únicamente este campo) | `kds_item_status` de los ítems de su estación | Status de la orden, pagos, turno, inventario |
| **Facturación** | `pos_cfdi_requests`, campos fiscales (RFC, UUID SAT, PDF URL, estado fiscal) | `pos_cfdi_requests`, `pos_orders.cfdi_request_id` (pointer FK, nunca el status) | Status de órdenes, pagos, inventario |
| **Inventario** | `pos_inventory`, `pos_inventory_movements`, `pos_recipes`, costos calculados | Existencias, movimientos, food cost | Status de órdenes, pagos, turno |
| **Dashboard / Analytics / IA** | Nada en la capa operativa | Solo lectura sobre eventos y vistas materializadas | Todo |

### Prohibiciones explícitas (cross-module)

Estas reglas son invariantes del sistema. No son guidelines — son restricciones de arquitectura.

1. **El KDS nunca modifica pagos, status de orden, ni datos de turno.** Solo escribe `kds_item_status`.
2. **Facturación nunca cambia el status de una orden.** Puede leer la orden para autocompletar montos; no puede escribir en ella.
3. **El cobro (POS) nunca deduce inventario directamente.** Publica `orders.closed.v1`; el módulo de Inventario reacciona.
4. **Inventario nunca cambia el status de una orden.** Puede leer la orden para calcular costos; no puede escribir en ella.
5. **Dashboard, Analytics e IA nunca escriben datos operativos.** Son receptores de eventos, no productores.
6. **Ningún módulo hace mutaciones cross-domain.** Las vistas materializadas para reportes son aceptables en lectura; los writes nunca cruzan boundaries.

### Principio de lectura cross-module

- **Para decisiones en tiempo real** (ej. el cajero necesita ver el nombre del mesero): el módulo consulta datos del otro (READ), pero no los escribe.
- **Para reaccionar a cambios** (ej. Inventario deduce al cerrar una orden): el módulo escucha un evento del dominio. Nunca hace polling a la tabla del otro módulo.

Ejemplo correcto: Inventario calcula food cost cuando recibe `orders.closed.v1`.
Ejemplo incorrecto: Dashboard hace cron cada 60s sobre `pos_orders` para actualizar KPIs — debe suscribirse a `orders.closed.v1`.

---

## Domain Events — Catálogo oficial

Un evento de dominio representa un **hecho de negocio que ya ocurrió**. No es una instrucción ni una notificación; es una afirmación sobre el pasado.

Todos los sistemas downstream (Dashboard, IA, Analytics, Alertas, Food Cost, CFDI portal) escuchan eventos. **Nunca escuchan tablas.**

### Schema base de evento

```typescript
interface DomainEvent<T = unknown> {
  id: string            // UUID — idempotency key para el consumidor
  type: EventType       // ej. 'orders.closed.v1'
  client_id: string     // tenant
  occurred_at: string   // cuándo ocurrió el hecho de negocio (fuente de verdad de ordering)
  recorded_at: string   // cuándo se persistió (puede ser posterior si el sistema estaba offline)
  actor_id: string      // staff_id de quien realizó la acción
  aggregate_id: string  // ID de la entidad principal (order_id, turno_id, etc.)
  aggregate_type: AggregateType
  payload: T
  correlation_id?: string // agrupa eventos relacionados (ej. todos los de un turno)
}

type AggregateType = 'order' | 'turno' | 'payment' | 'cash_movement' | 'cfdi' | 'inventory'
```

**Invariante de ordering:** los consumidores ordenan por `occurred_at`, no por `recorded_at`. Los IDs son UUIDs — no secuenciales — para no asumir orden por ID.

**Idempotencia obligatoria:** todos los consumidores usan `event.id` como idempotency key. Si ya procesaron un evento con ese ID, lo ignoran sin error.

---

### Catálogo por módulo

#### Módulo: Órdenes (producer: POS)

| Evento | Trigger | Consumers principales |
|---|---|---|
| `orders.created.v1` | Primera persistencia de la orden en DB | Dashboard, IA |
| `orders.sent_to_kitchen.v1` | Primera comanda enviada (primer batch) | KDS, Dashboard |
| `orders.batch_sent.v1` | Cada batch enviado a cocina (incluyendo el primero) | KDS |
| `orders.item_cancelled.v1` | Ítem cancelado (pre o post-cocina) | KDS, Inventario, Audit |
| `orders.item_voided.v1` | Ítem anulado por error operativo | KDS, Inventario, Audit |
| `orders.closed.v1` | Pago completado, orden cerrada | Inventario, Dashboard, CFDI portal, Food Cost, IA |
| `orders.reopened.v1` | Gerente reabre una orden cerrada | Inventario (reversa), Dashboard, Audit |
| `orders.voided.v1` | Gerente anula la orden completa | Inventario, Dashboard, Audit |
| `orders.transferred.v1` | Orden transferida a otra mesa o mesero | KDS, Dashboard, Audit |

**Payload de `orders.closed.v1`** (el evento más consumido):
```typescript
{
  order_id: string
  turno_id: string
  tipo: OrderType
  order_purpose: OrderPurpose
  mesero_id: string
  mesero_nombre: string
  total: number
  subtotal: number
  iva: number
  descuento?: number
  propina?: number
  pagos: PaymentLeg[]
  items: {
    product_id: string
    name: string
    quantity: number
    unit_price: number
    station: KitchenStation
    cancelled: boolean
    voided: boolean
  }[]
  mesa?: number
  cliente_nombre?: string
  delivery_platform?: DeliveryPlatform
  closed_at: string
}
```

**Payload de `orders.batch_sent.v1`:**
```typescript
{
  order_id: string
  turno_id: string
  batch_id: string
  batch_number: number     // 1 = primer tiempo, 2 = segundo tiempo, etc.
  items: {
    item_id: string
    product_id: string
    name: string
    quantity: number
    station: KitchenStation
    modifiers: Modifier[]
  }[]
  sent_at: string
}
```

---

#### Módulo: KDS (producer: KDS)

| Evento | Trigger | Consumers principales |
|---|---|---|
| `kds.item_status_changed.v1` | Cocina marca un ítem como preparando o listo | POS (avanzar status de orden), Dashboard |
| `kds.batch_completed.v1` | Todos los ítems de un batch están listos | POS, Dashboard, notificación al mesero |

---

#### Módulo: Turnos (producer: POS)

| Evento | Trigger | Consumers principales |
|---|---|---|
| `turnos.opened.v1` | Cajero abre el turno con fondo inicial | Dashboard, todos los módulos |
| `turnos.closed.v1` | Gerente confirma el cierre Z | Dashboard, Inventario, Analytics |

**Payload de `turnos.closed.v1`:**
```typescript
{
  turno_id: string
  terminal_id: string
  abierto_por: string
  cerrado_por: string
  cerrado_autorizado_por?: string  // si fue soft block con escalation
  fondo_inicial: number
  fondo_final: number
  efectivo_sistema: number
  diferencia: number
  ventas_total: number
  ventas_efectivo: number
  ventas_tarjeta: number
  propinas_total: number
  ordenes_count: number
  ordenes_pendientes: string[]    // vacío si cierre limpio
  opened_at: string
  closed_at: string
}
```

---

#### Módulo: Caja (producer: POS)

| Evento | Trigger | Consumers principales |
|---|---|---|
| `cash.deposit.v1` | Cajero registra un depósito al cajón | Dashboard, Audit |
| `cash.withdrawal.v1` | Cajero registra un retiro del cajón | Dashboard, Audit |

---

#### Módulo: Facturación (producer: Facturación)

| Evento | Trigger | Consumers principales |
|---|---|---|
| `cfdi.requested.v1` | Cliente solicita factura | Dashboard |
| `cfdi.issued.v1` | Facturama confirma emisión | Dashboard, POS (actualiza cfdi_request_id), Email |
| `cfdi.failed.v1` | Facturama rechaza la solicitud | Dashboard, Soporte |

---

#### Módulo: Inventario (producer: Inventario)

| Evento | Trigger | Consumers principales |
|---|---|---|
| `inventory.reconciled.v1` | Transaction B completa la deducción de ingredientes | Dashboard, Food Cost, Alertas |
| `inventory.low_stock.v1` | Una existencia cae por debajo del umbral de reorden | Alertas, Dashboard |

---

### Garantías de entrega

| Nivel | Semántica | Cuándo aplica |
|---|---|---|
| **At-least-once** | El evento puede llegar más de una vez. El consumidor debe ser idempotente (usar `event.id`). | Por defecto para todos los eventos |
| **Exactly-once** | Se garantiza exactamente una entrega. Implementado a nivel de RPC idempotente + revisión. | Deducción de inventario (`inventory.reconciled.v1`) |

### Estado actual de implementación

El event store de Fullsite (append-only, activo desde 2026-06-12 en shadow mode) persiste eventos en Supabase. Los consumidores actuales son primera generación — no todos cumplen aún con "escuchar eventos, no tablas". Este catálogo es el objetivo al que migrar, módulo por módulo, sin requerir un corte total.

---

## RFC Process — Cambios al modelo post-freeze

A partir de la versión 2.1 de esta spec, el modelo está **congelado**. Todo cambio que afecte:
- Ownership boundaries (quién es dueño de qué tabla o campo)
- Catálogo de domain events (agregar, renombrar, cambiar payload de evento existente)
- Entidades del dominio (nuevos campos con semántica de negocio, no solo columnas técnicas)
- Guards (agregar, modificar condición, cambiar de hard a soft block o viceversa)
- Flujo canónico de 6 pasos

...requiere un **RFC aprobado** antes de modificar la spec.

### Formato de un RFC

Archivo: `docs/product/RFC-{número}-{slug}.md`

```markdown
# RFC-{N}: {Título corto}

**Estado:** DRAFT | UNDER REVIEW | APPROVED | REJECTED
**Autor:** {nombre}
**Fecha:** {YYYY-MM-DD}
**Aprobado por:** Daniel

## Motivación
¿Qué problema resuelve este cambio? ¿Por qué el modelo actual es insuficiente?

## Propuesta
Descripción concisa del cambio propuesto.

## Impacto en ownership
¿Cambia quién es dueño de algún dato? ¿Crea un módulo nuevo?

## Impacto en domain events
¿Agrega, modifica o elimina algún evento del catálogo?

## Impacto en clientes existentes
¿Rompe algún consumidor de evento o interfaz pública de módulo?

## Migration path
¿Cómo se migran datos existentes y consumidores existentes?

## Alternativas descartadas
¿Qué otras opciones se consideraron y por qué no se eligieron?
```

### Cambios que NO requieren RFC
- Agregar una columna técnica sin semántica de negocio (ej. `updated_at`, índice)
- Corrección de bug dentro de un módulo sin cruzar boundaries
- Cambios de UI/UX que no afecten el modelo de datos
- Agregar un nuevo campo al **payload** de un evento existente (backwards compatible)
- Documentar clarificaciones sin cambiar el comportamiento

---

## Criterio de cierre de esta spec

Esta spec se considera CERRADA cuando:
1. ✅ Daniel aprueba el flujo canónico — flujo de 6 pasos confirmado
2. ✅ Las decisiones abiertas quedan resueltas — todas resueltas en revisión 2026-07-23
3. ✅ El schema de DB está definido con los campos exactos
4. ✅ Ownership boundaries definidos — módulo propietario de cada tabla y campo
5. ✅ Catálogo de domain events definido — 17 eventos oficiales
6. ✅ RFC process documentado — proceso para cambios post-freeze
7. Los P0 están implementados y certificados en campo
8. El primer flujo V2 (tipo de orden + routing) está implementado, validado en AMALAY, y las Bibles actualizadas

Los ítems 7 y 8 son los únicos pendientes para el cierre total. El modelo está congelado.

---

_Fuentes: POS-FLOW-AUDIT.md (2026-07-23) | WANSOFT-POS-BIBLE.md | CAJA-SPEC.md | DATA-MODEL.md | FULLSITE-DOMAIN-BIBLE.md | FULLSITE-ENGINEERING-BIBLE.md_
_v1.0 — 2026-07-23 — Draft inicial_
_v2.0 — 2026-07-23 — Revisión crítica C01–C10, G1–G4. Estado: APROBADA._
_v2.1 — 2026-07-23 — Ownership Boundaries + Domain Events + RFC Process. Estado: ARCHITECTURE FREEZE._

---

## Milestone de cierre funcional: POS V2 Operational Certification

Esta spec define el contrato. El milestone define cuándo el contrato demostró funcionar en operación real.

Ver criterios completos en: `docs/feos/EXECUTION-PLAN.md § Milestone`

Requisitos resumidos: 4 P0 CERTIFIED + 7 días consecutivos en AMALAY sin incidentes P0.
Solo cuando ese milestone se cumple puede comenzar la fase de P1 Features.
