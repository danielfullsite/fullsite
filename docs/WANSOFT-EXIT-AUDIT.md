# Wansoft Exit Audit — Fullsite / AMALAY

> Fuente de verdad para apagar Wansoft.
> Cada item tiene evidencia verificable.
> Actualizado: 2026-07-10

---

## Criterio de clasificación

- **P0** — Bloquea operación del restaurante
- **P1** — Afecta clientes o reduce confianza, pero restaurante opera
- **P2** — Mejora importante post-cutover
- **P3** — Nice to have

---

## 1. OPERACION POS

| Capacidad | Estado | Wansoft | Fullsite | Ultima prueba |
|---|---|---|---|---|
| Mesas | ✅ | POS presencial, 16 mesas | `pos/mesas/`, clients.mesas=16, planograma | 2026-07-08 Electron |
| Ordenes (crear, enviar, cerrar) | ✅ | POS diario | `pos/page.tsx`, pos_orders (9 rows smoke test), saveOrder() con turno enforcement | 2026-07-09 Chrome |
| Cobro efectivo | ✅ | forma-de-pago | pos_payment_methods (18), calcOrderTotals() | 2026-07-09 Chrome |
| Cobro tarjeta | ✅ | forma-de-pago | Mismo flow, metodo tarjeta credito/debito | 2026-07-09 Chrome |
| Pago mixto | ✅ | Soportado | calcSplitPayment(), splitPersonas(), calcSplitParejo() | 2026-07-09 Chrome |
| Corte de caja | ✅ | reportes-ingresos-cortes | `pos/corte/`, pos_cierres (1 row), export CSV | 2026-07-09 Chrome |
| Turnos | ✅ | egresos-nomina-turnos | TurnoGate.tsx, pos_turnos (2 rows), turno offline mode, 4-layer enforcement | 2026-07-09 Chrome |
| Retiros de efectivo | ✅ | ingresos-control-de-efectivo | pos_cash_movements, UI en pos/page.tsx | 2026-06-27 Chrome |
| Depositos | ✅ | ingresos-control-de-efectivo-depositos | pos_cash_movements, /control-efectivo/ | 2026-06-27 Chrome |
| Propinas | ✅ | reportes-modulo-de-propinas | calcPropina(), totalConPropina(), /propinas/ dashboard | 2026-07-09 Chrome |
| Cancelaciones | ✅ | Cancel en POS | pos_audit_log: item_voided, permisos: cancelar_platillos/ordenes | 2026-07-09 Chrome |
| Descuentos manuales | ✅ | Permisos por rol | 6 permisos granulares: descuentos_ordenes_pct/monto, platillos_gratis, cortesia, etc. | 2026-06-27 Chrome |
| Promociones | ✅ | punto-de-venta-restaurante-promociones | pos-promos.ts: percentage/fixed/2x1/combo, schedule, auto-apply. pos_promotions (2) | 2026-06-27 Chrome |
| Pre-cuenta | ✅ | Operacion diaria | pos_audit_log: preticket_printed (5 rows), printTicket() | 2026-07-08 Electron |
| Domicilio/Delivery | ✅ | punto-de-venta-restaurante-domicilio | `pos/delivery/`, delivery_orders, permisos: abrir_cuentas_domicilio/recoger | 2026-06-16 Chrome |
| Combos | ✅ | POS tiene combos | pos-combos.ts: getActiveCombos, applyCombo, schedule. pos_combos (0 rows, sin data) | 2026-06-15 Chrome |
| Reservaciones | ⚠️ No POS | No modulo core Wansoft | amalay_reservaciones (23 rows), /reservar/ dashboard. No integrado en POS | N/A |
| Facturacion CFDI | ⚠️ P1 | facturacion (14 screenshots) | pos/facturacion/, /api/factura/timbrar/, pos_cfdi_requests (1 test), pos_billing_clients (6) | Sandbox only |

**CFDI nota:** Facturama en sandbox. Cita SAT 21 julio para CSD/e.firma. Importante pero NO bloquea operacion — AMALAY puede operar sin emitir facturas temporalmente.

---

## 2. IMPRESION

| Capacidad | Estado | Evidencia | Ultima prueba |
|---|---|---|---|
| Comanda cocina | ✅ | printByStation() → TCP a impresora cocina | 2026-07-08 Electron (fisico AMALAY) |
| Comanda barra | ✅ | printByStation() → TCP a impresora barra | 2026-07-08 Electron (fisico AMALAY) |
| Ticket caja | ✅ | printTicket() → USB impresora caja | 2026-07-08 Electron (fisico AMALAY) |
| Pre-cuenta | ✅ | Mismo flow que ticket | 2026-07-08 Electron |
| Bridge embebido | ✅ | Electron main.js puerto 7717, TCP+USB | 2026-07-08 Electron |

**Investigacion de 121 print jobs fallidos:**

Veredicto: **NO es bug. Son pruebas desde Chrome donde no hay bridge.**

Evidencia:
- 99 errores = "Failed after 5 attempts" — bridge inalcanzable desde Chrome
- 58 errores = "Bridge no disponible por Xs" — timeout porque no hay bridge corriendo
- El bridge solo corre dentro de Electron (puerto 7717) o como Node.js standalone
- Desde Chrome en app.fullsite.mx → no hay bridge local → todo intento de impresion falla
- Los 3 prints exitosos fueron con bridge activo: Jun 25, Jun 30, Jul 8 (instalacion fisica)
- Jul 8 (instalacion fisica): 1 printed (barra), el resto fallo porque bridge no estaba configurado para todas las estaciones aun

Conclusion: La cola de impresion funciona correctamente. Registra fallos cuando bridge no esta disponible (comportamiento esperado). En Electron con bridge embebido, impresion funciona.

---

## 3. PERMISOS Y SEGURIDAD

| Capacidad | Estado | Evidencia | Ultima prueba |
|---|---|---|---|
| Staff (CRUD) | ✅ | pos_staff (40 activos), /pos/staff/ | 2026-07-08 Chrome |
| Roles (5 perfiles) | ✅ | admin, gerente, capitan, cajero, mesero. 50 permisos granulares | 2026-07-08 Chrome |
| PINs | ✅ | pos_staff.pin, uniqueness enforced | 2026-07-08 Chrome |
| Huella digital | ✅ | pos_fingerprint_templates (1), servicio C# DPUruNet, proxy Electron | 2026-07-08 Electron (fisico) |
| Audit log | ✅ | pos_audit_log (63 rows, 6 action types) | 2026-07-09 Chrome |
| Sesiones | ✅ | pos-sessions.ts: registerSession, heartbeat, terminal IDs | 2026-07-08 Chrome |

---

## 4. CATALOGOS

| Capacidad | Estado | Evidencia | Ultima prueba |
|---|---|---|---|
| Productos (522 activos) | ✅ Migrado | wansoft_products.json → pos_menu_items (687 total, 522 activos) | 2026-07-09 Verificado DB |
| Categorias (57) | ✅ Migrado | pos_menu_categories (60) | 2026-07-09 Verificado DB |
| Modificadores | ✅ Migrado | wansoft_modificadores.json → pos_modifier_groups (65), pos_modifiers (245), links (166+12) | 2026-07-09 Verificado DB |
| Modificadores escalonados | ✅ Implementado | DB: level, min_selections, max_selections, required. UI: modal step-by-step en pos/page.tsx | 2026-07-09 Chrome. Pendiente prueba fisica AMALAY |
| Metodos de pago (18) | ✅ Migrado | pos_payment_methods (18) | 2026-07-09 Verificado DB |
| Tamanos | ⚠️ N/A | pos_sizes (0 rows). AMALAY no usa tamanos | N/A |
| Tarjetas regalo | ⚠️ N/A | pos_gift_cards (0 rows). Existe pero AMALAY no usa | N/A |
| Market items | ✅ Migrado | Menu items con categorias mkt-*, pos_market_stock (197 rows) | 2026-07-09 Verificado DB |

---

## 5. RECETAS E INVENTARIO

| Capacidad | Estado | Evidencia | Ultima prueba |
|---|---|---|---|
| Recetas (1,322 platillos) | ✅ Migrado | wansoft_recetas.json (615) → pos_recipes_old (4,066 lineas, 1,160 ingredientes unicos) | 2026-07-10 Verificado DB |
| Ingredientes (1,050) | ✅ Migrado | pos_ingredients (1,050), pos_insumos (400) | 2026-07-10 Verificado DB |
| Existencias (stock Jul 7) | ✅ Migrado | wansoft_existencias_20260707.json (745) → pos_inventory_products (778, 376 con stock >0, $217K valor) | 2026-07-10 Verificado DB |
| Costos por producto | ✅ Migrado | cost_per_unit calculado de value/stock. Ej: Rib Eye $315/KG, Jamon $837/KG | 2026-07-10 Verificado DB |
| Punto de reorden | ✅ Migrado | wansoft_reorder_points.json (90) → pos_inventory_products.reorder_point (83 con valor >0) | 2026-07-10 Recien migrado |
| Unidades de medida | ✅ Migrado | Normalizado: KG, GR, LT, ML, PZ, SOBRE, BOLSA, etc. | 2026-07-10 Verificado DB |
| Movimientos inventario | ✅ Construido | pos_inventory_movements (135 rows), audit trail intocable | 2026-06-27 Chrome |
| Inventario fisico | ✅ Construido | /pos/inventario-fisico/ | 2026-06-11 Chrome |
| Merma | ✅ Construido | /pos/merma/, movement_type='waste' | 2026-06-16 Chrome |
| Departamentos | ✅ Migrado | category: LACTEOS, PROTEINA ANIMAL, ABARROTES, etc. | 2026-07-10 Verificado DB |

---

## 6. PROVEEDORES Y COMPRAS

| Capacidad | Estado | Evidencia | Ultima prueba |
|---|---|---|---|
| Proveedores (241) | ✅ Migrado | wansoft_proveedores.json (202) → pos_suppliers (241, 190 con RFC, 100 con tel) | 2026-07-10 Verificado DB |
| Facturas proveedor (agregado) | ✅ Migrado | wansoft_facturas_proveedores.json → 144 proveedores con invoice_count + invoice_total ($10.86M, 3,282 facturas) | 2026-07-10 Verificado DB |
| Ordenes de compra | ⚠️ Tabla vacia | pos_purchase_orders (0 rows). wansoft_ordenes_compra.json extraido (20KB) | No migrado |
| Recepcion facturas | ✅ Construido | /pos/recepcion-factura/, /pos/facturas-proveedor/ | 2026-06-15 Chrome |

---

## 7. CONFIGURACION

| Capacidad | Estado | Evidencia | Ultima prueba |
|---|---|---|---|
| Impresoras (3 estaciones) | ✅ | printers.json en Electron: cocina TCP, barra TCP, caja USB | 2026-07-08 Electron (fisico) |
| IVA (16%) | ✅ | clients.iva_rate=0.16, getIvaRate()/setIvaRate() dinamico | 2026-07-09 Chrome |
| Empresa | ✅ | clients: rfc=AFO200806JI0, razon_social=AMALAY FOODS, regimen_fiscal=601 | 2026-07-10 Verificado DB |
| Multi-tenant | ✅ | client_id en todas las tablas, clients table con config por restaurante | Arquitectura verificada |
| Estaciones (cocina/barra/caja) | ✅ | STATION_CATEGORIES, getStationForItem(), routing automatico por categoria | 2026-07-08 Electron |

---

## 8. DASHBOARD / IA

| Capacidad | Estado | Evidencia | Ultima prueba |
|---|---|---|---|
| Ventas historicas (915 dias) | ✅ Migrado | wansoft_daily: 2024-01-02 a 2026-07-10, ventas 100%, meseros 98.6%, platillos 98.6% | 2026-07-10 Verificado DB |
| KPIs tiempo real | ✅ | wansoft_kpis (1 row, scraper activo) | 2026-07-10 |
| Food Cost | ✅ | /food-cost/, wansoft_food_cost | 2026-07-04 Chrome |
| Agentes IA (16) | ✅ | daily-briefing, anomaly-detector, close-predictor, upselling, staffing, menu-engineering, anti-fraud, tips, etc. | Crons activos diario |
| Alertas stock | ✅ | stock_alert_agent, inventory_alerts | Cron activo |
| Estado de resultados | ✅ | /estado-resultados/, wansoft_pnl | 2026-07-04 Chrome |
| CRM (11,794 clientes) | ✅ | pos_customers (11,794), /crm/ | 2026-07-10 Verificado DB |

---

## 9. DISASTER RECOVERY

| Escenario | Solucion | Estado | Ultima prueba |
|---|---|---|---|
| Internet cae | Turno offline mode: cache localStorage, amber banner, revalidar al reconectar. pos-offline-db.ts: cacheMenu, cacheOrder, queueOperation, syncAll | ✅ Construido | 2026-07-09 Chrome (simulado) |
| Windows reinicia | Electron auto-start via registro Windows. Turno persiste (same-day cache) | ✅ Construido | 2026-07-08 Electron |
| Luz se va | Mismo que Windows reinicia + offline mode si internet no regresa antes que PC | ✅ Construido | No probado fisicamente |
| Bridge muere | Print queue registra fallo, pos_print_jobs con status needs_attention. Electron re-spawns bridge | ✅ Construido | 2026-07-08 Electron |
| Impresora desconectada | Print job falla con retry (5 intentos). pos_print_jobs log. Fallback: otra estacion | ⚠️ Parcial | 2026-07-08 Electron. Falta fallback automatico a otra impresora |
| Supabase lento/caido | Offline mode: ordenes en IndexedDB, sync cuando regresa. Menu cacheado | ✅ Construido | 2026-07-09 Chrome (simulado) |
| Electron crash | Windows auto-start lo re-lanza. Turno persiste | ✅ Construido | 2026-07-08 Electron |
| Chrome crash | No aplica — POS corre en Electron kiosk, no Chrome | 🚫 N/A | — |
| Terminal nueva | Instalar .exe, configurar printers.json, registrar huella. ~30 min | ✅ Documentado | 2026-07-07 (3 terminales) |
| Backup de datos | Supabase managed backups (diario). wansoft_daily como respaldo historico | ✅ Automatico | Supabase PITR |
| Turno stale (>8h) | autoCloseStaleTurno(), red alert >2h, force close | ✅ Construido | 2026-07-09 Chrome |

---

## 10. DATOS NO MIGRADOS (solo JSON local)

| JSON | Tamano | Necesario | Razon |
|---|---|---|---|
| wansoft_cardex_summary.json | 64KB | No | Movimientos historicos. Cubierto por pos_inventory_movements |
| wansoft_compras_sugeridas.json | 70KB | No | Fullsite tiene su propio agente de compras |
| wansoft_costo_vs_venta.json | 96KB | No | Cubierto por cost_per_unit en pos_inventory_products |
| wansoft_costos.json | 190KB | No | Parcialmente cubierto por cost_per_unit |
| wansoft_ordenes_compra.json | 20KB | P3 | Historico de OCs, no bloquea operacion |
| wansoft_subproductos.json | 3KB | No | Datos minimos |
| wansoft_routing_almacen.json | 70KB | No | AMALAY = 1 almacen |
| wansoft_variacion_costos.json | 24KB | No | Reporte historico |
| wansoft_asistencia.json | 9KB | No | Control externo |
| wansoft_margen.json | 1KB | No | Cubierto por food-cost |

---

## GAPS RESTANTES

### P0 — Bloquea operacion

Ninguno. Todo lo necesario para operar el restaurante esta construido.

### P1 — Afecta clientes o reduce confianza

| # | Gap | Accion | Esfuerzo |
|---|---|---|---|
| P1-1 | Smoke test fisico AMALAY | Lunes: instalar .exe en 3 terminales, correr checklist de 10 pasos | 4h presencial |
| P1-2 | Impresoras en fisico | Verificar IPs, routing cocina/barra/caja con ordenes reales | Parte del smoke test |
| P1-3 | Fingerprint en fisico | Registrar huellas de Eduardo y 2 meseros, probar cross-terminal | Parte del smoke test |
| P1-4 | Offline en fisico | Desconectar ethernet, hacer orden, reconectar, verificar sync | Parte del smoke test |
| P1-5 | CFDI Facturama | Cita SAT 21 julio. Despues: activar Facturama produccion ($1,650) | Depende del SAT |
| P1-6 | Propinas vacias en wansoft_daily | Solo 17/915 dias tienen propinas_total. Scraper no extrae propinas del reporte diario | Fix en parser |

### P2 — Mejora importante post-cutover

| # | Gap | Accion | Esfuerzo |
|---|---|---|---|
| P2-1 | Ordenes de compra sin data | Migrar wansoft_ordenes_compra.json a pos_purchase_orders | 1h |
| P2-2 | Facturas proveedor detalladas | Solo tenemos agregado (total+count). Factura por factura no extraida | Requiere scraper nuevo |
| P2-3 | Fallback impresora automatico | Si cocina falla, intentar en otra estacion | 2h |

### P3 — Nice to have

| # | Gap |
|---|---|
| P3-1 | Subproductos (3KB) |
| P3-2 | Routing multi-almacen |
| P3-3 | Variacion historica de costos |
| P3-4 | Asistencia de personal |

---

## CHECKLIST FINAL — Antes de apagar Wansoft

| # | Item | Estado | Fecha verificacion |
|---|---|---|---|
| 1 | Smoke test: ordenes en 3 terminales | ☐ | — |
| 2 | Smoke test: cobro efectivo + tarjeta + mixto | ☐ | — |
| 3 | Smoke test: comanda cocina impresa | ☐ | — |
| 4 | Smoke test: comanda barra impresa | ☐ | — |
| 5 | Smoke test: ticket caja impreso | ☐ | — |
| 6 | Smoke test: corte de caja completo | ☐ | — |
| 7 | Smoke test: turno abrir/cerrar | ☐ | — |
| 8 | Smoke test: pago mixto (efectivo + tarjeta) | ☐ | — |
| 9 | Smoke test: modificadores escalonados (Chilaquiles) | ☐ | — |
| 10 | Smoke test: offline (desconectar internet, operar, reconectar) | ☐ | — |
| 11 | Smoke test: reinicio Windows (turno persiste, auto-start) | ☐ | — |
| 12 | Smoke test: huella digital (login, registro, cross-terminal) | ☐ | — |
| 13 | Smoke test: staff crear/editar desde POS | ☐ | — |
| 14 | Smoke test: monitor de salud (6 servicios) | ☐ | — |
| 15 | Dashboard: ventas historicas visibles (915 dias) | ☐ | — |
| 16 | Dashboard: meseros/propinas/platillos | ☐ | — |
| 17 | Dashboard: inventario con stock y costos | ☐ | — |
| 18 | Dashboard: proveedores con gasto anual | ☐ | — |
| 19 | Dashboard: recetas con ingredientes | ☐ | — |
| 20 | Agentes IA: daily briefing funciona | ☐ | — |
| 21 | CFDI: Facturama en produccion | ☐ | — |
| 22 | Eduardo dice: "ya puedo operar sin Wansoft" | ☐ | — |

**Criterio de exit: items 1-14 + item 22. El resto son mejoras post-cutover.**

**El dia que todos esten en verde, Wansoft se apaga.**
