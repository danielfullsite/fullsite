# FULLSITE Dashboard — Gap Analysis
**Versión:** 1.1 — 2026-07-25  
**Metodología:** Audit de código fuente + comparación vs. Wansoft Dashboard Bible  
**Veredictos:** MEJOR / EQUIVALENTE / INFERIOR / DIFERENTE POR DISEÑO / NO NECESARIO / NO VERIFICADO

---

## Reglas de Ingeniería para Cerrar Gaps

Estas reglas aplican a todos los P0 y P1 antes de escribir código:

**Regla 1 — Patrón antes de implementación**  
Antes de clasificar una brecha como P0, verificar si ya existe un patrón oficial que la resuelva. Si existe, la solución consiste en extender ese patrón, no en crear uno alternativo.

**Regla 2 — Extender sin modificar**  
Antes de cerrar un P0, comprobar que el fix extiende el patrón sin modificarlo. Extender un patrón probado es un fix de bajo riesgo. Modificarlo convierte el trabajo en un cambio arquitectónico y exige una evaluación distinta.

**Regla 3 — El contrato debe ser visible**  
Un patrón no puede depender de que el desarrollador lo conozca de memoria. El contrato debe estar documentado en el lugar donde alguien va a trabajar — un comentario al inicio del módulo basta.

**Aplicación a Inventario (P0-1 a P0-3):**  
El contrato ya existe y ya está documentado en `src/lib/inventory.ts` líneas 1-25:  
> "ALL stock changes MUST go through recordMovement(). Direct writes to pos_inventory or pos_ingredients.cost_per_unit are forbidden outside this module."  

El enum `MovementType` ya incluye `transfer_out`, `transfer_in`, y `return` — los tipos exactos que los tres flujos necesitan. El patrón no solo existe: fue diseñado para cubrir estos casos. Los tres módulos (barcode, transferencias, devoluciones) simplemente no lo invocaron.

**Criterio de aceptación para P0-1 a P0-3:**
- No modificar `recordMovement()` ni `inventory.ts`
- No crear una segunda función para movimientos de inventario
- No actualizar `pos_inventory_products.stock` directamente desde ningún page
- Invocar `recordMovement()` con el `MovementType` correcto desde cada módulo
- Verificar que cada operación crea exactamente un movimiento en el ledger y actualiza el stock una sola vez

---

## Marco de Evaluación

Esta comparación responde a: ¿Qué problema de negocio resuelve esta función? ¿Quién la usa y con qué frecuencia? ¿Qué decisión habilita? ¿Fullsite ya lo resuelve, mejor o diferente?

Wansoft es un sistema de reportes de cierre de día + configuración de POS. Fullsite es un centro de operaciones en tiempo real. La diferencia no es de features sino de filosofía: Wansoft produce reportes; Fullsite produce decisiones.

---

## Matriz Completa de Gaps

### DOMINIO A: ANALYTICS & REPORTES DE VENTAS

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Dashboard ejecutivo diario | OPERATIVA — 13 widgets configurables, KPIs, sparklines | Resumen en pantalla de inicio, no configurable | **MEJOR** | Ninguno | — |
| Ventas del día / periodo | OPERATIVA — selector rango, MoM, anti-fraude | Reporte de ventas estático | **MEJOR** | Ninguno | — |
| Tendencias históricas | OPERATIVA — YoY, DOW, heatmap | Comparativo mensual básico | **MEJOR** | Ninguno | — |
| Análisis por categoría de menú | OPERATIVA — top 15 + modifiers vendidos | Grupos de menú | **MEJOR** | Falta filtro por periodo (fijo 30d) | P2 |
| Análisis de meseros | OPERATIVA — radar chart, KPIs, 7/14/30d | Ventas por mesero | **MEJOR** | Sin export, sin sucursal | P2 |
| Cortes de caja | OPERATIVA — heatmap, 30/60/90d, retiros/depósitos | Corte Z diario, seminal, quincenal, mensual | **EQUIVALENTE** | Falta Corte X (parcial) y reimpresión | P1 |
| Reporte de propinas | PARCIAL — fallback a estimación | Propinas por mesero | **INFERIOR** | Real data requiere depth scraper activo | P1 |
| Control de efectivo | OPERATIVA — flujo cronológico, depósitos bancarios | Fondo inicial, retiros básicos | **MEJOR** | — | — |
| Conciliación bancaria | OPERATIVA — CSV upload, matching automático | No existe | **MEJOR** | — | — |
| P&L Statement | PARCIAL — labor hardcodeado 25%, food cost estimado | Estado de resultados básico | **INFERIOR** | Costos reales no integrados | P1 |
| Reporte fiscal / IVA | OPERATIVA — IVA calculado, CSV export | Reporte de IVA básico | **EQUIVALENTE** | IVA acreditable es estimado (30%), no real | P2 |
| Pólizas contables | OPERATIVA — CONTPAQi XML | No existe | **MEJOR** | RFC hardcodeado, sin configuración por cliente | P1 |
| Exportación CSV/Excel | OPERATIVA — reportes, cortes, fiscal | Export básico | **EQUIVALENTE** | Sin filtros aplicados en export, sin export programado | P2 |
| Descuentos y cancelaciones | OPERATIVA — anti-fraude con thresholds | Cancelaciones básicas | **MEJOR** | — | — |

**Resumen Dominio A:** 10 MEJOR, 3 EQUIVALENTE, 2 INFERIOR, 0 AUSENTE. Las inferioridades son datos que requieren feeds de Wansoft más profundos (propinas real, labor real) o configuración por cliente (RFC pólizas).

---

### DOMINIO B: INVENTARIO Y CADENA DE SUMINISTRO

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Vista de stock actual | OPERATIVA — por almacén, FIFO financiero | Vista de inventario básica | **EQUIVALENTE** | Batch (no tiempo real), sin export | P2 |
| Entradas de mercancía | OPERATIVA — proveedor + producto + costo, idempotente | Entrada de almacén básica | **MEJOR** | Sin barcode scanning | P2 |
| Entradas desde CFDI XML | OPERATIVA — auto-match RFC + fuzzy conceptos | No existe | **MEJOR** | Sin validación de firma CFDI | P2 |
| Merma y pérdidas | OPERATIVA — por razón, KPIs, historial | Merma básica | **MEJOR** | Sin evidencia fotográfica, sin aprobación | P3 |
| Movimientos (audit trail) | OPERATIVA — unificado, solo lectura | Log básico | **MEJOR** | Sin export, sin pagination | P2 |
| Toma física / conteo | OPERATIVA — varianza con valor $, ajuste automático | Conteo de inventario | **EQUIVALENTE** | Sin barcode, sin conteo cíclico | P2 |
| Puntos de reorden | PARCIAL — config en snapshot, no live | Reorder points básicos | **INFERIOR** | Desconexión entre config y stock real | P1 |
| Generación de OC | PARCIAL — desde snapshot, sin tracking post-envío | OC básica | **INFERIOR** | Reorder config no sync a pos_ingredients | P1 |
| Transferencias entre almacenes | OPERATIVA — registro, 5 almacenes | Transferencias básicas | **EQUIVALENTE** | No actualiza DB de origen/destino | P1 |
| Devoluciones a proveedor | OPERATIVA — registro con razón | Devoluciones básicas | **EQUIVALENTE** | No ajusta balance de inventario | P1 |
| Subproductos / producción | OPERATIVA — OPs internas, costeo | Parcial en Wansoft | **MEJOR** | Deducción de ingredientes no implementada | P1 |
| Barcode scanning | OPERATIVA (UI) | No existe | **MEJOR** | Scans NO actualizan stock en DB | P0 |
| Presentaciones / conversiones | OPERATIVA — factores, reglas | Parcial | **MEJOR** | Sin push-back a Wansoft | P3 |
| Costos de inventario | OPERATIVA — snapshot, top 20 | Costos básicos | **EQUIVALENTE** | Sin comparación entre snapshots | P2 |
| Predicción de demanda | INFRAESTRUCTURA — `/api/inventory/predict` existe, no UI | No existe | **DIFERENTE POR DISEÑO** | UI no construida | P2 |

**Resumen Dominio B:** Inventario es el módulo más completo pero con una falla sistémica: **varios módulos registran movimientos sin actualizar el stock real** (barcode, transferencias, devoluciones). Esto crea una ilusión de trazabilidad que en realidad no cierra el loop.

**Gap P0 crítico:** El loop de inventario no está cerrado. El módulo tiene cobertura funcional alta pero integridad de datos comprometida.

---

### DOMINIO C: RECETAS Y FOOD COST

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Recetas por platillo | OPERATIVA — CRUD con ingredientes | Recetas básicas | **EQUIVALENTE** | Sin historial de costos | P2 |
| Sub-recetas (insumos intermedios) | OPERATIVA — anidamiento, costo vía API | No existe en Wansoft | **MEJOR** | — | — |
| Análisis de food cost | OPERATIVA — fuzzy match, alertas sospechosas | Reporte básico de food cost | **EQUIVALENTE** | Fuzzy match puede tener falsos positivos | P2 |
| Historial de márgenes | AUSENTE | Parcial | **INFERIOR** | No hay tracking temporal de márgenes | P2 |
| Factor de rendimiento / merma | PARCIAL — en ingredientes | Wansoft tiene rendimiento | **INFERIOR** | Yield factor opaco, no visible en UI | P1 |

---

### DOMINIO D: PERSONAL Y OPERACIONES

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Performance de meseros | OPERATIVA — radar, 7/14/30d, KPIs | Ventas por mesero | **MEJOR** | Sin export, sin filter por sucursal | P2 |
| Pre-nómina | OPERATIVA — tarifas editables, deducciones | Nómina completa en Wansoft | **INFERIOR** | Deducciones estimadas, sin export contable | P2 |
| Asistencia (clock in/out) | OPERATIVA — PIN, log del día | Lista de asistencia | **EQUIVALENTE** | Sin integración biométrica | P2 |
| CRUD de staff | INFRAESTRUCTURA — archivo incompleto | CRUD en POS | **INFERIOR** | Implementación incompleta | P0 |
| Analíticas por mesero | INFRAESTRUCTURA — archivo incompleto | Reportes de mesero | **INFERIOR** | Implementación incompleta | P1 |
| Auditoría de acciones POS | OPERATIVA — log inmutable | No existe en dashboard | **MEJOR** | Sin export, sin purge policy | P2 |
| Horarios | OPERATIVA — CRUD días/horas | Horarios básicos | **EQUIVALENTE** | Sin timezone | P3 |

---

### DOMINIO E: IA Y AGENTES

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Detección de anomalías | OPERATIVA — Groq, horario | No existe | **MEJOR** | — | — |
| Anti-fraude | OPERATIVA — risk score, findings | No existe | **MEJOR** | — | — |
| Predicción de cierre | OPERATIVA — 3x/día, oportunidades | No existe | **MEJOR** | — | — |
| Menu engineering | OPERATIVA — BCG matrix, semanal | No existe | **MEJOR** | — | — |
| Optimización de staffing | OPERATIVA — por día de semana | No existe | **MEJOR** | — | — |
| Upselling por mesero | OPERATIVA — brechas por categoría | No existe | **MEJOR** | — | — |
| Chat IA | OPERATIVA — lenguaje natural, 8+ tablas | No existe | **DIFERENTE POR DISEÑO** | iOS Safari limitado (no voice) | P2 |
| Agente de voz | OPERATIVA — ElevenLabs, es-MX | No existe | **DIFERENTE POR DISEÑO** | iOS Safari sin soporte speech recognition | P2 |
| Coach diario | OPERATIVA — 3 insights JSON | No existe | **DIFERENTE POR DISEÑO** | — | — |
| Monitor de agentes | OPERATIVA — 47 agentes, 7 tentáculos | No existe | **DIFERENTE POR DISEÑO** | — | — |
| Predicción de demanda | INFRAESTRUCTURA — API existe, sin UI | No existe | **MEJOR** | UI no construida | P2 |

**Resumen Dominio E:** Fullsite tiene ventaja absoluta. Wansoft no tiene ninguna capacidad de IA. Este es el moat de producto más claro.

---

### DOMINIO F: ADMINISTRACIÓN Y CONFIGURACIÓN

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Gestión de menú | OPERATIVA — CRUD categorías/items | Admin de menú | **EQUIVALENTE** | Sin delete de items, sin imágenes | P2 |
| Modificadores | OPERATIVA — asignación multi-categoría | Modificadores | **EQUIVALENTE** | Config por tipo de orden no persiste | P1 |
| Tamaños | OPERATIVA — multiplicadores de precio | Tamaños básicos | **EQUIVALENTE** | — | — |
| Formas de pago | OPERATIVA — tipo, comisión, código fiscal | Métodos de pago | **EQUIVALENTE** | Sin delete | P3 |
| Promociones | OPERATIVA — 4 tipos con programación | Descuentos básicos | **MEJOR** | Sin picker de item en UI | P1 |
| Importación masiva | OPERATIVA — CSV bulk 4 tipos | Import básico | **MEJOR** | Sin rollback en fallo parcial | P2 |
| Exportación de datos | OPERATIVA — 8 tablas CSV | Export básico | **EQUIVALENTE** | Solo para dueño, sin filtros | P2 |
| Wizard de alta (onboarding) | OPERATIVA — multi-paso | No existe | **MEJOR** | Sin rollback en error | P2 |
| Bóveda de credenciales | OPERATIVA ⚠️ | No existe | **MEJOR** | **RIESGO CRÍTICO: cifrado XOR weak** | P0 |
| Zonas de delivery | OPERATIVA — CRUD con CPs | No existe | **MEJOR** | Sin geocoding, sin validación | P3 |
| Gestión de usuarios portal | OPERATIVA — 6 roles | Admin básico | **EQUIVALENTE** | Sucursales hardcodeadas, password client-side | P1 |
| Sucursales | OPERATIVA — comparativo | Multi-sucursal | **EQUIVALENTE** | Sin CRUD de sucursales | P2 |
| Catálogo de cuentas | OPERATIVA — jerárquico | No existe | **MEJOR** | Sin import SAT, sin balance sync | P2 |
| Horarios | OPERATIVA — días/horas | Horarios | **EQUIVALENTE** | Sin timezone | P3 |

---

### DOMINIO G: CFDI Y FINANZAS

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Solicitud de factura (QR) | INFRAESTRUCTURA — form existe, sin email | Factura por solicitud | **INFERIOR** | Sin email automático post-solicitud | P0 |
| Emisión automática de CFDI | PARCIAL — Facturama disponible pero sin UI fluida | Facturación directa | **INFERIOR** | Flujo solicitud→emisión no automatizado | P0 |
| Descarga de CFDI (PDF/XML) | OPERATIVA — proxy Facturama | Descarga básica | **EQUIVALENTE** | — | — |
| Complemento de pago | INFRAESTRUCTURA — API sin UI | Complemento de pago | **INFERIOR** | Sin UI que lo active | P1 |
| Notas de crédito | INFRAESTRUCTURA — solo localStorage | Notas de crédito básicas | **INFERIOR** | Datos efímeros, sin CFDI real | P1 |
| Reporte fiscal mensual | OPERATIVA — IVA, CSV | Reporte fiscal | **EQUIVALENTE** | IVA acreditable estimado | P2 |
| Cuentas por cobrar | OPERATIVA — abonos, aging | CxC básico | **EQUIVALENTE** | Sin aging buckets, sin link a CFDI | P2 |
| Pólizas CONTPAQi | OPERATIVA — XML diario/mensual | No existe | **MEJOR** | RFC hardcodeado por cliente | P1 |
| Control de efectivo | OPERATIVA — depósitos, flujo | Control básico | **MEJOR** | — | — |

**Resumen Dominio G:** CFDI es la brecha más crítica para el cutover real. La infraestructura existe (Facturama, API routes) pero el flujo de usuario desde QR → solicitud → emisión → entrega no está automatizado.

---

### DOMINIO H: CRM Y CLIENTES

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Base de clientes | OPERATIVA — CRUD básico | Base de clientes | **EQUIVALENTE** | Sin auto-link desde POS | P1 |
| CRM completo | OPERATIVA — perfiles, tags, historial | CRM básico | **MEJOR** | Sin auto-tagging, sin export segmentos | P2 |
| Programa de lealtad | INFRAESTRUCTURA — localStorage | Puntos de lealtad (MegaPoints) | **INFERIOR** | No persistente, no integrado con POS | P2 |
| Encuestas de satisfacción | OPERATIVA — QR, NPS, export | No existe | **MEJOR** | Datos demo hardcodeados, sin segmentación | P1 |
| Captura automática de cliente en POS | AUSENTE | Captura básica | **INFERIOR** | Clientes no se asocian automáticamente a órdenes | P1 |

---

### DOMINIO I: DELIVERY Y E-COMMERCE

| Función | Estado Fullsite | Wansoft | Veredicto | Gap Real | Prioridad |
|---|---|---|---|---|---|
| Analytics de delivery | PARCIAL — depende naming pago_metodos | Delivery básico | **EQUIVALENTE** | Sin conciliación de comisiones | P2 |
| Webhook Uber Eats | PARCIAL — sin HMAC verification | No existe | **MEJOR** | Riesgo de seguridad: sin firma | P0 |
| Integración Rappi | AUSENTE | No existe | **NO VERIFICADO** | No hay webhook Rappi | P2 |
| Retail / tienda | INFRAESTRUCTURA — sin POS integration | No existe en Wansoft | **DIFERENTE POR DISEÑO** | Items de tienda no aparecen en checkout | P2 |
| Zonas de delivery | OPERATIVA — CRUD con tarifa | Zonas básicas | **EQUIVALENTE** | Sin geocoding | P3 |

---

## Resumen por Veredicto

| Veredicto | Count | Comentario |
|---|---|---|
| MEJOR | 34 | Analytics, IA, inventario avanzado, tools operativos |
| EQUIVALENTE | 22 | Configuración básica, CRUD estándar, reportes base |
| INFERIOR | 14 | CFDI, lealtad, staff CRUD, propinas reales, P&L |
| DIFERENTE POR DISEÑO | 6 | Chat/voz, retail, predicción, mission control |
| INFRAESTRUCTURA | 8 | Exist en código, no product-complete |
| NO VERIFICADO | 1 | Rappi |

---

## Roadmap de Gaps — P0 a P3

### P0 — Bloquean el producto como tal (resolver antes de cualquier cutover)

| # | Gap | Módulo | Evidencia | Esfuerzo |
|---|---|---|---|---|
| P0-1 | **Barcode scanning no actualiza stock** — escaneos se logean pero pos_inventory_products.stock no cambia | inventario-real/barcode | Código auditado: escribe a wansoft_data pero no a pos_inventory | Bajo (1-2h) |
| P0-2 | **Transferencias no cierran loop en DB** — movimientos registrados pero stock origen/destino no actualiza | inventario-real/transferencias | Código: sbPost a wansoft_data, sin UPDATE pos_inventory | Bajo (1-2h) |
| P0-3 | **Devoluciones no ajustan balance** — devuelves pero el stock no sube | inventario-real/devoluciones | Código: guarda registro, no llama recordMovement | Bajo (1h) |
| P0-4 | **Vault cifrado con XOR weak** — key hardcodeada en cliente, cualquier atacante descifra credenciales | admin/vault | VAULT_KEY = 'fullsite_vault_2026' en código fuente | Medio (4-8h: migrar a AES-256 server-side) |
| P0-5 | **Webhook Uber Eats sin HMAC** — cualquier POST puede inyectar órdenes falsas | api/webhook/ubereats | TODO comment en código: "verify signature" | Bajo (1h: agregar HMAC check) |
| P0-6 | **pos/staff CRUD incompleto** — no se puede gestionar staff desde dashboard | pos/staff | Archivo cortado en ~100 líneas | Medio (4-8h: completar CRUD) |
| P0-7 | **Flujo CFDI solicitud→emisión no automatizado** — QR promete factura pero no hay pipeline automático | factura → api/factura/timbrar | UI de /factura no dispara timbrado, hay que ir a /facturas manualmente | Alto (8-16h: pipeline completo) |

---

### P1 — Bloquean casos de uso críticos del gerente

| # | Gap | Módulo | Evidencia | Esfuerzo |
|---|---|---|---|---|
| P1-1 | **Propinas reales requieren depth scraper activo** | /propinas | Código: fallback a estimación si no hay wansoft_tips_raw | Bajo (configuración, no código) |
| P1-2 | **P&L con labor hardcodeado al 25%** — no refleja nómina real | /estado-resultados | LABOR_COST_PCT = 0.25 hardcodeado | Medio (integrar wansoft_labor) |
| P1-3 | **RFC de empresa hardcodeado en pólizas CONTPAQi** — XXXXXXXXXXXX | /api/contabilidad/polizas | Valor literal en código fuente | Bajo (mover a config por cliente) |
| P1-4 | **Puntos de reorden no sincronizan a pos_ingredients** — config en snapshot de Wansoft, no en tabla viva | /inventario-real/reorden | Código: sbPost a wansoft_data, sin UPDATE pos_ingredients | Medio (rediseñar storage de reorder_points) |
| P1-5 | **Producción interna no descuenta ingredientes** | /inventario-real/produccion | Comentario en código: "TODO: deduct from inventory" | Bajo (implementar deducción) |
| P1-6 | **Complemento de pago CFDI sin UI** | /api/factura/complemento-pago | Route existe, no hay ninguna página que lo llame | Bajo (1 página) |
| P1-7 | **Config de modificadores por tipo de orden no persiste** | /admin/modificadores | Estado en memoria (useState), no llama a DB | Bajo (agregar PATCH a pos_modifiers) |
| P1-8 | **pos/staff-analytics incompleto** — sin gráficas de horas | /pos/staff-analytics | Archivo cortado ~100 líneas | Medio (completar UI) |
| P1-9 | **Clientes no se capturan automáticamente desde POS** | /clientes | No hay link entre pos_orders y pos_customers | Alto (requiere cambio en POS y dashboard) |
| P1-10 | **Notas de crédito solo en localStorage** — se pierden | /notas-credito | Storage: localStorage en lugar de Supabase | Bajo (migrar a pos_credit_notes tabla) |
| P1-11 | **Lealtad solo en localStorage** — no persiste | /lealtad | Storage: localStorage para todo | Alto (rediseñar con Supabase + POS integration) |

---

### P2 — Mejoran significativamente la experiencia pero no bloquean

| # | Gap | Módulo | Esfuerzo |
|---|---|---|---|
| P2-1 | Propinas: selector de periodo (fijo 30 días) | /propinas | Bajo |
| P2-2 | Análisis de categorías: selector de periodo (fijo 30 días) | /platillos | Bajo |
| P2-3 | Reportes/Ingresos: agregar al Sidebar navigation | /reportes/ingresos | Bajo |
| P2-4 | Estado de Resultados: integrar labor real desde wansoft_labor | /estado-resultados | Medio |
| P2-5 | Movimientos inventario: export CSV + pagination | /inventario-real/movimientos | Bajo |
| P2-6 | Inventario vista maestra: export CSV | /inventario-real | Bajo |
| P2-7 | Toma física: soporte de barcode scanning | /inventario-real/toma-fisica | Medio |
| P2-8 | Meseros: export de performance + filtro por sucursal | /meseros | Bajo |
| P2-9 | Admin/usuarios: fetch sucursales desde DB (hardcodeadas) | /admin/usuarios | Bajo |
| P2-10 | Admin/modificadores: persistir config por tipo de orden | /admin/modificadores | Bajo |
| P2-11 | Admin/carga-masiva: rollback transaccional en fallo | /admin/carga-masiva | Medio |
| P2-12 | Historial de márgenes en food cost | /food-cost | Alto |
| P2-13 | Factor de rendimiento visible en UI de recetas | /recetas | Bajo |
| P2-14 | Onboarding: rollback en error + detección duplicados | /admin/onboarding | Medio |
| P2-15 | CxC: aging buckets 30/60/90 días | /cuentas-por-cobrar | Bajo |
| P2-16 | Encuestas: remover datos demo hardcodeados | /encuestas | Bajo |
| P2-17 | UI de predicción de demanda (API ya existe) | /inventario-prediccion | Medio |
| P2-18 | Delivery: conciliación de comisiones por plataforma | /delivery | Alto |
| P2-19 | Reporte fiscal: IVA acreditable real (no estimado 30%) | /reporte-fiscal | Alto |
| P2-20 | Chat IA: soporte de voz en iOS Safari | /voice | Alto (dependency externa) |

---

### P3 — Nice-to-have, no urgentes

| # | Gap | Módulo |
|---|---|---|
| P3-1 | Merma: evidencia fotográfica + flujo de aprobación | /inventario-real/merma |
| P3-2 | Toma física: conteo cíclico (no full inventory) | /inventario-real/toma-fisica |
| P3-3 | Devoluciones: generación automática de nota de crédito CFDI | /inventario-real/devoluciones |
| P3-4 | Presentaciones: push-back a catálogo Wansoft | /inventario-real/presentaciones |
| P3-5 | Conversiones: cálculo automático de inversas | /inventario-real/conversiones |
| P3-6 | Proveedores: historial de compras + métricas de desempeño | /proveedores |
| P3-7 | OC: tracking post-envío (estado de OC) | /inventario-real/orden-compra |
| P3-8 | CRM: auto-tags basado en spend/frecuencia | /crm |
| P3-9 | CRM: export de segmentos para marketing | /crm |
| P3-10 | Encuestas: link a ticket original + segmentación por mesero | /encuestas |
| P3-11 | Admin/vault: migrar a AES-256 server-side (ver P0-4) | /admin/vault |
| P3-12 | Admin/exportar: export incremental + programado | /admin/exportar |
| P3-13 | Zonas delivery: geocoding + validación de CPs | /admin/domicilio |
| P3-14 | Horarios: soporte de timezone | /admin/horarios |
| P3-15 | Retail/tienda: integración con checkout POS | /admin/tienda |

---

## Análisis de Capacidades de Exportación

El usuario requirió un análisis específico de exports. El estado actual:

| Módulo | CSV | PDF | Filtros en export | Columnas seleccionables | Rango de fechas | Agrupación | Programado | Log de quien exportó |
|---|---|---|---|---|---|---|---|---|
| Reportes (ventas/meseros/platillos) | ✅ | Print | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Reporte Fiscal | ✅ (contable) | ❌ | ✅ (mes/año) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Admin/Exportar (8 tablas) | ✅ | ❌ | ❌ (exporta todo) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Encuestas | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Inventario-real | ❌ | ❌ | — | — | — | — | — | — |
| Movimientos | ❌ | ❌ | — | — | — | — | — | — |
| Food Cost | ❌ | ❌ | — | — | — | — | — | — |
| Meseros | ❌ | ❌ | — | — | — | — | — | — |
| Nómina | ❌ | ❌ | — | — | — | — | — | — |

**Conclusión de exports:** El sistema tiene capacidad de export básica pero no cumple el estándar de "export que preserve el contexto del reporte". Falta especialmente: columnas seleccionables, agrupación, reportes programados, y log de exports sensibles. Esta es una P2 transversal.

---

## Análisis de Configurabilidad

Inventario de qué es configurable vs. hardcodeado:

### Ya es configurable (en DB o UI)
- Menú, categorías, items, tamaños, modificadores
- Métodos de pago, promociones, horarios
- Zonas de delivery, formas de pago
- Usuarios y roles del portal
- Recetas y sub-recetas
- Puntos de reorden (aunque en snapshot, no live)

### Actualmente hardcodeado → debe configurarse
- `DEFAULT_HOURLY_RATE = $62.50/hr` en nómina
- `LABOR_COST_PCT = 0.25` en P&L
- Sucursales disponibles (3 hardcodeadas en admin/usuarios)
- RFC de empresa en pólizas CONTPAQi
- Razones de merma (lista fija no editable)
- Tiers de precio en admin/tienda/precios (rangos fijos)
- Rate limits de API (20/min chat, 15/min voz) — ok si en config, no si en código

### Debe inferirse automáticamente
- Reorder points → auto-cálculo desde historial de salidas (ya implementado pero desconectado)
- Labor cost → calculado desde wansoft_labor (no requiere config manual)
- IVA acreditable → calculado desde facturas de proveedor (no estimado fijo)

### La IA puede aprender con el tiempo
- Thresholds de anti-fraude (hoy: >1.5% descuentos = alerta, puede ajustarse per-restaurante)
- Predicción de cierre (mejora con más histórico)
- Menu engineering (BCG matrix se afina con datos)
- Patrones de staffing óptimo

### Invariantes del sistema (no deben ser configurables)
- Audit trail: siempre encendido, no se puede desactivar
- Idempotency keys en movimientos de inventario
- RLS por client_id: no se puede desactivar
- Firma HMAC en webhooks externos (fix P0-5)

---

## Priorización Final

**Hacer antes de cualquier nuevo cliente (P0, 4-6 días de trabajo):**
1. P0-1 a P0-3: Cerrar loop de inventario (barcode + transferencias + devoluciones = 1 día)
2. P0-4: Vault cifrado real (1 día)
3. P0-5: HMAC en webhook Uber Eats (2 horas)
4. P0-6: Completar pos/staff CRUD (1 día)
5. P0-7: Pipeline CFDI automático (2-3 días)

**Hacer antes del corte de AMALAY (P1, 5-7 días):**
1. P1-3: RFC en pólizas (2 horas)
2. P1-4: Reorder points a pos_ingredients (1 día)
3. P1-5: Producción descuenta ingredientes (2 horas)
4. P1-6: UI para complemento de pago (4 horas)
5. P1-7: Persistir config modificadores (2 horas)
6. P1-8: Completar staff-analytics (1 día)
7. P1-10: Notas de crédito a Supabase (4 horas)

**Hacer antes del segundo cliente (P2, 2-3 semanas):**
- Ver lista P2 completa arriba — 20 items, mayoría de esfuerzo bajo/medio

---

*Documento generado a partir de inspección directa de código fuente y comparación con Wansoft Dashboard Bible. 2026-07-25.*
