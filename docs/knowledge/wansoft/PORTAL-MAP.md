# Wansoft Portal Web — Mapa de Caminitos (Screenshots Jul 17)

> NOTA: El documento COMPLETO con los 211 caminitos está en `docs/strategy/WANSOFT-BIBLE.md`
> Este archivo solo documenta lo capturado visualmente en screenshots del 2026-07-17.
> Para el análisis estratégico módulo por módulo, ver la Biblia.

## Sidebar principal

1. Reportes
2. Ingresos
3. Egresos
4. Inventario
5. Facturación
6. Ecommerce
7. Punto de venta
8. Administración
9. Encuesta
10. Configuración
11. Facturas Wansoft
12. Liberaciones

## Dashboard (Escritorio)

- Selector de sucursal (dropdown: "Café Amalay - Plaza Duendes", "Amalay - Arboleda")
- KPI: Estatus de licencia (VIGENTE)
- KPI: Órdenes abiertas (count + total MXN)
- KPI: Última sincronización (horas, rojo si >48h)
- KPI: Última venta recibida (timestamp)
- Chart: Reporte de utilidad marginal (Ventas Netas / Costo / Margen, mensual)
- Sección: Por inventariar

## Reportes (expandido completo)

### Escritorio
Dashboard home

### Ingresos
Reporte de ingresos por periodo

### Egresos
Reporte de egresos por periodo

### Compras
Reporte de compras a proveedores

### Vales
Gestión de vales (vale Amalay, etc.)

### Nómina
- Reporte de asistencia
- Reporte de pago de nómina
- Reporte de incidencia

### Inventarios
- Costo y margen
- Punto de reorden
- Reporte de existencias
- Cardex (movimientos por artículo)
- Costo por artículo
- Costo por subproducto
- Costo por producto
- Productos a caducar
- Validación de recetas
- Productos que no están en recetas
- Productos que están en recetas
- Reporte de recetas
- Estado de cuenta de inventario
- Órdenes de compra canceladas
- Consolidado de existencias
- Compras sugeridas
- Paleo de barra (conteo rápido botellas/bar)
- Variación de costos
- Diferencias reporte físico vs sistema
- Tablajería (cortes de carne, rendimiento)
- Órdenes de Producción por Productor
- Reporte Cierre de Inventario
- Reporte de costos de producto vs venta
- Reporte de inventario físico vs sistema

### Ventas a terceros
Uber Eats, Rappi, DiDi, etc.

### Pantalla en cocina
Config/vista del KDS

### Integraciones
- Microsip (contabilidad)
- Getin (reservaciones)
- Detalle de ventas

### Control de acceso
Entradas/salidas de personal

### Estado de resultados
P&L mensual/trimestral

### Sincronización
Status de sync terminal ↔ nube

### Horas trabajadas
Reporte de horas por empleado

### Módulo de propinas
Propinas por mesero, % sobre venta

### Reporte de acciones realizadas en portal web
Audit trail del portal

### Auditoría
- Impresiones de tickets

---

## POS Terminal (Caja Netsilver) — Documentado en CAJA-SPEC.md

### Toolbar principal
- Opciones (menú operaciones)
- Editar cuenta
- Imprimir
- Cobrar
- Filtros
- Semáforo de estatus
- Nueva cuenta
- Actualizar
- Delivery
- Admin
- Bloquear

### Menú Opciones (4 columnas)
**Mesa:** Juntar mesas, Cambiar de mesa, Cambiar mesero, Activar HH, Ventas de mesero
**Domicilio:** Ventas a domicilio, Asignar repartidor, Cambiar billete, Cambiar tiempo
**CXC:** Cobranza, Clientes VIP
**Otros:** Cambiar cuenta, Ver detalle, Órdenes abiertas, Existencias, Cerrar con cód. barra, Asignar cliente, Nombre cliente, Agregar Propina, Código CheckIn

### Menú Admin
- Configurar netsilver
- Realizar corte
- Emitir factura
- Huella digital
- Reimprimir ticket
- Cambiar forma de pago
- Registrar vale
- Cambiar No. Personas
- Cancelaciones
- Reimprimir factura
- Propinas
- Reportes locales
- Depurar BD
- Abrir Cajón
- Depósitos
- Retiros
- Reimpresión de voucher
- Pagos anticipados
- Salir del sistema

### Captura de cuenta
- Código de barras
- CANT +/- (cantidad)
- SILLA +/- (asiento)
- Borrar/Editar/Tiempos/Fire/Apurar/Duplicar
- Búsqueda de producto
- 3 niveles de menú: Categorías → Subcategorías → Items
- Avanzadas/Cancelar/Imprimir/Cobrar/Guardar

### Edición de cuenta
- Borrar partida
- Descuento / Cortesía / 2x1
- Transferir de mesa
- Cambiar silla
- Cambiar estatus cancelada-anulada
- Descuento prorrateado
- Cambiar mesa / personas
- Dividir cuenta
- Promociones

### Cobro
- 17+ formas de pago (efectivo, dólares, cortesía, crédito, débito, Rappi, NetPay, Uber, transferencia, vales, influencer, etc.)
- Pago mixto (multi-forma)
- Auto-pago
- Propina
- Pago con tarjeta / electrónico
- Descuento VIP / Recompensas

### Cortes (5 tipos)
- Corte X (parcial)
- Corte de Turno
- Corte Z (cierre día)
- Corte Global
- Corte de Mesero

### Configuración terminal (20 módulos)
- Operativas
- Seguridad
- Cierre de cuentas
- Periféricos
- Cortes y apertura
- Ticket
- Comanda
- Factura electrónica
- Retiros
- Diseño
- Billares
- Reportes
- Megapuntos
- Propinas
- Nómina
- Control de mesas
- Comisiones
- Terminales bancarias (Clip, NetPay, BBVA, Op. en Línea)
- Anticipos
- Tiempo aire
- Notificaciones
- Existencias locales

---

## Gap Analysis: Fullsite vs Wansoft

### Fullsite TIENE (29/35 reportes)
✅ Dashboard, Ingresos, Egresos, Compras
✅ Asistencia, Pre-Nómina
✅ Costo y margen (Food Cost), Punto de reorden, Existencias
✅ Cardex (Movimientos), Costo por artículo, Costo por producto
✅ Validación de recetas, Productos sin receta, Reporte de recetas
✅ Estado de cuenta inventario, Compras sugeridas
✅ Variación de costos (agente IA), Diferencias físico vs sistema
✅ Producción, Cierre de Inventario, Costos producto vs venta
✅ Ventas a terceros (Delivery), Pantalla cocina (KDS)
✅ Control de acceso, Estado de resultados, Horas trabajadas
✅ Propinas, Auditoría

### Fullsite FALTA (6/35 reportes)
❌ Vales
❌ Reporte de incidencia
❌ Costo por subproducto (Eduardo lo pidió Jul 16)
❌ Productos a caducar
❌ Paleo de barra
❌ Tablajería

### Fullsite SUPERA a Wansoft
🚀 30 agentes IA (anomalías, fraude, predicción, upselling, staffing, etc.)
🚀 Chat IA — pregúntale a tu restaurante en español
🚀 Coach — insights automáticos
🚀 Food Cost con detección de recetas sospechosas
🚀 Auto-86 (86 automático por stock)
🚀 Predicción de compras
🚀 Conciliación bancaria
🚀 Reporte fiscal
🚀 Contabilidad CONTPAQi
🚀 Notas de crédito
🚀 Control de efectivo con flujo de caja
🚀 Voice Agent
🚀 CRM con tags y visitas
🚀 Multi-sucursal (cuando se active)
🚀 Audit trail SIEMPRE activo (en Wansoft es checkbox y AMALAY lo tiene APAGADO)
