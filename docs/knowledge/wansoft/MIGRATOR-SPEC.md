# 02 — MIGRATOR SPEC: Wansoft → Fullsite

Objetivo: mínimo trabajo del cliente. Todo lo que ya sabemos leer de Wansoft (parsers en `.github/scripts/`) se reutiliza; lo demás se ordena por realismo de extracción.

## Fuentes de extracción disponibles (de mejor a peor)

| # | Fuente | Acceso | Estado probado |
|---|---|---|---|
| F1 | **Endpoints HTTP JSON/HTML del portal wansoft.net** (`https://www.wansoft.net/Wansoft.Web/...`) | Cookie relay (`.ASPXAUTH` + `ASP.NET_SessionId` + CSRF token en `clients.wansoft_cookies`; login manual cada 7-30 días por Turnstile) — wansoft_auth.py L52-93 | ✅ FUNCIONA (JSON first, HTML `.rowReport` fallback, export form 3ª opción). Playwright/headless NO funciona (Turnstile). |
| F2 | **Exports TXT/CSV del portal** (`/Inventory/Export*` vía form POST + `__RequestVerificationToken`) | Misma cookie | ✅ FUNCIONA — wansoft_inventory_scrape.py L238-274 |
| F3 | **BD NetSilver SQL Server directa** (backup `.bak` 1.78 GB o SSMS vía TeamViewer SERVER1, BD `NetSilver`) | Acceso físico/TeamViewer al server del cliente | ✅ Probado en AMALAY (memoria TeamViewer); 80 tablas, 822 SPs. Máxima fidelidad, mayor fricción. |
| F4 | **Excel export de ventas (9 hojas)** que el cliente ya sabe bajar | El cliente lo baja de Reportes | Formato conocido (BIBLE.md §2), sin parser dedicado aún |
| F5 | **Foto/documento** (ticket de corte, config NETSILVER en pantalla) | Visita de instalación | Usado en AMALAY (CAJA-SPEC.md capturas 37-52) |

Regla de diseño: **F1/F2 automatizan ~90%**; F3 solo para lo que el portal no expone (permisos finos, histórico ticket-a-ticket); F5 solo para configuración operativa (fondo, impresoras, reglas).

---

## FASE A — Necesario para operar DÍA 1

### A1. Catálogo de menú (grupos, platillos, precios)
- **Fuente:** F1 `/Menu/GetSaucerAndComplementaryListBySubsidiary` (JSON) + `/Reports/GetSaucersWithCost` (name, price, cost, margin_pct) + `/Reports/SalesByGroup`.
- **Parser existente:** `wansoft_menu_sync.py` (L165-227) y `wansoft_recipe_scraper.py` (L97). Precedente de import: `docs/knowledge/wansoft/import-wansoft-catalog.sql` + `extract-2026-07-20.json`.
- **Transformación:** grupos → `pos_menu_categories`; platillos → `pos_menu_items` (name, price, category_id, barcode). Flags `aplica_descuento/2x1/cortesia`: NO exportables por portal → default true + ajuste con cliente (o F3: flags en tabla Platillo).
- **Validación:** conteo items ≥ items con venta en 90 días (`SalesBySaucer` = universo realmente vendido); precios spot-check contra ticket físico; 0 categorías vacías.
- **Cliente aporta:** 30 min de revisión de precios/flags. **Automatizable:** 95%.
- **Riesgo:** platillos inactivos/basura en catálogo (AMALAY: `platillos_top` mezcla grupos y meseros) → filtrar por ventas 90d.

### A2. Modificadores
- **Fuente:** F1 `/Reports/SalesByModifiers` (wansoft_menu_sync.py L249) da SOLO los modificadores vendidos con frecuencia — la ESTRUCTURA (niveles, requerido, min/max, precio, vínculo item) no está en reports → **F3** (tabla Modificador: Nivel, Requerido, Minimos/MaximosSelecciones, Precio, Id_Platillo) o captura manual guiada.
- **Transformación:** → `pos_modifier_groups` (level, required, min/max_selections) + `pos_modifiers` (price) + `pos_item_modifier_groups`.
- **Validación:** todo platillo con modificador requerido en Wansoft debe tenerlo en Fullsite (bloquea captura si no); dry-run: capturar 10 platillos top y comparar comanda.
- **Cliente aporta:** sesión 1-2 h validando niveles con el POS Wansoft abierto (o nada si hay acceso F3). **Automatizable:** 40% sin F3, 90% con F3.
- **Riesgo ALTO:** sin modificadores correctos el POS no es operable día 1 — es el dominio con peor cobertura de export.

### A3. Staff, PINs, roles
- **Fuente:** F5/manual — el portal no exporta usuarios con permisos; F3 tiene tabla Usuario + Perfil pero PINs/huellas no migran (hash/plataforma distinta).
- **Transformación:** → `pos_staff` (name, role ∈ mesero|capitan|cajero|gerente|admin, pin nuevo). Mapeo de 15 roles Wansoft → 5 roles Fullsite (tabla de equivalencias, decisión gerente).
- **Validación:** `unique_pin_per_client`; todo cajero/gerente prueba login + una op con escalación.
- **Cliente aporta:** lista nombre→puesto (foto del reporte de Asistencia sirve) + asignar PINs nuevos. **Automatizable:** 20% (es corto: ~15-30 personas).
- **Riesgo:** convención pseudo-meseros ("APLICACIONES", "MESERO EVENTO") debe preservarse y excluirse de rankings (`clients.staff_exclude_meseros`).

### A4. Configuración de caja y corte
- **Fuente:** F5 — pantallas NETSILVER > Cortes/Caja/Ticket (checklist ya levantado en CAJA-SPEC.md §12 para AMALAY, reutilizable como formulario de onboarding).
- **Datos:** fondo de caja (AMALAY $1,700), regla cambio-como-propina (<$5), umbral de diferencia aceptable, tip-out % (5%), propinas sugeridas (10/15/20), # copias de ticket/corte, footer 7 líneas, serie CFDI, IVA/IEPS.
- **Transformación:** → `clients` (iva_rate, receipt_footer, logo_url, rfc, business_day_start_local), `pos_turnos.fondo_inicial` seed, `pos_payment_methods` (17+ formas: cash/card/transfer + commission_pct).
- **Validación:** corte paralelo (ver A7). **Cliente aporta:** 1 h de walkthrough con gerente. **Automatizable:** 0% (pero es un formulario de 1 página).

### A5. Impresoras y ruteo por estación
- **Fuente:** F5 — inventario físico (AMALAY: EC TICKET USB + cajón RJ-11; COCINA CALIENTE, BARRA, PANADERÍA TCP/IP) + reglas de ruteo por grupo con overrides por platillo (CAJA-SPEC.md §12).
- **Transformación:** ruteo → `clients.pos_settings.station_routing` (patrón P1-D03) + `item.station`; jobs → `pos_print_jobs`.
- **Validación:** por cada categoría, imprimir comanda de prueba y confirmar estación = donde imprimía Wansoft; ticket de prueba con formato/QRs.
- **Cliente aporta:** IPs de impresoras (o autodescubrimiento) + confirmación por estación. **Automatizable:** 60% (derivar ruteo inicial de grupos del menú).
- **Riesgo:** categorías ambiguas (postres→caja vs cocina); AMALAY resolvió con overrides — presupuestar iteración en sitio.

### A6. Mesas y zonas
- **Fuente:** F5 (AMALAY: mapa de mesas APAGADO en Wansoft, usan lista) → `pos_mesas` (33 mesas AMALAY, x_pct/y_pct, zone).
- **Cliente aporta:** croquis o foto del salón. **Automatizable:** 30%.

### A7. Reconciliación de arranque (gate de go-live)
- **Corte paralelo:** 1-3 días con ambos POS NO simultáneos por turno (regla data_source: nunca ambos a la vez) o comparación Wansoft día N-1 vs Fullsite día N.
- **Cuadres obligatorios al centavo:** ventas_dia Fullsite vs `GetConsolidatedSales`; efectivo esperado (fórmula CAJA-SPEC.md §14.2: Fondo + VentasEf + PropinasEf + Depósitos − Vales − PropTarjetaEnEf) vs conteo físico; por forma de pago vs vouchers de terminal.
- **Precedente:** E2E-06 ya reconcilió fondo + venta efectivo + tarjeta cent-level.

---

## FASE B — Primera semana (opera sin esto, duele pronto)

### B1. Ingredientes + inventario inicial
- **Fuente:** F1 `/Inventory/GetProductsBySubsidiary`, `/Inventory/GetWarehousesBySubsidiarySortedByName` (JSON `{Value,Text}`), `/Inventory/GetInventoryStatementBySubsidiary`; F2 `/Inventory/ExportInventoryStatement` (por almacén, con fechas). Parsers: `wansoft_inventory_sync.py` L105-160, `wansoft_inventory_scrape.py` L238-326. Unidades vía `/Inventory/GetUnitsOfMeasureBySubsidiary` (texto largo: "Kilogramo", "Pieza", "Litro").
- **Transformación:** productos → `pos_ingredients` (name, unit normalizada, cost_per_unit, category); presentaciones (`GetPresentationsBySubsidiary` — wansoft_subproduct_scraper.py L212) → `pos_presentations` + `pos_ingredient_presentations` (contains_quantity/unit); existencias → `pos_inventory.stock` + movimiento inicial tipo `ajuste`. **Colapso 6 almacenes → 1 stock** (Fullsite no tiene multi-almacén): sumar, guardando desglose original en notes/JSONB para auditoría. Skip almacenes "ELIMINADO" (parser ya lo hace, L300).
- **Validación:** Σ existencias por almacén = stock Fullsite; costo total inventario ±1% vs reporte Wansoft "Consolidado de existencias"; conversiones (1 CAJA=24 PZ) cargadas en `pos_unit_conversions` y probadas con 5 compras reales.
- **Cliente aporta:** idealmente un conteo físico el día del switch (mejor que heredar el teórico de Wansoft). **Automatizable:** 85%.
- **Riesgo:** unidades inconsistentes compra-vs-receta; encoding de exports TXT (ISO-8859-1 vs UTF-8, no parseado aún — guardado raw).

### B2. Recetas y subproductos (food cost + depleción)
- **Fuente:** F1 `/Production/GetSaucerRecipe` (por saucerId+sizeId), `/Production/GetSubProductRecipe`, `/Inventory/GetRecipeProductsBySubsidiary`. Parsers: `wansoft_recipe_scraper.py` L97-169, `wansoft_subproduct_scraper.py` L149-212. Ya existen 574 recetas scrapeadas en `wansoft_recipes` (saucer_id, saucer_name, budget_cost, ingredients JSONB, raw).
- **Transformación:** → `pos_recipe_versions` (source='wansoft', source_batch=fecha) + `pos_recipe_lines`; subproductos → `pos_sub_recipes` + `pos_sub_recipe_ingredients`; vincular `recipe_ref` en menú (evitar fuzzy match: pos-recipe-ref.test.ts documenta paths db|fuzzy|miss). Set `pos_item_inventory_policy` (recipe vs direct_stock para market) — gate DEBE quedar READY.
- **Validación:** cobertura recipe_ref ≥95% de items con venta; food cost recalculado ≈ `GetCostBySaucer` de Wansoft (±2 pts; nota: Wansoft sin yield, Fullsite con yield_factor ⇒ diferencias esperadas y explicables); ningún resultado UNMAPPED en `pos_reconciliation_results` tras 1 día.
- **Cliente aporta:** nada (validación chef opcional de top 20 recetas). **Automatizable:** 90%.
- **Riesgo:** recetas por tamaño (sizeId) colapsan al modelo multiplier de `pos_sizes`; costos Wansoft = "último precio de compra" sin yield → no comparar a ciegas.

### B3. Proveedores
- **Fuente:** F1/F2 (compras por proveedor en Egresos) o F3 (202 proveedores AMALAY). → `pos_suppliers` (name, rfc, clave_wansoft, payment_terms). **Automatizable:** 80%. Cliente valida los ~10 activos.

### B4. Históricos de ventas (contexto para IA y comparativos)
- **Fuente:** F1 `GetConsolidatedSales` + `SalesByUser/Group/PaymentType/TypeOfOrder` por día. Parser: `wansoft_backfill.py` L53-150 (patrón probado: 880 días backfilled en AMALAY).
- **Transformación:** → `wansoft_daily` (client_slug del nuevo cliente). Montos "$1,234.56" → strip `$,%`; `pago_metodos` puede venir % o MXN (regla ≥100 ⇒ MXN, payment-conversion.test.ts).
- **Validación:** Σ diarios de un mes = total mensual del portal (patrón `wansoft_data_audit.py`); dedupe por fecha (keep highest ventas).
- **Cliente aporta:** solo la cookie (login 1 vez). **Automatizable:** 98%. Puede correr en background post go-live.

## FASE C — Puede migrar después (mes 1+)

- **C1. Detalle ticket-a-ticket histórico** (Venta/DetalleVenta/Pago): solo F3 (.bak). Para CRM/recuperación de clientes y baselines anti-fraude. Nota: si el cliente tenía "logs de acciones" apagado (AMALAY), no existe histórico de cancelaciones/descuentos — no prometerlo.
- **C2. Clientes de facturación** (directorio CFDI): F3 o export CxC → `pos_billing_clients` (UNIQUE rfc+client). Alternativa: recaptura on-demand al facturar.
- **C3. Asistencia/nómina histórica**: F3 (RegistroAsistencia) → `pos_attendance`. Opcional.
- **C4. Kardex histórico de inventario**: F2 exports por rango (`ExportTransfer`, `ExportBatchAdjustment`, `ExportMassiveInventoryOutput` — wansoft_inventory_scrape.py L320-324) → `pos_inventory_movements` con provenance. Solo si el cliente audita mermas históricas.
- **C5. Promociones/combos/gift cards**: casi nadie las usa (AMALAY: cero promos configuradas) → capturar manual si existen → `pos_promotions`/`pos_combos`/`pos_gift_cards`.
- **C6. Encuestas/reviews/lealtad**: fuera de alcance del migrador v1.

## Reglas transversales del migrador

1. **Provenance en todo:** `source='wansoft'` + `source_batch` (ya soportado en `pos_recipe_versions`; extender convención a ingredients/menu vía notes) — decisión "provenance en tablas externas" (memoria migration-engine).
2. **Idempotente y re-ejecutable:** upsert por claves naturales (client_id + nombre/clave wansoft); correr N veces sin duplicar (patrón UNIQUE ya existe en casi todas las tablas destino).
3. **Nunca ambos POS a la vez** (memoria data-source-switch): el switch `clients.data_source` define la verdad; el migrador corre con Wansoft aún activo, el corte paralelo define el flip.
4. **Reporte de migración por dominio:** conteos origen vs destino + cuadres (¢) + lista de excepciones → doc de evidencia ANTES de certificar (pipeline de certificación).
5. **Todo dinero al centavo; toda cantidad con unidad explícita** — rechazar filas sin unidad reconocida en `pos_unit_conversions` en vez de adivinar.

## Qué pide al cliente (mínimo absoluto, resumen)

| Ítem | Tiempo | Fase |
|---|---|---|
| Login Wansoft 1 vez (cookie relay) | 5 min | A/B |
| Lista staff + roles + PINs nuevos | 30 min | A3 |
| Walkthrough config caja/ticket (formulario CAJA-SPEC) | 1 h | A4 |
| IPs impresoras + prueba por estación | 30 min | A5 |
| Validación modificadores (si no hay acceso BD) | 1-2 h | A2 |
| Revisión precios/flags menú | 30 min | A1 |
| Conteo físico de inventario (recomendado) | 2-4 h staff | B1 |
| Croquis de mesas | 10 min | A6 |

**Total cliente: ~4-6 h** (sin acceso a BD NetSilver) o **~3 h** (con acceso F3).

## Riesgos top

1. **Modificadores sin export estructurado** (A2) — único dominio día-1 con automatización <50% sin BD directa.
2. **Cookie/Turnstile:** login manual recurrente; incidente SEV-2 2026-08 (Turnstile endureció) — el migrador debe tolerar cookies muertas y reanudar.
3. **Multi-almacén → stock único:** pérdida de granularidad; comunicar explícitamente (Bar vs Cocina dejan de distinguirse en stock).
4. **Semánticas de corte distintas** (Z fiscal numerado, intentos de arqueo, cambio-como-propina) — sin modelarlas, el primer corte "no cuadra" contra la costumbre del cajero.
5. **Encoding/formatos de exports TXT** aún no parseados (guardados raw) — presupuestar hardening del parser en el primer cliente no-AMALAY.
