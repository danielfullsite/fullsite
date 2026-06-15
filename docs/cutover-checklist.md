# Cutover Checklist — Wansoft → Fullsite POS

## PRE-CUTOVER (1 semana antes)

### Datos migrados
- [ ] Productos activos/inactivos revisados (522 items, confirmar con menú real)
- [ ] Precios actualizados al día
- [ ] Modificadores por categoría verificados
- [ ] Categorías correctas (33 categorías, colores, orden)
- [ ] Usuarios/PINs de TODO el staff cargados en pos_staff
- [ ] Mesas/secciones del plano verificadas vs plano físico
- [ ] Formas de pago configuradas (10 métodos: efectivo, TC, TD, transfer, Rappi, Uber, DiDi, Clip, NetPay, aDomicilio)
- [ ] Inventario inicial capturado (conteo físico)
- [ ] Recetas cargadas y verificadas (al menos platillos principales)
- [ ] Unidades de medida y conversiones correctas

### Hardware probado
- [ ] Impresora COCINA FRIA (192.168.1.21) — comanda de prueba
- [ ] Impresora COCINA CALIENTE (192.168.1.40) — comanda de prueba
- [ ] Impresora BARRA (192.168.1.30) — comanda de prueba
- [ ] Impresora PANADERIA (USB) — ticket de prueba
- [ ] Impresora EC TICKET (USB) — ticket de pago + cajón RJ11
- [ ] Cajón de dinero — abre con POST /drawer
- [ ] Bridge corriendo y auto-start verificado
- [ ] Chrome abre Fullsite POS al encender
- [ ] Internet principal estable
- [ ] Plan B si se cae internet (offline mode probado)

### Software verificado
- [ ] Login con PIN de cada rol (mesero, cajero, gerente, admin)
- [ ] Menú completo visible sin scroll
- [ ] Categorías de bebidas → barra, comida → cocina
- [ ] Modificadores correctos por categoría

## DÍA DEL CUTOVER

### Antes de abrir (7:00 AM)
- [ ] Bridge corriendo (verificar ventana de CMD)
- [ ] Chrome abierto en app.fullsite.mx/pos
- [ ] Login con PIN del primer turno
- [ ] Turno abierto con fondo inicial correcto
- [ ] Impresión de prueba a cocina y barra
- [ ] Cajón de dinero probado
- [ ] Wansoft encendido como backup (NO apagar)
- [ ] Daniel disponible por teléfono/TeamViewer

### Operación (flujo completo probado)
- [ ] **Abrir mesa** — seleccionar mesa, personas, mesero
- [ ] **Agregar productos** — tap categoría → tap producto → confirmar
- [ ] **Modificadores** — "Sin cebolla", "Extra queso", shot extra
- [ ] **Fire a cocina** — botón Cocina → comanda sale en impresora correcta
- [ ] **Fire a barra** — bebida → comanda sale en barra
- [ ] **Tiempo/curso** — separador de tiempo, fire por curso
- [ ] **Silla** — asignar items a sillas diferentes
- [ ] **Transferir mesa** — mover orden a otra mesa
- [ ] **Pre-ticket** — Cuenta → imprime pre-cuenta
- [ ] **Pago efectivo** — Cobrar → Efectivo → cambio correcto → cajón abre → ticket imprime
- [ ] **Pago tarjeta** — Cobrar → TC/TD → ticket imprime (sin cajón)
- [ ] **Pago mixto** — Cobrar → Mixto → efectivo + tarjeta → totales cuadran
- [ ] **Propina** — registrar propina en el cobro
- [ ] **Descuento** — aplicar descuento % o $ con PIN gerente
- [ ] **Cancelación** — cancelar platillo con motivo + PIN gerente
- [ ] **Anulación** — anular orden completa con PIN gerente
- [ ] **Retiro de caja** — retiro con PIN gerente + motivo
- [ ] **Depósito** — depósito con PIN gerente
- [ ] **Delivery** — crear orden delivery con repartidor
- [ ] **Facturación** — solicitud CFDI desde QR del ticket
- [ ] **Reimprimir** — reimprimir ticket
- [ ] **Corte** — corte de caja: esperado vs declarado, diferencia

### Primer corte (cierre del día)
- [ ] Corte de caja cuadra con efectivo real
- [ ] Propinas por mesero registradas
- [ ] Cancelaciones/descuentos con justificación
- [ ] Retiros/depósitos reflejados
- [ ] Inventario se dedujo correctamente (spot check 3 ingredientes)

## POST-CUTOVER (primera semana)

- [ ] Corte diario cuadra ±$50
- [ ] Comparar ventas Fullsite vs referencia Wansoft (si corre en paralelo)
- [ ] Spot check inventario cada 2 días
- [ ] Capacitación de refuerzo si hay dudas
- [ ] Recopilar feedback del staff
- [ ] Resolver bugs reportados el mismo día
- [ ] Al final de la semana: decisión GO/NO-GO para apagar Wansoft

## CONTINGENCIA

Si Fullsite falla durante operación:
1. **NO entrar en pánico** — el bridge tiene print queue, las órdenes se guardan offline
2. **Si el bridge se cae:** reiniciar con doble-click en start-bridge.bat
3. **Si Chrome se cierra:** reabrir, ir a app.fullsite.mx/pos
4. **Si internet se cae:** el POS sigue funcionando offline, sync al reconectar
5. **Si nada funciona:** abrir Wansoft, registrar ventas ahí, sincronizar después
6. **Siempre:** Daniel disponible por TeamViewer (ID: 730 530 602)
