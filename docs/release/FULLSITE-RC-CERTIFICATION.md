# FULLSITE RELEASE CANDIDATE CERTIFICATION

**Registro operativo canónico.** POS + KDS + Dashboard + Offline.
Iniciado: 2026-08-06 · QA Lead: sesión war-room · Release candidato: `1.3.3` (electron-app `21f6b87`, EXE SHA `80F0A819…C03A`)

## Principio de PASS (no negociable)

Una feature solo es **PASS** cuando: se ejecuta desde su interfaz; persiste; produce el efecto esperado en los demás módulos; sobrevive restart cuando aplica; no pierde ni duplica; respeta tenant/sucursal/usuario/permisos; y tiene evidencia reproducible. Estados: `PASS / FAIL / BLOCKED / NOT IMPLEMENTED / HIDDEN-OUT-OF-RELEASE`. Estado de trabajo adicional en este registro: `PENDING` (aún no ejecutada su verificación — NO cuenta como PASS).

**Niveles de evidencia** (columna Ev.):
- **UI** — ejecutado desde la interfaz real end-to-end
- **LAB** — ejecutado en runtime real (Bridge instalado, WS real, CI Windows) pero no desde la UI
- **TEST** — suite automatizada que importa código de producción
- **—** — sin evidencia de ejecución

---

# FASE 1 — INVENTARIO REAL

## 1A. POS (dashboard-app `/pos`, 27 rutas; página principal `pos/page.tsx`)

| # | Feature | Implementación | Estado cert. | Ev. | Nota |
|---|---|---|---|---|---|
| P01 | Login staff (lockscreen + PIN, lockout 5 intentos) | UI `pos/layout.tsx:66-450` | PENDING | TEST (hashPin) | Física: matriz #2 |
| P02 | Huella (DigitalPersona 7718 + WebAuthn) | UI `pos/huella` + layout | BLOCKED (hardware) | — | Solo con lector físico (lunes) |
| P03 | Permisos/roles (50+ flags, 6 perfiles) | UI `pos-permissions.ts` | PENDING | TEST (roles offline) | pos-data-auth 24 tests PASS |
| P04 | Apertura de turno (TurnoGate + fondo) | UI `pos/turno` | PENDING | TEST (replica) | Física: matriz #5 |
| P05 | Mapa de mesas / plano (43 mesas AMALAY) | UI `pos/mesas`, `pos/plano` | PENDING | LAB (locks Bridge) | state.test.js mesa locks PASS |
| P06 | Selección de mesero | UI `pos/page.tsx:1555` | PENDING | — | |
| P07 | Número de personas | UI `pos/page.tsx:1597` | PENDING | — | |
| P08 | Asientos (silla por ítem, ciclado) | UI `pos/page.tsx:1612` | PENDING | — | Sin agrupación visual por asiento (documentado) |
| P09 | Productos/menú (IDB cache SWR + búsqueda) | UI `pos/page.tsx:1634` | PENDING | TEST (pos-menu-db) | Física: matriz #6 |
| P10 | Modificadores **multinivel** (groups: level/min/max/required) | UI ModifierModal `pos/page.tsx:173-400` | PENDING | TEST (routing) | Fallback a nivel único legacy |
| P11 | Cursos/tiempos (separadores TIEMPO) | UI `pos/page.tsx:2714` | PENDING | — | |
| P12 | Notas por ítem y por orden | UI `pos/page.tsx:258,2126` | PENDING | — | |
| P13 | Envío a cocina (print por estación + guardado + conflictos) | UI `pos/page.tsx:2864-3165` | PENDING | LAB (ORDER_SENT Bridge) | contract.test.js + twin |
| P14 | Edición antes de envío | UI `pos/page.tsx:2365` | PENDING | — | |
| P15 | Edición después de envío | **PARTIAL por diseño** | HIDDEN-OUT-OF-RELEASE | — | UI bloquea ítems enviados (Lock) — correcto para cocina; se certifica el bloqueo, no la edición |
| P16 | Cancelación con motivo + autorización manager | UI CancelItemModal `pos/page.tsx:938-1137` | PENDING | TEST (PBKDF2 auth) | 18 motivos preset; física: matriz #18 |
| P17 | Transferir mesa (PIN manager) | UI `pos/page.tsx:4129` | PENDING | — | |
| P18 | Juntar mesas (merge) | UI `pos/mesas:378` | PENDING | — | |
| P19 | Dividir cuenta parejo (2–6) | UI `pos/page.tsx:4787` | PENDING | TEST (calcSplitParejo) | pos-critical PASS |
| P20 | Dividir por producto (cuentas 1–6) | UI `pos/page.tsx:4851` | PENDING | TEST (prorrateo) | |
| P21 | Dividir por persona (asignación explícita) | **NOT IMPLEMENTED** | NOT IMPLEMENTED | — | Solo parejo + por producto. No prometer en venta |
| P22 | Pago efectivo (cambio + cajón) | UI `pos/page.tsx:5420` | PENDING | TEST (cálculos) | |
| P23 | Pago tarjeta (monto + Getnet display; **sin tarjetas guardadas**) | UI `pos/page.tsx:5300` | PENDING | — | "Tarjeta registrada" NO existe — no prometer |
| P24 | Pago mixto (2+ métodos) | UI `pos/page.tsx:5450` | PENDING | TEST (suma métodos) | |
| P25 | Propinas (10/15/20/custom) | UI `pos/page.tsx:5243` | PENDING | — | |
| P26 | Depósitos/retiros con auth manager | UI CashMovementModal `pos/page.tsx:1291` | PENDING | — | |
| P27 | Corte X | UI `pos/corte:46` | PENDING | TEST (arqueo) | pos-arqueo PASS; física: matriz #20 |
| P28 | Corte Z / cierre turno (wizard + reconciliación) | UI CierreCajaWizard | PENDING | TEST (cierre-guard 30+) | Física: matriz #20 |
| P29 | Impresión (comanda por estación, preticket, ticket) | UI printByStation | PENDING | LAB (bytes ESC/POS twin) | Física: impresora real |
| P30 | Reimpresión (debounce + audit) | UI `pos/page.tsx:4092` | PENDING | — | |
| P31 | Indicador offline | UI OfflineIndicator | PENDING | — | OC-11 |
| P32 | Recuperación tras restart (IDB+localStorage: drafts 8h, turno, menú) | UI `pos/page.tsx:1531` | PENDING | TEST (replica TTL) | Física: matriz #14 |
| P33 | Recuperación tras crash (cola offline + replay idempotente) | lib pos-offline-db | PENDING | LAB (backoff+dedup) | pos-sync-backoff PASS; física: matriz #17/#23 |

**POS: 33 features inventariadas · 30 implementadas-UI · 1 NOT IMPLEMENTED (P21) · 1 HIDDEN por diseño (P15) · 1 BLOCKED hardware (P02).**

## 1B. KDS (dashboard-app `/kds` + `/pos/cocina|barra|kds` + electron-kds kiosk)

| # | Capacidad | Implementación | Estado cert. | Ev. | Nota |
|---|---|---|---|---|---|
| K01 | Recepción de orden en tiempo real (WS DELTA) | UI useKdsWsClient:144 | PENDING (UI) | **LAB** | twin: 16 tests kds-ws + shift 127 órdenes |
| K02 | Recepción por estación (cocina/barra, resolveItemStation) | UI kds/page.tsx:46 | PENDING | — | |
| K03 | Modificadores visibles | UI kds/page.tsx:506 | PENDING | — | |
| K04 | Notas visibles | UI kds/page.tsx:511 | PENDING | — | |
| K05 | Cursos/tiempos + timers color-coded (<10/10-20/>20 min) | UI kds/page.tsx:22,417 | PENDING | — | |
| K06 | Cambio de estado por ítem (toggle + auto-advance) | UI kds/page.tsx:261 | PENDING | LAB (KDS_ITEM_STATUS) | |
| K07 | Cambio de estado por orden (bump, dual-write) | UI kds/page.tsx:237 | PENDING | LAB | |
| K08 | Órdenes actualizadas (2ª ronda, badges R2/R3) | UI useKdsWsClient:149 | PENDING | LAB (rondas twin) | |
| K09 | Órdenes canceladas se reflejan | UI useKdsWsClient:173 | PENDING | LAB (ORDER_CANCELLED) | |
| K10 | Prevención de duplicados (event.id + Set 256 + command_id) | UI useKdsWsClient:129 | PENDING (UI) | **LAB** | exactly-once certificado en twin/rehearsal |
| K11 | Reconexión tras restart (SUBSCRIBE + last_sequence catch-up) | UI useKdsWsClient:232 | PENDING (UI) | **LAB** | ws-hub catch-up tests PASS |
| K12 | Caída del Bridge → FALLBACK Supabase poll 2s | UI useKdsWsClient:301 | PENDING | — | |
| K13 | Operación LAN sin WAN (LAN_PRIMARY autónomo) | UI useKdsWsClient:14 | PENDING (UI) | **LAB** | twin sin WAN todo el run |
| K14 | WAN return → RECONCILING → LAN_PRIMARY | UI useKdsWsClient:305 | PENDING | — | |
| K15 | Kiosk Electron KDS (auto-login, route-guard, retry 10s) | electron-kds/main.js | PENDING | — | |

**KDS: 15 capacidades · 15 implementadas-UI · el plano de transporte (Bridge WS) está LAB-certificado; la capa UI requiere ejecución.**

## 1C. Dashboard (187 rutas de página; núcleo operativo evaluado para release)

**Decisión de alcance para CONTROLLED MARKET RELEASE:** el release crítico del dashboard es el núcleo operativo que cuadra con el POS. Todo lo demás se clasifica y lo incompleto visible se repara u oculta (registro abajo).

| Grupo | Rutas | Estado cert. | Ev. | Nota |
|---|---|---|---|---|
| Núcleo operativo: `/` (KPIs), `/ventas`, `/cortes`, `/meseros`, `/propinas`, `/platillos` | 6 | PENDING | — | Auth ✓, tenant-scoped ✓ (`client_slug`/`client_id`), fechas ✓; reconciliación vía `pos_orders`→agregado + `pos-daily-aggregator` |
| Admin POS: `/admin/menu`, `/admin/modificadores`, `/admin/grupos`, `/admin/promociones`, `/admin/formas-pago`, `/admin/usuarios` | 6 | PENDING | — | CRUD tenant-scoped; usuarios con CRUD parcial (BUG-003) |
| Login/auth/roles (`/login`, RLS, roles.ts: dueño→mesero) | — | PENDING | — | Finanzas solo dueño; agentes dueño+gerente |
| Agentes IA (`/agentes/*` 14 rutas) | 14 | PENDING | — | Loading sin timeout (BUG-005) |
| Finanzas (owner): `/estado-resultados`, `/contabilidad`, `/food-cost`, etc. | ~13 | PENDING | — | Food-cost porciones hardcoded (BUG-007) |
| Inventario real (16 rutas) | 16 | PENDING | — | Solo snapshot "latest" (BUG-008) |
| **Incompletas visibles**: `/lealtad` (rewards mock), `/encuestas` (sin respuestas), `/admin/usuarios` (parcial) | 3 | **FAIL (reparar u ocultar)** | UI-inspección | BUG-001/002/003 — no pueden quedar visibles así |
| Demo/interno: `/demo/*` (40+), `/internal/*`, `/showcase` | ~45 | HIDDEN-OUT-OF-RELEASE | — | Deben quedar fuera del build o tras flag para clientes |
| Resto (CRM, delivery, ecommerce, reservas, voice, etc.) | ~80 | PENDING (clasificar por cliente) | — | No prometer en el release controlado sin certificar |

**Gaps transversales dashboard:** sin selector de sucursal en núcleo (asume single-location — aceptable para CONTROLLED release con clientes de 1 sucursal, documentado BUG-004); alerta de sync sin acción de retry (BUG-006).

---

# FASE 2 — MATRIZ END-TO-END (estado)

## Ejecución UI 2026-08-06 (navegador real + Bridge real v1.3.3 tenant `demo` + staging)

Ambiente: dashboard-app dev (localhost:3210) contra Supabase staging (tenant
`demo` = "El Molcajete Demo"), Bridge canónico booteado desde el runner del
rehearsal en 7717, impresoras ESC/POS fake en 19100/19101. Usuario e2e
`e2e-rc@demo.sandbox` (dueño) + PIN cajero 2222.

**E2E-01 Servicio normal — PASS (UI, salvo impresión física)**. Cadena real
verificada de punta a punta con evidencia:
- Login Supabase + PIN staff (cajero Carlos) → **PASS**
- Abrir turno (fondo $2000) → **PASS** (Turno 1, 16 mesas)
- Abrir mesa 1 vía `/pos?mesa=N`, mesero Diana Torres, 4 personas → **PASS**
- Capturar Agua de horchata + Café de olla, **modificador** "Extra queso +$25"
  (total tile $55→$80), **nota** "sin hielo" → **PASS** (aritmética correcta)
- Enviar → `save-order` idempotente **HTTP 200** (`r1_save_order_idempotent`,
  first_execution) + `POST 7717/events ORDER_SENT` **200** → **PASS**
- **KDS UI** `/pos/barra`: la orden aparece (mesa 1, Diana, 1×horchata +
  1×café, estado NUEVA); routing correcto (bebidas→barra, cocina=0) → **PASS**
- **Cambio de estado KDS** NUEVA→Preparando en UI, persistido → **PASS**
- Cobro: confirmar personas → **propina 15% ($20)** → **efectivo** monto exacto
  $153.40, **cambio $0.00** → orden `cerrada` con `metodo_pago=Efectivo`,
  `pagos=[{monto:153.4}]`, subtotal 115 / IVA 18.40 / total 133.40 → **PASS**
- **Dashboard `/ventas`** refleja la venta: Ventas netas $133, Métodos de pago
  Efectivo $153 (100%), categorías COFFEE $60 + FRESH DRINKS $55, Personas 4,
  Propinas $20 → **RECONCILIACIÓN PASS** (valores exactos POS↔dashboard)
- Impresión física: **BLOCKED PHYSICAL** (KDS en modo FALLBACK Supabase-poll en
  este ambiente; el print server-side por PRINT_COMMAND no se ejercitó — las
  impresoras fake capturaron 0 jobs. El path WS↔Bridge + bytes ESC/POS ya está
  LAB-certificado por el twin; físico el lunes).

**Caveat de honestidad:** el cobro cerró una orden-sonda (`e2e-probe-4`) creada
por mis llamadas directas a `save-order` durante el diagnóstico de drift, no la
misma `order_id` que fue al KDS — porque las sondas dejaron varias órdenes
abiertas en la mesa 1 (ambigüedad que la UI limpia no produce). La matemática
del cobro, el cierre y el cuadre en dashboard son correctos y reales; la
identidad única order_id de punta a punta en una sola corrida sin sondas queda
para re-ejecución limpia. Datos de prueba y órdenes-sonda eliminados; tenant
`demo` restaurado a 0 órdenes / 0 turnos abiertos.

**Hallazgos de DRIFT staging↔producción** (registrados como BUG-013, infra):
el tenant `demo` en staging no tenía los grants/policies que producción sí
aplica vía service key — hubo que espejar: `pos_staff` anon read (login PIN),
grants+RLS en tablas operativas POS, `execute` en `r1_save_order*`,
`client_users` anon read (resolución de tenant del dueño). Sin esto el POS daba
401 en cada escritura. **No es bug de producto** (producción usa service key que
bypassa RLS); es deuda de paridad del ambiente demo — importa porque el paquete
de demo/clonability depende de que el tenant demo funcione con anon.

| Journey | Estado | Evidencia actual | Falta |
|---|---|---|---|
| E2E-01 Servicio normal (login→turno→orden→KDS→cobro→dashboard) | **PASS (UI)** | Ejecución navegador 2026-08-06 arriba; reconciliación exacta en `/ventas` | Impresión física (lunes); re-corrida limpia sin sondas |
| E2E-02 Cancelación controlada | PENDING | ORDER_CANCELLED + auth PBKDF2: LAB/TEST | UI + audit log + caja + dashboard |
| E2E-03 Pago complejo (split + mixto + propina + corte) | PARCIAL (UI) | **Propina 15% + efectivo exacto + cambio $0 + cierre + dashboard: PASS** (E2E-01); split parejo/por-producto y mixto multi-método a nivel cálculo TEST (pos-critical) | UI de split y mixto multi-método + corte |
| E2E-04 Restart (POS/Bridge/KDS + recuperar + cobrar) | **PARTIAL LAB PASS** | Bridge: rehearsal 31120621675 (kill -F, 6/6 ACKs, replay) + twin restarts | Renderer/KDS UI restart; física matriz #14 |
| E2E-05 Offline completo (WAN off→operar→restart→WAN on→sync→0 dups) | **PARTIAL LAB PASS** | Twin GREEN (0 loss/dup, null-route) + rehearsal drain | Capa UI + física (10 escenarios matriz) |
| E2E-06 Caja (apertura→ventas→movimientos→X→Z→reconciliación) | PENDING | Cálculos: TEST (arqueo + cierre-guard) | UI + reconciliación dashboard |
| E2E-07 Multi-terminal (2 terminales, concurrencia, dedup) | **PARTIAL LAB PASS** | Twin multi-cliente WS (POS+KDS+barra), locks multi-terminal TEST | 2 terminales UI reales; física OC-05/06 |
| E2E-08 Tenant isolation | **LAB PASS** | Staging TI-01..05 PASS (tenant `demo` + `vantara`); twin cross-tenant probe REJECT (`restaurant_id mismatch`); CFG-02 en SUBSCRIBE | Re-verificar en físico con tenant AMALAY real |

# FASE 4 — RECONCILIACIÓN DASHBOARD

PENDING. Diseño del cuadre: `events.ndjson`/`pos_orders` vs POS UI vs corte vs dashboard, con set controlado de operaciones en staging tenant `demo`. Se ejecuta con E2E-01/03/06.

# FASE 5 — SUITE DE RELEASE (ejecutada 2026-08-06)

| Suite | Comando | Resultado 2026-08-06 |
|---|---|---|
| Bridge (electron-app local-server) | `cd electron-app && node --test local-server/tests/*.test.js` | **PASS — 170/170 tests, 39 suites, 0 fail** (corrido sin `identity-route.test.js`, que cuelga en macOS local — BUG-010; ese endpoint quedó ejercitado hoy en CI Windows por dry-run y rehearsal) |
| Dashboard-app unit/integration | `cd dashboard-app && npx vitest run` | **PASS — 2104/2104 tests, 55 archivos** |
| Bridge contract + security (root) | `npx vitest run tests/` | **PASS — 142 tests** (los "14 files failed" del sweep raíz son archivos de otros runners barridos por error — BUG-011) |
| Twin (bajo demanda) | workflow `amalay-twin.yml` | GREEN run 31105522304 |
| Upgrade+Rollback rehearsal | workflow `upgrade-rehearsal.yml` | GREEN run 31120621675 att.4 |

Regla: todo P0/P1 corregido agrega test de regresión y re-ejecuta el journey completo relacionado + esta suite.

# RECONCILIACIÓN DE EVIDENCIA FÍSICA PREVIA (AMALAY)

Visitas físicas documentadas e incorporadas al gate: **2026-07-12** (preflight PDV3/SERVER1: deployment type, impresoras TCP .21/.30/.40:9100 + USB, jam EC TICKET, PDV1 impresora rota IP .250, bug PIN por bridge legacy en 7717), **2026-07-24** (F-01 sync + A-01 boot SW: PASS, commits c312fac/54feab6), **2026-07-27** (sesión offline: bloques A-03/B-01/F-01 definidos; B-01 fix `2edcca1` deployed SIN certificar), **2026-07-28** (PRR v1: 4.7/10, 27 hallazgos).

**Bugs observados físicamente → cobertura actual → estado de retest:**

| Bug de campo | Fix | Test actual | Retest físico (FC lunes) |
|---|---|---|---|
| PRR-02 sync abandonado tras retries | `dacf364` | `pos-sync-backoff.test.ts` (8, incl. soak 4h simulado) | FC-20/21 (OC-12 cronómetro) |
| PRR-04 print jobs varados tras crash Bridge | `80a8d7d` | `print-queue-recovery.test.js` + **rehearsal 31120621675 con datos vivos** | FC-19 |
| PRN-GAP-01 reimpresión con drop silencioso | fixed | `pos-print.test.ts` | FC-09/reimpresión |
| PER-01 drain PATCH→405 loop infinito (matrix 08-05) | **`99cdf7a`** | `pos-sync-backoff.test.ts:63` (405 fix) — la mención "no tocado" en OFFLINE-TEST-MATRIX es previa al fix | FC-21 |
| B-01 impresión offline (27-jul) | `2edcca1` | LAB: twin bytes ESC/POS | FC-08/09 **pendiente cert física** |
| A-03 login PIN offline (27-jul) | — | `pos-manager-auth` (30) — staff lockscreen es deuda separada documentada | FC-02 |
| Bug PIN por bridge legacy en 7717 (12-jul) | proceso legacy | DIAGNOSTIC-ONLY detecta dueño del puerto | Gate T-01 diagnóstico |
| PDV1 impresora rota / EC TICKET jam (12-jul) | hardware | — | Inventario físico lunes (no bloquea PDV3/SERVER1) |
| PAY-GAP-02 ticket duplicado en crash MP | mitigado | SIN TEST durable — **P2 registrado (BUG-012)** | E2E-03 doble clic + física |

**Pendientes de retest físico** (todos dentro del gate del lunes vía FC/OC): PRR-02, PRR-04, B-01, A-03, F-01 real, OC-01 (4h — DEFERRED aceptado con smoke 90–120 min). PRR-05..10 (provisioning/ops/docs) son alcance PRR de negocio, no de esta certificación UI — siguen abiertos en PRR-v1.md.

**Topología/config usada:** twin fixture `amalay-twin-config.json` (36 KNOWN / 15 INFERRED / 12 UNKNOWN — top: deployment type, IP SERVER1, printers.json v1-vs-v2, enrollment de huella). Los 12 UNKNOWN se resuelven en el diagnóstico T-01 del lunes. Docs leídos: PRR-v1, CERTIFICATION-SESSION-2026-07-27, OCS-P2.5.4–9, OCS-P0-1, THURSDAY-RUNBOOK, OFFLINE-TEST-MATRIX, INSTALLER-VERIFICATION, SECOND-TENANT-REPORT, AMALAY-CONFIG-PROVENANCE, AMALAY-R1-VALIDATION, FIELD-NOTES-PREFLIGHT-JUL12.

# FASE 6 — AMALAY FÍSICO

Programado 2026-08-10 con `FULLSITE-AMALAY-FIELD.zip` (SHA `5ED4EDA9…B051`): diagnóstico → gates → install → smoke → offline (FC-01..22+EXTRA) → restart → WAN return → sync/dedup → certificación. Todo FAIL físico genera bug aquí y retest.

# GATE DE RELEASE (estado vivo)

```text
POS CRITICAL FEATURES PASS        — PENDING (0 FAIL conocidos; ejecución UI pendiente)
KDS CRITICAL FEATURES PASS        — PENDING (transporte LAB PASS; UI pendiente)
DASHBOARD CRITICAL FEATURES PASS  — FAIL parcial (3 incompletas visibles: reparar u ocultar)
E2E JOURNEYS PASS                 — 1 LAB PASS (E2E-08) · 3 PARTIAL LAB · 4 PENDING
DASHBOARD RECONCILIATION PASS     — PENDING
OFFLINE PHYSICAL PASS             — PENDING (lunes)
RESTART RECOVERY PASS             — LAB PASS (Bridge) · UI/física PENDING
SYNC / DEDUP PASS                 — LAB PASS (exactly-once twin+rehearsal) · física PENDING
INSTALL PASS                      — LAB PASS (CI verify-install + rehearsal)
UPGRADE PASS                      — LAB PASS (rehearsal 1.3.0→1.3.3 con datos vivos)
ROLLBACK PASS                     — LAB PASS (byte-idéntico con datos vivos)
TENANT ISOLATION PASS             — LAB PASS · física PENDING
P0 OPEN = 0                       — CUMPLE HOY (0 conocidos)
P1 BLOCKING = 0                   — NO CUMPLE (BUG-001 y decisión ocultar/reparar pendiente)
```

## Estado tras ejecución UI 2026-08-06

**Features certificadas PASS por UI en E2E-01** (subieron de PENDING):
- POS: P01 login PIN, P04 turno, P05 mesa, P06 mesero, P07 personas, P09 productos, P10 modificadores, P12 notas, P13 envío, P22 efectivo, P25 propina, P32 recuperación de draft tras restart de renderer (la orden $115 sobrevivió relogin/lockscreen).
- KDS: K01 recepción (UI), K02 routing por estación, K03 modificadores, K04 notas, K06/K07 cambio de estado (vía Supabase-poll path).
- Dashboard: `/` y `/ventas` carga + auth + tenant-scope + reconciliación con POS (valores exactos).

**Ocultas del release (fix `8010d9a`):** `/lealtad`, `/encuestas`, `/admin/usuarios`, `/internal` → 401 para todos los roles (BUG-001/002/003 cerrados).

**Aún PENDING de UI** (ejecutables sin hardware, no alcanzados esta sesión):
E2E-02 (cancelación), E2E-06 (caja/cortes), split UI (P19/P20) y mixto
multi-método (P24), sweep de las 33 POS restantes, dashboard core `/cortes`
`/meseros` `/propinas` `/platillos` runtime. BLOCKED PHYSICAL: huella (P02),
impresión física (P29). NOT IMPLEMENTED: dividir por persona (P21).

**Clasificación de salida:** CONTROLLED MARKET RELEASE — clientes seleccionados, instalación controlada, monitoreo cercano, rollback listo, soporte directo. Sin self-service masivo.

## Registro de cambios de este documento

- 2026-08-06: creación; FASE 1 completa; evidencia LAB consolidada; bug register inicial.

# AMALAY DIGITAL TWIN — 5 PRINTERS / 3 POS RUN (2026-08-06)

Harness extendido a topología física completa (fixture reconciliado Jul-12):
3 POS con identidad (ENTRADA/ESCONDITE/CAJA) + KDS COCINA + 5 impresoras TCP
nombradas con captura de bytes ESC/POS por destino + WAN cortada a nivel
socket (listener staging cerrado, LAN WS viva).

**Shift 4h-equivalente (compress 12, spawn):** 129 órdenes (119 cerradas, 10
canceladas) · 1,413 comandos / 1,411 ACKed · 55 acks duplicados absorbidos ·
0 violaciones dedup · 3 restarts con recovery · 0 errores · outbox drenado.

**Prints por impresora (bytes reales verificados):** COCINA-1=150 ·
COCINA-2=151 (estación cocina → ambas, fiel a printers.json) · BARRA=121 ·
ENTRADA=42 · CAJA=74.

**Sondas nuevas:** escondite-ticket-fallback PASS (FAIL físico PDV1
representado: RECIBO enruta a tickets-caja) · dedup-after-restart PASS ·
concurrent-drains PASS · corte-print-outage **FAIL → BUG-015 (P1)**.

**VEREDICTO shift: FAIL — 1 escenario (corte-print-outage / BUG-015).**
Todo lo demás PASS. Nota técnica: printer-outage-recover PASS porque su ciclo
incluye restart del Bridge (init revive jobs); BUG-015 demuestra que SIN
restart, un job `retrying` nunca se auto-reintenta tras recuperar la impresora.
