# FULLSITE Dashboard — Capability Audit
**Versión:** 1.0 — 2026-07-25  
**Metodología:** Inspección directa de código fuente (Next.js 16 App Router, TypeScript)  
**Cobertura:** 105+ páginas, 30+ componentes, 80+ rutas API  
**Clasificación:** OPERATIVA / PARCIAL / INFRAESTRUCTURA / AUSENTE

---

## Resumen Ejecutivo

| Estado | Páginas | % |
|---|---|---|
| OPERATIVA | 78 | 74% |
| PARCIAL | 12 | 11% |
| INFRAESTRUCTURA | 9 | 9% |
| AUSENTE (en menu/referenciada) | 6 | 6% |

El dashboard tiene una profundidad real mayor de lo que aparenta. 74% de las páginas están completamente conectadas a datos reales. Los módulos más maduros son Analytics/Ventas, Inventario Real (15 sub-páginas), IA/Agentes (47 agentes registrados), y Admin (13 páginas CRUD). Las brechas más significativas están en CFDI end-to-end, CRM con lealtad real, y dos páginas de staff incompletas.

---

## Stack técnico

- **Frontend:** Next.js 16 App Router, TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgREST directo via `fetch()`, nunca Supabase SDK — evita hang silencioso en App Router)
- **IA:** Groq (inferencia backend), Claude implícito, ElevenLabs TTS (opcional)
- **Autenticación:** Supabase session (`fs-at` cookie), RLS por `client_id`
- **Datos Wansoft:** Scraper Playwright → `wansoft_daily` + `wansoft_data` JSONB
- **Offline:** IndexedDB `fullsite_pos` v1 (POS), no aplica al dashboard
- **Deploy:** Vercel
- **Agentes autónomos:** GitHub Actions cron → Groq → Supabase → Telegram

---

## DOMINIO 1: HOME & ANALYTICS EJECUTIVO

### /page.tsx — Dashboard Home
**Status: OPERATIVA**
- 13 widgets configurables (visibilidad persistida en localStorage)
- KPIs: Ventas, Tickets, Personas, Ticket Promedio con sparklines 7 días
- Selector de periodo (Día/Semana/Mes) + navegación de fechas
- Gráfica de ingresos 30d + distribución por categoría + métodos de pago
- Top meseros, eficiencia, progreso del mes
- Widget de estado de agentes IA (`agent_runs`)
- Auto-refresh cada 5 min + en foco de pestaña
- **Fuente:** `wansoft_daily` (primaria) con fallback a `pos_orders` agregado
- **Hardcoded:** nada relevante
- **Falta:** no exportable, sin drill-down por widget

---

### /ventas/page.tsx — Detalle de Ventas
**Status: OPERATIVA**
- Selector de rango (Hoy/Ayer/Semana/Mes/Custom)
- KPIs: ventas netas/brutas/descuentos/devoluciones con comparación MoM
- Gráfica diaria área + distribución por categoría + breakdown por tipo de orden
- **Sección anti-fraude:** Cancelaciones, Anulaciones, Cortesías, Descuentos detallados
- **Fuente:** `wansoft_daily` + `getWansoftData('cancel_sales', 'voids', 'courtesies', 'discounts_detail')`
- **AMALAY:** validado (anti-fraude activo)
- **Falta:** sin export CSV

---

### /ingresos/page.tsx — Flujo de Efectivo
**Status: OPERATIVA**
- Vista 30 días fija: efectivo/tarjeta/otros + gráfica área apilada
- Lógica de conversión robusta (handles % y MXN de Wansoft)
- **Fuente:** `wansoft_daily` con fallback
- **Falta:** sólo 30 días, sin selector de periodo

---

### /cortes/page.tsx — Cortes y Cierres
**Status: OPERATIVA**
- Selector 30/60/90 días
- KPIs acumulados + **heatmap calendario** (intensidad por color, Lun-Dom)
- Tabla diaria (ventas, tickets, personas, TP, efectivo, tarjeta, % cambio)
- Detalle de corte: retiros y depósitos bancarios
- **Fuente:** `wansoft_daily` + `getWansoftData('cash_closing', 'cash_withdrawals', 'bank_deposits')`
- **Falta:** sin link a `/control-efectivo` desde tabla

---

### /caja/page.tsx — Vista Simple de Caja
**Status: OPERATIVA**
- KPIs Efectivo/Tarjeta/Otros/Total (30 días)
- Gráfica área apilada + tabla últimos 14 días
- **Nota:** versión simplificada de `/ingresos`

---

### /tendencias/page.tsx — Análisis de Tendencias
**Status: OPERATIVA**
- Página de analytics más completa del dashboard
- Tabs (día/semana/mes/año) + navegación por periodo
- YoY comparison, ticket promedio por tipo, trends de pagos y descuentos
- Top 5 platillos (últimos 3 meses), comparativo mismo día de semana
- Breakdowns: fin de semana vs. entre semana, DOW averages
- **Fuente:** `wansoft_daily` (todos los registros, histórico completo)

---

### /estado-resultados/page.tsx — P&L Statement
**Status: PARCIAL**
- Selector mes/trimestre/semestre/año
- Estructura P&L: brutas → descuentos → netas → food cost → labor → margen
- Food cost real desde `wansoft_food_cost` si existe, sino estimado al 35%
- Badge indica "Real" vs "Estimado"
- Top 20 platillos por costo real
- **Hardcoded:** labor cost = 25% (estimación fija)
- **Falta:** overhead costs, COGS real, gastos operativos, integración completa Wansoft P&L

---

### /reporte-fiscal/page.tsx — Reporte Fiscal Mensual
**Status: OPERATIVA**
- Selector mes/año + botón Generar
- IVA: trasladado (16% ingresos) − acreditable (16% egresos) = por pagar
- Top 10 clientes facturados (RFC + razón social)
- Ventas diarias, CFDIs emitidas vs. canceladas
- **Export:** Download CSV contable vía `/api/export/polizas`
- **Fuente:** `pos_cfdi_requests`, `pos_orders`, `pos_purchase_orders`
- **AMALAY:** validado (compliance fiscal activo)

---

### /reportes/page.tsx — Generador de Reportes
**Status: OPERATIVA**
- 4 tipos: Ventas, Meseros, Platillos, Tendencias
- Selector de rango personalizado
- Export: Print (window.print()) + CSV (BOM-encoded para Excel)
- **Fuente:** `wansoft_daily` agregado por tipo

---

### /reportes/ingresos/page.tsx — Reporte de Ingresos Profundo
**Status: OPERATIVA**
- Tabs día/semana/mes/año + navegación con flechas
- KPI grande: ventas netas con comparaciones vs. periodo anterior y YoY
- Chips por mes (ENE, FEB…) + selector año
- **Nota:** no está en Sidebar (ruta huérfana, accesible solo por URL directa)

---

### /platillos/page.tsx — Análisis de Platillos y Categorías
**Status: OPERATIVA**
- Top 15 categorías (horizontal bar) + grid de top 10
- Tracking especial: Chilaquiles y H&H (series independientes)
- **Modificadores vendidos:** Top 20 extras desde `wansoft_modifiers_sold`
- **AMALAY:** validado (tracking menu-específico de AMALAY)
- **Falta:** sin filtro por periodo (fijo 30 días)

---

### /cancelaciones/page.tsx — Cancelaciones y Descuentos
**Status: OPERATIVA**
- 30/60/90 días (selector en código, no visible en UI — bug UX)
- KPIs: descuentos 30d, % sobre ventas, promedio diario
- Gráfica diaria + mensual + top 5 días con mayor descuento
- Threshold visual: meta <1.5%

---

### /propinas/page.tsx — Análisis de Propinas
**Status: PARCIAL**
- KPIs: total, promedio, % ventas, meseros activos
- Propinas por mesero con badge "Real" (verde) o "Estimado" (ámbar)
- **Fuente real:** `wansoft_tips_raw` (requiere depth scraper activo)
- **Fallback:** estimación proporcional por ventas de mesero
- **Falta:** trends de propinas, breakdown por método de pago, selector de periodo

---

### /control-efectivo/page.tsx — Control de Efectivo
**Status: OPERATIVA**
- Presets: Hoy/Semana/Mes/Custom
- KPIs: efectivo recibido/retiros/depósitos/saldo en caja
- Tabla cronológica de flujo de caja (fecha, concepto, responsable, entrada/salida, balance acumulado)
- **Formulario de ingreso:** depósito bancario (monto, banco, referencia, responsable) → `pos_cash_movements`
- **CRUD:** Write (depósitos bancarios) + Read (movimientos)

---

### /conciliacion/page.tsx — Conciliación Bancaria
**Status: OPERATIVA**
- Upload de estado de cuenta en CSV (parsing automático multi-formato)
- Auto-detección de columnas (fecha, concepto, depósito, retiro, referencia)
- Matching ventas tarjeta (Wansoft) vs. depósitos banco
- Threshold: 1.5–4% diferencia = OK; >4% = Alerta
- KPIs: ventas tarjeta / depósitos / diferencia / status
- Ordenamiento por fecha o diferencia

---

## DOMINIO 2: INVENTARIO REAL

El módulo más extenso del dashboard. 15 sub-páginas con ciclo de vida completo de inventario.

### /inventario-real/page.tsx — Vista Maestra
**Status: OPERATIVA**
- Snapshot actual por almacén con FIFO financiero
- Tabs por almacén, filtros, ordenamiento
- **Fuente:** `wansoft_data.inventory_parsed` (batch, no tiempo real)
- **Falta:** export CSV, drill-down a movimientos por producto

---

### /inventario-real/entradas/page.tsx — Entradas de Mercancía
**Status: OPERATIVA**
- Flujo completo: selección proveedor → búsqueda producto → cantidad/costo → confirmación
- **Escribe a:** `pos_inventory_movements` (ledger) + `pos_inventory.stock` + `pos_ingredients.cost_per_unit`
- Idempotency keys para prevenir duplicados
- **Falta:** barcode scanning, múltiples proveedores por entrada

---

### /inventario-real/entradas-factura/page.tsx — Entradas por CFDI XML
**Status: OPERATIVA**
- Drag-and-drop de XML CFDI 4.0
- Auto-match por RFC a proveedor + fuzzy match de conceptos a productos
- Mapeo editable antes de confirmar
- Prevención de duplicados por UUID CFDI
- **Falta:** validación de firma del CFDI, batch multi-archivo

---

### /inventario-real/merma/page.tsx — Registro de Merma
**Status: OPERATIVA**
- Selector por almacén + razones hardcodeadas (Caducado, Dañado, Error de cocina, Robo, etc.)
- KPIs: merma/día, merma/mes, producto top, costo acumulado
- Log historial (últimas 60 entradas)
- **Escribe a:** `pos_inventory_movements` (negativo) + `wansoft_data.inventory_waste_*`
- **Falta:** evidencia fotográfica, flujo de aprobación (va directo al ledger)

---

### /inventario-real/movimientos/page.tsx — Auditoría de Movimientos
**Status: OPERATIVA**
- Vista unificada de todos los movimientos (entradas, transferencias, merma, conteos, ventas)
- Filtros por tipo, fecha, búsqueda
- Badges por tipo, detalle expandible
- **Solo lectura:** no permite reversión (diseño correcto para audit trail)
- **Falta:** export, pagination

---

### /inventario-real/orden-compra/page.tsx — Generación de OC
**Status: PARCIAL**
- Auto-genera OC desde reorder points + snapshot de inventario
- Agrupa por proveedor, edit de cantidades, envío vía WhatsApp
- **Brecha:** lee de `wansoft_data` snapshot, no de `pos_ingredients` en tiempo real
- **Falta:** tracking post-envío, precios específicos por proveedor

---

### /inventario-real/toma-fisica/page.tsx — Conteo Físico
**Status: OPERATIVA**
- Carga snapshot vs. sistema, usuario ingresa conteo real
- Cálculo de varianza y valor ($) de diferencia
- Ajusta automáticamente `pos_inventory.stock` si hay diferencia
- **Falta:** barcode scanning, conteo cíclico (requiere conteo completo), multi-operador

---

### /inventario-real/reorden/page.tsx — Puntos de Reorden
**Status: PARCIAL**
- Configura mínimo/máximo por producto con auto-cálculo (salidas/30 × 3)
- **Brecha crítica:** guarda en `wansoft_data` snapshot, NO en `pos_ingredients`
- Desconexión con inventario en tiempo real
- **Falta:** alertas activas cuando stock llega a mínimo

---

### /inventario-real/produccion/page.tsx — Órdenes de Producción
**Status: OPERATIVA**
- Gestión de producción interna (salsas, masas, pan, bases)
- Verifica disponibilidad de ingredientes
- Historial con estados (completada/en proceso/cancelada)
- **Brecha:** deducción de ingredientes en comentario, no implementada

---

### /inventario-real/subproductos/page.tsx — Subproductos
**Status: OPERATIVA**
- Insumos intermedios con recetas propias (bases, salsas, masas)
- Cálculo de costo desde ingredientes
- **Fuente:** `wansoft_data.subproductos` + `pos_ingredients`

---

### /inventario-real/transferencias/page.tsx — Transferencias entre Almacenes
**Status: OPERATIVA**
- Mueve inventario entre Cocina/Barra/Panadería/Market/Venta Terceros
- Registro en `wansoft_data.inventory_transfer_*`
- **Brecha:** no actualiza `pos_inventory_products` en origen/destino en DB

---

### /inventario-real/presentaciones/page.tsx — Presentaciones
**Status: OPERATIVA**
- Variantes de presentación con factor de conversión (1 caja = 24 pz)
- **Fuente:** `wansoft_data.product_presentations`
- **Falta:** push-back a catálogo de Wansoft (solo lectura desde Wansoft)

---

### /inventario-real/conversiones/page.tsx — Conversiones de Unidades
**Status: OPERATIVA**
- Reglas de conversión genéricas y específicas por producto
- Presets estándar hardcodeados (KG→G, L→ML, docena→pz)
- **Falta:** conversiones inversas auto-calculadas

---

### /inventario-real/costos/page.tsx — Costos de Inventario
**Status: OPERATIVA**
- Snapshot de costos por almacén/departamento
- Top 20 productos por valor
- **Falta:** comparación entre snapshots (delta), análisis de rotación real

---

### /inventario-real/devoluciones/page.tsx — Devoluciones a Proveedor
**Status: OPERATIVA**
- Registro de devoluciones con razón y proveedor
- **Brecha:** no ajusta balance de `pos_inventory_products`
- **Falta:** generación de nota de crédito

---

### /inventario-real/barcode/page.tsx — Escaneo de Código de Barras
**Status: OPERATIVA**
- BarcodeDetector API (Chrome/Android) o entrada manual
- Toggle entrada/salida, log diario
- **Brecha crítica:** los escaneos se registran pero NO actualizan stock en DB

---

## DOMINIO 3: RECETAS Y FOOD COST

### /recetas/page.tsx — Recetas de Platillos
**Status: OPERATIVA**
- CRUD de recetas agrupadas por platillo
- Ingredientes con cantidad, costo calculado, yield factor
- **Tabla:** `pos_recipes_old`
- **Nota:** usa REST directo (no `/api` wrapper)

---

### /recetas/sub-recetas/page.tsx — Sub-Recetas
**Status: OPERATIVA**
- Insumos intermedios que son ingredientes de múltiples platillos
- Soporte para anidar sub-recetas dentro de sub-recetas
- Costo vía `/api/food-cost/calculate?sub_recipe_id=X`
- **Tabla:** `pos_sub_recipes` + `pos_sub_recipe_ingredients`
- API REST completa en `/api/sub-recipes`

---

### /food-cost/page.tsx — Análisis de Food Cost
**Status: OPERATIVA**
- Fuente primaria: `wansoft_recipes` + `pos_ingredients` via `/api/food-cost`
- Fuente fallback: `wansoft_data.costeo_por_platillo` (Excel de Eduardo)
- Matching fuzzy de recetas Wansoft vs. menú actual
- Clasificación: Market (mkt-*) / Modificador (wsm-*)
- Alertas de costos sospechosos (ingrediente único >60% del costo, >$50)
- **Falta:** historial de márgenes, análisis temporal

---

## DOMINIO 4: COMPRAS Y PROVEEDORES

### /compras/page.tsx — Reorden y Movimientos
**Status: OPERATIVA**
- Productos con stock ≤ reorder_point con déficit y costo estimado
- Tab de movimientos recientes (entrada/salida/merma)
- **Falta:** generación de OC desde aquí (ver `/inventario-real/orden-compra`)

---

### /proveedores/page.tsx — Directorio de Proveedores
**Status: OPERATIVA**
- Búsqueda por nombre/RFC/categoría/clave_wansoft
- Datos de contacto + términos de pago
- **Tabla:** `pos_suppliers`
- **Solo lectura** — CRUD está implícito en el flujo de inventario
- **Falta:** historial de compras, métricas de desempeño

---

## DOMINIO 5: IA Y AGENTES

### /agentes/page.tsx — Hub de Agentes
**Status: OPERATIVA**
- Monitoreo en tiempo real de todas las ejecuciones
- KPIs: total runs, tasa éxito, duración promedio, agentes activos
- Cards individuales por agente con métricas
- **Fuente:** `agent_runs` (200 registros más recientes)

---

### Agentes individuales (14 páginas)
Todos leen de `agent_results` con su `agent_id` específico. Todos **OPERATIVA**.

| Agente | Route | Modelo | Trigger | Output |
|---|---|---|---|---|
| Anomalías | /agentes/anomalias | Groq | Horario | Severidad, valor actual vs. esperado |
| Anti-Fraude | /agentes/antifraude | Groq | Programado | Risk score 0-100, findings por severidad |
| Clima + Eventos | /agentes/clima | Groq | Programado | Datos meteorológicos + eventos locales |
| Cocina | /agentes/cocina | Groq | Programado | Métricas de calidad de cocina |
| Desperdicio | /agentes/desperdicio | Groq | Semanal | Detección de desperdicio |
| Hermes | /agentes/hermes | Groq | 2x día (7am/11pm) | Salud del sistema multi-agente |
| Menu Engineering | /agentes/menu | Groq | Semanal (Lun) | Matriz BCG (Estrellas/Caballos/Puzzles/Perros) |
| Predicción Cierre | /agentes/prediccion | Groq | 3x día (2pm/4pm/6pm) | Proyección de ventas al cierre + oportunidades |
| Propinas | /agentes/propinas-agente | Groq | Viernes | Análisis propinas por mesero |
| Proveedores | /agentes/proveedores-agente | Groq | Semanal | Monitor de proveedores |
| Staffing | /agentes/staffing | Groq | Semanal (Lun) | Optimización de horarios por día de semana |
| Tiempo Mesa | /agentes/tiempo-mesa | Groq | Diario | Rotación de mesas |
| Upselling | /agentes/upselling | Groq | Horario | Potencial de upselling por mesero/categoría |
| Prediccion stock | /agentes/prediccion | Groq | Automático | Predicción de demanda |

---

### /chat/page.tsx — Chat IA
**Status: OPERATIVA**
- Consulta en lenguaje natural sobre datos del restaurante
- Detección inteligente de qué datos cargar (meseros, food cost, reservas, inventario…)
- Parsing de fechas natural ("del 5 al 12", "1 de mayo a 18 de mayo")
- Pre-agregados: mensual, semanal, últimos 7 días, ranking por mesero
- Análisis mesero × platillo, food cost, inventario market, YoY
- Generación de gráficas automática si usuario pide "gráfica"
- **Auth:** sesión Supabase (cookie fs-at o Bearer token)
- **Rate limit:** 20 req/min por usuario
- **Log:** `chat_logs` tabla
- **Modelo:** Groq (configurado vía GROQ_API_KEY)
- **Fuente:** 8+ tablas en paralelo con carga condicional

---

### /voice/page.tsx — Agente de Voz
**Status: OPERATIVA**
- Speech-to-text (browser API, es-MX) → Groq → ElevenLabs TTS
- Voz "Laura" (multilingüe, español latinoamericano)
- Fallback a browser SpeechSynthesis si no hay ELEVENLABS_API_KEY
- Waveform visualizer, auto-stop 3 segundos de silencio
- **Rate limit:** 15 req/min por IP
- **Datos:** misma lógica que /chat (carga condicional 14-90 días)
- **Limitación conocida:** no funciona en iOS Safari (no soporta Speech Recognition API)

---

### /coach/page.tsx — Coach IA
**Status: OPERATIVA**
- 3 insights estructurados JSON (type/title/body/priority/metric)
- Cargados on-demand + polling 60s
- **Fuente:** 90 días `wansoft_daily` + 7 días `wansoft_waiter_categories`
- **Modelo:** Groq

---

### /mission-control/page.tsx — Control de Misión
**Status: OPERATIVA**
- 47 agentes registrados en 7 tentáculos (Inteligencia, Operaciones, Reportes, Personal, Conocimiento, Meta, Data)
- Vista en grid por tentáculo con indicadores de estado (rojo=error, verde=reciente, gris=inactivo)
- Panel derecho: historial de un agente + feed live
- Refresh cada 30s
- **Fuente:** `agent_runs` (200 records) + `agent_results` (100 records)

---

## DOMINIO 6: PERSONAL Y OPERACIONES

### /meseros/page.tsx — Performance de Meseros
**Status: OPERATIVA**
- 3 tabs: ranking de ventas, comparativo KPIs (radar chart), detalle (top categorías/platillos)
- Selectores: 7/14/30 días
- KPI ponderado por volumen (correcto)
- **Fuente:** `wansoft_daily.meseros` + `wansoft_waiter_categories` JSONB
- **Falta:** sin filtro por sucursal, sin export

---

### /nomina/page.tsx — Pre-Nómina
**Status: OPERATIVA**
- 4 tabs: tabla de nómina (tarifas horarias editables), performance, propinas, asistencia
- Cálculo: horas trabajadas × tarifa − deducciones
- **Hardcoded:** `DEFAULT_HOURLY_RATE = $62.50/hr`, deducción 5.5%
- **Fuente:** `wansoft_labor`, `wansoft_tips`, `wansoft_hours_worked`
- **Falta:** export a sistema contable, integración SAT, deducciones reales

---

### /cancelaciones/ — Ver DOMINIO 1
### /propinas/ — Ver DOMINIO 1

### /pos/asistencia/page.tsx — Checador de Asistencia (PIN)
**Status: OPERATIVA**
- Clock-in/out por PIN + log de hoy + últimas 14 entradas por persona
- Valida secuencia (salida requiere entrada previa)
- **Tabla:** `pos_attendance` + `/api/pos/pin`

---

### /pos/auditoria/page.tsx — Log de Auditoría POS
**Status: OPERATIVA**
- Log inmutable de acciones POS (14 tipos de acción)
- Búsqueda y filtro, hasta 200 entradas
- **Tabla:** `pos_audit_log`
- **Falta:** export, drill-down JSON, purge policy

---

### /pos/staff/page.tsx — CRUD de Staff
**Status: INFRAESTRUCTURA**
- Archivo cortado (~100 líneas), implementación incompleta
- Estructura definida (ROLE_LABELS, CREATABLE_ROLES) pero sin flujo completo
- **Requiere:** completar CRUD + delete

---

### /pos/staff-analytics/page.tsx — Analíticas de Staff
**Status: INFRAESTRUCTURA**
- Perfil por mesero: ventas, tickets, propinas, mejor día, distribución horaria
- Archivo cortado (~100 líneas)
- **Fuente:** `pos_orders` + `pos_attendance` (opcional)
- **Requiere:** completar UI de gráficas

---

## DOMINIO 7: ADMINISTRACIÓN Y CONFIGURACIÓN

### /admin/menu/page.tsx — Gestión de Menú
**Status: OPERATIVA**
- CRUD completo de categorías e items (sin delete de items)
- Búsqueda, filtro por categoría, 22 colores de badge
- **Tablas:** `pos_menu_categories`, `pos_menu_items`
- **Falta:** delete de items, escaneo de barcode, upload de imagen

---

### /admin/grupos/page.tsx — Vista de Grupos
**Status: OPERATIVA**
- Resumen read-only de categorías con conteo de items y rangos de precio
- Vista complementaria a `/admin/menu` (no duplica CRUD)

---

### /admin/modificadores/page.tsx — Modificadores
**Status: OPERATIVA**
- 3 tabs: gestión (CRD), asignación a categorías, configuración por tipo de orden
- **Brecha:** configuración por tipo de orden se guarda solo en memoria (no persiste a DB)
- **Tablas:** `pos_modifier_groups`, `pos_modifiers`, `pos_category_modifiers`

---

### /admin/tamaños/page.tsx — Tamaños y Multiplicadores
**Status: OPERATIVA**
- CRUD completo (multiplicador precio, ej. "Grande" = 1.3x)
- **Tabla:** `pos_sizes`

---

### /admin/formas-pago/page.tsx — Métodos de Pago
**Status: OPERATIVA**
- CRU (sin delete) de métodos de pago con tipo, comisión %, código fiscal
- **Tabla:** `pos_payment_methods`

---

### /admin/promociones/page.tsx — Promociones
**Status: OPERATIVA**
- 4 tipos: %, fijo $, 2x1, combo con programación avanzada (día/hora/fecha)
- Auto-apply toggle, límite por día
- **Brecha:** sin picker de categoría/item en UI (se ingresan IDs manualmente)
- **Tabla:** `pos_promotions`

---

### /admin/horarios/page.tsx — Horarios
**Status: OPERATIVA**
- CRUD de horarios (nombre, rango de horas, días de semana)
- **Tabla:** `pos_schedules`
- **Falta:** soporte de timezone

---

### /admin/usuarios/page.tsx — Usuarios del Portal
**Status: OPERATIVA**
- 6 roles: admin, gerente, cajero, mesero, cocina, viewer
- Multi-select de sucursales
- **Brecha:** sucursales hardcodeadas (3), no se fetchen de DB
- **Brecha:** contraseña hasheada client-side (inseguro)
- **Almacena en:** `wansoft_data` como JSONB (data_key='portal_users') — no en tabla auth propia

---

### /admin/carga-masiva/page.tsx — Importación Masiva
**Status: OPERATIVA**
- CSV bulk import para: ingredientes, inventario, recetas, items del menú
- Batching 100 filas por request, merge de duplicados
- **Falta:** rollback en fallo parcial, validación de columnas requeridas

---

### /admin/exportar/page.tsx — Exportaciones
**Status: OPERATIVA**
- Descarga CSV de 8 tablas (ingredientes, inventario, recetas, menú, categorías, staff, market stock, recetas Wansoft)
- **Acceso:** hardcodeado a rol 'dueño'
- **Falta:** export incremental, export programado

---

### /admin/onboarding/page.tsx — Wizard de Alta
**Status: OPERATIVA**
- Flujo multi-paso: info cliente → staff con PINs → menú CSV → formas de pago
- **Crea:** `clients`, `pos_staff`, `pos_menu_categories`, `pos_menu_items`, `pos_payment_methods`
- **Falta:** rollback en error, detección de duplicado de cliente

---

### /admin/vault/page.tsx — Bóveda de Credenciales
**Status: OPERATIVA** ⚠️ RIESGO DE SEGURIDAD
- Almacena credentials de delivery, POS, banco, WiFi, social, APIs
- **RIESGO:** Cifrado XOR+Base64 con key hardcodeada `'fullsite_vault_2026'` en código cliente
- 10 categorías, toggle show/hide contraseña
- **Falta:** update de credencial (solo CRD), audit log de acceso, cifrado real (AES-256)

---

### /admin/domicilio/page.tsx — Zonas de Delivery
**Status: OPERATIVA**
- CRUD de zonas (nombre, CPs, tarifa, min. orden, tiempo estimado)
- **Tabla:** `pos_delivery_zones`
- **Falta:** geocoding, validación de CPs, detección de overlap

---

### /sucursales/page.tsx — Multi-Sucursal
**Status: OPERATIVA**
- Comparativo de ventas/TP/top mesero/top categoría por ubicación
- Muestra "Una sola ubicación" si hay <2
- **Fuente:** `wansoft_daily` filtrado por `location_id`

---

### /seguridad/page.tsx — Trust Center
**Status: OPERATIVA**
- 6 certificaciones, 6 proveedores de infraestructura, 27 controles de seguridad
- **Todo hardcodeado** (no hay status live ni links a auditorías externas)

---

### /configuracion/cuentas/page.tsx — Catálogo de Cuentas
**Status: OPERATIVA**
- CRUD de catálogo de cuentas con jerarquía (padre/hijo, cascade delete)
- 5 tipos: activo/pasivo/ingreso/egreso/capital
- También: gestión de cuentas bancarias
- **Almacena:** `wansoft_data` JSONB (chart_of_accounts, bank_accounts)
- **Falta:** importar catálogo estándar SAT, sincronización con saldo real

---

## DOMINIO 8: CFDI Y FINANZAS

### /factura/page.tsx — Solicitud de Factura (QR del ticket)
**Status: INFRAESTRUCTURA**
- Formulario público para que el cliente solicite su factura via QR
- Validación de RFC client-side, 27 regímenes fiscales, usos CFDI
- Promete email en 24h, mecanismo no implementado
- **POST a:** `/api/factura` (crea registro en `pos_cfdi_requests`)
- **Falta:** integración completa con Facturama, email automático

---

### /facturas/page.tsx — Dashboard de Facturas
**Status: OPERATIVA** (parcial)
- Lista de solicitudes CFDI pendientes + marcado como "emitida"
- Parser de XML CFDI 4.0 (drag-and-drop client-side)
- Deduplicación por UUID
- **Falta:** generación de XML de salida (solo parsing), complemento de pago sin UI

---

### /contabilidad/page.tsx — Pólizas Contables
**Status: OPERATIVA**
- Genera pólizas diarias compatibles con CONTPAQi (14 cuentas SAT estándar)
- Resumen mensual: P&L simplificado + IVA + estimación ISR
- Alertas fiscales: facturación <80%, >$50k sin facturar, sin datos
- Export botón → `/api/contabilidad/polizas`
- **Fuente:** `pos_orders`, `pos_invoices`, `wansoft_daily`
- **Falta:** export XML CONTPAQi 1.3 totalmente compatible, IVA acreditable real (usa 30% est.)

---

### /notas-credito/page.tsx — Notas de Crédito
**Status: INFRAESTRUCTURA**
- Registro de devoluciones/descuentos/errores con folio NC-YYYYMMDD-NNNN
- **Almacena:** localStorage únicamente (se pierde al cerrar sesión)
- **Falta:** sync a Supabase, generación real de CFDI tipo I, link a factura original

---

### /cuentas-por-cobrar/page.tsx — Cuentas por Cobrar
**Status: OPERATIVA**
- CRUD de cuentas abiertas con abonos parciales
- Clasificación automática: al corriente / próximo a vencer / vencida / pagada
- KPIs: total por cobrar, vencidas, cobrado este mes
- **Falta:** cálculo de intereses, aging buckets (30/60/90 días), link a CFDIs

---

## DOMINIO 9: CRM Y CLIENTES

### /clientes/page.tsx — Base de Clientes
**Status: OPERATIVA**
- CRUD de clientes: nombre, teléfono, email, notas
- Métricas: visitas, gasto total, ticket promedio, última visita
- **Tabla:** `pos_customers`
- **Falta:** link automático desde órdenes POS, tags/segmentación

---

### /crm/page.tsx — CRM Dashboard
**Status: OPERATIVA**
- Perfiles con historial de visitas, tags (VIP, frecuente, etc.), cumpleaños
- Importación desde `reservaciones` (dedup por teléfono/nombre)
- Modal de historial de transacciones por cliente
- **Falta:** auto-captura desde POS por teléfono, auto-tags por spend/frecuencia, export de segmentos

---

### /lealtad/page.tsx — Programa de Lealtad
**Status: INFRAESTRUCTURA**
- Config: puntos/peso, tasa de canje, bonos (bienvenida/cumpleaños)
- Recompensas configurables, balances de clientes
- **Todo en localStorage** (se pierde, no persiste)
- **Falta:** integración con POS (puntos no se otorgan en checkout), sync a Supabase, redención real

---

### /encuestas/page.tsx — Constructor de Encuestas
**Status: OPERATIVA** (con advertencia)
- CRUD de encuestas con tipos de pregunta: stars, NPS, sí/no, texto libre
- Preview móvil + generación de QR + URL pública
- Vista de resultados: KPIs, histogramas, muestras de texto, export CSV
- **Advertencia:** respuestas de demo (15 hardcodeadas con datos aleatorios)
- **Falta:** integración con impresión de ticket (QR auto), segmentación por mesero/hora

---

### /encuesta/[id]/page.tsx — Formulario Público
**Status: OPERATIVA**
- Formulario móvil-first accesible via QR
- Submite a Supabase + localStorage como fallback
- **Falta:** autenticación (sin límite de envíos), link al ticket original

---

## DOMINIO 10: DELIVERY Y E-COMMERCE

### /delivery/page.tsx — Analytics de Delivery
**Status: PARCIAL**
- Gráfica diaria apilada (Uber/Rappi/Otros), trend mensual
- KPIs: total delivery 30d, % ventas, split por plataforma
- **Brecha:** depende de que `pago_metodos` en Wansoft clasifique correctamente "Ubereats" etc.
- **Falta:** conciliación de comisiones, datos a nivel de orden

---

### /ecommerce/page.tsx — Análisis E-Commerce
**Status: PARCIAL**
- Canales: Rappi, Ubereats, DiDi
- KPIs: total, días con órdenes, ticket promedio, % total
- **Misma brecha que /delivery:** depende de naming en pago_metodos
- **Falta:** cálculo de comisiones, tracking de fulfillment

---

### /admin/tienda/ — Módulo Retail (4 sub-páginas)

| Ruta | Status | Descripción | Gap |
|---|---|---|---|
| /articulos | OPERATIVA | CRUD items con costo/precio/stock (`pos_retail_items`) | No integrado con POS, no historial de stock |
| /grupos | INFRAESTRUCTURA | Grupos derivados de items (no tabla propia) | Solo lectura, no CRUD independiente |
| /precios | OPERATIVA | Gestión bulk por tier de precio | Tiers hardcodeados, sin historial |
| /promociones | INFRAESTRUCTURA | CRUD de promos por item | No integrado con POS, no tracking de redención |

---

## DOMINIO 11: RUTAS API CLAVE

### /api/chat — Chat IA
- Auth, rate limit 20/min, carga condicional de 8+ tablas, log a `chat_logs`
- **Status: OPERATIVA**

### /api/coach — Coach IA
- 90 días wansoft_daily, 3 insights JSON, Groq
- **Status: OPERATIVA**

### /api/voice — Agente de Voz
- Streaming SSE, rate limit 15/min IP, misma lógica que chat
- **Status: OPERATIVA**

### /api/voice-tts — Text-to-Speech
- GET: health check ElevenLabs; POST: síntesis voz Laura
- Fallback 204 → browser TTS
- **Status: OPERATIVA**

### /api/food-cost — Cálculo de Food Cost
- GET: carga wansoft_recipes + pos_ingredients, matching fuzzy
- `/calculate`: costo de platillo o sub-receta específica
- **Status: OPERATIVA**

### /api/sub-recipes — CRUD Sub-Recetas
- REST completo: GET/POST/PATCH/DELETE + ingredientes
- **Status: OPERATIVA**

### /api/factura — CFDI Requests
- GET/POST/PATCH, validación RFC server-side, deduplicación por orden
- **Status: OPERATIVA**

### /api/factura/timbrar — Estampado Facturama
- pendiente → procesando → emitida, email best-effort
- **Requiere:** Facturama configurado en env
- **Status: OPERATIVA** (con Facturama)

### /api/factura/descarga — Proxy PDF/XML
- **Status: OPERATIVA**

### /api/factura/complemento-pago — Complemento de Pago
- Endpoint existe, sin UI que lo llame
- **Status: INFRAESTRUCTURA**

### /api/contabilidad/polizas — Pólizas CONTPAQi
- JSON/XML/CSV, 14 cuentas SAT, pólizas diarias + mensuales
- RFC hardcodeado como XXXXXXXXXXXX (pendiente config por cliente)
- **Status: OPERATIVA** (parcial)

### /api/webhook/ubereats — Webhook Uber Eats
- Maneja orders.notification, orders.cancel, orders.ready_for_pickup
- Auto-accept vía Uber API
- **Brecha crítica:** sin verificación de firma HMAC (TODO en código)
- **Status: PARCIAL**

### /api/onboarding — Creación de Usuario Auth
- POST, crea auth user via service key
- **Status: OPERATIVA**

### /api/pos/staff — Lista de Staff (sin PINs)
- GET, solo staff activo, no expone PINs
- **Status: OPERATIVA**

### /api/mp-point — MercadoPago Point
- Integración con terminal física MP
- **Status: INFRAESTRUCTURA** (no auditado en detalle)

### /api/clip-pinpad — Clip Pinpad
- Integración con terminal Clip
- **Status: INFRAESTRUCTURA** (no auditado en detalle)

---

## DOMINIO 12: PÁGINAS POS DESDE DASHBOARD

El dashboard contiene 24+ páginas bajo `/pos/` que extienden el POS hacia funciones de backoffice:

| Ruta | Función | Status |
|---|---|---|
| /pos/asistencia | Checador PIN | OPERATIVA |
| /pos/auditoria | Log inmutable | OPERATIVA |
| /pos/staff | CRUD staff | INFRAESTRUCTURA (incompleto) |
| /pos/staff-analytics | Analíticas mesero | INFRAESTRUCTURA (incompleto) |
| /pos/configuracion | Config POS | No auditada |
| /pos/monitor | Monitor órdenes | No auditada |
| /pos/kds | KDS display | No auditada |
| /pos/corte | Corte de turno | No auditada |
| /pos/historial | Historial de órdenes | No auditada |
| /pos/food-cost | Food cost POS | No auditada |
| /pos/inventario | Inventario POS | No auditada |
| /pos/recetas | Recetas POS | No auditada |
| /pos/compras | Compras POS | No auditada |
| /pos/delivery | Delivery POS | No auditada |
| /pos/facturacion | Facturación POS | No auditada |

---

## Componentes Reutilizables

| Componente | Función | Status |
|---|---|---|
| AppShell.tsx | Shell de aplicación con auth | OPERATIVA |
| Sidebar.tsx | Navegación principal con roles | OPERATIVA |
| TopNav.tsx | Header con notificaciones | OPERATIVA |
| NotificationBell.tsx | Campana de alertas | OPERATIVA |
| KPICard.tsx | Card de KPI genérica | OPERATIVA |
| RevenueChart.tsx | Gráfica de ingresos | OPERATIVA |
| RevenueDistributionChart.tsx | Distribución de ingresos | OPERATIVA |
| PredictionWidget.tsx | Widget de predicción | OPERATIVA |
| CoachPanel.tsx | Panel de coach IA | OPERATIVA |
| ChatWidget.tsx | Chat IA embebido | OPERATIVA |
| POSCopilot.tsx | Voz en piso | OPERATIVA |
| TurnoGate.tsx | Gate de turno | OPERATIVA |
| OfflineIndicator.tsx | Indicador offline | OPERATIVA |
| InventoryAlerts.tsx | Alertas de inventario | OPERATIVA |
| SmartCashCalculator.tsx | Calculadora de efectivo | OPERATIVA |
| MeseroLeaderboard.tsx | Ranking meseros | OPERATIVA |
| StaffShiftPanel.tsx | Panel de turno | OPERATIVA |
| BarcodeScanner.tsx | Escáner de barcode | OPERATIVA |
| CierreCajaWizard.tsx | Wizard de cierre | OPERATIVA |
| PageHeader.tsx | Header de página | OPERATIVA |
| EmptyState.tsx | Estado vacío | OPERATIVA |

---

## Riesgos Críticos Identificados

### Seguridad
1. **Vault encryption es XOR+Base64** con key hardcodeada en código cliente (`'fullsite_vault_2026'`). Cualquiera con acceso al source puede descifrar todas las credenciales. Requiere AES-256 server-side.
2. **Webhook Uber Eats sin verificación de firma HMAC** — cualquier request POST al endpoint puede inyectar órdenes falsas.
3. **Usuarios del portal almacenados como JSONB** en `wansoft_data`, no en tabla auth propia con RLS granular.

### Integridad de Datos
4. **Barcode, Transferencias, Devoluciones** registran movimientos en logs pero NO actualizan `pos_inventory_products.stock`. Los scans existen desconectados del inventario real.
5. **Reorder points** almacenados en `wansoft_data` snapshot, no en `pos_ingredients`. Si el snapshot es antiguo, las OC generadas son incorrectas.
6. **Notas de crédito** solo en localStorage — se pierden al cerrar sesión.
7. **Lealtad** solo en localStorage — se pierde al cerrar sesión.

### Configuración Incompleta
8. **Order-type config de modificadores** no persiste a DB (en memoria).
9. **Sucursales hardcodeadas** (3) en admin/usuarios en lugar de fetch desde DB.
10. **RFC de empresa hardcodeado** como XXXXXXXXXXXX en pólizas CONTPAQi.

---

## Capacidades No Enlazadas desde Navegación

Estas rutas existen pero no aparecen en Sidebar.tsx:
- `/reportes/ingresos` — reporte de ingresos profundo
- `/api/factura/complemento-pago` — sin UI
- `/admin/chat-logs` — no auditado
- `/admin/tarjetas-regalo` — no auditado
- Varias rutas `/pos/*` — accesibles solo por URL directa

---

## Dominio "Market" / Retail

El dashboard tiene un módulo completo de retail en `/admin/tienda/` (artículos, grupos, precios, promociones) pero:
- No integrado con el POS (artículos de tienda no aparecen en checkout)
- Stock de market (`pos_retail_items`) separado de inventario de restaurante
- Promotores de tienda no se aplican en checkout

---

*Documento generado a partir de inspección directa de código fuente. 2026-07-25.*
