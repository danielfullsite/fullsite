# OPEN ITEMS — índice único de lo abierto

> **Fuente única de verdad de lo pendiente.** Consolida los backlogs que estaban dispersos y no
> coincidían: `BUGS.md`, los 27 hallazgos PRR, los P0 de la Biblia Wansoft, la auditoría
> `audit/AUDITORIA-FULL-2026-08-19.md` y la `audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md`.
> Organizado por las **olas** de `../PLAN-AHORA.md`. Estado: ✅ hecho · 🔶 grace/parcial · ⬜ abierto.
> Última actualización: 2026-08-19.

Regla: cuando cierres un item, márcalo aquí. Cuando aparezca uno nuevo, entra aquí — no en un doc suelto.

---

## OLA 0 — AMALAY 100% + no perder dinero (esta semana)

| ID | Item | Sev | Estado | Fuente |
|---|---|---|---|---|
| OP-01 | Skimming: `r1_save_order` guarda total/descuento del cliente | 🔴 CRÍTICO | 🔶 grace (log-only `skimming_suspect`). **Fase 2/rechazo sin codificar** | AUDITORIA §1; `save-order/route.ts`, `004_functions.sql:822` |
| OP-02 | Cancelar item sin enforcement server-side | 🔴 CRÍTICO | 🔶 grace (`CANCEL_APPROVAL_STRICT` off) | `cancel-item/route.ts:64` |
| OP-03 | Reabrir cuenta pagada sin aprobación | 🔴 CRÍTICO | 🔶 grace (`POS_APPROVAL_STRICT` off) | `reopen-order/route.ts`, `manager-approval.ts` |
| OP-04 | KDS fan-out `ORDER_SENT` fire-and-forget (pierde comanda offline) | 🔴 CRÍTICO | ✅ desplegado (retry `28b05cae`) | AUDITORIA §1 |
| OP-05 | `render()` del KDS sin try/catch (cocina en blanco) | 🔴 CRÍTICO | ✅ desplegado | `kds-ui.html` |
| OP-06 | Offline de Entrada NUNCA probado físicamente | 🟠 P0 | ⬜ prueba miércoles | PLAN-JUEVES §4 |
| OP-07 | Escondite no imprime (config BOM) | 🟠 P0 | ⬜ config limpio listo; falta acceso | PLAN-JUEVES "Diagnóstico Escondite" |
| OP-08 | Cold-boot sin internet = pantalla negra | 🟠 P0 | ⬜ fix diseñado (servir shell por Pedro) | OFFLINE-LAN-FIELD-PROVEN:173 |
| OP-09 | OFF-01 impresoras: `station_id` texto libre, falla silenciosa | 🟠 P0 | ⬜ validar cobertura al arranque | PLAN-JUEVES §8 |
| OP-10 | Doble cobro posible (`handlePayment` sin guard `updated_at`) | 🟠 P0 | ⬜ | MANUAL-OPERATIVO:235 (DT-1) |
| OP-11 | Documentar flags `*_STRICT` en `.env.example`+runbook | 🟢 P2 | ✅ runbook + `.env.example` | FRAUD-ENFORCEMENT-FLAGS.md |

---

## OLA 1 — Reconverger la verdad

| ID | Item | Sev | Estado | Fuente |
|---|---|---|---|---|
| OP-12 | Mergear `feat/pos-ui-kit` → `main` (223 commits: cáscara, provisioning) | 🟠 P0 | ⬜ sesión dedicada | HANDOFF-STATE PASO B |
| OP-13 | Un solo registro de bugs/P0 | 🟠 P1 | ✅ **este doc** | — |
| OP-14 | Corregir doc peligroso (KDS-por-https) + banners a docs viejos | 🟠 P1 | ✅ hecho (`fbedcc9d`) | AUDITORIA-FULL §docs |
| OP-15 | Cerrar el pricing en UN esquema + recalcular unit economics | 🟠 P1 | ⬜ decisión de Daniel | AUDITORIA-FULL §6 |
| OP-16 | Refrescar `README.md` (oro reciente) | 🟢 P2 | ✅ hecho | — |

---

## OLA 2 — Blindar para producción / Cliente #2

| ID | Item | Sev | Estado | Fuente |
|---|---|---|---|---|
| OP-17 | Local server LAN sin auth (`0.0.0.0:7717`) | 🟠 P0 | ⬜ token por terminal (aditivo) | AUDITORIA §2; `index.js:185+` |
| OP-18 | Sesión robable: cookie `fs-at` sin httpOnly + refresh token en localStorage | 🟠 P0 | ⬜ (SEC-2 / P0-D) | SECURITY §1 |
| OP-19 | 2FA super-admin `daniel@fullsite.mx` (0 MFA) | 🟠 P1 | ⬜ (SEC-1) | SECURITY §2 |
| OP-20 | OCM Fase 3 (IA consume vistas por-tenant; fuga cross-tenant) | 🟠 P0 | ⬜ vistas en prod, falta refactor | OCM-REVIEW-2026-08-19 |
| OP-21 | Inventario: facturas-proveedor + recepción-factura al `recordMovement()` | 🟠 P1 | 🔶 **facturas-proveedor ✅ (`f1583bb5`, invoice_entry)**; recepción-factura ⬜ | AGENTS.md; PLAN-JUEVES §7 |
| OP-22 | Editor de ticket POS-side (riesgo fiscal: RFC/serie → CFDI-QR roto) | 🟠 P1 | ⬜ | FULLSITE-VS-WANSOFT-BIBLE §4 |
| OP-23 | Wizard self-serve + provisioning de terminales por código | 🟠 P1 | ⬜ | CLIENT-ONBOARDING-REQUIREMENTS |
| OP-24 | Impuestos (IVA/IEPS) hardcodeados → por-tenant | 🟠 P1 | ⬜ | GO-LIVE.md |
| OP-25 | Ejecutar PAE (Café Nómada) + gate Golden Skeleton | 🟠 P1 | ⬜ | P1-GOLDEN-SKELETON-REGISTRY |
| OP-26 | `itemKey` del KDS por índice (marca listo el equivocado) | 🟢 P1 | ⬜ verificar migración a `id` | PLAN-JUEVES §8 |

---

## OLA 3 — IA que mueve la aguja

| ID | Item | Sev | Estado | Fuente |
|---|---|---|---|---|
| OP-27 | Poblar `agent_events` (estimated_value + outcome) — cerrar bucle de valor | 🟠 P1 | ⬜ hoy no se escribe | IA §4 |
| OP-28 | `get_monitoring_context()` + gate de severidad en Telegram (fixea 22/24) | 🟠 P1 | ⬜ | AGENT-CERT-REGISTRY |
| OP-29 | Fraude en tiempo real sobre event store (no semanal) | 🟢 P2 | ⬜ | IA §4 |
| OP-30 | Auto-completar recetas (71% con 1 ingrediente → food cost ficticio) | 🟢 P2 | ⬜ | AI-OPPORTUNITIES §11 |
| OP-31 | `pos_daily_aggregator.py` BLOCKED (sin señal de cierre de día) | 🟢 P2 | ⬜ | AGENT-CERT-REGISTRY |
| OP-32 | 0 agentes certificados — certificar la flota existente | 🟢 P2 | ⬜ | AGENT-CERT-REGISTRY |

---

## OLA 4 — Negocio (no bloquea lo técnico)

| ID | Item | Estado | Fuente |
|---|---|---|---|
| OP-33 | Cliente #2 arm's-length | ⬜ demo jueves = paso 1 | FULLSITE-VALUATION-MEMO |
| OP-34 | Cofundador comercial/COO (Founder Commitment) | ⬜ | COFOUNDERS.md |
| OP-35 | Alinear valuación ($2.5M vs $5M) | ⬜ decisión | deck vs IC memo |

---

## Legacy `BUGS.md` — sin descripción (heredado, PRR-20)

Estos venían de `state/BUGS.md` marcados abiertos pero **sin documentar** — parte de la deuda. Documentar o cerrar y mover arriba.

- **P1:** POS-07, POS-09, POS-11, DASH-09, DASH-12, DASH-13, DASH-20
- **P2:** POS-14, POS-15, POS-17, DASH-16, DASH-21
- **P3:** POS-10, DASH-18
- **CLOSED (verificar que no regresionaron):** POS-02 (phantom merge), POS-03 (silent print), POS-04 (boot offline)

## Nuevos — del pipeline de código 2026-08-20 (`docs/PIPELINE-CODIGO.md`)

Hallados por las 3 investigaciones; no estaban rastreados. Verificar en campo los 🔴 (impacto dinero) antes de accionar.

| ID | Item | Sev | Estado | Fuente |
|---|---|---|---|---|
| OP-36 | Bug "laboratorio": POS de AMALAY aterriza en tenant `lab-resto` por impersonación residual (`fullsite_actas`) | 🟠 P1 | ⬜ fix inmediato=limpiar localStorage; fix código=resolver tenant + limpiar act-as | PIPELINE §0; `AuthContext.tsx:101` |
| OP-37 | `merge-orders` recalcular totales server-side (vector skimming) | 🔴 P0 | ⬜ **flagged: money-math, verificar con merge real (no a ciegas)** | `merge-orders/route.ts:40` TODO P0-F |
| OP-38 | Credenciales MP Point / Clip → `credentials_vault` (hoy client-supplied) | 🔴 P0 | ⬜ | `mp-point/route.ts:8`, `clip-pinpad/route.ts:4` (P0-H/I) |
| OP-39 | Enforcement server-side de permisos (cancelar=admin, PERM-07) | 🟠 P0 | ⬜ confirmar `/api/pos/*` valida rol, no solo registra | roles.ts; auditoría fraude |
| OP-40 | Constructor de mapa de mesas: mergear a main + link nav + **unificar coordenadas** (hoy plano solo renderiza AMALAY hardcode) | 🟠 P1 | 🔶 editor funciona en rama; loop sin cerrar | `plano-editor/page.tsx`, `mesas/page.tsx:159` |
| OP-41 | Roles/jerarquía: unificar 3 sistemas + reconectar `/admin/usuarios` (hoy cosmético, escribe blob) + puente PIN + tier `platform_admin` | 🟠 P1 | 🔶 motor `roles.ts` ok; `/admin/usuarios` no crea usuarios reales | roles.ts; usuarios/page.tsx |
| OP-42 | Alta de mesero en ~30s (rotación): wizard 1 paso sobre motor existente | 🟢 P2 | ⬜ | pos-pin.ts, roles.ts |
| OP-43 | Alertas de fraude en tiempo real (event-driven, no cron viernes) | 🟠 P1 | ⬜ net-new (única brecha de arquitectura) | antifraud_agent.py |
| OP-44 | CRM recovery: cablear WhatsApp Business API + bulk + tracking (hoy `wa.me` manual) | 🟢 P2 | 🔶 | whatsapp-crm.ts |
| OP-45 | DASH-03 agente lee factura→entrada · DASH-06 transferencias inter-sucursal | 🟢 P2 | ⬜ | entradas-factura; inventory.ts |
| OP-46 | pgvector / RAG para IA (idea Juan Carlos) | 🟢 P2 | ⬜ gap AI-native | — |
| OP-47 | Split de cuenta por N personas (>3) + división pareja | 🟢 P2 | 🔶 parcial (C1/C2/C3) | pos/page.tsx |
| OP-48 | Setear `FACTURAMA_USER/PASSWORD/EXPEDITION_PLACE` en prod | 🟢 P2 | ⬜ | facturama.ts |
| OP-49 | Higiene: 6 tenants de prueba mezclados en `clients` + 2 valores data_source (`supabase` vs `fullsite`) | 🟢 P3 | ⬜ | clients (MCP) |

## Certificación (bloquea "milestone POS V2" → Golden Skeleton)

- **PRR-v1:** 27 hallazgos OPEN (10 P0), score 4.7/10 — `certifications/PRR-v1.md`
- **P0-4 Fase 5 física** (checklist OCS-P2.5.9 sin ejecutar) — bloquea todo el track downstream
- **P0-3 CSD — PAC = Facturama** (no Facturapi) — blocker externo SAT (Andy tramita CSD)
