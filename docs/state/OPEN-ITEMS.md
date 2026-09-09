# OPEN ITEMS — índice único de lo abierto

> **Fuente única de verdad de lo pendiente.** Consolida los backlogs que estaban dispersos y no
> coincidían: `BUGS.md`, los 27 hallazgos PRR, los P0 de la Biblia Wansoft, la auditoría
> `audit/AUDITORIA-FULL-2026-08-19.md` y la `audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md`.
> Organizado por las **olas** de `../PLAN-AHORA.md`. Estado: ✅ hecho · 🔶 grace/parcial · ⬜ abierto.
> Última actualización: 2026-09-08 (noche) para el candidato `lab/pin-real-desde-pantalla`; las olas de agosto conservan su estado histórico salvo actualización explícita.
>
> **Ojo con la frescura de este documento.** Al revisarlo el 2026-09-08 con Daniel en el
> restaurante, DOS de sus 🔴 P0 estaban desactualizados a favor nuestro: OP-10 ya tenía
> cuatro capas de protección y OP-50 ya había cerrado la escalada de privilegio. Un
> pendiente que se cierra sin actualizar aquí es peor que uno abierto: hace que se gaste la
> noche persiguiendo algo resuelto mientras lo que sí falta sigue esperando. Al cerrar
> algo, ciérralo AQUÍ el mismo día y con la prueba que lo sostiene.

Regla: cuando cierres un item, márcalo aquí. Cuando aparezca uno nuevo, entra aquí — no en un doc suelto.

## Candidato de cierre: revisión del 8 de septiembre

Fuente y aceptación de cada H: [Huecos actuales y condiciones de cierre](../audit/FULLSITE-HUECOS-ACTUALES-2026-09-08.md). No instalado en AMALAY. Estos estados distinguen código pendiente de falta de prueba; no vuelven a declarar abiertos los defectos ya corregidos en el candidato. El backlog heredado inferior no es una auditoría nueva de producción.

| ID | Pendiente vigente del candidato | Estado |
|---|---|---|
| H01 | Corte y reportes omiten el nuevo modelo de pago separado | ⬜ defecto estático |
| H02 | Ajustes de consumo después de preparar cuenta financiera | ⬜ función pendiente |
| H03 | Tarjeta, pago mixto y propinas por Caja | ⬜ función pendiente |
| H04 | Transferir consumo, unir cuentas, cancelación individual y otras acciones de salón | ⬜ funciones pendientes |
| H05 | Recibo, precuenta, cajón y resolución autorizada de impresión incierta | ⬜ funciones y hardware |
| H06 | Retiros, depósitos y X/Z completo | ⬜ función pendiente |
| H07 | Entrada de delivery y otros canales al escritor Caja | ⬜ integración pendiente |
| H08 | Inventario transaccional, recetas y depleción de ventas nuevas | ⬜ defecto e integración |
| H09 | Permisos y campos inmutables en APIs cloud/proxies | ⬜ validación y enforcement |
| H10 | Aislamiento y recuperación de MP/Clip/CFDI/delivery | ⬜ implementación y sandbox |
| H11 | Alta reanudable, activación completa y credenciales iniciales | ⬜ defectos estáticos |
| H12 | Sucursales, presencia de empleado y huella LAN | ⬜ integración y aceptación |
| H13 | Conciliación, periodo completo y procedencia de datos de dashboard/IA | ⬜ integración y aceptación |
| H14 | Migraciones reales y transición coordinada de AMALAY | 🔶 PostgreSQL local probado; destino pendiente |
| H15 | Publicación real, Windows/hardware y restauración | 🔶 empaquetado sintético probado; campo pendiente |
| H16 | Carga, diagnóstico accionable y actualización con pendientes | ⬜ aceptación y funciones de soporte |

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
| OP-10 | Doble cobro posible (`handlePayment` sin guard `updated_at`) | 🟠 P0 | ✅ **CERRADO — el item estaba viejo** (verificado 2026-09-08). Hay CUATRO capas, no cero: `operationLock` (doble clic, `pos/page.tsx:3751`) · `checkOrderConflict('payment')` (:3250, aborta si otra terminal cerró o modificó — comprobación de cliente, con ventana entre leer y escribir) · `expected_revision` OCC server-side (`save-order/route.ts:173`) · `save_operation_id` + **PRIMARY KEY (client_id, order_id, save_operation_id)** en `pos_save_operations`, verificado contra la base. La capa 4 es la que cierra el caso: dos terminales cobrando offline reproducen contra esa llave y la segunda no puede insertar. Anclado por `__tests__/no-se-cobra-dos-veces.test.ts` (12/12) | MANUAL-OPERATIVO:235 (DT-1) |
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
| OP-21 | Inventario: facturas-proveedor + recepción-factura al `recordMovement()` | 🟠 P1 | ✅ **HECHO** — ambas a invoice_entry (`f1583bb5`, `eb6ec359`) | AGENTS.md |
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
| OP-36 | "Laboratorio" NO era bug de código — el act-as de platform-admin se quedaba pegado en `lab-resto`. Se resuelve entrando al tenant correcto (Tenants→Entrar AMALAY). Mejora real = **UX de act-as** (letrero "viendo como X" + switch/salir visible) para no quedar pegado. Nota: quitar `fullsite_actas` a un platform-admin da 403 (pierde el camino RLS autorizado). | 🟢 P2 | 🔶 operativo resuelto; falta UX | `AuthContext.tsx:101`, `/platform/tenants` |
| OP-37 | `merge-orders` recalcular totales server-side (vector skimming) | 🔴 P0 | ✅ **HECHO** (`eb6ec359`) — total server-side (suma 2 órdenes BD) + audita skimming + fallback seguro. Falta probar un merge real en campo | `merge-orders/route.ts` |
| OP-38 | Credenciales MP Point / Clip → `credentials_vault` (hoy client-supplied) | 🔴 P0 | ⬜ | `mp-point/route.ts:8`, `clip-pinpad/route.ts:4` (P0-H/I) |
| OP-39 | Enforcement server-side de permisos (cancelar=admin, PERM-07) | 🟠 P0 | 🔶 **PARCIAL** (`eec847ec`) — `checkPosRole()` en api-auth.ts; `adjust-market`+`recipe-sync` exigen gerente+ (grace: audita `below_role:*` a `pos_audit_log`, flip a 403 con `MARKET_ROLE_STRICT='true'`); adjust-market actor server-verificado. cancel-item/reopen-order ya tenían gate. `deduct-market` NO se gatea (camino de venta). **Barrido completo de `/api/pos/*` hecho 2026-08-20** — resto sin-rol son camino de venta/operacionales (add-items, save-order, transfer-item, time-clock) → correcto. El enforcement real vive en el `db` proxy → **ver OP-50**. **FIX review (`2185cb92`): `dueño` agregado a `POS_ROLE_LVL` (faltaba → owner tratado como nivel 0 → falsos below_role/fraude en grace, 403 en strict).** Ya es strict-safe | `api-auth.ts`, `adjust-market`, `recipe-sync`; auditoría fraude |
| OP-40 | Constructor de mapa de mesas: mergear a main + link nav + **unificar coordenadas** | 🟢 P1 | ✅ **HECHO** — #1 merge (`plano-editor` en main); #3 coords (`75bfdde7`) `/pos/mesas`+`/pos/plano` leen `x_pct/y_pct/shape` de `pos_mesas` con fallback; #2 (`dc9bab8b`) botón "Editar mapa" gerente+ en `/pos/mesas` + toggle Plano abierto a todo tenant con mapa. **FIX review2 (`7c67c2da`): coerción `Number()` — PostgREST devuelve `numeric` como string, el `typeof===number` hacía el planograma de BD código muerto (ni AMALAY lo veía). Ahora sí lee coords de BD.** Falta probar en campo. Cosmético pend: `FLOOR_WALLS/FLOOR_LABELS` hardcode AMALAY (solo tenants != amalay) | `plano-editor`, `mesas/page.tsx`, `plano/page.tsx` |
| OP-41 | Roles/jerarquía: unificar 3 sistemas + reconectar `/admin/usuarios` + puente PIN + tier `platform_admin` | 🟢 P1 | ✅ **RESUELTO** — mapeo 2026-08-20 mostró que A2 (`a117121f`) ya cerró el 80%: los 3 sistemas conversan (`roles.ts DB_ROLE_MAP` + AuthContext + withPOSAuth); puente PIN vivo (`pos_staff.pin`→`/api/pos/pin`→shift token + throttle); `platform_admin` real (`platform_admins`+`is_platform_admin()`+act-as); `/equipo` (A2) crea usuarios reales E2E (auth.users+client_users+pos_staff+PIN) y YA está en el sidebar gateado a dueño+gerente. `/admin/usuarios` (teatro/blob) retirado → redirect a `/equipo` (`189207d2`). Deuda menor (no bloquea): vocabulario fino `barra`/`cocina` sin mapa dashboard (POS-only, caen a nivel 0 = ok) y `member` legacy = **basura de prueba** (2 `test-isolation-*@fullsite-test.invalid` en client_users de amalay → limpiar, ver OP-49) | `roles.ts`, `equipo/page.tsx`, `api/owner/*` |
| OP-42 | Alta de mesero en ~30s (rotación): wizard 1 paso sobre motor existente | 🟢 P2 | ✅ **HECHO** (`21cb7b33`) — `/api/owner/staff` autogenera PIN 4-díg único si no viene; `/equipo` deja PIN opcional + modal que muestra el PIN una vez (copiar/anotar). Flujo: nombre→Guardar→PIN. **FIX review (`2185cb92`): `pinTaken` ya no filtra `active` (coincide con índice único `(pin,client_id)`) → PIN de mesero desactivado ya no da 502 opaco; INSERT 409 → mensaje legible.** Falta: probar en campo | `api/owner/staff/route.ts`, `equipo/page.tsx` |
| OP-43 | Alertas de fraude en tiempo real (event-driven, no cron viernes) | 🟢 P1 | ✅ **HECHO** (`4ba69b81`) — `fraud_watcher.py` + `fraud-watcher.yml` (cron cada 30 min horario servicio) vigila `pos_audit_log` (skimming_suspect + below_role de OP-39) y alerta el mismo día; batch semanal se queda con patrones estadísticos. **Modo SOMBRA** (`FRAUD_WATCHER_ALERT!=true`): registra en `agent_events`, NO manda Telegram hasta validar con tráfico real. Plomería probada (dispatch OK, agent_runs registrado). Gap conocido (BAJO, review): watermark = created_at del run, no max(created_at) de eventos → un evento en la ventana fetch→log_run (~ms) no dispara same-day; el batch semanal es backstop. Falta: prender alertas (repo var `FRAUD_WATCHER_ALERT=true`) tras 1er día real (lunes) sin falsos positivos | `fraud_watcher.py`, `fraud-watcher.yml` |
| OP-44 | CRM recovery: WhatsApp bulk + tracking | 🟢 P2 | 🔶 **CORTE A HECHO** (`14c4f978`) — `/crm` botón "Recuperación": filtra inactivos c/tel (30/60/90d) por valor, arma mensaje con `whatsapp-crm.ts` (antes huérfana) y abre `wa.me` pre-llenado; tracking = tag `contactado` + nota fechada (sin tabla nueva). Envío **manual** (1 clic/cliente). **Bloqueado externo:** el envío automático en lote requiere **WhatsApp Business API (Meta)** — pendiente auth (CLAUDE.md L231, categoría Uber/Rappi). Cuando Meta apruebe: cambiar el botón wa.me→API, UI+tracking se quedan. **FIX review2 (`7c67c2da`): (1) el CRM usaba anon key → RLS bloqueaba lectura/escritura de `pos_customers` (bug PREEXISTENTE, no solo OP-44); ahora `authHdrs()` con `getAuthToken()` → el CRM entero funciona; (2) `wa.me` normaliza teléfono por longitud (números lada-520 ya no se corrompen)+`isWhatsAppablePhone`; (3) `markContacted` optimista con filtro tenant** | `whatsapp-crm.ts`, `crm/page.tsx`, `data.ts` |
| OP-45 | DASH-03 agente lee factura→entrada · DASH-06 transferencias inter-sucursal | 🟢 P2 | ⬜ | entradas-factura; inventory.ts |
| OP-46 | pgvector / RAG para IA (idea Juan Carlos) | 🟢 P2 | ⬜ gap AI-native | — |
| OP-47 | Split de cuenta por N personas (>3) + división pareja | 🟢 P2 | 🔶 parcial (C1/C2/C3) | pos/page.tsx |
| OP-48 | Setear `FACTURAMA_USER/PASSWORD/EXPEDITION_PLACE` en prod | 🟢 P2 | ⬜ | facturama.ts |
| OP-49 | Higiene: 6 tenants de prueba mezclados en `clients` + 2 valores data_source (`supabase` vs `fullsite`) | 🟢 P3 | ⬜ | clients (MCP) |
| OP-50 | **`db` proxy = superficie de escritura real del POS; solo gatea 2 tablas** (`pos_cash_movements`, `pos_cierres`). Un shift token de **mesero** puede `PATCH pos_menu_items` (precio), `PATCH/DELETE pos_orders` (skimming directo del total), `PATCH pos_market_stock`/`pos_inventory_movements` (bypassa el gate de OP-39). Los gates por-ruta son bypasseables aquí. **NO tocar antes del jueves** (línea de vida del Offline Shell, path congelado). Fix medido post-instalación: (a) grace-audit de PATCH/DELETE sensibles sin bloquear, (b) expandir `MANAGER_ONLY` por tabla/columna con prueba de campo (ojo: `pos_orders` lo escriben meseros — gatear por columna `total`/DELETE, no blanket) | 🔴 P0 | 🔶 **CERRADO lo de dinero 2026-09-08**; el resto del item estaba viejo. Al verificarlo, el proxy ya gateaba 5 tablas (no 2), con lista blanca y el PIN redactado de la respuesta: la escalada de privilegio estaba cerrada. Faltaba lo de dinero, y se cerró POR COLUMNA en los DOS proxies (`CAMPOS_SOLO_DE_GERENTE` en `lib/pos-db-policy.ts`): total, subtotal, iva, descuento, propina, saldo, pagos, payment_status, status, order_revision, turno_id, client_id. Más borrado de orden solo-gerente (una orden se cancela, no se borra) y `pos_menu_items` solo-gerente. Por columna y no por tabla porque los meseros escriben `pos_orders` todo el día — verificado que sus únicas escrituras por ahí son `kds_item_status` y `mesero`. Anclado por `__tests__/proxy-no-deja-tocar-el-dinero.test.ts` (21/21, 20 fallan contra el código anterior) | `api/pos/db/route.ts`, `db/[...path]/route.ts` |

| OP-51 | **Ventana de día sin zona horaria — barrido pendiente.** El patrón `created_at=gte.${fecha}T00:00:00&lte.${fecha}T23:59:59` sale de la ventana equivocada: Postgres corre en UTC (verificado, `current_setting('TimeZone')`), así que pedir un día trae **del día anterior a las 18:00 hasta las 17:59** en hora de Monterrey. Y el default de fecha con `new Date(x.toLocaleString(...)).toISOString()` aplica el desfase **dos veces**: después de las 18:00 devuelve MAÑANA (medido: 18:30, 20:30 y 23:30 del 7-sep → `2026-09-08`) | 🟠 P1 | 🔶 **CERRADO en el corte y el historial 2026-09-08** (`todayMX()` + `zonedStartOfDayISO()`, que ya existían en `lib/date-mx.ts` y son tenant-aware; el corte era el único que importaba `getActiveTimezone` y aun así no las usaba). En el corte se arreglaron **las dos** consultas: órdenes y `pos_cash_movements` —esta última la encontró el barrido y pesa igual, porque el arqueo resta esos retiros del efectivo esperado—. **NO tocados, a propósito:** `reporte-fiscal`, `api/export/polizas`, `api/contabilidad/polizas` (mover la ventana cambia números contables ya emitidos: requiere decidir qué pasa con lo declarado), `control-efectivo`, `pos/monitor`, `pos/asistencia`, `pos/delivery`, `api/dashboard/hourly-distribution`. **Riesgo si se sigue:** el reporte pedía además unificar todo al día de venta de las 05:00 (`business_day_start_local`); hacerlo sólo en unas pantallas crea una TERCERA definición y deja tres números distintos del mismo día — corte, dashboard, `dia-de-venta.ts` y `ops_aggregate.py` tienen que moverse juntos. **Ojo con lo histórico:** las filas de `pos_cierres` ya escritas usan la convención UTC vieja y están corridas hasta 6 h | `corte/page.tsx`, `historial/page.tsx`, `lib/date-mx.ts` |

## Certificación (bloquea "milestone POS V2" → Golden Skeleton)

- **PRR-v1:** 27 hallazgos OPEN (10 P0), score 4.7/10 — `certifications/PRR-v1.md`
- **P0-4 Fase 5 física** (checklist OCS-P2.5.9 sin ejecutar) — bloquea todo el track downstream
- **P0-3 CSD — PAC = Facturama** (no Facturapi) — blocker externo SAT (Andy tramita CSD)
