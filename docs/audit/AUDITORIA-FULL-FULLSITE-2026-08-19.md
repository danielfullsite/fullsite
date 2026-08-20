# Auditoría FULL de Fullsite — estado completo (2026-08-19)

> Síntesis de 6 auditorías paralelas sobre todo `docs/` + verificación contra código de
> `origin/main` y la rama de trabajo: (1) núcleo operativo/offline, (2) plataforma/clonabilidad,
> (3) seguridad/fraude, (4) estado de ingeniería/certificaciones, (5) IA/agentes, (6) estrategia/negocio.
> Método: cada dominio reportó estado real, items abiertos, **docs viejos/contradictorios**, y prioridades — todo citado.

---

## La tesis en una frase

**Fullsite no tiene un problema de producto — tiene un problema de que su registro de verdad se desincronizó de su realidad.** El núcleo es genuinamente sólido (offline probado en campo, RLS multi-tenant cerrado en prod, idempotencia, ledger inmutable, provisioning construido). Pero **la verdad se bifurcó**: el sistema real vive en la rama `feat/pos-ui-kit` (**223 commits adelante de `main`**) + el campo, mientras `main` y ~40 documentos formales quedaron congelados en julio y hoy **se contradicen entre sí, con el código, y con el campo**.

Los 6 dominios encontraron **el mismo patrón**, de forma independiente:

| Dominio | La "verdad formal" (docs julio) dice | La realidad (código/campo agosto) es |
|---|---|---|
| Ingeniería | PRR 4.7/10, "NO certificado"; los 4 CRÍTICO ni están en `BUGS.md` | Offline probado en campo; pero 4 CRÍTICO de fraude/pérdida reales y abiertos |
| Offline | 10 docs describen diseño WS/https; `DEPLOYMENT-STATE` dice "offline pendiente cert" | Offline HTTP/LAN **probado en campo** (caja+KDS) — solo 1 doc lo refleja |
| Plataforma | `CLONEABILITY-REPORT`: "`onboard_client.py` no existe" | Provisioning existe (provisionTenant, /api/platform/onboard) — **pero solo en la rama, no en main** |
| Seguridad | `SECURITY-FOUNDATION-P0`: casi todo `IN_PROGRESS` | Blindaje B2 (RLS) cerrado y verificado en prod; fraude en grace sin voltear |
| IA | "26+ agentes activos", `agent_events` mide valor | 0 agentes certificados; `agent_events` **nunca se escribe** |
| Negocio | `PRICING.md`: "$1,999, final"; unit economics sobre $1,999 | Código dice $4,999; 4 esquemas de precio conviviendo |

**Traducción:** el problema #1 no es construir más — es **reconverger la verdad**. Mientras no lo hagas, cualquier decisión (o clonación, o pitch) puede arrancar de un dato falso. Esto valida la regla de esta sesión: *basarse en lo que ya tenemos y confirmar antes de actuar* — pero resulta que buena parte de lo escrito ya no es cierto.

---

## Estado por dominio (verde = sólido · rojo = abierto)

### 1. Núcleo operativo / offline
🟢 **Sólido:** caja imprime offline (🏆 campo 18-ago), KDS recibe con caja offline (🏆), arquitectura HTTP/LAN vía Pedro (causa raíz mixed-content resuelta), sync idempotente por `save_operation_id`, auth gerente offline (PBKDF2 8h), paridad POS vs Wansoft.
🔴 **Abierto:** offline de **Entrada/Escondite NUNCA probado físicamente**; Escondite no imprime (BOM); **cold-boot sin internet = pantalla negra**; doble cobro posible (DT-1); OFF-01 impresoras sin validar (falla silenciosa); toda la deuda de Phase 2 (outbox Local Server→Supabase, LAN-01) sigue abierta — el éxito de campo fue en Phase 1 (browser sincroniza directo).

### 2. Plataforma / clonabilidad
🟢 **Sólido:** POS transaccional clonable sin código (probado en sandbox); aislamiento 2 capas (`_cid()` + RLS); `provisionTenant` + `onboard_client.py` con templates/dry-run/rollback existen.
🔴 **Abierto:** todo eso vive en la rama, **no en `main`/prod** (PASO B pendiente); **OCM Fase 3 pendiente** (la IA lee tablas muertas + fuga cross-tenant con Cliente #2); wizard self-serve + provisioning de terminales por código faltan; PAE nunca ejecutado; Golden Skeleton PENDING-GATE; impuestos (IVA/IEPS) hardcodeados en `GO-LIVE.md`.

### 3. Seguridad / fraude
🟢 **Sólido y verificado en prod:** RLS multi-tenant B2 (49 políticas permisivas eliminadas, 34 tablas tenant-scoped, 0 cross-tenant); proxy `api/pos/db` blindado; PIN server-side hasheado 4-10; separación POS/dashboard users.
🔴 **Abierto:** **fraude en GRACE, no bloquea** (cancelar/reabrir auditan pero permiten; **skimming Fase 2/rechazo NO codificada**); **local server LAN sin auth** (`0.0.0.0:7717` — cualquier equipo cancela/imprime/reconfigura); sesión robable por XSS (cookie `fs-at` sin httpOnly, refresh token en localStorage); **2FA del super-admin ausente** (único `platform_admin`, 0 MFA).

### 4. Estado de ingeniería / certificaciones
🟢 **Sólido:** P0-1 (cierre con órdenes abiertas) CERTIFIED; módulos OCS (caja/KDS/print/órdenes/pagos) CERTIFIED en código; R1 inventario campo PASS.
🔴 **Abierto:** PRR **4.7/10**, 27 hallazgos OPEN (10 P0); **P0-4 Fase 5 física nunca ejecutada** (checklist OCS-P2.5.9 con todos los ☐ vacíos) → bloquea milestone POS V2 → bloquea todo Golden Skeleton; **3-4 registros de bugs/P0 distintos sin índice único**; 13 bugs "pendiente de documentar".

### 5. IA / agentes
🟢 **Sólido:** pipeline reportes/ops corre por cron a Telegram; `pos_intraday_snapshot` CERTIFIED; `reviews-manager` (Worker) más avanzado que el skeleton.
🔴 **Abierto:** **0 agentes certificados** ("¿en cuál confiarías mañana? None"); **`agent_events` nunca se escribe** (bucle de valor sin cerrar); 22/24 alertan sin contexto (fatiga); orquestador/kb son skeleton (docs dicen "active"); 71% de recetas con 1 ingrediente → food cost ficticio.

### 6. Estrategia / negocio
🟢 **Sólido:** tesis estable y afilada (`DIRECTION-EXPERTO`, edge agent); deck honesto ($0 MRR declarado); IP 9/10.
🔴 **Abierto:** **pricing sin resolver (4 esquemas)**; unit economics sobre precio equivocado (2.5x); **Cliente #2 arm's-length inexistente** (condición de YC y del IC memo); cofundador estancado (ninguno pasa Founder Commitment); distribución 3/10; brecha de valuación $2.5M (memo) vs $5M (deck).

---

## Registro de docs viejos/contradictorios (el hallazgo más accionable)

Esto es lo que hay que **re-fechar, corregir o archivar** — ordenado por peligro:

| Doc | Problema | Acción |
|---|---|---|
| `offline/MULTI-RESTAURANT-DEPLOYMENT.md:~546` | **PELIGROSO:** instruye abrir el KDS por `https://app.fullsite.mx` — viola la regla dura #1 (rompe offline por mixed-content) | Corregir YA |
| `strategy/PRICING.md` | "$1,999 final" contradice el código ($4,999) y 2 esquemas más | Reescribir con el precio ganador |
| `strategy/UNIT-ECONOMICS-DEEP.md` | Todo el análisis sobre $1,999 (posible 2.5x equivocado) | Recalcular sobre precio real |
| `state/BUGS.md` | Marca CLOSED bugs que reaparecen; 13 "pendiente de documentar"; no tiene los 4 CRÍTICO | Consolidar en índice único |
| `platform/CLONEABILITY-REPORT-v1.md`, `PROVISIONING.md` | "onboard no existe / SQL a mano" — superado por el código en la rama | Actualizar/archivar |
| `security/SECURITY-FOUNDATION-P0.md`, `POS-BROWSER-SECURITY.md` | Estado julio/staging; el blindaje de agosto ya cerró en prod | Marcar snapshot histórico |
| `architecture/LOCAL-FIRST.md §9`, `customers/amalay/DEPLOYMENT-STATE.md`, `offline/EXECUTIVE-SUMMARY.md` | Listan como abierto lo que el campo ya probó; describen diseño WS/Chrome viejo | Re-fechar/redirigir a `OFFLINE-LAN-FIELD-PROVEN` |
| `ai/OVERVIEW.md` / `CLAUDE.md` | orquestador/kb "active" (son skeleton); `agent_events` como fuente (no se escribe); "26+ agentes" (0 certificados) | Reconciliar con `CONTEXT.md` reales |
| `hiring/COFOUNDERS.md`, `operations/STATE-OF-THE-COMPANY` | Candidatos y estado de julio, superados | Actualizar |
| `docs/README.md` | Índice de julio; no lista el oro reciente | Refrescar |

**El patrón de higiene correcto ya existe:** `architecture/OFFLINE-MASTER.md` tiene un banner "actualizado 18-ago → ver OFFLINE-LAN-FIELD-PROVEN". Replicar ese patrón (banner + redirect) en todos los de arriba.

---

## Lo que la auditoría confirma que SÍ es sólido (no tocar por tocar)

Idempotencia por `command_id`; cola IndexedDB que sobrevive reload; ledger de inventario inmutable con costo promedio ponderado; multi-tenant limpio y verificado post-B2; OCC en cancel-item; offline LAN probado en campo (caja+KDS); auth server-side sin confiar en headers; edge agent v0 shipped. **El problema no es el núcleo — es que el enforcement server-side y el registro de estado no lo alcanzaron.**

→ **Plan de acción priorizado: ver [`../PLAN-AHORA.md`](../PLAN-AHORA.md).**
