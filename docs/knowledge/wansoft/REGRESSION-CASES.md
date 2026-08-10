# 03 — CASOS DE REGRESIÓN: comportamiento Wansoft real → prueba Fullsite

Formato: `RC-## | dominio | escenario Wansoft real (fuente) | comportamiento esperado Fullsite | test existente o GAP`.
Tests en `dashboard-app/src/__tests__/`. No se encontró carpeta de tests separada en electron-app (los tests del monorepo viven en dashboard-app; suite ~1,400+ tests).

## Caja / Cortes / Arqueo

- **RC-01** | caja | Fórmula de arqueo del ticket real de corte AMALAY 2026-06-12: Esperado = Fondo $1,700 + VentasEfectivo + PropinasEfectivo + Depósitos − Vales − PropinasTarjetaPagadasEnEfectivo (CAJA-SPEC.md §14.2) | `calcEfectivoEsperado` reproduce la fórmula con depósitos/retiros y propinas por método | ✅ `pos-arqueo.test.ts` (calcEfectivoEsperado: propina efectivo/tarjeta, depósitos/retiros, combinación completa)
- **RC-02** | caja | Diferencia = Efectivo Real declarado − Esperado; sobrante positivo, faltante negativo (CAJA-SPEC.md §14.2) | diferencia con signo correcto en `pos_cierres.diferencia` | ✅ `pos-arqueo.test.ts` (diferencia positiva/negativa) + `pos-critical.test.ts` (Cash movements: sobrante/faltante/perfecto)
- **RC-03** | caja | Retiro de caja exige motivo + usuario + autorizador (botones Admin, CAJA-SPEC.md §12.9) | `pos_cash_movements` con reason/actor/approved_by NOT NULL y entra a la fórmula del corte | ✅ parcial: fórmula en `pos-arqueo.test.ts`/`pos-critical.test.ts`; **GAP**: no hay test de que retiro sin approved_by sea rechazado
- **RC-04** | caja | Corte Z bloqueado con órdenes abiertas; usuario debe cerrarlas antes (flujo en vivo, CAJA-SPEC.md §18) | GUARD-08: cierre con órdenes abiertas solo con escalación (autorizador + nota ≥10 chars, IDs capturados) | ✅ `pos-cierre-guard.test.ts` (filterOpenOrders, validateEscalationNota, withEscalationPayload)
- **RC-05** | caja | Solo status realmente abiertos bloquean el corte (cobrada/cancelada no cuentan) | filterOpenOrders mantiene enviada|preparando|lista y descarta cobrada|cancelada | ✅ `pos-cierre-guard.test.ts`
- **RC-06** | caja | El corte suma solo órdenes cobradas; canceladas no aportan a ventas (INFORMACIÓN OPERATIVA del corte, CAJA-SPEC.md §14.2) | `computeOrderSummary` descarta canceladas y agrega movimientos de caja | ✅ `pos-arqueo.test.ts` (computeOrderSummary)
- **RC-07** | caja | Cada intento de arqueo se registra (monto, diferencia, usuario, ts; máx 3 — `spInsIntentoCorteZ`, CAJA-SPEC.md) | registrar todos los intentos de arqueo (sin límite) para señal anti-fraude | ❌ **GAP** (Fullsite guarda solo el resultado final)
- **RC-08** | caja | Cambio <$5 en pago con tarjeta se registra como propina automática (config activa AMALAY, CAJA-SPEC.md §12) | si se adopta la regla: propina auto y efectivo esperado ajustado | ❌ **GAP** (regla no modelada)
- **RC-09** | caja | Fondo del siguiente turno hereda del efectivo real del corte anterior (WANSOFT-POS-BIBLE.md §18) | `pos_turnos.fondo_inicial` nuevo = fondo_final/conteo del turno cerrado | ❌ **GAP** (sin test de encadenamiento de turnos)
- **RC-10** | caja | Corte de Mesero: ventas por mesero del turno, base del tip-out 5% (CAJA-SPEC.md) | reporte por mesero del turno con propinas | ❌ **GAP** (existe `pos_staff_shifts.sales_total/tips_total`, sin test ni corte dedicado)

## Split / transferencia de cuentas

- **RC-11** | split | Split por silla: items de sillas seleccionadas van a orden nueva, binario (no se duplica), cada cuenta cobra e imprime aparte (WANSOFT-POS-BIBLE.md §11) | `splitCuenta`/`calcSplitItems`: asignación por item, Σ cuentas = total exacto | ✅ `pos-calculations.test.ts` (splitCuenta, calcSplitItems, sums equal full)
- **RC-12** | split | Descuento aplicado a la cuenta se prorratea al dividir (CAJA-SPEC.md §9) | prorrateo de descuento consistente en split por items y parejo; sin perder centavos | ✅ `pos-calculations.test.ts` (prorrateo + fuzz) + `pos-critical.test.ts` (Pago Mixto + Descuento)
- **RC-13** | split | División entre N personas con ajuste de centavos (cuenta impar) | `calcSplitParejo`: última cuenta absorbe el residuo; Σ = total | ✅ `pos-calculations.test.ts` (cierre de centavos, fuzz) + `business-logic.test.ts` (odd splits ceiling)
- **RC-14** | split | Pago mixto: multi-forma en una orden, saldo debe llegar a $0, botón Auto asigna restante (CAJA-SPEC.md §9) | `pagos` JSONB suma exacta al total; propina/IVA sobre total descontado | ✅ `pos-critical.test.ts` (múltiples métodos sum to total) + `pos-arqueo.test.ts` (split payments con propina)
- **RC-15** | transferencia | Transferir platillo de mesa A a mesa B, auditado usuario/origen/destino/hora — vector #1 de fraude según Eduardo (CAJA-SPEC.md §13) | mover item entre órdenes con registro de auditoría | ❌ **GAP CRÍTICO** (no existe módulo ni test de transferencia de mesa)

## Cancelaciones / permisos / descuentos

- **RC-16** | cancelación | Cancelar item ya enviado a cocina requiere permiso elevado (6 catálogos de PIN gerente, CAJA-SPEC.md §12.6) | solo admin tiene `cancelar_ordenes`; resto de roles rechazado | ✅ `pos-permissions.test.ts` (Eduardo rule: ONLY admin)
- **RC-17** | cancelación | Item cancelado no suma al total ni reaparece tras recargar (flujo en vivo) | flag cancelled persistido y excluido de subtotales | ✅ `pos-critical.test.ts` (Cancel after fire, BUG-016 persisted flag, múltiples courses)
- **RC-18** | cancelación | Pregunta "¿SE PREPARÓ?": NO → stock regresa; SÍ → merma (CAJA-SPEC.md §13.1) | cancelación decide devolución vs movimiento merma en ledger | ❌ **GAP** (movement_type='merma' existe; flujo de decisión no)
- **RC-19** | cancelación | Aviso "CANCELADA" se imprime en la misma impresora que la comanda original (CAJA-SPEC.md §13.1) | print job de cancelación ruteado a la estación original del item | ❌ **GAP**
- **RC-20** | permisos | Escalación in-place: gerente autoriza con su PIN sin cerrar sesión del cajero; debe quedar quién pidió y quién autorizó (CAJA-SPEC.md §13.3) | verificación PIN gerente offline (PBKDF2, TTL 24h, revocación) + registro de autorizador | ✅ `pos-manager-auth.test.ts` (verify/TTL/revoke/meetsMinRole) + `pos-cierre-guard.test.ts` (cierre_autorizado_por)
- **RC-21** | permisos | Jerarquía: mesero abre cuentas y comanda pero NO cierra, NO descuenta, NO corta; cajero corta turno/X pero NO Z ni descuentos (matriz Wansoft de perfiles) | matriz de permisos por rol equivalente | ✅ `pos-permissions.test.ts` (mesero/cajero permissions, jerarquía 5 roles)
- **RC-22** | descuentos | Platillo sin flag no acepta 2x1/descuento: "EL PLATILLO 'ACAI B KIND BOWL' NO ACEPTA 2X1" (CAJA-SPEC.md) | `aplica_2x1/aplica_descuento` bloquean la operación en captura | ❌ **GAP** (flags en schema; sin test del rechazo en flujo)
- **RC-23** | descuentos | Descuento nunca deja total negativo; cortesía limitada ($480/persona en regla Fullsite) y no excede subtotal | floor $0 y límite de cortesía | ✅ `pos-calculations.test.ts` (floor at $0) + `business-logic.test.ts` (Cortesia limits)
- **RC-24** | descuentos | Promoción activa solo en su ventana horaria; 2x1 calcula el item gratis; auto_apply (motor de promos Wansoft, 13 SPs) | evaluación de promos por schedule/tipo/items | ✅ `pos-critical.test.ts` (Promo evaluation, 2x1 calc, time window)
- **RC-25** | descuentos | Combo con precio menor a la suma: prorrateo proporcional sin perder centavos (paquetes Wansoft) | combo pricing proporcional con redondeo estable | ✅ `pos-critical.test.ts` (Combo pricing)

## Impresión por estación / KDS

- **RC-26** | impresión | Ruteo por grupo con override por platillo: CAFÉ → BARRA aunque el grupo vaya a COCINA (CAJA-SPEC.md §12) | `item.station` explícito tiene prioridad sobre keywords | ✅ `station-routing.test.ts` (Heineken → barra sin keywords, priority) + `pos-print.test.ts` (splitOrderByStation)
- **RC-27** | impresión | Separador de tiempo "XX TIEMPO: 1" aparece en TODAS las comandas de estaciones con items del tiempo (firebutton, CAJA-SPEC.md §6/§12) | TIEMPO_ITEM_ID distribuido a estaciones con items; trailing limpiado | ✅ `station-routing.test.ts` + `pos-print.test.ts` (tiempo items distributed, trailing cleaned)
- **RC-28** | impresión | Editar orden y reenviar imprime SOLO el delta (2ª comanda solo con CHILAQUILES, sesión en vivo CAJA-SPEC.md §13) | `detectItemChanges` detecta cantidad/modificadores/notas/silla y solo eso se imprime | ✅ `pos-print.test.ts` (detectItemChanges)
- **RC-29** | impresión | RestPrintingApp cae → comandas se acumulan y salen al volver (polling 15s, ARCHITECTURE.md §4.2) | cola persistente: pending→retrying→printed; needs_attention visible; reintento en caliente (BUG-015) | ✅ `pos-critical.test.ts` + `pos-print.test.ts` (state machine) + `printer-queue.test.ts` (serialización, fallo no bloquea cola)
- **RC-30** | impresión | Items market [NO IMPRIMIR] no generan comanda de cocina (CAJA-SPEC.md §12) | market → estación caja; no comanda a cocina | ✅ parcial `pos-inventory-offline.test.ts`/`business-logic.test.ts` (market→caja); **GAP**: no hay test "no se imprime comanda"
- **RC-31** | impresión | Ticket sin IVA desglosado cuando el cliente opera precios con IVA incluido (config AMALAY: IVA visible ✗) | fila IVA condicional a rate>0 (PRN-GAP-02) | ✅ `pos-print.test.ts` (IVA conditional)
- **RC-32** | KDS | Comanda física es forward-only: no se "desimprime" (equivalencia funcional) | KDS forward-only: enviada→preparando→lista→entregada, bloquea retroceso | ✅ `pos-kds.test.ts` (Forward-only guard)
- **RC-33** | KDS | Comandas viejas no saturan la cocina (Wansoft: papel se tira) | auto-archive >4h para enviada/preparando; lista siempre visible | ✅ `pos-kds.test.ts` (Auto-archive threshold)

## Inventario / recetas / unidades

- **RC-34** | inventario | Venta cobra → receta depleta ingredientes una sola vez aunque haya reintentos/concurrencia (`spSelConsumoPorVenta` corre 1 vez por venta) | idempotencia de depleción por orderId (secuencial y concurrente); ledger con 1 entrada | ✅ `inventory-double-deduction.test.ts` (TC-DD-01..06; documenta P0 y guard requerido)
- **RC-35** | inventario | Item market depleta 1:1 sin receta (grupo Market de AMALAY) | `computeMarketDeductions`: 1:1, agrega cantidades, alerta en reorden, faltante si sin stock | ✅ `market-inventory.test.ts`
- **RC-36** | inventario | Depleción usa la receta correcta del platillo (574 recetas AMALAY) | path por `recipe_ref` (DB) preferido; fuzzy solo fallback; miss se loguea, nunca silencioso | ✅ `pos-recipe-ref.test.ts` (db|fuzzy|miss) + `inventory-policy-gate.test.ts` (gate READY, GATE_FAILED)
- **RC-37** | inventario | Conversión compra→receta: 1 CAJA = 24 PIEZAS; recetas en gr/ml, compras en kg/cajas (BIBLE.md §3.2) | `pos_unit_conversions` aplicada en depleción y costeo | ❌ **GAP** (tabla existe; sin test unitario de conversión)
- **RC-38** | inventario | Merma/yield: 1kg pollo crudo ≠ cocido (72%); Wansoft NO lo maneja y su food cost miente (BACKOFFICE-KNOWLEDGE.md) | `yield_factor`/`merma_pct` aplicados en depleción y food cost | ❌ **GAP ALTO** (campos existen; aplicación en `deductIngredientsForOrder` sin test / sin evidencia)
- **RC-39** | inventario | Existencias locales apagadas en AMALAY: la venta NUNCA se bloquea por stock ("nunca decir no al cliente", CAJA-SPEC.md §12) | venta procede con stock 0; se registra faltante/alerta, no bloqueo | ✅ parcial `market-inventory.test.ts` (sin fila stock → faltante, no error); **GAP**: política explícita para ruta receta
- **RC-40** | inventario | Offline: depleción y política de inventario sobreviven sin red (benchmark Wansoft local-first) | policy state machine con LKG cache warm <7d; gate no rompe ventas | ✅ `inventory-policy.test.ts` (LKG cache, FAILED/READY) + `pos-inventory-offline.test.ts`

## Conciliación de totales día

- **RC-41** | conciliación | Total día = Σ formas de pago; % de pago suman ~100 (reporte SalesByPaymentType, wansoft_backfill.py L135) | conversión % → MXN correcta (regla ≥100 ⇒ MXN), agregación multi-día, orden desc | ✅ `payment-conversion.test.ts` + `data-integrity.test.ts` (percentages ~100%)
- **RC-42** | conciliación | Un solo registro por fecha aunque el scraper corra 2 veces (avance 3pm + cierre 11pm) | dedupe por fecha conservando el de mayor ventas | ✅ `data-dedup.test.ts` (dedupeByFecha) + `dedup-parserow.test.ts`
- **RC-43** | conciliación | Campos sucios del reporte Wansoft ("$1,234.56", nulls, JSONB doble-encoded) no corrompen totales | parseRow saneando null/NaN/strings; JSONB tolerante | ✅ `dedup-parserow.test.ts` + `data-integrity.test.ts`
- **RC-44** | conciliación | Día operativo con business date (corte 04:00, ventas post-medianoche cuentan al día anterior — `spInsNuevoDiaDeOperacion`; Fullsite: business_day_start_local) | asignación de fecha por business date, TZ Mexico City | ✅ parcial `data-integrity.test.ts` (timezone UTC-6); **GAP**: sin test de frontera 00:00-04:00 con `business_day_start_local`
- **RC-45** | conciliación | Corte por forma de pago cuadra contra terminal bancaria al centavo (gap Getnet: tecleo manual, CAJA-SPEC.md) | conciliación MP Point/Clip monto exacto vs orden | ✅ parcial `mp-point-api.test.ts`/`mercadopago-smart.test.ts` (API flow); evidencia E2E-06 cent-level; **GAP**: test automatizado de conciliación por método vs corte

## Resumen de GAPs (prioridad)

| GAP | Casos | Severidad |
|---|---|---|
| Transferencia de platillos entre mesas (fraude #1) | RC-15 | ALTA |
| Merma/yield en depleción + conversiones de unidades | RC-37, RC-38 | ALTA |
| Flujo "¿SE PREPARÓ?" + impresión CANCELADA a estación original | RC-18, RC-19 | ALTA |
| Intentos de arqueo registrados + regla cambio-como-propina | RC-07, RC-08 | MEDIA |
| Encadenamiento de fondo entre turnos + corte de mesero | RC-09, RC-10 | MEDIA |
| Enforcement flags aplica_descuento/2x1 en flujo | RC-22 | MEDIA |
| Frontera business date 00:00-04:00 | RC-44 | MEDIA |
| Conciliación automática por método vs corte | RC-45 | MEDIA |
