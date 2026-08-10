# 01 — MAPA WANSOFT → FULLSITE (datos y comportamientos)

> Fuentes: `docs/knowledge/wansoft/` (BIBLE.md, CAJA-SPEC.md, DATA-MODEL.md, ARCHITECTURE.md, LESSONS-NETSILVER.md, BACKOFFICE-KNOWLEDGE.md, PORTAL-MAP.md), `docs/product/WANSOFT-POS-BIBLE.md`, `docs/product/SETTINGS-BIBLE.md`, `docs/product/SETTINGS-GAP-ANALYSIS.md`, schema en `scripts/sql/migrations/` (001, 010, 011, 012, P1-D03). BD real Wansoft = NetSilver SQL Server (~80 tablas, 822 SPs, backup `cafeamalay20260330.bak` 1.78 GB — ARCHITECTURE.md §11).
> Estados: **MAPEADO** / **PARCIAL** / **SIN EQUIVALENTE** / **COMPORTAMIENTO DISTINTO**.

## 1. Catálogos (menú / productos / grupos)

| Wansoft (fuente) | Fullsite | Estado | Notas de semántica |
|---|---|---|---|
| Grupo (ID_Grupo, 2285 refs; nivel, sección) — DATA-MODEL.md §3.1 | `pos_menu_categories` (name, color, sort_order, active) | MAPEADO | Fullsite es plano (1 nivel); Wansoft tiene tipo-de-grupo/nivel/sección. Jerarquía extra = PARCIAL. |
| Platillo (ID_Platillo, 4390 refs; clave, precio, barcode, grupo) — DATA-MODEL.md §3.1 | `pos_menu_items` (category_id, name, price, barcode, sort_order, active) | MAPEADO | — |
| Flags AceptaDescuento / Acepta2x1 / AceptaCortesia — BIBLE.md §3.1, CAJA-SPEC.md | `pos_menu_items.aplica_descuento / aplica_2x1 / aplica_cortesia` | MAPEADO | Wansoft valida en captura: "EL PLATILLO 'ACAI B KIND BOWL' NO ACEPTA 2X1". Fullsite debe rechazar igual. |
| Tipos de precio múltiples (normal/evento/HH/delivery, 303 refs) — DATA-MODEL.md §3.1 | Sin campo; `pos_promotions.schedule` cubre HH parcialmente | SIN EQUIVALENTE | Wansoft aplica precio automático según TipoOrden. Fullsite: 1 precio por item. |
| Tamaños (ID_Tamano, precio diferencial) — DATA-MODEL.md §3.1 | `pos_sizes` (name, multiplier) | COMPORTAMIENTO DISTINTO | Wansoft: precio absoluto por tamaño; Fullsite: multiplicador. Recetas Wansoft se piden por (saucerId, sizeId). |
| Horarios de disponibilidad por platillo — BIBLE.md §3.1 | `pos_schedules` + `pos_combos.schedule` | PARCIAL | Wansoft **oculta** el platillo fuera de horario (no lo pone gris). |
| Flag NoImprimir (market) — CAJA-SPEC.md §12 | Ruteo estación `caja` / market items | MAPEADO | Ver §8 impresión. |

## 2. Modificadores

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Modificador por niveles (Nivel 1 obligatorio, 2+ opcional; modal escalonado) — CAJA-SPEC.md §4, WANSOFT-POS-BIBLE.md §4 | `pos_modifier_groups` (level, required, min_selections, max_selections) + `pos_modifiers` (price) + `pos_item_modifier_groups` | MAPEADO | Invariante Wansoft: no puedes guardar sin resolver nivel requerido; opcional tiene botón skip. Máximo por nivel validado en captura (no permite 5 si max=4). |
| Concatenación en comanda: "CHILAQUILES. VERDES. AGUACATE. POLLO" — CAJA-SPEC.md §4 | Comanda imprime modificadores por renglón (config) | COMPORTAMIENTO DISTINTO | Wansoft concatena al nombre; Fullsite renglones. Cocina AMALAY está entrenada con formato Wansoft. |
| Precio de modificador se suma al base — CAJA-SPEC.md §4 | `calcItemSubtotal` (extras) — cubierto en pos-calculations.test.ts | MAPEADO | — |
| Modificadores distintos por tipo de orden (presencial vs delivery) — CAJA-SPEC.md §4 | — | SIN EQUIVALENTE | |
| Sabores tipo QUITAR ("Sin cebolla"…) | Modifiers `QUITAR` estáticos (pos-menu-db) | MAPEADO | Fullsite hoy: parte estática en código, parte BD. |

## 3. Recetas y subproductos

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Receta (Id_Platillo, Id_Articulo, Cantidad, Id_UnidadMedida, Costo) — DATA-MODEL.md §3.1; 574 recetas AMALAY (ARCHITECTURE.md) | `pos_recipe_versions` + `pos_recipe_lines` (ingredient_id, quantity, recipe_unit); histórico `pos_recipes` (JSONB, source='excel', ~27.6% food cost) y `pos_recipes_old` | MAPEADO | Fullsite añade versionado (UNIQUE active por item) que Wansoft no tiene. `pos_recipes` (Excel) = verdad de costeo (memoria food-cost-truth). |
| Subproducto / preparación intermedia (Id_ProductoIntermedio) — DATA-MODEL.md §3.1; endpoint `/Production/GetSubProductRecipe` | `pos_sub_recipes` (yield_quantity, yield_unit) + `pos_sub_recipe_ingredients` (ingredient_type: ingredient\|subrecipe) | MAPEADO | Fullsite soporta anidación subrecipe→subrecipe; Wansoft NO tiene sub-recetas anidadas (Eduardo lo pidió — BACKOFFICE-KNOWLEDGE.md §1). |
| Rendimiento/yield: NO implementado en Wansoft (gap: 1kg pollo crudo ≠ cocido, 72%) — BACKOFFICE-KNOWLEDGE.md | `pos_ingredients.yield_factor`, `pos_insumos.rendimiento_pct/merma_pct`, `precio_limpio` | COMPORTAMIENTO DISTINTO (Fullsite superior) | Ojo: yield existe en schema pero **no se aplica en depleción** (gap de test — ver 03-REGRESSION). |
| Orden de Producción (Id_OrdenProduccion, 1542 refs; entrada ingredientes → salida producto, status + merma) — BIBLE.md §3.4, `spInsComandaProduccion` | — | SIN EQUIVALENTE | Producción es proceso de primera clase en Wansoft (batch de 40 croissants). Fullsite no tiene entidad de producción. |
| Deducción al COBRAR, no al comandar — CAJA-SPEC.md (marcado como incorrecto) | `deductIngredientsForOrder()` con gate `pos_item_inventory_policy` + `pos_reconciliation_results` | COMPORTAMIENTO DISTINTO | Fullsite decide por policy (recipe/direct_stock/unclassified) e idempotencia por order_revision. Definir momento de depleción explícitamente al migrar. |

## 4. Inventario

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| 6 almacenes AMALAY (Cocina Principal, Pastelería, Bar, Market, Almacén General, Desechables) — BIBLE.md §3.2 | `pos_inventory` (stock único por ingredient) — **sin dimensión almacén** | SIN EQUIVALENTE | Fullsite tiene un solo stock por ingrediente/cliente. Multi-almacén no existe. |
| Articulo (Presentación, UDM, PuntoReorden, último costo, Caducable) — DATA-MODEL.md §3.1; ~3,000 productos | `pos_ingredients` (unit, cost_per_unit, yield_factor, is_critical) + `pos_inventory` (reorder_point, reorder_quantity) + `pos_presentations` + `pos_ingredient_presentations` (contains_quantity/unit, cost_per_presentation) | MAPEADO | Caducidad ("productos a caducar") sin equivalente. Unidades Wansoft en texto largo: "Kilogramo", "Pieza", "Litro" (ingredient-costs-2026-07-20.json). |
| Conversiones (1 CAJA = 24 PIEZAS; compra en cajas, receta en piezas) — BIBLE.md §3.2 | `pos_unit_conversions` (from_unit, to_unit, factor, is_system) | PARCIAL | Tabla existe; **sin test unitario** y sin evidencia de uso en depleción. |
| Movimiento (Tipo entrada/salida/ajuste/devolución; Motivo; Usuario) — DATA-MODEL.md §3.1 | `pos_inventory_movements` / `pos_market_movements` (movement_type: compra\|venta\|merma\|ajuste, actor, order_id, mutation_revision) | MAPEADO | Fullsite añade liga a `pos_reconciliation_results`. Falta tipo "transferencia" y "devolución". |
| Stock comprometido (CantidadEnProduccion) → "¿cuántos más puedo servir?" — BIBLE.md §4 | — | SIN EQUIVALENTE | AMALAY además opera con existencias locales APAGADAS ("nunca decir no al cliente") — CAJA-SPEC.md §12. |
| Merma por cancelación: pregunta "¿SE PREPARÓ?" SÍ=merma / NO=regresa stock — CAJA-SPEC.md §13.1 | movement_type='merma' existe; **flujo de pregunta no existe** | PARCIAL | Edge case operativo clave (ver §12). |
| Paleo de barra (pesar botellas vs consumo teórico, báscula COM 9600 baud) — BIBLE.md §3.2 | — | SIN EQUIVALENTE | Anti-robo de porciones en bar. |
| Físico vs sistema (export `ExportPhysicalInventoryVsSystemReport`) — wansoft_inventory_scrape.py | Conteo/ajuste manual (movement ajuste); sin reporte dedicado | PARCIAL | |
| Transferencias entre sucursales (760 refs; enviar=baja origen, recibir=alta destino con discrepancia) — DATA-MODEL.md | — | SIN EQUIVALENTE | Relevante para Grupo Galería multi-sucursal. |
| Alerta variación de costo de compra (>15% default) — BIBLE.md §3.2 | Agente cost variance (AI Ops) | PARCIAL | En Fullsite vive como agente, no como validación en recepción de OC. |
| Punto de reorden + compras sugeridas — PORTAL-MAP.md (Reportes Inventario) | `pos_inventory.reorder_point` + `pos_purchase_orders.ai_suggested` + `pos_inventory_alerts` | MAPEADO | |

## 5. Usuarios, permisos, roles

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Usuario (Puesto, huella DigitalPersona 4500, RegistroAsistencia) — DATA-MODEL.md §3.1 | `pos_staff` (pin, role, unique_pin_per_client) + `pos_fingerprint_templates` + `pos_attendance` (method: pin/fingerprint) + `pos_staff_shifts` | MAPEADO | 15 roles en AMALAY-Wansoft vs 5 en Fullsite (mesero, capitan, cajero, gerente, admin). |
| Perfiles/plantillas de permisos (Id_Perfil; Permiso/PermisoRol/PermisoUsuario) — ARCHITECTURE.md §3.1 | Matriz de permisos por rol en código (`getPermissions`, PERMISSION_GROUPS ×7) | COMPORTAMIENTO DISTINTO | Wansoft: permisos por usuario configurables; Fullsite: por rol, fijo en código. |
| 6 catálogos de PIN gerente (platillos, grupos, formas de pago, descuentos, cortesías, razones de cancelación) — CAJA-SPEC.md §12.6 | Parcial: cancelar_ordenes = solo admin; descuentos por permiso; catálogos no configurables | PARCIAL | Wansoft granular por catálogo; Fullsite por permiso de rol. |
| Escalation in-place: gerente teclea PIN SIN cerrar sesión del cajero — CAJA-SPEC.md §13.3 | Manager auth offline (PBKDF2 + TTL 24h + revocación) — pos-manager-auth.test.ts | MAPEADO | Wansoft NO registra quién pidió + quién autorizó; Fullsite sí debe (y GUARD-08 ya guarda `cierre_autorizado_por`). |
| Logs de acciones: checkbox, AMALAY lo tenía APAGADO = cero audit trail — CAJA-SPEC.md §12.6 | `pos_staff_audit`, `pos_cash_movements.approved_by`, auditoría siempre-on | COMPORTAMIENTO DISTINTO (Fullsite superior) | Anti-patrón Wansoft: auditoría opcional. Fullsite no debe hacerla apagable. |

## 6. Ventas (órdenes, split, transferencia, cancelación, descuentos)

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| OrdenPendiente (Id secuencial por terminal, Mesa, Mesero, Personas, TipoOrden: Restaurante/Llevar/Domicilio/Recoger/eCommerce, Status 1-4) — CAJA-SPEC.md §6, DATA-MODEL.md | `pos_orders` (mesa, mesero, personas, status abierta→…→cobrada/cancelada, order_number, customer_name, turno_id) | MAPEADO | Tipos de orden Fullsite implícitos (mesa vs llevar); domicilio/recoger sin flujo propio. AMALAY solo usa Restaurante/Llevar/eCommerce. |
| Comanda item (Silla, Tiempo, Produccion flag) — CAJA-SPEC.md §6 | `pos_orders.items` JSONB (cuenta, station, cancelled, course/tiempo separador TIEMPO_ITEM_ID) | PARCIAL | Silla Wansoft = base del split; Fullsite usa "cuenta" por item. Sillas activadas en AMALAY. |
| Separador de tiempos + firebutton (texto custom "***PREPARAR Y SAC...") — CAJA-SPEC.md §12 | TIEMPO_ITEM_ID distribuido a todas las estaciones — station-routing.test.ts | MAPEADO | |
| Edición: NO editar items ya enviados a cocina (solo cancelar) — CAJA-SPEC.md §13; 2ª comanda imprime solo lo nuevo | `detectItemChanges` (delta printing) — pos-print.test.ts | MAPEADO | Invariante: reenvío imprime SOLO delta. |
| Cancelación: razón (catálogo) + pregunta "¿SE PREPARÓ?" + aviso CANCELADA en impresora original — CAJA-SPEC.md §13.1 | Items cancelled excluidos de totales (BUG-016 persist) + permiso admin | PARCIAL | Faltan: catálogo de razones, decisión de inventario, impresión de aviso a cocina. |
| Transferencia de platillos entre mesas (vector #1 de fraude según Eduardo; auditable origen/destino/item/hora) — CAJA-SPEC.md §13 | — | SIN EQUIVALENTE | Sin módulo ni test en Fullsite. |
| Split de cuenta POR SILLA, binario (item va a cuenta 1 o 2), cada orden cobra e imprime aparte — WANSOFT-POS-BIBLE.md §11 | `splitCuenta`/`calcSplitItems` (por item) + `calcSplitParejo` (por persona, ajuste de centavos en última cuenta) | MAPEADO | Fullsite añade split parejo que Wansoft no tiene. Prorrateo de descuento probado con fuzz (suma = total exacto). |
| Descuentos: catálogo % (10–90) + razones nombradas ("TELCEL 15%", "BBVA 15%", "50% EMPLEADOS"); por item o prorrateado; no dobles descuentos — CAJA-SPEC.md | `pos_orders.descuento` + `pos_promotions` (percentage/fixed/2x1, max_per_day, auto_apply) | PARCIAL | Fullsite sin catálogo de razones de descuento ni flag anti-doble-descuento. |
| 2x1 (op separada, flag Acepta2x1) — CAJA-SPEC.md | `pos_promotions.type='2x1'` + `aplica_2x1` | MAPEADO | |
| Cortesía: siempre 100%, razón obligatoria, PIN gerente, catálogo nombrado (CLAUDIA SADA, INFLUENCER) — CAJA-SPEC.md | Límite cortesía $480/persona probado (business-logic.test.ts), `aplica_cortesia` | PARCIAL | Sin catálogo de cortesías nombradas ni razón obligatoria en flujo. |
| Pago mixto (multi-forma, botón "Auto" asigna saldo restante; cambio en tiempo real; saldo debe llegar a $0) — CAJA-SPEC.md §9 | `pos_orders.pagos` JSONB [{metodo, monto}] — pos-critical.test.ts | MAPEADO | Invariante: suma pagos = total; propina/IVA sobre total con descuento. |
| 17+ formas de pago (Efectivo, Dólares, TC/TD, Transferencia, Rappi, UberEats, NetPay, Clip, custom "Claudia Sada", "Vale Amalay"…) — CAJA-SPEC.md | `pos_payment_methods` (type cash/card/transfer, commission_pct, fiscal_code) | MAPEADO | Getnet NO integrada en Wansoft (se teclea a mano) — mismo riesgo si Fullsite no integra terminal. Fullsite: MP Point + Clip API. |
| Impuestos: IVA 16% + IEPS separado (alcohol) — DATA-MODEL.md Venta.IEPS | `pos_orders.iva`; `clients.iva_rate`; IVA condicional en ticket (PRN-GAP-02) | PARCIAL | **IEPS sin equivalente**. AMALAY hoy corre IVA_RATE=0 (precios con IVA incluido). |

## 7. Caja / Cortes

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Fondo de caja $1,700 persistente entre turnos — CAJA-SPEC.md §14.2 | `pos_turnos.fondo_inicial/fondo_final` | MAPEADO | Wansoft: fondo del siguiente turno hereda del efectivo real del corte. |
| Fórmula arqueo: Esperado = Fondo + VentasEfectivo + PropinasEfectivo + Depósitos − Vales − PropinasTarjetaPagadasEnEfectivo — CAJA-SPEC.md §14.2, SETTINGS-GAP-ANALYSIS.md #6 | `calcEfectivoEsperado` + `pos_cierres` (billetes/monedas JSONB, total_contado, efectivo_sistema, diferencia) — pos-arqueo.test.ts | MAPEADO | Fullsite cuenta por denominación (billetes/monedas) — Wansoft solo monto declarado. Término Wansoft "Vales" = gastos menores → `pos_cash_movements` tipo retiro. |
| Regla "cambio como propina en pagos bancarios" (<$5 → propina) ACTIVA en AMALAY — CAJA-SPEC.md §12 | — | SIN EQUIVALENTE | Afecta cuadre al centavo de propinas y efectivo. |
| 5 tipos de corte: X (parcial), Turno, Z (fiscal, consecutivo 0001…, sin órdenes abiertas, máx 9h turno), Global (multi-terminal), Mesero — WANSOFT-POS-BIBLE.md §18, CAJA-SPEC.md §18 | `pos_cierres` = corte de turno único; corte X ≈ resumen en vivo; sin Z fiscal numerado, sin Global, sin corte de mesero | PARCIAL | Fullsite GUARD-08 **mejora** el Z: permite cerrar con órdenes abiertas solo con escalación (autorizador + nota ≥10 chars) — migración 012. Wansoft simplemente bloquea. |
| Intentos de arqueo (máx 3; cada intento registra monto, diferencia, usuario, timestamp — `spInsIntentoCorteZ`) — CAJA-SPEC.md | — | SIN EQUIVALENTE | Anti-manipulación: los intentos revelan "cuadrar a mano". Fullsite guarda 1 resultado. |
| Retiros/Depósitos con motivo + usuario + autorización; retiros programados (auto cuando cash > umbral) — CAJA-SPEC.md §12 | `pos_cash_movements` (type deposito/retiro, reason, actor, approved_by NOT NULL) | MAPEADO | Retiros programados sin equivalente (AMALAY los tiene apagados). |
| Contenido del corte impreso: TOTALES GENERALES (s/impuestos, IVA, IEPS, c/impuestos), ventas por FP, propinas por FP, CONTROL POR FORMA PAGO (arqueo), INFORMACIÓN OPERATIVA (órdenes, platillos, personas, promedios, por tipo, cortesías, cancelaciones, anulaciones, descuentos, DXU, gift cards, promos) — CAJA-SPEC.md §14.2 (ticket real 2026-06-12) | `pos_cierres` (total_ventas, tickets_count, cancelaciones, descuentos, propinas, *_sistema por método) | PARCIAL | Faltan en corte Fullsite: anulaciones vs cancelaciones (Wansoft distingue), cortesías, DXU, desglose por tipo de orden, promedios/persona. |
| Propinas: tip-out 5% de ventas, reparto por puesto (`spSelReportePropinasPuestos`), fondo de propinas (`spInsFondoPropinas`), brutas vs netas (−comisión) — CAJA-SPEC.md, DATA-MODEL.md | `pos_staff_shifts.tips_total`; `pos_payment_methods.commission_pct` | PARCIAL | Sin motor de reparto/liquidación (`spInsertarLiquidacion`). |
| Botones Admin: abrir cajón SIN venta (auditado), cambiar forma de pago post-cobro (auditado), registrar vale — CAJA-SPEC.md §12.9 | drawer kick en print jobs (type='drawer'); cambio de método post-cobro sin flujo auditado | PARCIAL | |

## 8. Impresión

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Ruteo por grupo + override por platillo; hasta 5 impresoras por item; [NO IMPRIMIR] — CAJA-SPEC.md §12 | `splitOrderByStation` con `item.station` explícito (P1-D03 station routing en `clients.pos_settings`) + fallback keywords | MAPEADO | Fullsite: 3 estaciones (cocina/barra/caja); Wansoft: N impresoras + duplicado. |
| 4 impresoras AMALAY: EC TICKET USB (caja + cajón RJ-11 DRAWER_KICK), COCINA CALIENTE TCP/IP, BARRA TCP/IP, PANADERÍA — CAJA-SPEC.md §12 | `pos_print_jobs` (station, type comanda/ticket/drawer, state machine pending→printed/needs_attention/bridge_unavailable/retrying) | MAPEADO | BUG-015: retrying auto-reintenta en caliente (v1.3.4). |
| RestPrintingApp.exe polling 15 s a SQL Server — ARCHITECTURE.md §4.2 | Bridge HTTP inmediato (0-1 s) | COMPORTAMIENTO DISTINTO (Fullsite superior) | Benchmark de confiabilidad offline: igualar o superar (memoria offline-architecture). |
| Comanda: 30+ checkboxes (silla, tamaño, grupo, modificadores por renglón, agrupados, tamaños de letra por campo, distancia 15) — CAJA-SPEC.md §12.2-12.10 | Formato de comanda fijo en código | PARCIAL | Configurabilidad por cliente muy inferior; documentado en SETTINGS-GAP-ANALYSIS.md. |
| Ticket 72mm: QR encuesta 270×270, QR CFDI autofactura serie A, propina sugerida (catálogo %), footer 7 líneas, logo/RFC — CAJA-SPEC.md §12 | Ticket con IVA condicional (PRN-GAP-02); `clients.receipt_footer`, `logo_url`; CFDI vía `pos_cfdi_requests`/Facturapi | MAPEADO | QR de autofacturación en ticket: PARCIAL. |
| Cancelación imprime "CANCELADA" en la MISMA impresora que la comanda original — CAJA-SPEC.md §13.1 | — | SIN EQUIVALENTE | Crítico operativo: cocina debe enterarse de dejar de preparar. |
| Pre-ticket (cuenta) vs ticket final pagado; impresiones N configurables — CAJA-SPEC.md §12 | Flujo pre-ticket/final implementado (memoria Bernardo CRM) | MAPEADO | |
| Etiquetas/stickers por grupo; 47 templates MR6 — ARCHITECTURE.md §5 | — | SIN EQUIVALENTE | Etiquetas para delivery/market. |

## 9. KDS

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Wansoft NO tiene KDS visual: Id_KdsEstacion (89 refs) existe pero se implementa como routing de impresión — ARCHITECTURE.md §3.1, BIBLE.md §2 | KDS real: `pos_orders.kds_item_status` JSONB, forward-only (enviada→preparando→lista→entregada), auto-archive 4h, filtro por estación, optimistic update + rollback — pos-kds.test.ts | COMPORTAMIENTO DISTINTO (Fullsite superior) | No hay comportamiento Wansoft que igualar; el "contrato" a igualar es la comanda impresa: todo lo que imprime debe aparecer en KDS con el mismo ruteo. |
| Tiempos/firebutton llegan a cocina por comanda parcial | TIEMPO_ITEM_ID visible en KDS y en todas las estaciones con items | MAPEADO | |

## 10. Históricos / reportes

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Reporte diario consolidado (`GetConsolidatedSales`: TotalSales, TotalGrossSales, TotalDiscount) + por mesero/grupo/FP/hora/área/terminal — PORTAL-MAP.md, wansoft_backfill.py | `wansoft_daily` (ventas_brutas, ventas_dia, descuentos, efectivo, tarjeta, meseros/ventas_por_grupo/pago_metodos JSONB, tickets_count, personas) + `wansoft_kpis` (tiempo real) + `wansoft_hourly`/`wansoft_persons_hourly`/`wansoft_data` | MAPEADO | 880 días backfilled. JSONB keys: `nombre`,`total`. `platillos_top` mezcla platillos/meseros/grupos (nota CLAUDE.md). |
| Export Excel ventas 9 hojas (resumen, detalladas, cortesías, descuentos, cancelaciones, anulaciones, ocupación, contador con IVA/IEPS) — BIBLE.md §2 | Reportes dashboard + `wansoft_catalog` (mapa de exports: xlsx_sheets, endpoints) | PARCIAL | "Reporte para contador" (desglose fiscal) sin equivalente 1:1. |
| Inventario: 22+ reportes (kardex, existencias, caducar, validación de recetas, paleo, tablajería, físico vs sistema, compras sugeridas) — PORTAL-MAP.md | Ledger `pos_inventory_movements` + alerts; reportes mínimos | PARCIAL | Kardex reconstruible desde ledger. |
| Ventas detalle por ticket (DetalleVenta, Pago por venta) — DATA-MODEL.md | `pos_orders.items/pagos` JSONB por orden | MAPEADO | Fullsite es fuente primaria desde el switch de data_source (clients.data_source wansoft/fullsite). |

## 11. Conciliación de totales

| Wansoft (fuente) | Fullsite | Estado | Notas |
|---|---|---|---|
| Arqueo por forma de pago (`spInsCortesArqueoDiferenciaFP`) — DATA-MODEL.md | `pos_cierres.efectivo_sistema/tarjeta_sistema/transferencias_sistema` + diferencia | MAPEADO | Diferencia = Real − Esperado; sobrante positivo, faltante negativo (pos-arqueo, pos-critical tests). |
| Conciliación ventas vs CFDI (faltantes → factura global) — PORTAL-MAP.md | `pos_cfdi_requests` por orden; sin factura global | PARCIAL | AMALAY ~400-430 CFDIs/mes. |
| Conciliación depósitos bancarios vs cortes; gap Getnet manual — CAJA-SPEC.md | Conciliación MP Point (E2E-06: fondo + venta efectivo + tarjeta al centavo) | PARCIAL | |
| Físico vs sistema con motivo — wansoft_inventory_scrape.py | Ajustes en ledger | PARCIAL | |
| Suma diarios = mensual (audit `wansoft_data_audit.py` GetConsolidatedSales vs SalesByBranch) | dedupeByFecha (keep highest ventas), payment % → MXN, sums consistency tests | MAPEADO | Regla parser: montos "$1,234.56" → strip `$,%`. `pago_metodos` puede venir en % o MXN (payment-conversion.test.ts: ≥100 ⇒ MXN). |

## 12. Comportamientos no-obvios (edge cases que Fullsite debe igualar)

1. **"¿SE PREPARÓ?" en cancelación** decide inventario: NO → stock regresa; SÍ → merma sin retorno (CAJA-SPEC.md §13.1). Fullsite hoy no pregunta.
2. **Aviso CANCELADA se imprime en la impresora de la comanda original** — si no, cocina prepara platillos cancelados.
3. **Cambio <$5 en pago con tarjeta se convierte en propina automáticamente** (config activa en AMALAY) — rompe cuadres al centavo si el migrador no lo modela.
4. **Corte Z bloquea con órdenes abiertas** y valida turno ≤9h; numeración consecutiva fiscal. Fullsite: escalación GUARD-08 en vez de bloqueo duro (superior, pero documentar la diferencia al cliente).
5. **Cada intento de arqueo queda registrado** (máx 3) — señal anti-fraude que Fullsite no captura.
6. **Fondo del siguiente turno hereda del efectivo real del corte anterior** — no es constante aunque AMALAY use $1,700 fijo.
7. **Reenvío a cocina imprime SOLO el delta** (segunda comanda con únicamente CHILAQUILES en sesión en vivo, CAJA-SPEC.md §13).
8. **Platillos fuera de horario desaparecen del POS** (no se muestran deshabilitados).
9. **Transferencia de platillos entre mesas = vector #1 de fraude** (Eduardo): debe quedar auditada origen/destino/usuario/hora; Wansoft la tiene, Fullsite no.
10. **Precios por tipo de orden** se aplican solos (delivery usa precio delivery si existe, si no el base).
11. **Silla obligatoria si sillas activadas; tiempos obligatorios si activados** — validaciones de captura, no de cierre.
12. **Pseudo-mesero "APLICACIONES"** agrupa ventas de plataformas delivery — el filtro `staff_exclude_meseros` ya lo excluye de rankings (wansoft_backfill.py L96); el migrador debe preservar la convención.
13. **IEPS separado del IVA** en bebidas alcohólicas — sin equivalente Fullsite; impacta el "reporte para contador".
14. **Existencias locales apagadas** en AMALAY ("nunca decir no al cliente"): el POS no bloquea venta sin stock; depleción puede dejar stock negativo → Fullsite: `computeMarketDeductions` NO permite stock negativo (faltante) — COMPORTAMIENTO DISTINTO a validar con el cliente.
15. **Órdenes con Id secuencial por terminal** (72, 73, 74…) — los meseros se refieren a órdenes por ese número corto; `order_number` de Fullsite debe ser visible y secuencial.
16. **Logs de auditoría eran opcionales y estaban apagados** — al migrar no habrá histórico de cancelaciones/descuentos/cortesías para baseline de agentes anti-fraude.
