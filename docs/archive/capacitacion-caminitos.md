> **ARCHIVED.** Replaced by: `(client-specific)`
>
> This document is kept for historical reference only.

# Manual de Caminitos — Wansoft vs Fullsite POS

> Referencia para capacitación del staff de AMALAY.
> Cada flujo operativo que se hace en Wansoft tiene su equivalente en Fullsite.
> Generado 2026-06-16.

---

## APERTURA DEL DÍA

### 1. Abrir turno / caja

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Login con usuario/password | Login con PIN de 4 dígitos (o huella) |
| 2 | Admin → Cortes y apertura | /pos/turno → "Abrir turno" |
| 3 | Ingresar fondo de caja inicial | Ingresar fondo inicial → Confirmar |
| 4 | Terminal lista | POS listo, turno abierto |

**Diferencia clave:** En Wansoft el fondo se configura por terminal. En Fullsite se registra por turno y queda en el audit log.

---

## TOMAR ÓRDENES

### 2. Nueva orden en mesa

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Botón "Nueva" | Seleccionar mesa en el grid o plano |
| 2 | Seleccionar mesero de la lista | Ya identificado por PIN al entrar |
| 3 | Ingresar número de mesa + personas | Mesa ya seleccionada, personas opcional |
| 4 | Navegar categorías (3 niveles) | Navegar categorías (tabs arriba) |
| 5 | Click en platillo → se agrega al ticket | Click en platillo → se agrega al ticket |
| 6 | CANT +/- para cambiar cantidad | Botones +/- en cada item del ticket |
| 7 | SILLA +/- para asignar asiento | Tab de silla en la barra superior |
| 8 | Botón "Guardar" | Botón "Enviar a cocina" |

**Diferencia clave:** En Fullsite el mesero se identifica al entrar con PIN, no se selecciona en cada cuenta.

### 3. Modificadores (especificaciones del platillo)

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Click en platillo ya agregado | Click en platillo → aparece modal |
| 2 | Popup con opciones por grupo | Modal con grupos: Proteína, Quitar, Agregar |
| 3 | Seleccionar modificadores | Seleccionar modificadores (obligatorios marcados) |
| 4 | Prompt "no olvides anotar especificaciones" | Validación automática de mínimos/máximos |

**Diferencia clave:** Fullsite valida que se seleccionen los modificadores obligatorios. Wansoft solo pone un recordatorio.

### 4. Tiempos de cocina (1er tiempo, 2do tiempo)

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Separador automático "XX TIEMPO: 1 XX" | Separador automático al inicio |
| 2 | Botón reloj (🕐) para agregar nuevo tiempo | Botón "Tiempo" para agregar separador |
| 3 | Botón fuego (🔥) para enviar tiempo a cocina | Botón "Enviar a cocina" envía todo |

### 5. Código de barras

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Campo "Código" + ACEPTAR | Escanear con cámara o lector USB |
| 2 | Busca por clave de producto | Busca por barcode en el catálogo |
| 3 | Agrega al ticket | Agrega al ticket automáticamente |

---

## EDITAR CUENTA

### 6. Cancelar un item

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Editar → Seleccionar partida → Borrar | Swipe izquierda en el item → Cancelar |
| 2 | (no pide motivo si "Guardar logs" está OFF) | PIN de gerente obligatorio |
| 3 | — | Motivo obligatorio |
| 4 | — | Queda en audit log (no borrable) |

**Diferencia clave:** En Wansoft se puede borrar sin rastro. En Fullsite cada cancelación requiere aprobación de gerente, motivo, y queda registrada permanentemente.

### 7. Descuento

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Editar → Descuento o Descuento prorrateado | Botón descuento → Modal |
| 2 | Seleccionar % o monto | Seleccionar % o escribir monto |
| 3 | — | PIN de gerente obligatorio |
| 4 | Se aplica | Se aplica + queda en audit log |

### 8. 2x1 / Promociones

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Editar → Aplicar 2x1 → Seleccionar partidas | Descuento → Modo 2x1 → Seleccionar par |
| 2 | Valida elegibilidad por platillo | Valida elegibilidad por platillo |
| 3 | El más barato del par se va a $0 | El más barato del par se va a $0 |
| 4 | — | PIN de gerente |

### 9. Cortesía

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Editar → Aplicar cortesía | Descuento → 100% → Motivo "cortesía" |
| 2 | — | PIN de gerente obligatorio |

### 10. Dividir cuenta (split)

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Editar → Dividir cuenta | Botón "Split" |
| 2 | Opciones: por silla, parejo, por items | Opciones: parejo (N partes) o por items |
| 3 | Se generan sub-cuentas | Se generan sub-cuentas, cada una cobra independiente |

### 11. Cambiar de mesa

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Opciones → Cambiar de mesa → Número | Editar orden → Cambiar mesa → Seleccionar |

### 12. Juntar mesas

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Opciones → Juntar mesas | Mesas → Seleccionar 2+ → Juntar |
| 2 | Seleccionar cuentas a unir | Se combinan los items |

---

## COBRAR

### 13. Cobro en efectivo

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Botón "Cobrar" ($) | Botón "Cobrar" |
| 2 | Seleccionar "Efectivo" | Seleccionar "Efectivo" |
| 3 | Ingresar monto recibido | Ingresar monto o botones rápidos ($100, $200, $500) |
| 4 | Botón "Auto" autocompleta | "Exacto" autocompleta |
| 5 | Ver cambio calculado | Ver cambio calculado |
| 6 | Enter → imprime ticket | Confirmar → imprime ticket automático |

### 14. Cobro con tarjeta

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Cobrar → Tarjeta de crédito/débito | Cobrar → Tarjeta |
| 2 | Modal de integración Clip/NetPay | Confirmar monto en terminal MP Point |
| 3 | Swipe/tap en terminal bancaria | Tap en terminal bancaria |
| 4 | Confirmación automática | Confirmar que pasó → imprime ticket |

**Nota:** AMALAY usa MP Point Mini (Bluetooth). El cajero confirma el monto manualmente.

### 15. Pago mixto (parte efectivo, parte tarjeta)

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Cobrar → Seleccionar 1ra forma | Cobrar → Agregar forma de pago |
| 2 | Ingresar monto parcial | Ingresar monto parcial |
| 3 | Agregar 2da forma de pago | Agregar otra forma de pago |
| 4 | Saldo restante se muestra | Saldo restante se actualiza |
| 5 | Guardar cuando saldo = 0 | Confirmar cuando saldo = 0 |

### 16. Propina

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | En pantalla de cobro → Campo propina | En modal de cobro → Campo propina |
| 2 | Ingresar monto o % | Ingresar monto |
| 3 | Se registra por mesero | Se registra por mesero en audit log |

**Config AMALAY:** mesero paga 5% de su venta (descuento por comisiones tarjeta / fondo común).

### 17. Formas de pago especiales

| Forma | Wansoft | Fullsite |
|---|---|---|
| Efectivo | Sí | Sí |
| Tarjeta crédito/débito | Sí (Clip/NetPay/BBVA) | Sí (MP Point) |
| Transferencia | Sí | Sí |
| Uber Eats / Rappi | Sí (como forma de pago) | Sí (forma de pago custom) |
| Vale Amalay | Sí | Sí (configurable) |
| Cortesía / Influencer | Sí | Sí (con PIN gerente) |

---

## IMPRESIÓN

### 18. Comanda a cocina

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Al guardar → se imprime comanda | Al enviar a cocina → se imprime comanda |
| 2 | Ruteo por grupo (cocina/barra) | Ruteo por estación (cocina/barra/market) |
| 3 | Impresora primaria + secundaria | Impresora por estación (configurable) |
| 4 | Muestra silla [S2] y tiempos | Muestra silla [S2] y tiempos |

### 19. Pre-cuenta (ticket para el cliente)

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Botón "Imprimir" | Se imprime automático al cobrar |
| 2 | Ticket 72mm con QR encuestas | Ticket con QR de autofacturación |
| 3 | Propina sugerida en ticket | Propina sugerida en ticket |

### 20. Reimprimir ticket

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Reimprimir ticket | /pos/historial → Buscar orden → Reimprimir |

---

## DELIVERY (Uber Eats / Rappi)

### 21. Recibir pedido de plataforma

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Botón Delivery → Ver órdenes | /pos/delivery → Órdenes llegan automático |
| 2 | Filtrar por plataforma | Tabs: Todas / Uber Eats / Rappi |
| 3 | Aceptar orden | Marcar "Preparando" |
| 4 | Cambiar estatus: Confirmada → Preparando | Preparando → Lista para recoger |
| 5 | Asignar repartidor (de lista staff) | No aplica (plataforma asigna driver) |
| 6 | — | "Esperando repartidor de Uber/Rappi" |

**Diferencia clave:** AMALAY no tiene repartidores propios. Fullsite solo controla el status de cocina. La plataforma maneja logística.

---

## INVENTARIO

### 22. Deducción automática de inventario

| | Wansoft | Fullsite |
|---|---|---|
| Método | Manual / existencias locales (OFF) | Auto-deducción por receta al cobrar |
| Recetas | 574 en Wansoft | 574 food + 91 bebidas en Fullsite |
| Alertas | No configurado | Alerta cuando stock < punto de reorden |

**Diferencia clave:** Fullsite descuenta inventario automáticamente cada vez que se cobra una orden. Wansoft no lo hace (existencias locales está desactivado en AMALAY).

---

## FACTURACIÓN (CFDI)

### 23. Emitir factura

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Emitir factura | Cliente escanea QR del ticket |
| 2 | Capturar RFC | Captura RFC en formulario web |
| 3 | — | Razón social, CP, email |
| 4 | Timbrar (PAC integrado) | Se genera solicitud → timbrado por Facturama |

**Pendiente:** Cuenta de Facturama en producción ($1,650 MXN).

---

## CIERRE DEL DÍA

### 24. Retiro de caja

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Retiros | Botón retiro en POS |
| 2 | Ingresar monto + motivo | Monto + motivo + PIN gerente |
| 3 | — | Queda en audit log |

### 25. Depósito de caja

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Depósitos | Botón depósito en POS |
| 2 | Ingresar monto + motivo | Monto + motivo + PIN gerente |
| 3 | — | Queda en audit log |

### 26. Corte de turno

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Realizar corte → Corte de Turno | /pos/turno → Cerrar turno |
| 2 | Resumen: efectivo, tarjeta, vales | Wizard: conteo de efectivo → comparar con sistema |
| 3 | Imprime corte (1 copia) | Resumen en pantalla + opción imprimir |
| 4 | — | Diferencia efectivo real vs sistema |

### 27. Corte de mesero

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Corte de Mesero | /pos/staff-analytics → Seleccionar mesero |
| 2 | Ventas, propinas, descuento 5% | Ventas, tickets, propinas, ticket promedio |

### 28. Corte Z (cierre del día)

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Corte Z | /pos/corte → Seleccionar fecha |
| 2 | No permite con órdenes abiertas | Muestra advertencia si hay órdenes abiertas |
| 3 | Imprime resumen del día | Resumen completo: por forma de pago, mesero, hora pico |

---

## ADMINISTRACIÓN

### 29. Checador de asistencia

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | No tiene (externo) | /pos/asistencia → PIN o huella → Entrada/Salida |

### 30. Anular orden completa

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Editar → Cambiar estatus cancelada-anulada | Botón "Anular orden" |
| 2 | — | PIN de gerente obligatorio |
| 3 | — | Motivo obligatorio |
| 4 | — | Audit log inmutable |

### 31. Cambiar forma de pago (post-cobro)

| Paso | Wansoft | Fullsite |
|---|---|---|
| 1 | Admin → Cambiar forma de pago | /pos/corte → Reabrir orden → Recobrar |
| 2 | Sin audit trail (logs OFF) | PIN gerente + audit log completo |

**Diferencia clave:** En Wansoft esto es un punto de fraude conocido. En Fullsite requiere aprobación de gerente y queda registrado.

---

## MONITOR Y REPORTES

### 32. Ver cómo va el día

| | Wansoft | Fullsite |
|---|---|---|
| Método | Ir a Reportes locales o portal web | /pos/monitor → Dashboard en tiempo real |
| Contenido | Requiere generar reporte | Ventas, órdenes, pagos, inventario, cocina — todo live |

### 33. Auditoría

| | Wansoft | Fullsite |
|---|---|---|
| Estado | "Guardar logs" = OFF en AMALAY | SIEMPRE activo, no desactivable |
| Acceso | Solo desde config admin | /pos/auditoria → Buscar por acción, mesero, fecha |
| Contenido | Si está ON: log básico | Cada acción: quién, qué, cuándo, aprobado por quién |

---

## FLUJOS QUE FULLSITE TIENE Y WANSOFT NO

| Flujo | Descripción |
|---|---|
| KDS digital | Cocina ve órdenes en pantalla (no solo comanda impresa) |
| Auto-deducción inventario | Se descuenta al cobrar, no manual |
| Food cost en tiempo real | /pos/food-cost muestra costo por receta |
| Alertas de inventario | Notifica cuando stock baja del punto de reorden |
| Merma con tracking | /pos/merma registra desperdicio por motivo |
| Órdenes de compra | /pos/orden-compra sugiere qué comprar |
| Display para cliente | /pos/cliente muestra la orden en TV |
| Event store | Cada evento se guarda inmutable (strangler pattern) |
| Offline-first | Funciona sin internet, sincroniza al reconectar |
| Copiloto IA | 13 agentes analizan operaciones 24/7 |

---

---

# PARTE 2: DASHBOARD WEB — Wansoft vs Fullsite

> El dashboard web de Wansoft (wansoft.net) tiene 11 secciones con ~100 sub-opciones.
> Aquí está el mapeo completo de cada una contra Fullsite Dashboard (app.fullsite.mx).

---

## REPORTES

| Wansoft (Reportes →) | Fullsite | Status |
|---|---|---|
| Escritorio (KPIs, utilidad marginal) | Dashboard principal | Cubierto |
| Ingresos | /ventas + /tendencias | Cubierto |
| Egresos | /egresos | Cubierto |
| Inventarios | /pos/inventario + /pos/food-cost | Cubierto |
| Pantalla en cocina | /pos/cocina + /pos/kds + /pos/barra | Cubierto (mejor: digital, no solo impreso) |
| Integraciones | /pos/delivery (Uber/Rappi) | Cubierto |
| Control de acceso | /pos/asistencia (PIN + huella) | Cubierto |
| Estado de resultados | — | Pendiente (datos existen, falta vista P&L) |
| Sincronización | Automática (Supabase real-time) | Cubierto (mejor: no manual) |
| Horas trabajadas | /pos/asistencia | Cubierto |
| Módulo de propinas → Reporte | /pos/staff-analytics | Cubierto |
| Módulo de propinas → Fondos | /pos/corte (cash movements) | Cubierto |
| Reporte acciones portal web | /pos/auditoria | Cubierto (mejor: siempre activo) |
| Auditoría → Transferencia de platillos | /pos/auditoria (action: item_transferred) | Cubierto |

---

## INGRESOS

| Wansoft (Ingresos →) | Fullsite | Status |
|---|---|---|
| Ventas por sucursal | /ventas (filtro por fecha/mesero/categoría) | Cubierto |
| Proyección de ventas | Agente IA close_predictor (2pm/4pm/6pm) | Parcial (no hay página dedicada) |
| Detalle de ticket | /pos/historial | Cubierto |
| Cortes | /pos/corte (turno/fecha) | Cubierto |
| Cobranza | — | No aplica (CxC desactivado en AMALAY) |
| Retiros | /pos/corte → Cash movements | Cubierto |
| Pagos anticipados | — | Baja prioridad |
| Depósitos | /pos/corte → Cash movements | Cubierto |
| Cuentas por cobrar | — | No aplica (desactivado en AMALAY) |
| Pagos | /pos/historial (por forma de pago) | Cubierto |
| Control de Efectivo → Flujo | — | Pendiente |
| Control de Efectivo → Transferencia | — | Pendiente |
| Control de Efectivo → Recibidas | — | Pendiente |
| Control de Efectivo → Depósitos bancarios | — | Pendiente |

---

## EGRESOS

| Wansoft (Egresos →) | Fullsite | Status |
|---|---|---|
| Facturas (proveedores) | /pos/facturas-proveedor | Cubierto |
| Pagos | /pos/compras (recepción + pago) | Cubierto |
| Notas de Crédito | — | Pendiente con Facturama |
| Proveedores | /pos/compras (catálogo proveedores) | Cubierto |
| Compradores | — | No aplica |
| Tipo de vales | Forma de pago "Vale Amalay" | Cubierto |
| Nómina → Días de asueto | — | AMALAY lo maneja externo |
| Nómina → Turnos | /pos/turno | Cubierto |
| Nómina → Programación semanal | — | AMALAY lo maneja externo |
| Nómina → Pago de nómina | — | AMALAY lo maneja externo |

---

## INVENTARIO

### Entradas y salidas

| Wansoft (Inventario →) | Fullsite | Status |
|---|---|---|
| Con facturas | /pos/compras → recepción con factura | Cubierto |
| Transferencias → Recibidas | — | No aplica (1 sucursal) |
| Transferencias → Realizadas | — | No aplica (1 sucursal) |
| Transferencias → Hacer transferencia | — | No aplica (1 sucursal) |
| Devoluciones | /pos/merma (motivo: devolución) | Cubierto |
| Con código de barras | /pos (barcode scanner integrado) | Cubierto |
| Ajustes por lote | /pos/inventario-fisico (ajuste masivo) | Cubierto |
| Subproductos en proceso | Recetas de subproductos en pos_recipes | Parcial |
| Carga masiva de inventario | Script de sync (hoy sincronizamos 439 items) | Cubierto |
| Salida masiva de inventario | /pos/merma (múltiples items) | Cubierto |
| Órdenes de compra | /pos/orden-compra | Cubierto |
| Ventas de terceros | /pos/delivery (Uber/Rappi) | Cubierto |

### Tablajería

| Wansoft | Fullsite | Status |
|---|---|---|
| Configuración | — | No aplica a café |
| Entradas con producto base | — | No aplica |

### Orden de Producción

| Wansoft | Fullsite | Status |
|---|---|---|
| Productores | — | No aplica |
| Plantillas | — | No aplica |
| Órdenes de Producción | — | No aplica |

### Auditoría de inventario

| Wansoft | Fullsite | Status |
|---|---|---|
| Ajustes de inventario | /pos/inventario (movimientos) | Cubierto |
| Inventario físico vs sistema | /pos/inventario-fisico | Cubierto |
| Productos pendientes de rebaja | /pos/inventario (alertas stock bajo) | Cubierto |
| Reporte de existencias | /pos/inventario (stock completo) | Cubierto |
| Cierre de inventario | — | Pendiente (no bloquea cutover) |

### Control de inventarios

| Wansoft | Fullsite | Status |
|---|---|---|
| Almacenes | Config en Supabase (1 almacén) | Cubierto |
| Salidas por área/almacén | /pos/inventario (movimientos por tipo) | Cubierto |
| Salida de platillos por almacén | Auto-deducción por receta al cobrar | Cubierto (mejor: automático) |
| Departamentos | Categorías de ingredientes | Cubierto |
| Unidades de medida | Unidad por ingrediente (kg, lt, pz) | Cubierto |
| Presentaciones | — | No aplica |
| Productos | /pos/inventario (1,011 ingredientes) | Cubierto |
| Punto de reorden | /pos/inventario (reorder_point por item) | Cubierto |
| Precios | cost_per_unit por ingrediente | Cubierto |
| Áreas | Estaciones (cocina/barra/market) | Cubierto |
| Plantillas inv. físico vs sistema | /pos/inventario-fisico | Cubierto |
| Plantillas de OC | /pos/orden-compra (auto-sugiere) | Cubierto |
| Config límites variación costo | — | Baja prioridad |

### Producción y costos

| Wansoft | Fullsite | Status |
|---|---|---|
| Conversiones | — | Baja prioridad |
| Recetas de platillos | /pos/recetas (574 food + 91 bebidas) | Cubierto |
| Recetas de subproductos | pos_recipes (subrecetas como ingredientes) | Cubierto |
| Costos adicionales | — | Baja prioridad |

---

## FACTURACIÓN

| Wansoft (Facturación →) | Fullsite | Status |
|---|---|---|
| Emitir factura | /pos/facturacion (QR → RFC → timbrado) | Cubierto (falta Facturama producción) |
| Factura Global con txt | — | Pendiente con Facturama |
| Factura Global sin txt | — | Pendiente con Facturama |
| Facturas emitidas | /pos/facturacion (historial) | Cubierto |
| Reporte Conciliación | — | Pendiente |
| Factura Agrupada | — | Baja prioridad |
| Clientes (facturación) | pos_cfdi_requests (RFC guardado) | Cubierto |
| Notas de crédito → Emitir | — | Pendiente con Facturama |
| Notas de crédito → Emitidas | — | Pendiente |
| Complementos de pago | — | Baja prioridad (solo PPD) |

---

## ECOMMERCE

| Wansoft (Ecommerce →) | Fullsite | Status |
|---|---|---|
| Disponibilidad platillos integraciones | — | Pendiente (Rappi/Uber API) |
| Estatus plataformas | /pos/delivery (status por plataforma) | Cubierto |
| Estatus de menú integración | — | Pendiente (Rappi/Uber API) |
| Estatus órdenes programadas | — | No aplica (Rappi no soporta) |
| Estatus de órdenes | /pos/delivery (todas las órdenes) | Cubierto |
| Tiempo de preparación | /pos/kds (timer por orden) | Cubierto |
| Admin → Reporte órdenes integradas | /pos/delivery + Dashboard delivery | Cubierto |
| Admin → Config horario por integración | — | Pendiente (Rappi/Uber API) |
| Admin → Config grupos por marcas | — | No aplica |
| Admin → Config platillos | 522 items en código + Supabase | Cubierto |
| Admin → Config modificadores | 197 modificadores importados | Cubierto |
| Admin → Config grupos | 55 grupos multinivel | Cubierto |
| Admin → Cupones de Descuento | — | No usan ecommerce propio |

---

## PUNTO DE VENTA

### Restaurante

| Wansoft (PdV →) | Fullsite | Status |
|---|---|---|
| Forma de pago | pos_payment_methods en Supabase | Cubierto |
| Tamaños | Modificadores por tamaño | Cubierto |
| Tipos de grupos | Categorías en MENU_CATEGORIES | Cubierto |
| Grupos | 55 grupos importados de Wansoft | Cubierto |
| Config horarios para platillos | — | Baja prioridad |
| Platillos | 522 platillos activos | Cubierto |
| Modificadores | 197 opciones en pos_modifier_groups | Cubierto |
| Asignación de modificadores | 130 asignaciones por platillo | Cubierto |
| Config modificadores en niveles | Multinivel con min/max/required | Cubierto |
| Copiar config modificadores | — | Baja prioridad |
| Modificadores adicionales por tipo orden | — | Baja prioridad |
| Promociones | /pos (modo 2x1, descuentos con PIN) | Cubierto |
| Domicilio | /pos/delivery | Cubierto |

### Tarjetas de Regalo

| Wansoft | Fullsite | Status |
|---|---|---|
| Administración de tarjetas | — | "Vale Amalay" como forma de pago |
| Reporte Tarjetas de Regalo | — | Baja prioridad |
| Cancelar pagos | /pos/corte → Reabrir orden | Cubierto |

### Tienda (retail)

| Wansoft | Fullsite | Status |
|---|---|---|
| Forma de pago | Mismas formas de pago | Cubierto |
| Tipo de precio | Precio por item | Cubierto |
| Tipos de grupos / Grupos | Categorías mkt-* | Cubierto |
| Artículos | Items market en MENU_CATEGORIES | Cubierto |
| Promociones | Descuentos con PIN gerente | Cubierto |

---

## ADMINISTRACIÓN

| Wansoft (Admin →) | Fullsite | Status |
|---|---|---|
| Usuarios de punto de venta | pos_staff en Supabase (PIN + roles) | Cubierto |
| Perfil de usuario POS | Roles: admin/gerente/capitán/cajero/mesero | Cubierto |
| Usuarios de portal web | Auth Supabase (email) | Cubierto |
| Perfil de usuario portal web | Roles en Supabase | Cubierto |

---

## ENCUESTA

| Wansoft | Fullsite | Status |
|---|---|---|
| Configuración de encuesta | — | QR en ticket (link externo) |
| Reporte | — | Baja prioridad |

---

## CONFIGURACIÓN

| Wansoft (Config →) | Fullsite | Status |
|---|---|---|
| Sucursal | client_id en Supabase (multi-tenant) | Cubierto |
| Facturación electrónica | /pos/facturacion (Facturama) | Cubierto (falta cuenta producción) |
| Integraciones Ecommerce | Webhook Uber Eats, Rappi pendiente | Parcial |
| Cuentas contables | Integración CONTPAQi (Andy) | Cubierto |
| Cuentas bancarias | — | Baja prioridad |

---

## FACTURAS WANSOFT (billing)

| Wansoft | Fullsite | Status |
|---|---|---|
| Facturas de licencia Wansoft | No aplica — Fullsite es tu producto | Ya no pagas licencia |
| Por pagar: $42,374.59 | $0.00 con Fullsite | Ahorro directo |

---

## LIBERACIONES

| Wansoft | Fullsite | Status |
|---|---|---|
| Log de liberaciones | — | No aplica |

---

## RESUMEN DE COBERTURA

| Sección | Total opciones | Cubiertas | Pendientes | No aplica |
|---|---|---|---|---|
| Reportes | 14 | 13 | 1 (Estado resultados) | 0 |
| Ingresos | 14 | 8 | 4 (Control efectivo) | 2 |
| Egresos | 10 | 4 | 1 (Notas crédito) | 5 (nómina) |
| Inventario | 30 | 24 | 1 (Cierre inv) | 5 (tablajería/producción) |
| Facturación | 10 | 4 | 4 (Factura Global, NC) | 2 |
| Ecommerce | 13 | 6 | 3 (APIs delivery) | 4 |
| Punto de venta | 18 | 15 | 0 | 3 |
| Administración | 4 | 4 | 0 | 0 |
| Encuesta | 2 | 0 | 0 | 2 |
| Configuración | 5 | 3 | 1 (Integraciones) | 1 |
| Facturas Wansoft | 1 | — | — | 1 |
| Liberaciones | 1 | — | — | 1 |
| **TOTAL** | **122** | **81 (66%)** | **15 (12%)** | **26 (21%)** |

**81 de 122 opciones cubiertas.** Los 15 pendientes son mayormente facturación avanzada y control de efectivo — ninguno bloquea el cutover.

---

## NOTAS PARA CAPACITACIÓN

1. **PIN:** Cada persona tiene un PIN de 4 dígitos. El PIN reemplaza usuario/password de Wansoft.
2. **Gerente:** Cancelaciones, descuentos, retiros y depósitos requieren PIN de gerente.
3. **Huella:** Opcional para checador de asistencia (no obligatorio para POS).
4. **Impresoras:** Mismas impresoras, mismas IPs. El print bridge se encarga del ruteo.
5. **Offline:** Si se cae el internet, el POS sigue funcionando. Las órdenes se sincronizan al reconectar.
6. **Todo queda registrado:** A diferencia de Wansoft, no se puede borrar nada. Cada acción tiene rastro.
7. **Inventario:** Se descuenta automáticamente al cobrar (Wansoft no lo hace). 1,011 ingredientes, 665 recetas.
8. **Ahorro:** Ya no se paga licencia Wansoft ($42,374.59 pendientes). Fullsite es propio.
