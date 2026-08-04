# Pattern Register — Índice Maestro

> Fuente única de verdad para IDs, clasificaciones y estado de evidencia.  
> El detalle de cada patrón está en su archivo de categoría.  
> Última actualización: 2026-08-04

---

## OP — Operación

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| OP-001 | Apertura del día: fondo de caja obligatorio | MATCH | DOCUMENTED | 01-operacion.md |
| OP-002 | Turno como unidad de control fiscal | MATCH | CODE VERIFIED | 01-operacion.md |
| OP-003 | Un turno por terminal, no por negocio | MATCH | DOCUMENTED | 01-operacion.md |
| OP-004 | Cierre de turno bloquea acceso al POS | MATCH | CODE VERIFIED | 01-operacion.md |
| OP-005 | Cierre de turno sin corte Z son conceptos distintos | SURPASS | DOCUMENTED | 01-operacion.md |
| OP-006 | TurnoGate: bloqueo de POS sin turno activo | SURPASS | CODE VERIFIED | 01-operacion.md |
| OP-007 | Estado de turno: loading / active / none / stale | SURPASS | CODE VERIFIED | 01-operacion.md |
| OP-008 | Órdenes abiertas al cerrar turno — comportamiento no bloqueante | UNKNOWN | INFERRED | 01-operacion.md |
| OP-009 | Hora pico identificada internamente (sin config de operador) | SURPASS | CODE VERIFIED | 01-operacion.md |
| OP-010 | Sesión de PIN con TTL 900s — re-auth silencioso | SURPASS | CODE VERIFIED | 01-operacion.md |
| OP-011 | Idle timeout 1800s — cierre automático de sesión | MATCH | CODE VERIFIED | 01-operacion.md |
| OP-012 | Apertura offline: snapshot de menú en IDB desde boot | SURPASS | CODE VERIFIED | 01-operacion.md |
| OP-013 | Fondo de caja AMALAY: $1,700 MXN fijo | UNKNOWN | FIELD VERIFIED | 01-operacion.md |
| OP-014 | Turno transferible entre terminales en Wansoft | WANSOFT-ONLY | DOCUMENTED | 01-operacion.md |

---

## CJ — Caja

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| CJ-001 | IVA_RATE fijo 0.16 — precios con IVA incluido | MATCH | CODE VERIFIED | 02-caja.md |
| CJ-002 | Subtotal = total / 1.16 — el menú no discrimina IVA | MATCH | CODE VERIFIED | 02-caja.md |
| CJ-003 | Métodos de pago: efectivo, tarjeta crédito, débito, transferencia, UberEats | MATCH | FIELD VERIFIED | 02-caja.md |
| CJ-004 | Cobro mixto (efectivo + tarjeta en misma cuenta) | UNKNOWN | INFERRED | 02-caja.md |
| CJ-005 | Propina capturada en POS — separada del total de venta | SURPASS | CODE VERIFIED | 02-caja.md |
| CJ-006 | Tip-out AMALAY: 5% del total de propinas a la cocina | UNKNOWN | DOCUMENTED | 02-caja.md |
| CJ-007 | Corte Z: secuencial, irrepetible, requisito fiscal | MATCH | DOCUMENTED | 02-caja.md |
| CJ-008 | Corte X: acumulativo sin cierre — solo imprime reporte | MATCH | DOCUMENTED | 02-caja.md |
| CJ-009 | Wansoft tiene 5 tipos de corte (Z, X, Turno, Mesero, Global) | WANSOFT-ONLY | DOCUMENTED | 02-caja.md |
| CJ-010 | Cortesía máxima: CORTESIA_POR_PERSONA = $480 MXN | UNKNOWN | CODE VERIFIED | 02-caja.md |
| CJ-011 | Descuento requiere PIN de autorización de gerente | MATCH | DOCUMENTED | 02-caja.md |
| CJ-012 | Descuento por porcentaje vs. descuento por monto — dos flujos distintos | UNKNOWN | INFERRED | 02-caja.md |
| CJ-013 | Cancelación de ítem vs cancelación de cuenta completa | MATCH | DOCUMENTED | 02-caja.md |
| CJ-014 | Cancelación post-cobro requiere flujo de devolución separado | UNKNOWN | INFERRED | 02-caja.md |
| CJ-015 | Corte X clasifica mal pagos cuando hay split turno (bug conocido) | UNKNOWN | DOCUMENTED | 02-caja.md |
| CJ-016 | Efectivo recibido − efectivo esperado = diferencia de caja | MATCH | DOCUMENTED | 02-caja.md |
| CJ-017 | CFDI 4.0: RFC del cliente, uso de CFDI, método de pago — post-cobro | UNKNOWN | DOCUMENTED | 02-caja.md |
| CJ-018 | Terminal MP Point: cobro separado del POS — sin integración directa | UNKNOWN | FIELD VERIFIED | 02-caja.md |
| CJ-019 | Facturación QR en ticket para autoservicio CFDI | UNKNOWN | DOCUMENTED | 02-caja.md |

---

## CB — Cocina y Barra

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| CB-001 | KDS polling 2s + push events del bridge | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-002 | Wansoft KDS: poll SQL Server cada 15s | MATCH | DOCUMENTED | 03-cocina-barra.md |
| CB-003 | Routing por estación: resolveItemStation() heurística por nombre | MATCH | CODE VERIFIED | 03-cocina-barra.md |
| CB-004 | Routing Wansoft: ImpresoraGrupo en BD — configurable por operador | WANSOFT-ONLY | DOCUMENTED | 03-cocina-barra.md |
| CB-005 | Estados de KDS: enviada → preparando → lista → entregada | MATCH | CODE VERIFIED | 03-cocina-barra.md |
| CB-006 | Forward-only: no se puede retroceder un estado en KDS | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-007 | Tracking por ítem en Cocina: click individual por ítem | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-008 | Tracking por ítem en Barra: solo a nivel orden (gap G-03) | MATCH | CODE VERIFIED | 03-cocina-barra.md |
| CB-009 | Auto-archive de órdenes > 4h en ambas superficies | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-010 | Alerta de audio en Cocina: 880+1100Hz | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-011 | Alerta de audio en Barra: 660Hz | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-012 | Umbral urgencia Cocina: configurable (Settings modal, localStorage) | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-013 | Umbral urgencia Barra: hardcoded 10 min (gap G-05) | UNKNOWN | CODE VERIFIED | 03-cocina-barra.md |
| CB-014 | Delivery orders en Cocina KDS: delivery_orders inyectadas | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-015 | Delivery orders en Barra KDS: implementado 2026-07-31 | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-016 | Reimpresión desde KDS: reprintByStation() | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-017 | reprintByStation sin retry queue — fallo silencioso (gap G-04) | UNKNOWN | CODE VERIFIED | 03-cocina-barra.md |
| CB-018 | Tab panadería en Cocina (filtro sub-categoría) | SURPASS | CODE VERIFIED | 03-cocina-barra.md |
| CB-019 | KDS no notifica al mesero cuando se cancela un ítem | UNKNOWN | DOCUMENTED | 03-cocina-barra.md |
| CB-020 | Sidebar de conteo por platillo en Cocina | SURPASS | CODE VERIFIED | 03-cocina-barra.md |

---

## IN — Inventario y Compras

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| IN-001 | Stock no bloquea venta — operación continúa con stock negativo | MATCH | DOCUMENTED | 04-inventario-compras.md |
| IN-002 | Recetas como fuente de verdad para costo | MATCH | DOCUMENTED | 04-inventario-compras.md |
| IN-003 | Factor de rendimiento (yield) por ingrediente | UNKNOWN | DOCUMENTED | 04-inventario-compras.md |
| IN-004 | 574 recetas en AMALAY, 6 almacenes en Wansoft | UNKNOWN | FIELD VERIFIED | 04-inventario-compras.md |
| IN-005 | Cardex: movimientos de inventario con fecha y motivo | MATCH | DOCUMENTED | 04-inventario-compras.md |
| IN-006 | Compras sugeridas: punto de reorden calculado automáticamente | MATCH | DOCUMENTED | 04-inventario-compras.md |
| IN-007 | Transferencias entre almacenes con autorización | UNKNOWN | DOCUMENTED | 04-inventario-compras.md |
| IN-008 | Subproductos: resultados de producción que generan inventario | UNKNOWN | DOCUMENTED | 04-inventario-compras.md |
| IN-009 | Variación de costos: comparativo vs. costo teórico | UNKNOWN | DOCUMENTED | 04-inventario-compras.md |
| IN-010 | Costo real AMALAY ~27.6% (pos_recipes Excel) | UNKNOWN | DOCUMENTED | 04-inventario-compras.md |

---

## MS — Meseros y Servicio

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| MS-001 | PIN de mesero como autenticación primaria | MATCH | FIELD VERIFIED | 05-meseros-servicio.md |
| MS-002 | PIN_CACHE_TTL = 900s — re-auth silenciosa en background | SURPASS | CODE VERIFIED | 05-meseros-servicio.md |
| MS-003 | 50 registros de staff activos en AMALAY | UNKNOWN | FIELD VERIFIED | 05-meseros-servicio.md |
| MS-004 | Wansoft: huella dactilar como autenticación alternativa | WANSOFT-ONLY | DOCUMENTED | 05-meseros-servicio.md |
| MS-005 | Propina como campo de entrada en el cobro | SURPASS | CODE VERIFIED | 05-meseros-servicio.md |
| MS-006 | Pool de propinas — distribución por puntos o porcentaje | UNKNOWN | DOCUMENTED | 05-meseros-servicio.md |
| MS-007 | Mesero evento: categoría especial para eventos privados | UNKNOWN | FIELD VERIFIED | 05-meseros-servicio.md |
| MS-008 | Ranking de meseros por ventas — accesible en dashboard | SURPASS | CODE VERIFIED | 05-meseros-servicio.md |
| MS-009 | Wansoft: permiso "¿Se preparó?" — validación pre-cobro | WANSOFT-ONLY | DOCUMENTED | 05-meseros-servicio.md |
| MS-010 | Wansoft: permisos en dos pasos (solicitar + autorizar gerente) | WANSOFT-ONLY | DOCUMENTED | 05-meseros-servicio.md |

---

## DL — Delivery

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| DL-001 | Rappi/Uber Eats como método de pago en Wansoft — no entra al KDS | MATCH | DOCUMENTED | 06-delivery.md |
| DL-002 | Fullsite: delivery integrado al KDS como canal separado | SURPASS | CODE VERIFIED | 06-delivery.md |
| DL-003 | Estados delivery: nueva → preparando → lista → en_ruta → entregada | UNKNOWN | CODE VERIFIED | 06-delivery.md |
| DL-004 | Platform maneja los últimos dos estados (en_ruta, entregada) | UNKNOWN | CODE VERIFIED | 06-delivery.md |
| DL-005 | Webhook como canal de entrada de órdenes delivery | UNKNOWN | CODE VERIFIED | 06-delivery.md |
| DL-006 | Delivery orders inyectadas en stream KDS de Cocina | SURPASS | CODE VERIFIED | 06-delivery.md |

---

## PR — Impresión y KDS físico

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| PR-001 | Print Bridge en 127.0.0.1:7717 — HTTP → ESC/POS | SURPASS | CODE VERIFIED | 07-impresion-kds.md |
| PR-002 | Wansoft: RestPrintingApp.exe — poll SQL cada 15s → TCP | MATCH | DOCUMENTED | 07-impresion-kds.md |
| PR-003 | 3 impresoras AMALAY: EC TICKET (caja), COCINA CALIENTE, BARRA | FIELD VERIFIED | FIELD VERIFIED | 07-impresion-kds.md |
| PR-004 | Cajón conectado via RJ-11 a EC TICKET | FIELD VERIFIED | FIELD VERIFIED | 07-impresion-kds.md |
| PR-005 | Retry queue en print inicial: hasta 5 reintentos | SURPASS | CODE VERIFIED | 07-impresion-kds.md |
| PR-006 | BRIDGE_UNAVAILABLE_ESCALATION_MS = 120,000ms (2 min) | SURPASS | CODE VERIFIED | 07-impresion-kds.md |
| PR-007 | RETRY_INTERVAL_MS = 15,000ms, MAX_RETRIES = 5 | SURPASS | CODE VERIFIED | 07-impresion-kds.md |
| PR-008 | reprintByStation sin retry — fallo silencioso (gap G-04) | UNKNOWN | CODE VERIFIED | 07-impresion-kds.md |
| PR-009 | Print queue estado: pending→printing→success/bridge_unavailable→needs_attention | SURPASS | CODE VERIFIED | 07-impresion-kds.md |
| PR-010 | Bridge sin NSSM autostart — requiere inicio manual | UNKNOWN | FIELD VERIFIED | 07-impresion-kds.md |
| PR-011 | Wansoft: 47 templates de impresión predefinidos | WANSOFT-ONLY | DOCUMENTED | 07-impresion-kds.md |
| PR-012 | Routing de impresión Wansoft: ImpresoraGrupo → configurable desde admin | WANSOFT-ONLY | DOCUMENTED | 07-impresion-kds.md |

---

## CF — Configuración

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| CF-001 | Taxonomía Config/Auto/Config→Auto — tres tipos de configuración | SURPASS | DOCUMENTED | 08-configuracion.md |
| CF-002 | Actores de configuración: Dueño / Gerente / Fullsite | SURPASS | DOCUMENTED | 08-configuracion.md |
| CF-003 | Default first — sistema decide antes que el usuario configure | SURPASS | DOCUMENTED | 08-configuracion.md |
| CF-004 | Routing de ítems sin UI de configuración — requiere deploy (gap G-01) | WANSOFT-ONLY | CODE VERIFIED | 08-configuracion.md |
| CF-005 | Wansoft: configuración de routing desde admin sin deploy | WANSOFT-ONLY | DOCUMENTED | 08-configuracion.md |
| CF-006 | Umbral urgencia KDS en Cocina: configurable localStorage | SURPASS | CODE VERIFIED | 08-configuracion.md |
| CF-007 | Mesas: AMALAY usa plano físico; otros clientes grid numérico 12 | UNKNOWN | CODE VERIFIED | 08-configuracion.md |
| CF-008 | 522 ítems de menú activos en AMALAY | FIELD VERIFIED | FIELD VERIFIED | 08-configuracion.md |
| CF-009 | Multi-tenant: client_id en todas las tablas, RLS por rol | SURPASS | CODE VERIFIED | 08-configuracion.md |

---

## OF — Offline y Recuperación

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| OF-001 | Wansoft: SQL Server local = 100% offline sin internet | WANSOFT-ONLY | DOCUMENTED | 09-offline-recuperacion.md |
| OF-002 | Fullsite: IndexedDB como capa offline primaria | MATCH | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-003 | IDB v3 schema: 5 stores (menu, orders, inventory, sync_queue, meta) | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-004 | sync_queue: cola persistente de operaciones pendientes | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-005 | OCC: expected_revision evita escrituras concurrentes | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-006 | STALE_WRITE_CONFLICT al detectar revisión desactualizada | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-007 | Menú disponible offline desde boot (IDB seed) | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-008 | Staff puede autenticar offline (credentials en IDB) | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-009 | Auto-archive de órdenes > 4h | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-010 | Fase 5 de certificación offline: PENDING — ejecución física en AMALAY | UNKNOWN | DOCUMENTED | 09-offline-recuperacion.md |
| OF-011 | Bridge LAN: recibe push events durante outage de Supabase | SURPASS | CODE VERIFIED | 09-offline-recuperacion.md |
| OF-012 | Wansoft: boot por snapshot de menú en inicio del turno | MATCH | DOCUMENTED | 09-offline-recuperacion.md |
| OF-013 | Wansoft: cierre de turno completamente local sin internet | WANSOFT-ONLY | DOCUMENTED | 09-offline-recuperacion.md |

---

## EC — Errores y Edge Cases

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| EC-001 | pos_staff vacío → cualquiera entra como Admin (BLOCKER pre-cutover) | UNKNOWN | DOCUMENTED | 10-errores-edge-cases.md |
| EC-002 | Dos terminales sobre la misma mesa vacía → phantom orders | UNKNOWN | DOCUMENTED | 10-errores-edge-cases.md |
| EC-003 | Corte X clasifica pagos incorrectamente al cruzar turnos | UNKNOWN | DOCUMENTED | 10-errores-edge-cases.md |
| EC-004 | Sync silencioso descartado después de 5 retries — pérdida silent | UNKNOWN | DOCUMENTED | 10-errores-edge-cases.md |
| EC-005 | KDS no notifica al mesero en cancelación de ítem | UNKNOWN | DOCUMENTED | 10-errores-edge-cases.md |
| EC-006 | sessionStorage manipulable — bypass de permisos posible | UNKNOWN | DOCUMENTED | 10-errores-edge-cases.md |
| EC-007 | Órdenes abiertas al cerrar turno — comportamiento no especificado | UNKNOWN | DOCUMENTED | 10-errores-edge-cases.md |
| EC-008 | 2 PCs de KDS no sincronizan estado entre sí | UNKNOWN | FIELD VERIFIED | 10-errores-edge-cases.md |
| EC-009 | SSR hardcodea 'amalay' antes de hidratación (G-001) | UNKNOWN | CODE VERIFIED | 10-errores-edge-cases.md |
| EC-010 | RLS public override authenticated — FIXED SKEL-04 2026-07-29 | MATCH | CODE VERIFIED | 10-errores-edge-cases.md |
| EC-011 | Anon key permite lectura cross-tenant sin filtro (ADR-003) | UNKNOWN | CODE VERIFIED | 10-errores-edge-cases.md |
| EC-012 | AI Coach y Inventory Predictor solo leen wansoft_daily | UNKNOWN | CODE VERIFIED | 10-errores-edge-cases.md |
| EC-013 | Mesas hardcoded para AMALAY — otros clientes get grid genérico | UNKNOWN | CODE VERIFIED | 10-errores-edge-cases.md |

---

## HP — Heurísticas y Buenas Prácticas

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| HP-001 | Complejidad operacional como switching cost — lección Wansoft | UNKNOWN | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-002 | Internet = sync, no operación — los restaurantes operan LAN-first | MATCH | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-003 | Autoridad única: SQL Server es la única fuente de verdad en Wansoft | MATCH | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-004 | Polling > webhook para operaciones críticas (resilencia) | MATCH | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-005 | Stock sin bloqueo — venta continúa; corrección en inventario | MATCH | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-006 | Audit log siempre encendido — Wansoft lo tenía apagado por default | SURPASS | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-007 | Configuración debe fluir desde admin UI, no de deploy | WANSOFT-ONLY | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-008 | IPs estáticas en hardware de restaurante — DHCP falla en picos | FIELD VERIFIED | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-009 | Backup manual post-cierre — Wansoft depende de disciplina humana | MATCH | DOCUMENTED | 11-heuristicas-buenas-practicas.md |
| HP-010 | 5 tipos de corte en Wansoft reflejan 5 necesidades reales del negocio | MATCH | DOCUMENTED | 11-heuristicas-buenas-practicas.md |

---

## WN — Wansoft/NetSilver Patterns

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| WN-001 | 14 DLLs, SQL Server, RestPrintingApp.exe — arquitectura monolítica .NET | UNKNOWN | DOCUMENTED | 12-wansoft-netsilver-patterns.md |
| WN-002 | 822 stored procedures, 23 dominios de negocio | UNKNOWN | DOCUMENTED | 12-wansoft-netsilver-patterns.md |
| WN-003 | Comandero APK Android — única pantalla KDS | MATCH | DOCUMENTED | 12-wansoft-netsilver-patterns.md |
| WN-004 | TeamViewer como canal de soporte y actualizaciones | UNKNOWN | FIELD VERIFIED | 12-wansoft-netsilver-patterns.md |
| WN-005 | Sin migrations — actualizaciones manuales via TeamViewer | UNKNOWN | DOCUMENTED | 12-wansoft-netsilver-patterns.md |
| WN-006 | IPs hardcodeadas en config de impresoras | FIELD VERIFIED | FIELD VERIFIED | 12-wansoft-netsilver-patterns.md |
| WN-007 | Getnet standalone — no integrado al flujo POS | MATCH | DOCUMENTED | 12-wansoft-netsilver-patterns.md |
| WN-008 | Distribución como moat — 20+ verticales, 6,000+ clientes | UNKNOWN | DOCUMENTED | 12-wansoft-netsilver-patterns.md |
| WN-009 | Audit log apagado por default — riesgo de fraude no detectado | UNKNOWN | DOCUMENTED | 12-wansoft-netsilver-patterns.md |
| WN-010 | Cuatro estados de orden: Abierta → Comandada → Impresa → Cobrada | MATCH | DOCUMENTED | 12-wansoft-netsilver-patterns.md |

---

## AM — AMALAY Field Knowledge

| ID | Nombre | Clasificación | Evidencia | Archivo |
|---|---|---|---|---|
| AM-001 | Fondo de caja: $1,700 MXN fijo al inicio del turno | UNKNOWN | FIELD VERIFIED | 13-amalay-field-knowledge.md |
| AM-002 | 5 impresoras en planta: EC TICKET, COCINA CALIENTE, BARRA, + 2 | FIELD VERIFIED | FIELD VERIFIED | 13-amalay-field-knowledge.md |
| AM-003 | Báscula en COM1 — integración pendiente | UNKNOWN | FIELD VERIFIED | 13-amalay-field-knowledge.md |
| AM-004 | Tip-out: 5% de propinas totales va a cocina | UNKNOWN | DOCUMENTED | 13-amalay-field-knowledge.md |
| AM-005 | 522 ítems activos, 50 registros de staff con PINs | FIELD VERIFIED | FIELD VERIFIED | 13-amalay-field-knowledge.md |
| AM-006 | Uber/Rappi entra como método E-COMMERCE en Wansoft, no KDS | MATCH | FIELD VERIFIED | 13-amalay-field-knowledge.md |
| AM-007 | RFC AMALAY: AFO200806JI0, SA de CV, régimen 601 | UNKNOWN | DOCUMENTED | 13-amalay-field-knowledge.md |
| AM-008 | 3 visitas de campo documentadas; topología por dispositivo mapeada | FIELD VERIFIED | FIELD VERIFIED | 13-amalay-field-knowledge.md |
| AM-009 | Costo real ~27.6% (pos_recipes Excel) vs wansoft_food_cost stale | UNKNOWN | DOCUMENTED | 13-amalay-field-knowledge.md |
| AM-010 | Horario pico AMALAY: no documentado — requiere observación | UNKNOWN | INFERRED | 13-amalay-field-knowledge.md |

---

## Resumen de clasificaciones

| Clasificación | Cantidad |
|---|---|
| SURPASS | 32 |
| MATCH | 22 |
| UNKNOWN | 38 |
| WANSOFT-ONLY | 11 |
| FIELD VERIFIED (como clasificación) | 3 |
| **Total** | **106** |

---

## Niveles de evidencia — distribución

| Nivel | Cantidad |
|---|---|
| FIELD VERIFIED | 14 |
| CODE VERIFIED | 48 |
| DOCUMENTED | 38 |
| INFERRED | 6 |
| **Total** | **106** |
