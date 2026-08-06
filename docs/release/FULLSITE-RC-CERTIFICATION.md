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

| Journey | Estado | Evidencia actual | Falta |
|---|---|---|---|
| E2E-01 Servicio normal (login→turno→orden→KDS→print→cobro→dashboard) | PENDING | Segmento Bridge↔KDS: LAB (twin 127 órdenes + prints byte-verificados) | Ejecución UI completa + cuadre dashboard |
| E2E-02 Cancelación controlada | PENDING | ORDER_CANCELLED + auth PBKDF2: LAB/TEST | UI + audit log + caja + dashboard |
| E2E-03 Pago complejo (split + mixto + propina + corte) | PENDING | Cálculos: TEST (pos-critical, arqueo) | UI + ticket + corte + dashboard |
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

**Clasificación de salida:** CONTROLLED MARKET RELEASE — clientes seleccionados, instalación controlada, monitoreo cercano, rollback listo, soporte directo. Sin self-service masivo.

## Registro de cambios de este documento

- 2026-08-06: creación; FASE 1 completa; evidencia LAB consolidada; bug register inicial.
