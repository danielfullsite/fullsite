# Fullsite POS — Lógica operativa observada en Wansoft / NetSilver

## Objetivo

Replicar y mejorar la lógica operativa core de Wansoft/NetSilver dentro de Fullsite POS, asegurando paridad funcional mínima y agregando una capa superior de UX, auditoría, seguridad, inteligencia operativa e IA.

---

# 1. Modelo central: Orden

En NetSilver todo gira alrededor de una **orden**.

Una orden puede estar asociada a:

* Mesa
* Número de orden
* Mesero
* Cliente
* Número de personas
* Silla/persona
* Tipo de orden
* Turno
* Forma de pago
* Repartidor
* Plataforma delivery
* Estatus
* Total
* Descuentos
* Propinas
* Cancelaciones

## Modelo sugerido en Fullsite

```ts
Order {
  id
  orderNumber
  businessId
  locationId
  shiftId
  type // dine_in, delivery, pickup, third_party
  status // open, sent, preparing, ready, closed, cancelled
  tableId?
  waiterId?
  customerId?
  guestCount
  subtotal
  discountTotal
  taxTotal
  tipTotal
  total
  openedAt
  closedAt?
}
```

---

# 2. Apertura de mesa

NetSilver abre una mesa solicitando:

* Mesero
* Mesa
* Número de personas
* Nombre cliente opcional

Esto crea la orden abierta.

## Mejora Fullsite

Reducir fricción:

* Si la mesa ya tiene mesero asignado, autocompletar.
* Guest count rápido.
* Cliente opcional, no obligatorio.
* Permitir “abrir rápido” y completar después.

---

# 3. Mapa de mesas

NetSilver soporta mapa visual, pero básico:

* Mesas cuadradas/circulares
* Ancho
* Alto
* Número de personas
* Tamaño de letra
* Layout
* Secciones
* Permisos por sección
* Sección default

## Mejora Fullsite

Modelo más completo:

```ts
FloorSection {
  id
  name
  assignedWaiters[]
}

Table {
  id
  name
  sectionId
  capacity
  status // available, seated, ordered, eating, waiting_bill, paid, cleaning
  x
  y
  width
  height
  shape
}
```

Agregar métricas:

* Tiempo abierta
* Venta actual
* Ticket promedio por mesa
* Rotación
* Revenue per seat hour
* Alertas de mesa lenta

---

# 4. Sillas / personas

NetSilver maneja `Silla` en cada producto. Cada producto puede asignarse a una silla/persona.

Esto permite:

* Dividir cuenta
* Cambiar número de silla
* Transferir artículos
* Cobro por persona

## Modelo Fullsite

```ts
OrderSeat {
  id
  orderId
  seatNumber
  guestName?
}

OrderItem {
  id
  orderId
  seatId?
  productId
  quantity
  unitPrice
  total
}
```

## Mejora

Mostrar visualmente:

* Persona 1
* Persona 2
* Persona 3

Permitir arrastrar productos entre personas.

---

# 5. Categorías, subcategorías y productos

NetSilver usa jerarquía:

```txt
Categoría principal
  → Subcategoría
      → Producto
```

Ejemplo:

```txt
ALIMENTOS
  → BOWLS
      → ACAI B KIND BOWL
```

Categorías vistas:

* Alimentos
* Bebidas
* Market
* Alcohol
* Postres
* Appetizers
* Ventas terceros
* Evento/Menu

Subcategorías vistas:

* Bowls
* Toast & Bagels
* Chilaquiles & Enchiladas
* Pancakes & Waffles
* Paninis
* Soups & Salads
* Kids Menu
* Croissants Breakfast
* Eggs & Keto
* Signature
* Ceviche
* Pizzas & Pastas
* Extras
* Envíos

## Modelo Fullsite

```ts
Category {
  id
  name
  color
  parentId?
  sortOrder
}

Product {
  id
  name
  categoryId
  basePrice
  active
  kitchenStationId?
  taxCategoryId?
}
```

## Mejora

Agregar:

* búsqueda universal
* favoritos por mesero
* productos más vendidos
* sugerencias IA
* fotos opcionales
* tags operativos

---

# 6. Modificadores multinivel

NetSilver tiene un motor de modificadores maduro.

Ejemplo observado:

Producto:

```txt
ACAI B KIND BOWL
Precio base: $215
```

Grupo:

```txt
NIVEL 1: PROTEINA
Opcional, máximo 2 en total
```

Opciones:

```txt
Habits Vainilla Proteína Vegana +$50
Habits Colágeno +$30
```

Total resultante:

```txt
215 + 50 + 30 = 295
```

## Reglas detectadas

* Los modificadores pueden tener precio adicional.
* Pueden ser opcionales.
* Pueden tener máximo de selección.
* Se muestran como parte del nombre del producto en la orden.
* Afectan el total en tiempo real.

## Modelo Fullsite

```ts
ModifierGroup {
  id
  productId
  name
  level
  minSelections
  maxSelections
  required
  sortOrder
}

ModifierOption {
  id
  groupId
  name
  priceDelta
  active
}
```

```ts
OrderItemModifier {
  id
  orderItemId
  modifierOptionId
  nameSnapshot
  priceDeltaSnapshot
}
```

## Mejora

* IA sugiere modificadores rentables.
* Mostrar margen por modificador.
* Mostrar “78% de clientes agregan proteína”.
* Recordar preferencias de cliente frecuente.

---

# 7. Tiempos / cursos / Firebutton

NetSilver maneja tiempos mediante líneas tipo:

```txt
XX TIEMPO: 1 XX
```

También tiene pantalla:

```txt
Impresión por tiempos
Tiempo siguiente: 1
Botón: Imprimir
```

En configuración de comanda aparece texto de firebutton:

```txt
***PREPARAR Y SAC...
```

## Lógica

La orden puede separarse por tiempos/cursos:

* Tiempo 1
* Tiempo 2
* Tiempo siguiente
* Impresión por tiempo
* Preparar y sacar

## Modelo Fullsite

```ts
Course {
  id
  orderId
  number
  status // pending, fired, preparing, ready, served
  firedAt?
}

OrderItem {
  courseId?
}
```

## Mejora

* Fire visual por curso.
* “Enviar tiempo 2” sin reimprimir todo.
* KDS por curso.
* Medir tiempo entre cursos.
* Alertas si un curso tarda mucho.

---

# 8. Comanda / cocina / routing

NetSilver tiene configuración de comanda muy completa.

Opciones de encabezado:

* Fecha
* Terminal
* Tipo de orden
* Número de orden
* Número de mesa
* Número de personas
* Nombre de mesero
* Hora de impresión
* Nombre del cliente
* Dirección del cliente

Opciones de detalle:

* Agregar silla
* Agregar tamaño antes del platillo
* Agregar grupo
* Cantidad de modificadores
* Imprimir modificadores por renglón
* Línea entre conceptos
* Conceptos agrupados
* Platillos agrupados
* Modificadores agrupados

## Impresión por grupo

NetSilver direcciona grupos a impresoras/estaciones:

Ejemplos vistos:

```txt
BOWLS → COCINA CALIENTE
TOAST & BAGELS → COCINA CALIENTE
CHILAQUILES & ENCHILADAS → COCINA CALIENTE
JUGOS → BARRA
COFFEE HOT/ICE → BARRA
```

También tiene:

* impresora primaria
* impresora secundaria
* duplicar impresión
* impresoras involucradas
* catálogo de impresoras
* impresión por platillo
* impresión por grupo

## Modelo Fullsite

```ts
KitchenStation {
  id
  name // Barra, Cocina Caliente, Pantry, Horno, Postres
}

Printer {
  id
  name
  type
  connectionType
  stationId?
}

ProductRouting {
  productId
  stationId
  printerId?
}
```

## Mejora

No depender solo de grupos. Permitir routing por:

* producto
* categoría
* modificador
* tipo de orden
* estación
* prioridad

---

# 9. Edición avanzada de cuenta

Pantalla avanzada observada:

* Borrar partida
* Aplicar descuento
* Aplicar cortesía
* Aplicar 2 x 1
* Transferir de mesa
* Cambiar # de silla
* Cambiar estatus de cancelada/anulada
* Ver detalle
* Descuento prorrateado a la cuenta
* Cambiar # de mesa
* Cambiar # de personas
* Dividir cuenta
* Promociones

## Modelo Fullsite

Todas estas acciones deben ser eventos auditables:

```ts
OrderEvent {
  id
  orderId
  actorUserId
  type
  payload
  createdAt
}
```

Ejemplos:

```txt
ITEM_CANCELLED
DISCOUNT_APPLIED
COMP_APPLIED
TABLE_TRANSFERRED
SEAT_CHANGED
ORDER_SPLIT_ATTEMPTED
PAYMENT_METHOD_CHANGED
```

---

# 10. Cancelaciones

NetSilver NO borra directo.

Flujo observado:

```txt
Seleccionar producto
→ X / borrar
→ Proporcionar razón de cancelación
→ ¿Se preparó la orden / salieron productos de inventario?
→ Sí / No
```

Esto implica:

* motivo obligatorio
* auditoría
* validación de inventario
* diferencia entre cancelar antes o después de producción

## Modelo Fullsite

```ts
Cancellation {
  id
  orderItemId
  reason
  requiredManagerApproval
  inventoryConsumed
  cancelledBy
  approvedBy?
  createdAt
}
```

## Mejora

Agregar:

* catálogo de motivos
* autorización por gerente
* impacto en inventario
* reporte antifraude
* alertas por usuario/mesero/producto

---

# 11. Descuentos, cortesías y promociones

NetSilver soporta:

* Aplicar descuento
* Descuento prorrateado a la cuenta
* Aplicar cortesía
* Aplicar 2 x 1
* Promociones

Pantalla de promociones muestra:

* Seleccionar todos
* Deseleccionar todos
* Seleccionar todos los platillos que apliquen descuento

Esto sugiere que promociones se aplican sobre selección de partidas, no siempre sobre toda la cuenta.

## Modelo Fullsite

```ts
Promotion {
  id
  name
  type // 2x1, percent, fixed, category, item
  conditions
  effects
  active
}

DiscountApplication {
  id
  orderId
  orderItemId?
  promotionId?
  type
  amount
  reason
  approvedBy?
}
```

## Importante

El descuento prorrateado es crítico para:

* CFDI
* reportes
* contabilidad
* promociones
* pagos mixtos

---

# 12. Pago mixto

Pantalla de pago observada:

Métodos:

* Efectivo
* Dólares
* Cortesía
* Tarjeta de crédito
* Tarjeta de débito
* Rappi
* Netpay
* A domicilio
* Influencer
* Mercadotecnia
* Transferencia
* Otras formas de pago

Campos:

* Total de la cuenta
* Cantidad recibida
* Propina
* Cambio
* Saldo

Tabla:

```txt
Forma de Pago | Pagado | Propina | Total
```

Esto confirma soporte de pago mixto.

## Modelo Fullsite

```ts
Payment {
  id
  orderId
  method
  amount
  tipAmount
  reference?
  status
  createdAt
}
```

Permitir múltiples payments por order.

## Mejora

Separar métodos reales de pago vs categorías contables:

Métodos reales:

* efectivo
* tarjeta
* transferencia
* wallet

Categorías contables:

* influencer
* mercadotecnia
* cortesía
* empleado
* delivery platform

---

# 13. Propinas

NetSilver maneja propina en pantalla de pago.

Config de propinas observada:

* imprimir reporte de propinas a pagar
* porcentaje de venta que el mesero pagará
* plaque en pesos
* número de impresiones de retiro de fondo
* número de impresiones de pago de propina

## Modelo Fullsite

```ts
Tip {
  id
  orderId
  paymentId?
  waiterId
  amount
  method
}
```

## Mejora

Dashboard:

* propina por mesero
* propina promedio %
* mesas sin propina
* propina por método de pago
* propina contra venta
* pool de propinas

---

# 14. Seguridad y permisos

NetSilver tiene permisos operativos granulares.

Opciones vistas:

* bloquear pantalla en cada operación
* bloquear con protector de pantalla
* pedir clave al reimprimir pre-ticket
* cambio de platillos a otra mesa
* descuentos sobre descuentos
* cambio forma de pago de días anteriores
* cancelar ventas de días anteriores
* cambiar tipo de impresión días anteriores
* permite editar cuenta después de pre-ticket
* guardar logs de acciones

Permisos de gerente:

* platillos que requieren permiso de gerente
* grupos que requieren permiso de gerente
* formas de pago que requieren permiso de gerente
* catálogo de descuentos
* catálogo de cortesías
* catálogo de cancelaciones/anulaciones/devoluciones

## Flujos observados con permisos

Retiros:

```txt
No cuenta con permisos para retiros
→ ¿Desea apoyo de otra persona con permiso?
→ Validación de permisos
→ PIN
```

Depósitos también requieren permiso.

## Modelo Fullsite

```ts
RolePermission {
  roleId
  permission
}

ManagerApproval {
  id
  actionType
  requestedBy
  approvedBy
  pinValidated
  createdAt
}
```

Permisos clave:

```txt
APPLY_DISCOUNT
APPLY_COMP
CANCEL_ITEM
CANCEL_ORDER
CHANGE_PAYMENT_METHOD
TRANSFER_TABLE
REOPEN_CLOSED_ORDER
EDIT_AFTER_PRETICKET
MAKE_CASH_WITHDRAWAL
MAKE_CASH_DEPOSIT
RUN_CASH_CLOSE
VIEW_REPORTS
```

---

# 15. Retiros y depósitos

NetSilver trata retiros y depósitos como operaciones sensibles.

Ambos requieren permisos/PIN.

## Modelo Fullsite

```ts
CashMovement {
  id
  shiftId
  type // withdrawal, deposit
  amount
  reason
  createdBy
  approvedBy?
  printedAt?
}
```

## Mejora

* motivo obligatorio
* ticket de movimiento
* foto opcional del comprobante
* alerta si hay demasiados retiros
* conciliación con corte

---

# 16. Corte / cierre de turno

NetSilver tiene módulo “Realizar corte”.

También en configuración:

* Cortes y apertura
* Vista preliminar del corte global
* Fondos
* Impresiones

## Modelo esperado Fullsite

```ts
CashShift {
  id
  openedBy
  closedBy?
  openingCash
  expectedCash
  declaredCash
  difference
  openedAt
  closedAt?
}
```

Debe incluir:

* ventas por método de pago
* efectivo esperado
* efectivo declarado
* diferencia
* retiros
* depósitos
* propinas
* cortesías
* descuentos
* cancelaciones
* ventas por mesero
* ventas por plataforma
* ticket impreso

---

# 17. Delivery / repartidores

Pantalla observada: selección/asignación de repartidor.

Columnas:

* No.
* Cliente
* Dirección
* Repartidor
* Captura
* En ruta
* Tiempo
* Forma de pago
* Total
* Billete
* Cambio

Secciones:

* Órdenes asignadas
* Órdenes sin asignar

Botones:

* Asignar repartidor
* Cambiar billete
* Actualizar
* Cerrar
* Ver cerradas

## Modelo Fullsite

```ts
DeliveryOrder {
  id
  orderId
  driverId?
  customerName
  address
  capturedAt
  enRouteAt?
  deliveredAt?
  paymentMethod
  total
  cashReceived
  changeDue
  status
}
```

## Mejora

* tracking GPS
* app repartidor
* ETA
* cierre/liquidación por repartidor
* efectivo esperado por repartidor
* alertas de retraso

---

# 18. Domicilio

Menú de opciones contiene:

* Ventas a domicilio
* Asignar repartidor
* Cambiar billete
* Cerrar por repartidor
* Cambiar tiempo

Esto implica flujo:

```txt
Venta domicilio
→ asignar repartidor
→ marcar en ruta
→ cobrar/cambio
→ cerrar por repartidor
```

---

# 19. Clientes / CRM

NetSilver permite:

* asignar cliente
* nombre cliente
* clientes VIP
* recompensas
* descuento VIP

## Modelo Fullsite

```ts
Customer {
  id
  name
  phone
  email
  tags
  visitCount
  totalSpend
  averageTicket
}
```

## Mejora

* historial de consumo
* preferencias
* productos favoritos
* alergias/notas
* IA sugiere repetir orden
* segmentación automática

---

# 20. Reportes

NetSilver tiene Reportes locales, pero no se observó una capa analítica avanzada.

Fullsite debe superar con:

* ventas por hora
* ventas por mesero
* ventas por producto
* ventas por estación
* descuentos
* cancelaciones
* cortesías
* propinas
* productividad cocina
* ticket promedio
* revenue per seat hour
* margen por producto
* food cost
* merma
* forecast

---

# 21. Auditoría

Todo lo sensible debe generar evento.

Acciones críticas:

* cancelar partida
* cancelar orden
* aplicar descuento
* aplicar cortesía
* aplicar promoción
* cambiar mesa
* cambiar silla
* cambiar mesero
* cambiar forma de pago
* reimprimir ticket
* editar después de pre-ticket
* retiro
* depósito
* corte
* cambio de personas
* cambio de repartidor

## Modelo

```ts
AuditLog {
  id
  businessId
  locationId
  userId
  action
  entityType
  entityId
  beforeJson
  afterJson
  reason?
  approvedBy?
  createdAt
}
```

---

# 22. IA / capa inteligente Fullsite

Wansoft es transaccional. Fullsite debe ser inteligente.

## AI Sales Agent

* sugerir upsells
* productos con alta conversión
* combos recomendados
* empujar productos de mayor margen

Ejemplo:

```txt
Mesa 14 pidió Acai Bowl.
78% de clientes agregan proteína.
Sugerir: proteína vegana +$50.
```

## AI Food Cost Agent

* detectar costos altos
* margen por producto
* variación contra receta
* mermas

## AI Kitchen Agent

* detectar cuellos de botella
* estimar tiempos
* alertar retrasos
* balancear estaciones

## AI Fraud Agent

* detectar exceso de cancelaciones
* cortesías por usuario
* descuentos anómalos
* cambios de forma de pago
* retiros frecuentes

## AI General Manager

* proyección de ventas
* meta del día
* recomendación operativa
* staffing sugerido
* alertas de desempeño

---

# 23. Checklist de paridad mínima con Wansoft

Fullsite debe soportar:

* abrir mesa
* seleccionar mesero
* número de personas
* silla/persona
* categorías/subcategorías/productos
* modificadores multinivel
* modificadores con precio
* reglas min/max
* tiempos/cursos
* firebutton
* impresión/KDS por estación
* pagos mixtos
* propinas
* descuentos
* promociones
* 2x1
* cortesías
* cambio de mesa
* cambio de silla
* cambio de mesero
* división de cuenta
* cancelación con motivo
* cancelación con ajuste inventario
* permisos gerente
* retiros
* depósitos
* corte de caja
* delivery
* repartidores
* reportes
* auditoría

---

# 24. Principios de diseño para Fullsite

No copiar UI de Wansoft. Copiar lógica buena y mejorar UX.

## Principios

1. Menos clics.
2. Más contexto.
3. Todo auditable.
4. Todo medible.
5. Todo conectado a inventario.
6. Todo conectado a reportes.
7. IA como copiloto, no como adorno.
8. Offline-first para operación crítica.
9. KDS e impresoras robustas.
10. Seguridad granular desde el día uno.

---

# 25. Diferenciadores clave contra Wansoft

Fullsite debe ganar en:

* UX moderna
* KDS visual
* dashboard en vivo
* IA de ventas
* IA de food cost
* IA antifraude
* IA de inventario
* CRM real
* delivery con tracking
* reportes accionables
* recomendaciones automáticas
* margen en tiempo real
* forecasting
* auditoría completa
* integraciones bancarias modernas

---

# 26. Estructura técnica recomendada

## Core tables

```txt
businesses
locations
users
roles
permissions
tables
sections
orders
order_seats
order_items
modifier_groups
modifier_options
order_item_modifiers
payments
tips
discounts
promotions
cash_shifts
cash_movements
delivery_orders
drivers
kitchen_stations
printers
product_routing
audit_logs
manager_approvals
```

## Event system

Todo cambio operativo debe emitir evento:

```txt
OrderCreated
ItemAdded
ModifierSelected
ItemSentToKitchen
CourseFired
PaymentAdded
DiscountApplied
ItemCancelled
InventoryAdjusted
CashWithdrawalCreated
CashDepositCreated
ShiftClosed
DeliveryAssigned
```

Esto permitirá alimentar IA, reportes y auditoría.

---

# 27. Implementación prioritaria para Claude Code

Construir en este orden:

## Fase 1 — POS Core

* Orden
* Mesa
* Mesero
* Productos
* Modificadores
* Sillas
* Pagos mixtos
* Propinas

## Fase 2 — Operación

* KDS/impresoras
* Tiempos/firebutton
* cancelaciones con motivo
* descuentos
* promociones
* cortesías

## Fase 3 — Caja

* cash shift
* retiros
* depósitos
* corte
* reportes de caja

## Fase 4 — Delivery

* órdenes domicilio
* repartidor
* cambio/billete
* liquidación

## Fase 5 — Inteligencia

* AI Sales Agent
* AI Food Cost Agent
* AI Fraud Agent
* AI Kitchen Agent
* AI GM Agent

---

# 28. Nota final

NetSilver/Wansoft es fuerte en operación transaccional tradicional:

* vende
* imprime
* cobra
* cancela
* corta caja

Pero no tiene una capa moderna de inteligencia, analytics y automatización.

Fullsite debe igualar la lógica operativa crítica y luego superar con:

```txt
POS + KDS + Cash Control + CRM + Inventory + BI + AI Agents
```
