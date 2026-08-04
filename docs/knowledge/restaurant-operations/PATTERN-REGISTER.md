# Pattern Register — Índice Maestro

> Fuente única de verdad para IDs, clasificaciones y estado de ficha.  
> El detalle de cada patrón está en su archivo de categoría.  
> Última actualización: 2026-08-04 (Lote 3)

---

## Definiciones

### Clasificación (vs Wansoft)

| Valor | Significado |
|---|---|
| `SURPASS` | Limitación observada en Wansoft, u oportunidad documentada, que el sistema aborda. No es una propuesta de feature. |
| `MATCH` | Comportamiento operativo comprobado en ambos sistemas que debe preservarse. |
| `UNKNOWN` | Evidencia insuficiente para clasificar. |
| `WANSOFT-ONLY` | Wansoft implementa esto; Fullsite no tiene equivalente documentado. |

### Estado de ficha

| Valor | Significado |
|---|---|
| `DOCUMENTED` | Ficha completa en su archivo de categoría, con evidencia y fuente rastreable. |
| `INDEXED` | Identificado en el registro; ficha pendiente de desarrollar. |

### Nivel de evidencia (aplica dentro de la ficha)

| Valor | Significado |
|---|---|
| `FIELD VERIFIED` | Probado físicamente en AMALAY con hardware real. |
| `CODE VERIFIED` | Confirmado leyendo código fuente o un documento que cita constantes/file:line directamente. |
| `DOCUMENTED` | Registrado en docs oficiales del proyecto con sección rastreable. |
| `INFERRED` | Inferido de comportamiento observable, analogía u otra fuente indirecta. |
| `DOCUMENTED / UNVERIFIED COUNT` | Dato numérico cuya fuente es un documento o exportación; el recuento no fue reproducido independientemente. |

---

## Reconciliación de conteos entre lotes

| Lote | Total filas | DOCUMENTED | INDEXED | Errores detectados |
|---|---|---|---|---|
| **Lote 1** | **156** | 33 | 123 | El resumen del Lote 1 mostraba 106 — error: sumó tipos de clasificación, no filas. |
| **Lote 2** | **155** | 63 | 92 | El resumen del Lote 2 mostraba 145/82 — error aritmético: 63+92=155, no 145. |
| **Lote 3** | **TBD** | TBD | TBD | — |

**Cambios reales Lote 1 → Lote 2 (sin contar fichas escritas):**

| Cambio | Detalle |
|---|---|
| DL-006 eliminado | "Delivery orders inyectadas en Cocina" absorbido en CB-013 / CB-014. DL: 6 → 5 filas. |
| CB-002 renombrado | "Wansoft KDS poll 15s" (Lote 1) → absorbido en documentación de CB-001. CB-002 pasó a ser "resolveItemStation()". |
| CB-020 reemplazado | "Sidebar conteo platillos" (Lote 1) pasó a CB-019. CB-020 nuevo = "Barra push events via useBridgeClient". |
| Total neto | -1 fila (DL-006 eliminada). 156 → 155. |

**No hay patrones silenciosamente añadidos.** La diferencia entre los resúmenes (106 vs 145) fue enteramente por errores aritméticos en ambas tablas de resumen.

---

## OP — Operación · `01-operacion.md`

| ID | Nombre | Clasificación | Estado ficha | Evidencia | Fuente / Sección |
|---|---|---|---|---|---|
| OP-001 | Fondo de caja obligatorio en apertura | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §AMALAY-config |
| OP-002 | Turno como unidad de control fiscal | MATCH | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §turno; FULLSITE-OPERATIONS-BIBLE.md |
| OP-003 | Un turno por terminal, no por negocio | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §turnos |
| OP-004 | Cierre de turno bloquea acceso al POS | MATCH | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §TurnoGate |
| OP-005 | Cierre de turno y Corte Z son conceptos distintos | SURPASS | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §veredicto |
| OP-006 | TurnoGate: bloqueo de POS sin turno activo | SURPASS | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §TurnoGate |
| OP-007 | Estado de turno: loading / active / none / stale | SURPASS | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §turno-estados |
| OP-008 | Órdenes abiertas al cerrar turno — no bloqueante | UNKNOWN | DOCUMENTED | INFERRED | BREAK-THE-RESTAURANT.md §Trust-Issue-6 |
| OP-009 | Hora pico calculada internamente | SURPASS | DOCUMENTED | CODE VERIFIED | CLAUDE.md §wansoft_kpis columna hora_pico |
| OP-010 | PIN con TTL 900s — re-auth silenciosa | SURPASS | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §PIN_CACHE_TTL=900000 |
| OP-011 | Idle timeout 1800s | MATCH | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §IDLE_TIMEOUT_MS=1800000 |
| OP-012 | Menú en IDB desde boot — operación offline | SURPASS | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §IDB; OFFLINE-SUITE-v1.md §OC-10 |
| OP-013 | Fondo de caja AMALAY: $1,700 MXN fijo | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §AMALAY-config |
| OP-014 | Turno transferible entre terminales (Wansoft) | WANSOFT-ONLY | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §Wansoft-Avanzadas |

---

## CJ — Caja · `02-caja.md`

| ID | Nombre | Clasificación | Estado ficha | Evidencia | Fuente / Sección |
|---|---|---|---|---|---|
| CJ-001 | IVA_RATE fijo 0.16 — precios con IVA incluido | MATCH | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §constante-IVA_RATE |
| CJ-002 | Subtotal = total / 1.16 | MATCH | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §cálculo-IVA |
| CJ-003 | Métodos de pago aceptados | MATCH | DOCUMENTED | FIELD VERIFIED | CLAUDE.md §wansoft_daily.pago_metodos |
| CJ-004 | Cobro mixto (efectivo + tarjeta) | UNKNOWN | DOCUMENTED | INFERRED | FULLSITE-POS-OPERATIONAL-BIBLE.md §tabla-veredicto → CONTRA-001 |
| CJ-005 | Propina capturada en POS — separada del total | SURPASS | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §checkout; CLAUDE.md §propinas_total |
| CJ-006 | Tip-out AMALAY: 5% a cocina | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §AMALAY-config |
| CJ-007 | Corte Z: secuencial, irrepetible, fiscal | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §corte-Z |
| CJ-008 | Corte X: reporte acumulativo sin cierre | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §cortes |
| CJ-009 | Wansoft: 5 tipos de corte | WANSOFT-ONLY | DOCUMENTED | DOCUMENTED | FULLSITE-POS-OPERATIONAL-BIBLE.md §Wansoft-Avanzadas |
| CJ-010 | Cortesía máxima: CORTESIA_POR_PERSONA = $480 | UNKNOWN | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §constante-CORTESIA_POR_PERSONA |
| CJ-011 | Descuento requiere PIN de gerente | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §descuentos |
| CJ-012 | Descuento % vs monto fijo — dos flujos | UNKNOWN | DOCUMENTED | INFERRED | FULLSITE-POS-OPERATIONAL-BIBLE.md (no detallado) |
| CJ-013 | Cancelación de ítem vs cuenta completa | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §cancelaciones; BREAK-THE-RESTAURANT.md |
| CJ-014 | Cancelación post-cobro — flujo devolución | UNKNOWN | DOCUMENTED | INFERRED | CLAUDE.md §wansoft_daily.devoluciones |
| CJ-015 | Corte X clasifica mal pagos al cruzar turnos | UNKNOWN | DOCUMENTED | DOCUMENTED | BREAK-THE-RESTAURANT.md §Trust-Issue-1 |
| CJ-016 | Diferencia de caja: efectivo real − esperado | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §cierre |
| CJ-017 | CFDI 4.0: facturación post-cobro | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §facturación |
| CJ-018 | MP Point: cobro separado del POS, sin integración | UNKNOWN | DOCUMENTED | FIELD VERIFIED | FULLSITE-POS-OPERATIONAL-BIBLE.md §AMALAY-config |
| CJ-019 | Facturación QR en ticket para autoservicio | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §facturación-QR |

---

## CB — Cocina y Barra · `03-cocina-barra.md`

> Nota: Todos los patrones de esta sección derivados de KDS-WANSOFT-GAP-ANALYSIS.md tienen evidencia DOCUMENTED — el gap analysis es un documento de análisis, no código fuente.

| ID | Nombre | Clasificación | Estado ficha | Evidencia | Fuente / Sección |
|---|---|---|---|---|---|
| CB-001 | KDS polling 2s + push events del bridge | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Operación-continua |
| CB-002 | Routing por estación: resolveItemStation() | MATCH | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Routing |
| CB-003 | Routing Wansoft: ImpresoraGrupo configurable desde admin | WANSOFT-ONLY | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Routing (gap G-01) |
| CB-004 | Estados KDS: enviada→preparando→lista→entregada | MATCH | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estados |
| CB-005 | Forward-only: no retrocede estado en KDS | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estados |
| CB-006 | Tracking por ítem en Cocina: click individual | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estados |
| CB-007 | Barra: tracking solo a nivel de orden (gap G-03) | UNKNOWN | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estados (GAP G-03) |
| CB-008 | Auto-archive de órdenes > 4h | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación |
| CB-009 | Alerta audio Cocina: 880+1100Hz | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Alertas |
| CB-010 | Alerta audio Barra: 660Hz | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Alertas |
| CB-011 | Umbral urgencia Cocina: configurable en Settings | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Alertas |
| CB-012 | Umbral urgencia Barra: hardcoded 10 min (gap G-05) | UNKNOWN | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Alertas (GAP G-05) |
| CB-013 | Delivery orders en Cocina KDS | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones |
| CB-014 | Delivery orders en Barra KDS — 2026-07-31 | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones (CLOSED G-02) |
| CB-015 | Reimpresión desde KDS: reprintByStation() | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Impresión |
| CB-016 | reprintByStation sin retry — fallo silencioso (gap G-04) | UNKNOWN | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Impresión (GAP G-04) |
| CB-017 | Tab panadería en Cocina — filtro sub-categoría | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones |
| CB-018 | KDS no notifica al mesero en cancelación de ítem | UNKNOWN | DOCUMENTED | DOCUMENTED | BREAK-THE-RESTAURANT.md §Trust-Issue-5 |
| CB-019 | Sidebar de conteo por platillo en Cocina | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Alertas |
| CB-020 | Barra: push events via useBridgeClient (CLOSED G-06) | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación + §Operación-continua (CLOSED G-06) |

---

## IN — Inventario y Compras · `04-inventario-compras.md`

> Nota: Todos los datos numéricos de wansoft_*.json son snapshots de AMALAY y no han sido verificados por recuento independiente.

| ID | Nombre | Clasificación | Estado ficha | Evidencia | Fuente / Sección |
|---|---|---|---|---|---|
| IN-001 | Stock no bloquea venta — stock negativo posible | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §reglas-inventario; WANSOFT-BIBLE.md §confiabilidad-operativa |
| IN-002 | Recetas como fuente de verdad para costo | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §recetas; agents/wansoft/wansoft_recetas.json |
| IN-003 | Factor de rendimiento (yield) por ingrediente | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE DOCS/15-AMALAY/wansoft/DATA-MODEL.md §inventario |
| IN-004 | Recetas y almacenes en AMALAY — conteo atribuido | UNKNOWN | DOCUMENTED | DOCUMENTED / UNVERIFIED COUNT | agents/wansoft/wansoft_recetas.json; wansoft_existencias_detalle.json → UNK-031 |
| IN-005 | Cardex: movimientos con fecha, motivo y responsable | MATCH | DOCUMENTED | DOCUMENTED | agents/wansoft/wansoft_cardex_summary.json |
| IN-006 | Compras sugeridas: punto de reorden calculado | MATCH | DOCUMENTED | DOCUMENTED | agents/wansoft/wansoft_compras_sugeridas.json; wansoft_reorder_points.json |
| IN-007 | Transferencias entre almacenes con autorización | UNKNOWN | DOCUMENTED | DOCUMENTED | agents/wansoft/wansoft_transferencias.json |
| IN-008 | Subproductos: producción genera inventario | UNKNOWN | DOCUMENTED | DOCUMENTED | agents/wansoft/wansoft_subproductos.json; wansoft_produccion_plantillas.json |
| IN-009 | Variación de costos: real vs. costo teórico | UNKNOWN | DOCUMENTED | DOCUMENTED | agents/wansoft/wansoft_variacion_costos.json; wansoft_costo_vs_venta.json |
| IN-010 | Costo real AMALAY ~27.6% (pos_recipes) | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §food-cost → CONTRA-002 |

---

## MS — Meseros y Servicio · `05-meseros-servicio.md`

| ID | Nombre | Clasificación | Estado ficha | Evidencia | Fuente / Sección |
|---|---|---|---|---|---|
| MS-001 | PIN como autenticación primaria en POS | MATCH | DOCUMENTED | DOCUMENTED | BREAK-THE-RESTAURANT.md §BLOCKER-1; FULLSITE-OPERATIONS-BIBLE.md |
| MS-002 | PIN_CACHE_TTL = 900s — re-auth silenciosa | UNKNOWN | DOCUMENTED | CODE VERIFIED | FULLSITE-POS-BIBLE.md §constante-PIN_CACHE_TTL=900000 |
| MS-003 | 50 registros de staff activos en AMALAY | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md §staff |
| MS-004 | Wansoft: huella dactilar como autenticación alternativa | WANSOFT-ONLY | DOCUMENTED | DOCUMENTED | WANSOFT-BIBLE.md §seguridad |
| MS-005 | Propina como campo de entrada en el cobro | MATCH | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §cobro; CLAUDE.md §propinas_total |
| MS-006 | Pool de propinas — distribución al equipo | UNKNOWN | DOCUMENTED | INFERRED | FULLSITE-OPERATIONS-BIBLE.md §propinas |
| MS-007 | MESERO EVENTO: categoría especial para eventos | UNKNOWN | DOCUMENTED | DOCUMENTED | CLAUDE.md §meseros-activos (literal en la lista) |
| MS-008 | Ranking de meseros por ventas — accesible en dashboard | SURPASS | DOCUMENTED | DOCUMENTED | CLAUDE.md §wansoft_daily.meseros (campo JSONB) |
| MS-009 | Wansoft: permiso "¿Se preparó?" — validación pre-cobro | WANSOFT-ONLY | DOCUMENTED | DOCUMENTED | WANSOFT-BIBLE.md §permisos |
| MS-010 | Wansoft: permisos en dos pasos (solicitar + autorizar) | WANSOFT-ONLY | DOCUMENTED | DOCUMENTED | WANSOFT-BIBLE.md §permisos |

---

## DL — Delivery · `06-delivery.md`

> Nota: DL-006 eliminado del Lote 1 — su contenido fue absorbido en CB-013 (Cocina) y CB-014 (Barra).

| ID | Nombre | Clasificación | Estado ficha | Evidencia | Fuente / Sección |
|---|---|---|---|---|---|
| DL-001 | Rappi/Uber como método de pago en Wansoft — fuera del KDS | WANSOFT-ONLY | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones |
| DL-002 | Fullsite: delivery integrado al KDS como canal | SURPASS | DOCUMENTED | DOCUMENTED | KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones |
| DL-003 | Estados delivery: nueva→preparando→lista→en_ruta→entregada | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §delivery |
| DL-004 | Platform maneja en_ruta y entregada | UNKNOWN | DOCUMENTED | DOCUMENTED | FULLSITE-OPERATIONS-BIBLE.md §delivery |
| DL-005 | Webhook como canal de entrada de órdenes | UNKNOWN | DOCUMENTED | INFERRED | FULLSITE-OPERATIONS-BIBLE.md §delivery (mecanismo inferido) |

---

## PR — Impresión · `07-impresion-kds.md` (INDEXED)

| ID | Nombre | Clasificación | Estado ficha | Fuente / Sección |
|---|---|---|---|---|
| PR-001 | Print Bridge en 127.0.0.1:7717 — HTTP → ESC/POS | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §bridge |
| PR-002 | Wansoft: RestPrintingApp.exe — poll SQL 15s → TCP | MATCH | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md |
| PR-003 | 3 impresoras AMALAY: EC TICKET, COCINA CALIENTE, BARRA | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md §hardware |
| PR-004 | Cajón via RJ-11 a EC TICKET | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md §hardware |
| PR-005 | Retry queue print inicial: hasta 5 reintentos | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §MAX_RETRIES=5 |
| PR-006 | BRIDGE_UNAVAILABLE_ESCALATION_MS = 120,000ms | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §constante |
| PR-007 | RETRY_INTERVAL_MS = 15,000ms, MAX_RETRIES = 5 | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §constante |
| PR-008 | reprintByStation sin retry — fallo silencioso | UNKNOWN | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Impresión (GAP G-04) |
| PR-009 | Print queue: pending→printing→success/unavailable | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §print-queue |
| PR-010 | Bridge sin NSSM autostart | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md §bridge-status |
| PR-011 | Wansoft: 47 templates de impresión | WANSOFT-ONLY | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md |
| PR-012 | Routing impresión Wansoft: ImpresoraGrupo | WANSOFT-ONLY | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Routing |

---

## CF — Configuración · `08-configuracion.md` (INDEXED)

| ID | Nombre | Clasificación | Estado ficha | Fuente / Sección |
|---|---|---|---|---|
| CF-001 | Taxonomía Config / Auto / Config→Auto | SURPASS | INDEXED | docs/archive/bibles/CONFIGURABILITY-BIBLE.md §taxonomía |
| CF-002 | Actores: Dueño / Gerente / Fullsite | SURPASS | INDEXED | docs/archive/bibles/CONFIGURABILITY-BIBLE.md §actores |
| CF-003 | Default first: sistema decide antes de config | SURPASS | INDEXED | docs/archive/bibles/CONFIGURABILITY-BIBLE.md §principios |
| CF-004 | Routing sin UI — requiere deploy (gap G-01) | WANSOFT-ONLY | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Routing (GAP G-01) |
| CF-005 | Wansoft: routing configurable desde admin sin deploy | WANSOFT-ONLY | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Routing |
| CF-006 | Umbral urgencia Cocina: configurable en localStorage | SURPASS | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Alertas |
| CF-007 | Mesas: AMALAY plano físico; otros clientes grid 12 | UNKNOWN | INDEXED | docs/archive/KNOWN_GOTCHAS.md §G-011 |
| CF-008 | 522 ítems de menú activos en AMALAY | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md |
| CF-009 | Multi-tenant: client_id en todas las tablas + RLS | SURPASS | INDEXED | docs/archive/KNOWN_GOTCHAS.md §G-002 |

---

## OF — Offline y Recuperación · `09-offline-recuperacion.md` (INDEXED)

| ID | Nombre | Clasificación | Estado ficha | Fuente / Sección |
|---|---|---|---|---|
| OF-001 | Wansoft: SQL Server local = 100% offline | WANSOFT-ONLY | INDEXED | FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md |
| OF-002 | Fullsite: IndexedDB como capa offline primaria | MATCH | INDEXED | FULLSITE-POS-BIBLE.md §IDB |
| OF-003 | IDB v3 schema: 5 stores | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §IDB-schema |
| OF-004 | sync_queue: cola persistente de operaciones | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §sync_queue |
| OF-005 | OCC: expected_revision evita conflictos | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §OCC |
| OF-006 | STALE_WRITE_CONFLICT al detectar revisión desactualizada | SURPASS | INDEXED | FULLSITE-POS-BIBLE.md §OCC |
| OF-007 | Menú disponible offline desde boot | SURPASS | INDEXED | OFFLINE-SUITE-v1.md §OC-10 |
| OF-008 | Staff autentica offline (credentials en IDB) | SURPASS | INDEXED | OFFLINE-SUITE-v1.md §OC-09 |
| OF-009 | Auto-archive de órdenes > 4h | SURPASS | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación |
| OF-010 | Fase 5 certificación offline: PENDING | UNKNOWN | INDEXED | OFFLINE-SUITE-v1.md §Fases |
| OF-011 | Bridge LAN: push events durante outage Supabase | SURPASS | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación (CLOSED G-06) |
| OF-012 | Wansoft: boot por snapshot de menú en inicio | MATCH | INDEXED | FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md |
| OF-013 | Wansoft: cierre de turno completamente local | WANSOFT-ONLY | INDEXED | FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md |

---

## EC — Errores y Edge Cases · `10-errores-edge-cases.md` (INDEXED)

| ID | Nombre | Clasificación | Estado ficha | Fuente / Sección |
|---|---|---|---|---|
| EC-001 | pos_staff vacío → acceso Admin sin autenticación | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §BLOCKER-1 |
| EC-002 | Dos terminales sobre misma mesa vacía → phantom orders | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §BLOCKER-2 |
| EC-003 | Corte X clasifica mal pagos al cruzar turnos | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §Trust-Issue-1 |
| EC-004 | Sync silencioso descartado tras 5 retries | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §Trust-Issue-2 |
| EC-005 | KDS no notifica cancelación de ítem | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §Trust-Issue-5 |
| EC-006 | sessionStorage manipulable — bypass de permisos | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §Trust-Issue-4 |
| EC-007 | Órdenes abiertas al cerrar turno | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §Trust-Issue-6 |
| EC-008 | 2 PCs de KDS no sincronizan estado entre sí | UNKNOWN | INDEXED | BREAK-THE-RESTAURANT.md §Trust-Issue-7 |
| EC-009 | SSR hardcodea 'amalay' antes de hidratación | UNKNOWN | INDEXED | docs/archive/KNOWN_GOTCHAS.md §G-001 |
| EC-010 | RLS public override authenticated — FIXED SKEL-04 | MATCH | INDEXED | docs/archive/KNOWN_GOTCHAS.md §G-002 |
| EC-011 | Anon key permite lectura cross-tenant sin filtro | UNKNOWN | INDEXED | docs/archive/KNOWN_GOTCHAS.md §G-006 |
| EC-012 | AI Coach solo lee wansoft_daily | UNKNOWN | INDEXED | docs/archive/KNOWN_GOTCHAS.md §G-003 |
| EC-013 | Mesas hardcoded para AMALAY | UNKNOWN | INDEXED | docs/archive/KNOWN_GOTCHAS.md §G-011 |

---

## HP — Heurísticas · `11-heuristicas-buenas-practicas.md` (INDEXED)

| ID | Nombre | Clasificación | Estado ficha | Fuente / Sección |
|---|---|---|---|---|
| HP-001 | Complejidad operacional como switching cost | UNKNOWN | INDEXED | WANSOFT-BIBLE.md §modelo-negocio |
| HP-002 | Internet = sync, no operación — LAN-first | MATCH | INDEXED | FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md |
| HP-003 | Autoridad única: SQL Server en Wansoft | MATCH | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md |
| HP-004 | Polling > webhook para operaciones críticas | MATCH | INDEXED | FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md |
| HP-005 | Stock sin bloqueo — venta continúa siempre | MATCH | INDEXED | FULLSITE-OPERATIONS-BIBLE.md §inventario |
| HP-006 | Audit log siempre encendido | SURPASS | INDEXED | WANSOFT-BIBLE.md §seguridad |
| HP-007 | Config desde admin UI, no de deploy | WANSOFT-ONLY | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Routing (gap G-01) |
| HP-008 | IPs estáticas en hardware de restaurante | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md §red |
| HP-009 | Backup manual post-cierre | MATCH | INDEXED | WANSOFT-BIBLE.md §respaldos |
| HP-010 | 5 tipos de corte Wansoft = 5 necesidades reales | MATCH | INDEXED | FULLSITE-POS-OPERATIONAL-BIBLE.md §Wansoft-Avanzadas |

---

## WN — Wansoft/NetSilver Patterns · `12-wansoft-netsilver-patterns.md` (INDEXED)

| ID | Nombre | Clasificación | Estado ficha | Fuente / Sección |
|---|---|---|---|---|
| WN-001 | 14 DLLs, SQL Server, RestPrintingApp.exe — monolito .NET | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md |
| WN-002 | 822 stored procedures, 23 dominios | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/DATA-MODEL.md |
| WN-003 | Comandero APK Android — única pantalla KDS | MATCH | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones |
| WN-004 | TeamViewer como canal de soporte y actualizaciones | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md |
| WN-005 | Sin migrations — actualizaciones manuales | UNKNOWN | INDEXED | WANSOFT-BIBLE.md §actualizaciones |
| WN-006 | IPs hardcodeadas en config de impresoras | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md §red |
| WN-007 | Getnet standalone — no integrado al POS | MATCH | INDEXED | WANSOFT-BIBLE.md §seguridad |
| WN-008 | Distribución como moat — 20+ verticales, 6K+ clientes | UNKNOWN | INDEXED | WANSOFT-BIBLE.md §modelo-negocio |
| WN-009 | Audit log apagado por default | UNKNOWN | INDEXED | WANSOFT-BIBLE.md §seguridad |
| WN-010 | 4 estados de orden: Abierta→Comandada→Impresa→Cobrada | MATCH | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Estados |

---

## AM — AMALAY Field Knowledge · `13-amalay-field-knowledge.md` (INDEXED)

| ID | Nombre | Clasificación | Estado ficha | Fuente / Sección |
|---|---|---|---|---|
| AM-001 | Fondo de caja: $1,700 MXN | UNKNOWN | INDEXED | FULLSITE-POS-OPERATIONAL-BIBLE.md §AMALAY-config |
| AM-002 | 5 impresoras en planta | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md §hardware |
| AM-003 | Báscula en COM1 — integración pendiente | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md §hardware |
| AM-004 | Tip-out: 5% propinas a cocina | UNKNOWN | INDEXED | FULLSITE-POS-OPERATIONAL-BIBLE.md §AMALAY-config |
| AM-005 | 522 ítems activos, 50 staff con PINs | UNKNOWN | INDEXED | FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md |
| AM-006 | Uber/Rappi entra como E-COMMERCE en Wansoft | MATCH | INDEXED | KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones |
| AM-007 | RFC AMALAY: AFO200806JI0 | UNKNOWN | INDEXED | CLAUDE.md §AMALAY-fiscal |
| AM-008 | 3 visitas de campo; topología por dispositivo mapeada | UNKNOWN | INDEXED | docs/certifications/ (state docs) |
| AM-009 | Costo real ~27.6% (pos_recipes Excel) | UNKNOWN | INDEXED | FULLSITE-OPERATIONS-BIBLE.md §food-cost → CONTRA-002 |
| AM-010 | Horario pico AMALAY: no documentado | UNKNOWN | INDEXED | (ninguna — requiere observación de campo) |

---

## Resumen por estado de ficha (Lote 3)

| Categoría | Filas | DOCUMENTED | INDEXED |
|---|---|---|---|
| OP — Operación | 14 | 14 | 0 |
| CJ — Caja | 19 | 19 | 0 |
| CB — Cocina/Barra | 20 | 20 | 0 |
| IN — Inventario | 10 | 10 | 0 |
| MS — Meseros | 10 | 10 | 0 |
| DL — Delivery | 5 | 5 | 0 |
| PR — Impresión | 12 | 0 | 12 |
| CF — Configuración | 9 | 0 | 9 |
| OF — Offline | 13 | 0 | 13 |
| EC — Edge Cases | 13 | 0 | 13 |
| HP — Heurísticas | 10 | 0 | 10 |
| WN — Wansoft | 10 | 0 | 10 |
| AM — AMALAY | 10 | 0 | 10 |
| **Total** | **155** | **78** | **77** |

*Nota: El resumen del Lote 2 mostraba 145/63/82 — error aritmético. El conteo correcto de Lote 2 era 155/63/92. Lote 3 añade MS (10) y DL (5) a DOCUMENTED: 63+10+5=78.*

---

## Contradicciones abiertas

| ID | Descripción | Fuente A | Fuente B | Resuelve con |
|---|---|---|---|---|
| CONTRA-001 | Cobro clasificado como "INFERIOR" en FULLSITE-POS-OPERATIONAL-BIBLE.md §veredicto pero el aspecto específico no está detallado. Puede referirse al cobro mixto, al flujo de pago, o a ambos. | FULLSITE-POS-OPERATIONAL-BIBLE.md §tabla-veredicto | FULLSITE-POS-BIBLE.md (no lista limitaciones de cobro) | Leer §veredicto completo + prueba de campo cobro mixto → CJ-004 |
| CONTRA-002 | pos_recipes (Fullsite) y wansoft_food_cost coexisten como fuentes de costo para AMALAY. FULLSITE-OPERATIONS-BIBLE.md establece que wansoft_food_cost está stale pero no cuantifica la diferencia. El 27.6% debe tratarse como aproximación. | FULLSITE-OPERATIONS-BIBLE.md §food-cost | agents/wansoft/wansoft_costos.json | Comparación directa por platillo + auditoría física → IN-002, IN-010 |
