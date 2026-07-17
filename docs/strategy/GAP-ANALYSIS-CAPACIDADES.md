# Gap Analysis de Capacidades Operativas — Fullsite vs Wansoft

> No es un listado de pantallas. Es un inventario de TRABAJO REAL de restaurante.
> Cada fila representa algo que alguien hace en un restaurante serio.
> Generado: 2026-07-17. Fuente: WANSOFT-BIBLE.md + sesiones Eduardo + operacion AMALAY.

---

## Como leer esta matriz

- **Trabajo operativo**: lo que alguien HACE, no una pantalla
- **Frecuencia**: diario / semanal / mensual / excepcional
- **Quien**: dueno (D), gerente (G), cajero (C), cocina (K), compras (P), contador ($$), RH
- **Wansoft**: como lo resuelve hoy
- **Fullsite**: como lo resolvemos hoy
- **Estado**: RESUELTO / PARCIAL / FALTA / SUPERA / ENTERRAR
- **Rediseno**: si Fullsite deberia resolverlo diferente a Wansoft

---

## 1. VENDER (el core — sin esto no hay restaurante)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 1.1 | Abrir turno con fondo de caja | Diario | C | Admin > Cortes y apertura | /pos/turno > Abrir turno | RESUELTO | No |
| 1.2 | Abrir mesa, asignar mesero y personas | Diario | C/G | Nueva > seleccionar mesero > mesa > personas | Seleccionar mesa en grid, mesero por PIN | SUPERA | Mesero se identifica 1 vez, no en cada mesa |
| 1.3 | Tomar orden: navegar menu, agregar items | Diario | C | 3 niveles categoria > subcategoria > item | Tabs de categoria > items | RESUELTO | No |
| 1.4 | Modificadores obligatorios y opcionales | Diario | C | Popup sin validacion (solo nag "no olvides") | Modal escalonado con validacion min/max | SUPERA | Validacion real vs recordatorio |
| 1.5 | Asignar silla/asiento por item | Diario | C | SILLA +/- en captura | Tab de silla en barra superior | RESUELTO | No |
| 1.6 | Tiempos de platillo (1er/2do/3er tiempo) | Diario | C | Separador + fire button | Separador + envio a cocina | RESUELTO | No |
| 1.7 | Enviar comanda a cocina (impresion por estacion) | Diario | C | Guardar > imprime por grupo/platillo | Enviar a cocina > print bridge por estacion | RESUELTO | No |
| 1.8 | Codigo de barras para items market | Diario | C | Campo Codigo + ACEPTAR | Escaneo con camara/lector USB | RESUELTO | No |
| 1.9 | Cancelar item (3 caminos: no preparo/merma/anular) | Diario | C/G | Editar > borrar > motivo > "se preparo?" | Swipe > cancelar > motivo > preparo? > PIN gerente | SUPERA | Audit siempre on + PIN obligatorio |
| 1.10 | Descuento por item o cuenta completa | Diario | G | Editar > descuento/cortesia > prorrateado | Modal descuento + PIN gerente + audit | SUPERA | Audit trail obligatorio |
| 1.11 | Promocion 2x1 | Diario | C | Editar > 2x1 > seleccionar items elegibles | Modal 2x1 > seleccion > mas barato gratis | RESUELTO | No |
| 1.12 | Cobrar con pago mixto (efectivo+tarjeta+transferencia) | Diario | C | Pantalla cobro > N formas de pago > Auto | Modal cobro > pagos multiples > auto-calculo | RESUELTO | No |
| 1.13 | Formas de pago custom (influencer, vales, cortesia) | Diario | C | 17+ formas configurables | Formas de pago custom desde pos_payment_methods | RESUELTO | No |
| 1.14 | Propina en cobro | Diario | C | Agregar propina en pantalla cobro | Campo propina en modal de cobro | RESUELTO | No |
| 1.15 | Imprimir ticket con QR facturacion | Diario | C | Ticket 72mm con QR encuestas | Ticket con QR auto-facturacion | SUPERA | Self-service facturacion |
| 1.16 | Dividir cuenta por persona/silla | Semanal | C | Editar > Dividir cuenta | Split por silla | RESUELTO | No |
| 1.17 | Juntar mesas | Semanal | C | Opciones > Juntar mesas | Fusion de mesas en grid | RESUELTO | No |
| 1.18 | Cambiar mesa / cambiar mesero | Semanal | C/G | Opciones > Cambiar mesa/mesero | Editar orden > cambiar | RESUELTO | No |
| 1.19 | Transferir items entre mesas | Semanal | C | Editar > Transferir de mesa | Mover items entre ordenes | RESUELTO | No |
| 1.20 | Reimprimir ticket | Semanal | C | Admin > Reimprimir ticket | Boton reimprimir (con throttle 3s) | RESUELTO | No |
| 1.21 | Cambiar forma de pago post-cobro | Excepcional | G | Admin > Cambiar forma de pago (sin audit en Wansoft!) | No implementado | FALTA | Implementar CON audit trail obligatorio |
| 1.22 | Pagos anticipados (eventos) | Excepcional | G | Admin > Pagos anticipados | No implementado | FALTA | Vincular a reservaciones/eventos |
| 1.23 | Registrar vale | Excepcional | G | Admin > Registrar vale | No implementado | FALTA | Vales como tipo de pago, no modulo |
| 1.24 | Bloquear terminal (volver a PIN) | Diario | C | Boton candado | Boton bloquear en mesas | RESUELTO | No |
| 1.25 | Delivery: recibir orden de plataforma | Diario | C | Modulo Delivery con filtros por estatus/plataforma | /pos/delivery | PARCIAL | Falta integracion directa API (hoy via tablets) |
| 1.26 | Delivery: asignar repartidor con billete/cambio | Semanal | G | Opciones > Asignar repartidor > billete/cambio | No implementado (AMALAY no usa delivery propio) | FALTA | Solo cuando delivery propio se active |

---

## 2. CERRAR EL DIA (reconciliacion — el dueno duerme tranquilo o no)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 2.1 | Corte de turno (cajero cuadra su caja) | Diario | C | Admin > Corte de Turno > fondo+ventas+depositos-retiros=esperado vs declarado | CierreCajaWizard: contar efectivo > aprobar con PIN gerente | RESUELTO | Simplificado de 4 a 2 pasos |
| 2.2 | Corte X (parcial, sin cerrar — "como vamos?") | Diario | G | Admin > Corte X | No implementado | FALTA | Dashboard ya muestra ventas en tiempo real — pero el formato impreso formal falta |
| 2.3 | Corte Z (cierre fiscal del dia, consecutivo) | Diario | G | Admin > Corte Z con numeracion consecutiva | No implementado como Z formal | FALTA | Necesario para Hacienda. Numeracion consecutiva critica |
| 2.4 | Corte Global (consolida todas las terminales) | Diario | D/G | Admin > Corte Global | No implementado | FALTA | Necesario para multi-terminal. Dashboard ya consolida pero sin formato formal |
| 2.5 | Corte por mesero | Diario | G | Admin > Corte de Mesero | /meseros muestra ventas por mesero | PARCIAL | Falta formato imprimible per-mesero |
| 2.6 | Retiro de efectivo con motivo y PIN | Diario | G | Admin > Retiros (con escalation de permisos) | Retiro en POS con PIN gerente | RESUELTO | No |
| 2.7 | Deposito a caja | Diario | G | Admin > Depositos | Deposito en POS con PIN gerente | RESUELTO | No |
| 2.8 | Abrir cajon sin venta | Excepcional | G | Admin > Abrir Cajon | Comando ESC/POS desde bridge | RESUELTO | No |
| 2.9 | Deposito bancario (registrar que se deposito al banco) | Diario | G | Portal > Control de Efectivo > Depositos | /control-efectivo > registrar deposito | RESUELTO | No |
| 2.10 | Propinas: calcular fondo y distribucion | Diario | G | Modulo de propinas (5% de venta del mesero al pool) | /propinas + agente tips_analyzer | PARCIAL | Falta el calculo automatico del 5% sobre venta |

---

## 3. SABER CUANTO GANE (reportes — el corazon del dueno)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 3.1 | Ver ventas del dia/semana/mes | Diario | D/G | Portal > Reportes > Ingresos > Ventas por sucursal | / (dashboard) + /ventas | SUPERA | Real-time vs esperar sync |
| 3.2 | Ver ventas por mesero | Diario | D/G | Portal > Reportes > Ventas por mesero | /meseros | SUPERA | Dashboard interactivo vs Excel |
| 3.3 | Ver ventas por platillo/categoria | Semanal | D/G | Portal > Reportes > Ventas por platillo/grupo | /platillos + /tendencias | SUPERA | Con tendencias y IA |
| 3.4 | Ver ventas por hora (ocupacion) | Semanal | G | Portal > Reportes > Ventas por hora + Personas por hora | No implementado (datos por hora no disponibles de Wansoft) | FALTA | Critico cuando POS Fullsite genere datos propios |
| 3.5 | Ver ventas por forma de pago | Semanal | D/G | Portal > Reportes > Ventas por forma de pago | /ingresos + dashboard | RESUELTO | No |
| 3.6 | Comparar esta semana vs semana pasada | Semanal | D/G | Manual (descargar 2 Excels y comparar) | Dashboard automatico con delta % | SUPERA | Comparacion automatica |
| 3.7 | Comparar este ano vs ano pasado | Mensual | D | Manual | /tendencias con chart YoY | SUPERA | Automatico |
| 3.8 | Proyeccion de ventas del mes | Mensual | D | Portal > Reportes > Proyeccion de ventas | Dashboard > progreso del mes con proyeccion | SUPERA | IA vs extrapolacion lineal |
| 3.9 | Reporte para el contador | Semanal | $$ | Excel de ventas con hoja "Reporte Contador" | /contabilidad con polizas CONTPAQi | SUPERA | Formato directo para CONTPAQi |
| 3.10 | Descuentos, cortesias, cancelaciones detalle | Semanal | G | Portal > 4 reportes separados (desc/cortesias/cancel/anulaciones) | /cancelaciones + /ventas seccion anti-fraude | PARCIAL | Falta detalle por-item de cancelaciones individuales |
| 3.11 | Estado de resultados (P&L mensual) | Mensual | D | Portal > Estado de resultados (automatico) | /estado-resultados | PARCIAL | Labor cost estimado, food cost a veces estimado. Necesita datos reales |
| 3.12 | Exportar datos a Excel | Semanal | G/$$ | Todos los reportes exportan a Excel nativo | /reportes exporta CSV | PARCIAL | CSV no es Excel. Falta .xlsx real |

---

## 4. CONTROLAR LO QUE TENGO (inventario — el 35-45% del gasto)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 4.1 | Ver stock actual de todos los productos | Diario | P/G | Portal > Inventario > Reporte de existencias | /inventario-real | RESUELTO | No |
| 4.2 | Registrar entrada de mercancia | Diario | P | Portal > Entradas y salidas > con/sin factura | /inventario-real/entradas | PARCIAL | Entrada no actualiza pos_inventory automaticamente |
| 4.3 | Registrar entrada con factura XML | Semanal | P | Portal > Entradas > Con factura | /inventario-real/entradas-factura | RESUELTO | No |
| 4.4 | Registrar merma/desperdicio | Diario | K/G | Portal > ajustes (tipo merma) | /inventario-real/merma | PARCIAL | Merma no deduce de pos_inventory automaticamente |
| 4.5 | Toma fisica (conteo real vs sistema) | Semanal | P/G | Portal > Inventario fisico vs sistema | /inventario-real/toma-fisica | PARCIAL | Conteo no ajusta stock automaticamente |
| 4.6 | Ver movimientos historicos por producto (cardex) | Semanal | P/G | Portal > Cardex | /inventario-real/movimientos | RESUELTO | No |
| 4.7 | Punto de reorden (que comprar) | Diario | P | Portal > Punto de reorden | /inventario-real/reorden | RESUELTO | Con auto-config basado en consumo |
| 4.8 | Generar orden de compra a proveedor | Semanal | P | Portal > Ordenes de compra (internas) | /inventario-real/orden-compra + WhatsApp | SUPERA | OC a proveedor externo directo |
| 4.9 | Recibir orden de compra (verificar entrega) | Semanal | P | Portal > OC recibidas | /pos/recepcion-factura | RESUELTO | Con 6 motivos de discrepancia |
| 4.10 | Devolucion a proveedor | Excepcional | P | Portal > Devoluciones | No implementado | FALTA | Biblia lo marca como caso real frecuente |
| 4.11 | Transferir producto entre sucursales | Excepcional | P/G | Portal > Transferencias (760 refs!) | No implementado | FALTA | Pre-requisito para cadenas >5 sucursales |
| 4.12 | Carga masiva de inventario (Excel) | Excepcional | P | Portal > Carga masiva | /admin/carga-masiva | RESUELTO | No |
| 4.13 | Productos a punto de caducar | Semanal | P/K | Portal > Productos a caducar | No implementado | FALTA | Deberia ser alerta proactiva, no reporte |
| 4.14 | Paleo de barra (pesar botellas abiertas) | Semanal | G | Portal > Paleo de barra | No implementado | FALTA | Solo para restaurantes con barra. Post-500 |
| 4.15 | Cierre de inventario mensual | Mensual | P/G | Portal > Reporte Cierre de Inventario | /cierre-inventario | RESUELTO | Con snapshot historico |
| 4.16 | Variacion de costos (proveedor subio precio?) | Semanal | P/G | Portal > Variacion de costos | Agente cost-variance + /costos | SUPERA | IA detecta automaticamente vs reporte pasivo |
| 4.17 | Auto-86 (bloquear venta si no hay stock) | Diario | K/G | Portal > Existencias locales (checkbox, casi nadie lo usa) | /auto86 | SUPERA | Automatico vs checkbox que nadie activa |

---

## 5. SABER CUANTO CUESTA LO QUE VENDO (food cost — la diferencia entre ganar y perder)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 5.1 | Ver food cost por platillo | Semanal | G/D | Portal > Costo y margen | /food-cost | SUPERA | Monitor real-time con alertas vs Excel |
| 5.2 | Ver food cost por categoria | Semanal | G/D | Portal > Costo y margen por grupo | /food-cost (agrupado) | RESUELTO | No |
| 5.3 | Crear/editar receta de platillo | Excepcional | K/G | Portal > Recetas de platillos | /recetas | RESUELTO | No |
| 5.4 | Crear/editar sub-receta (salsa, base, preparacion) | Excepcional | K/G | Portal > Recetas de subproductos | No implementado como entidad separada | FALTA | Eduardo lo pidio Jul 16. Critico para costeo real |
| 5.5 | Factor de rendimiento por ingrediente | Config | K/G | Integrado en recetas (yield factor) | No implementado | FALTA | Eduardo lo pidio Jul 16. "Todo en lo que falla en los restaurantes" |
| 5.6 | Simulador de precios (dado costo %, calcular precio) | Excepcional | G/D | No existe (Eduardo usa Excel propio) | No implementado | FALTA | Oportunidad de SUPERAR a Wansoft |
| 5.7 | Validar que todas las recetas existan y esten correctas | Mensual | G | Portal > Validacion de recetas | /food-cost (deteccion de sospechosas) | SUPERA | IA detecta recetas mal configuradas |
| 5.8 | Produccion batch (salsas, panes, bases) | Diario | K | Portal > Orden de Produccion | /inventario-real/produccion | PARCIAL | Pagina existe pero produccion no afecta inventario |
| 5.9 | Costeo de produccion (MP entrada vs producto salida) | Semanal | G | Portal > Ordenes de Produccion por Productor | No implementado | FALTA | Biblia marca que Wansoft gana aqui |
| 5.10 | Costos adicionales (gas, mano de obra, depreciacion) | Mensual | G/$$ | Portal > Costos adicionales | No implementado | FALTA | Completa el food cost real |

---

## 6. CONTROLAR EL DINERO (finanzas — el contador y el dueno)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 6.1 | Registrar gasto con factura XML | Semanal | P/$$ | Portal > Egresos > Facturas | /gastos (con parser XML CFDI) | SUPERA | Parser automatico de CFDI |
| 6.2 | Registrar gasto de caja chica (sin factura) | Diario | G | Portal > Egresos > (manual) | /gastos tab Caja chica | RESUELTO | No |
| 6.3 | Notas de credito | Mensual | $$ | Portal > Egresos > Notas de credito | /notas-credito | RESUELTO | No |
| 6.4 | Cuentas por cobrar (CXC) | Semanal | G/$$ | Portal > Ingresos > Cuentas por cobrar | No implementado | FALTA | AMALAY no lo usa pero restaurantes corporativos si |
| 6.5 | Flujo de efectivo (entradas y salidas de cash) | Diario | G | Portal > Ingresos > Control de Efectivo > Flujo | /control-efectivo | RESUELTO | No |
| 6.6 | Conciliacion ventas tarjeta vs deposito banco | Semanal | G/$$ | No existe en Wansoft | /conciliacion (upload CSV banco) | SUPERA | Wansoft no tiene esto |
| 6.7 | Reporte fiscal (IVA trasladado, acreditable, ISR) | Mensual | $$ | No existe como reporte consolidado en Wansoft | /reporte-fiscal | SUPERA | Wansoft no tiene |
| 6.8 | Polizas contables para CONTPAQi | Mensual | $$ | Portal > Integraciones > Microsip | /contabilidad con export polizas | RESUELTO | No |
| 6.9 | Facturacion CFDI individual | Diario | C | Portal > Facturacion > Emitir | /pos/facturacion + QR auto-factura | SUPERA | Self-service por QR |
| 6.10 | Factura global (ventas sin factura individual) | Mensual | $$ | Portal > Factura Global (con/sin txt SAT) | No implementado como factura global | FALTA | Necesario para cumplimiento fiscal |
| 6.11 | Complementos de pago (PPD) | Mensual | $$ | Portal > Complementos de pago | No implementado | FALTA | Territorio del contador. Baja prioridad |
| 6.12 | Transferencia de efectivo entre sucursales | Excepcional | G | Portal > Transferencia de efectivo | No implementado | FALTA | Pre-requisito multi-sucursal |

---

## 7. MANEJAR AL EQUIPO (RH — alta rotacion, turnos variables)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 7.1 | Check-in/check-out de empleados | Diario | Todos | Portal > Control de acceso (huella digital) | POS login con PIN/huella + asistencia automatica | SUPERA | Sin hardware extra |
| 7.2 | Ver horas trabajadas por empleado | Semanal | RH/G | Portal > Horas trabajadas | /nomina tab Asistencia | RESUELTO | No |
| 7.3 | Pre-nomina (cuanto debo a cada empleado) | Semanal | RH/$$ | Portal > Pago de nomina | /nomina tab Pre-Nomina | PARCIAL | Rates estimados, disclaimer necesario |
| 7.4 | Programar turnos semanales | Semanal | G | Portal > Nomina > Programacion semanal | No implementado como modulo | FALTA | Agente staffing_optimizer sugiere pero no programa |
| 7.5 | Registrar incidencias (retardo, falta, permiso, vacaciones) | Semanal | RH/G | Portal > Nomina > Reporte de incidencia | No implementado | FALTA | Eduardo lo menciono. Necesario para nomina real |
| 7.6 | Crear/editar empleados con roles y permisos | Excepcional | G | Portal > Admin > Usuarios POS + permisos | /pos/staff + permisos granulares | RESUELTO | No |
| 7.7 | Propinas: fondo comun + distribucion | Diario | G | Portal > Modulo de propinas | /propinas + agente tips_analyzer | PARCIAL | Falta calculo automatico del % sobre venta |

---

## 8. CUMPLIR CON EL SAT (fiscal — no es opcional)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 8.1 | Emitir CFDI individual | Diario | C | Portal > Emitir factura | /pos/facturacion + QR | SUPERA | Self-service |
| 8.2 | Factura global mensual | Mensual | $$ | Portal > Factura Global | No implementado | FALTA | Obligatorio SAT |
| 8.3 | Notas de credito CFDI | Mensual | $$ | Portal > NC con reason codes SAT | /notas-credito | PARCIAL | Falta timbrado real |
| 8.4 | Complementos de pago | Mensual | $$ | Portal > Complementos | No | FALTA | Territorio contador |
| 8.5 | Conciliacion ventas vs facturas | Mensual | $$ | Portal > Reporte Conciliacion FE | /reporte-fiscal (parcial) | PARCIAL | Falta cruce exacto ventas vs timbrados |

---

## 9. COCINA (KDS — el otro lado de la orden)

| # | Trabajo operativo | Freq | Quien | Wansoft | Fullsite | Estado | Rediseno |
|---|---|---|---|---|---|---|---|
| 9.1 | Recibir comanda en pantalla | Diario | K | Pantalla en cocina (portal) | /pos/cocina (KDS real-time) | SUPERA | Real-time vs impresion |
| 9.2 | Marcar platillo como preparado | Diario | K | No existe (comanda impresa, se pierde) | Click en KDS > marca como listo | SUPERA | Digital vs papel |
| 9.3 | Ver tiempos de preparacion | Diario | K/G | No existe como metrica | KDS con timer visible | SUPERA | Nuevo. Wansoft no tiene |
| 9.4 | Filtrar por estacion (cocina/barra/panaderia) | Diario | K | Ruteo por impresora, no por pantalla | Filtro por estacion en KDS | SUPERA | Pantalla > papel |

---

## 10. LO QUE FULLSITE TIENE Y WANSOFT NO (ventaja competitiva)

| # | Trabajo operativo | Freq | Quien | Fullsite | Valor |
|---|---|---|---|---|---|
| 10.1 | "Cuanto llevo hoy?" por chat/voz | Diario | D/G | /chat + /voice | Respuesta en 3 segundos vs 4 clicks + esperar sync |
| 10.2 | Briefing matutino automatico | Diario | D/G | Agente daily_briefing 7AM | Nadie tiene que recordar revisar |
| 10.3 | Prediccion de cierre del dia | Diario | G | Agente close_predictor 2PM/4PM/6PM | Ajustar preparacion/staff antes de que sea tarde |
| 10.4 | Deteccion de fraude en cancelaciones/descuentos | Semanal | G/D | Agente antifraud | La IA revisa lo que el gerente no alcanza |
| 10.5 | Deteccion de anomalias en ventas | Diario | G | Agente anomaly_detector | Alerta si algo esta fuera de patron |
| 10.6 | Sugerencia de upselling por mesero | Semanal | G | Agente upselling | "Omar vende 30% menos 2da bebida que el promedio" |
| 10.7 | Optimizacion de staff por dia/hora | Semanal | G | Agente staffing_optimizer | Basado en ventas historicas |
| 10.8 | Menu engineering (estrellas, vacas, perros) | Mensual | G/D | Agente menu_engineering | Que empujar, que quitar |
| 10.9 | Monitoreo de proveedores | Mensual | P | Agente supplier_monitor | Alerta si proveedor sube precios |
| 10.10 | CRM con 12.2K clientes | Continuo | D/G | /crm + WhatsApp bot | Wansoft no tiene CRM real |
| 10.11 | Audit trail SIEMPRE activo | Continuo | G | pos_audit_log (no apagable) | Wansoft tiene checkbox APAGADO |
| 10.12 | Setup en <30 minutos | Excepcional | D | Chrome > login > operar | Wansoft: dias de instalacion |

---

## RESUMEN EJECUTIVO

### Score por area

| Area | Capacidades | Resuelto | Parcial | Falta | Supera |
|---|---|---|---|---|---|
| Vender | 26 | 18 | 1 | 4 | 3 |
| Cerrar el dia | 10 | 5 | 2 | 3 | 0 |
| Reportes/saber cuanto gane | 12 | 5 | 3 | 1 | 3 |
| Inventario | 17 | 8 | 3 | 3 | 3 |
| Food cost | 10 | 3 | 1 | 5 | 1 |
| Finanzas | 12 | 5 | 1 | 4 | 2 |
| RH/Equipo | 7 | 2 | 2 | 2 | 1 |
| Fiscal | 5 | 1 | 2 | 2 | 0 |
| Cocina/KDS | 4 | 0 | 0 | 0 | 4 |
| **TOTAL** | **103** | **47** | **15** | **24** | **17** |

- **47 RESUELTO** (46%) — funciona igual o basico
- **17 SUPERA** (16%) — Fullsite lo hace mejor que Wansoft
- **15 PARCIAL** (15%) — existe pero incompleto
- **24 FALTA** (23%) — no existe todavia

### Las 24 capacidades que faltan, priorizadas

**Critico (bloquea migracion de restaurante serio):**
1. Sub-recetas (5.4) — Eduardo Jul 16
2. Factor de rendimiento (5.5) — Eduardo Jul 16
3. Corte Z fiscal consecutivo (2.3)
4. Factura global (8.2)
5. Ventas por hora (3.4) — cuando POS genere datos

**Alto (un gerente lo extrañaria en el primer mes):**
6. Corte X parcial (2.2)
7. Programacion de turnos (7.4)
8. Registrar incidencias (7.5)
9. Devolucion a proveedor (4.10)
10. Simulador de precios (5.6) — Eduardo Jul 16
11. Cambiar forma de pago post-cobro (1.21)
12. Productos a caducar (4.13) — deberia ser alerta IA
13. Costeo de produccion (5.9)
14. Conciliacion ventas vs facturas CFDI (8.5)

**Medio (lo pedirian despues de 3 meses):**
15. Corte Global multi-terminal (2.4)
16. Corte por mesero imprimible (2.5)
17. Cuentas por cobrar CXC (6.4)
18. Costos adicionales (5.10)
19. Pagos anticipados/eventos (1.22)
20. Vales (1.23)
21. Complementos de pago (8.4)
22. Factura global (6.10)
23. Transferencia efectivo entre sucursales (6.12)

**Largo plazo (post-500 restaurantes):**
24. Transferencias de producto entre sucursales (4.11)
25. Paleo de barra (4.14)

---

> Este documento NO es un backlog.
> Es un mapa de la realidad operativa de un restaurante.
> Cada fila representa trabajo real que alguien hace hoy.
> Fullsite existe para que ese trabajo sea mas facil, mas rapido, o innecesario.
