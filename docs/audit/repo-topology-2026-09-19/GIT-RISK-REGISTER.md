# GIT RISK REGISTER — Fullsite

> 2026-09-19 · Read-only · Baseline `main = 10a1caa7`
> Clasificación: **P0** perder trabajo o desplegar código equivocado · **P1** ambigüedad de
> source-of-truth / ramas divergentes · **P2** deuda de organización · **P3** higiene.
> Ninguna recomendación fue ejecutada.

---

## PARTE 7 — ACTIVOS PRIVADOS / OPERACIONALES

| PRIVATE_ASSET | CURRENT_LOCATION | BACKED_UP | REMOTE | RISK_OF_LOSS | PRODUCT_REPO | INTERNAL_REPO |
|---|---|---|---|---|---|---|
| **Operational Brain** (`tools/brain/`: `brain.mjs`, `detectors.mjs`, `selftest.mjs`, `AGENT_REGISTRY.json`, `SIGNAL_EXPECTATIONS.json`, 7 salidas de agente, `observations/`) | Rama local `docs/system-state-map` (9 commits) · worktree en **`/private/tmp/.../wt-sistema`** | Sólo en `.git` local | **NO** | **ALTO** | No | **Sí** |
| **Schema-drift tooling** (`tools/schema-drift/`: `drift-guard.mjs`, `ledger.json`, `effects.json`, `files.json`, `registry.json`, `release-policy.json`, `contrato-turno-abierto.sh`) | misma rama local | Sólo `.git` local | **NO** | **ALTO** | Sí (es guardián de migraciones) | — |
| **Source-of-truth docs** (`docs/system/SOURCE-OF-TRUTH.md`, `SYSTEM-MAP.md`, `RELEASE-BOARD.md`, `EVIDENCE-PIPELINE-SPEC.md`, `OPERATIONAL_BRAIN_ARCHITECTURE.md`, `AGENT_SAFETY_POLICY.md`) | misma rama local | Sólo `.git` local | **NO** | **ALTO** | Parcial | **Sí** |
| **Field cert contract** (`docs/system/FIELD_CERT_CONTRACT.md`, `tools/brain/FIELD_CERT_ARTIFACT.template.json`) | misma rama local | Sólo `.git` local | **NO** | **ALTO** | Sí | — |
| **Certification Rig v1** (`dashboard-app/e2e/paridad/cert/**`, `CONTRATO-v1.md`) | `cert/rig-v1-pr1` (PR #418, base `golden/candidate-20260914`) + `cert/rig-v1-pr2` | Sí, remoto | origin | BAJO | **Sí** | — |
| **Agent registry / agent-os** (`docs/agent-os/PIPELINE.json`, `TASKS.json`, `AUDIT-LOG.ndjson`, `HEARTBEAT.json`) | main (parcial) + 10 ramas `agent-os/*` **todas sólo locales** + stashes 3,4,5 | Parcial | NO para las ramas | MEDIO | No | **Sí** |
| **Backlog / cierre de producto** (`docs/architecture/CAJA-REPORTES-2026-09-08.md`, `INVENTORY-ATOMIC-2026-09-08.md` + ~30 archivos de código) | **Sin commitear** en `.codex/worktrees/product-closure-20260905` | **NO** | **NO** | **CRÍTICO** | Sí | — |
| **Founder control center** (MFA) | `codex/founder-control-center` (93 commits, **sólo local**) | Sólo `.git` | **NO** | **ALTO** | No | **Sí** |
| **God Mode plataforma** (alta de cliente self-serve, impersonación auditada, deploy 1-click sin git) | `offline-shell/local-load`, **5 commits locales sin empujar** | Sólo `.git` | Parcial | **ALTO** | No | **Sí** |
| **Dossiers de clientes** (`docs/customers/scyf/`, `DEMO-TEKILA-RG.md`) + estrategia (`BIBLE-SQUARE.md`, `PLAN-SQUARE-FULLSITE.md`, `LOGICA-POR-VERTICAL.md`) | **Untracked** en el checkout principal | **NO** | **NO** | **ALTO** | No | **Sí** |
| **WhatsApp CRM / Concierge** (17 archivos TS + 1 migración + 5 tests) | **Untracked** en el checkout principal | **NO** | **NO** | **CRÍTICO** | Sí | — |
| **Auditorías de seguridad** (`docs/audit/` 26 archivos, `docs/security/` 23) | main | Sí | origin | BAJO pérdida / **ALTO exposición** | — | **Sí** (hoy están públicas) |
| **Datos de negocio AMALAY** (`data/backfill/amalay-wansoft-…json`, 238 KB) | main | Sí | origin | **ALTO exposición** | No | **Sí** |
| **Acuse IMPI de la marca** | PR #161 cerrado, rama borrada de local y de GitHub; el objeto `c6a495ce` **no existe en este clon** | Sólo en la API de GitHub | — | MEDIO | — | **Sí** |

---

## PARTE 8 — REGISTRO DE RIESGO

### P0 — perder trabajo o desplegar código equivocado

#### P0-1 · El repositorio es PÚBLICO y contiene datos de negocio, auditorías de seguridad y dossiers de clientes
**Evidencia:** `gh api repos/danielfullsite/fullsite --jq .visibility` → `public`.
`data/backfill/amalay-wansoft-2026-07-11_2026-09-09.json` (238 KB) contiene, por día y para
dos meses: `ventas_dia`, `efectivo`, `tarjeta`, `propinas_total`, `tickets_count`, y un
arreglo `meseros` con nombres. Además `docs/audit/` (26 archivos), `docs/security/` (23),
`docs/customers/` (13), `docs/strategy/` (31), `docs/legal/` (3).
**Mitigante:** ningún `.env`, `.mcp.json` ni `*.key` está trackeado en main; sólo
`.env.example`. `.gitignore` cubre los cuatro archivos de secretos verificados.
**Alcance de esa verificación:** revisé el árbol de `main@10a1caa7`, **no el historial
completo**. Un secreto commiteado y luego borrado no lo detecta este método.
**Por qué es P0 de "desplegar equivocado":** un fork o un clon externo puede levantar el
producto con la configuración de AMALAY.
**Propuesta (no ejecutada):** decidir si el producto debe ser público. Si sí, sacar
`data/`, `docs/customers/`, `docs/audit/`, `docs/strategy/`, `docs/legal/` a un repo interno.
Si no, cambiar visibilidad y, en cualquier caso, escanear el historial con `gitleaks`.

#### P0-2 · 17,536 líneas en 63 archivos nunca commiteados, en el checkout principal
**Evidencia:** `git status --porcelain` en `/Users/danielrg/fullsite` (rama `feat/pos-ui-kit`)
→ 65 rutas untracked; para 53 de ellas `git log --all --format=%H -1 -- <ruta>` devuelve vacío.
Ninguna está en `.gitignore`.
**Qué se perdería:** subsistema WhatsApp CRM/Concierge completo
(`lib/whatsapp-{automation,agent-policy,concierge-agent,quota}.ts`,
`lib/integrations/whatsapp/twilio.ts`, `components/crm/ConciergeCRM.tsx` 530 líneas,
7 rutas API bajo `api/crm/`, 5 tests), `lib/reservation-crm.ts`, `lib/contact-import.ts`,
`lib/operational-model.ts`, `app/ahora/page.tsx`, `app/global-error.tsx`, la migración
`20260912010000_crm_whatsapp_concierge.sql` (225 líneas), 4 maquetas HTML de ~11,200 líneas
(`fs-skeleton`, `fs-sistema`, `fs-alta`, `pos-skeleton`),
`electron-app/dist-pos/fingerprint-service.cs` (515 líneas),
`electron-app/kds-ui.html` (511), y 15 documentos de estrategia/auditoría/cliente.
**Disparadores realistas:** `git clean -fd`, `git checkout` a otra rama con conflicto de
rutas, borrar el worktree, o cualquier agente que "limpie el git status".
**Propuesta:** commitear a una rama `rescate/checkout-principal-20260919` y empujarla, antes
de cualquier otra cosa en este repo.

#### P0-3 · El cerebro operativo completo vive en una rama local sin respaldo, con worktree en `/private/tmp`
**Evidencia:** `docs/system-state-map`, 9 commits, 41 archivos, `REMOTE_EXISTS=no`
(`git for-each-ref refs/remotes/origin` no la lista). Worktree en
`/private/tmp/claude-501/-Users-danielrg-fullsite/a09d4136-…/scratchpad/wt-sistema`.
Ahí hay además 3 archivos untracked que no existen en ninguna ref: `tools/brain/lib/frescura.mjs`,
`tools/brain/lib/tiempo.mjs`, `tools/brain/observations/2026-09-19T0610Z.json`, y 3 trackeados
modificados (`brain.mjs`, `detectors.mjs`, `out/signal-health.json`).
**Matiz:** la rama vive en `.git` del repo principal, así que **sobrevive** a que se limpie
`/private/tmp`. Lo que muere son esos 3 archivos untracked y los 3 cambios sin commitear.
Lo que muere si se pierde el disco es **todo**, porque no hay remoto.
**Propuesta:** `git push -u origin docs/system-state-map` y commitear los 3 huérfanos.

#### P0-4 · Worktree `product-closure-20260905`: ~30 archivos huérfanos + 37 modificados, incluidas 2 migraciones
**Evidencia:** `git -C .codex/worktrees/product-closure-20260905 status --porcelain` → 37 `M`
+ 37 `??`; de los untracked, 30 no existen en ninguna ref.
**Contenido en riesgo:** `components/pos/{CorteDeCaja,ImpresionDeCaja,MovimientosDeCaja}.tsx`,
`lib/{caja-reportes,caja-reporte-cloud,inventory-movement-contract,inventory-pending-intent,pedro-movimientos,pos-db-proxy}.ts`,
`api/pos/inventory-movement/`, `electron-app/local-server/core/{cash-movements,controlled-print,operational-domain-error}.js`,
12 tests nuevos, 2 docs de arquitectura, y
`supabase/migrations/PENDIENTE_20260908010000_inventory_movement_atomic.sql` +
`PENDIENTE_20260908020000_pos_identity_and_write_guards.sql`.
**Agravante:** es una implementación **rival** de la de main (PARALLEL-REALITIES PR-03).
Recuperar no es sólo commitear, es decidir cuál gana.
**Propuesta:** commitear tal cual a `rescate/product-closure-20260905` y empujar. No mergear.

#### P0-5 · Código en producción que referencia tablas inexistentes en la BD de AMALAY
**Evidencia:** `pg_class` en `qjiomlvudfmzuvqvhwpk` → `pos_terminals` **no existe**,
`pos_terminal_enrollments` **no existe**, `tenant_source_authority` **no existe**.
En `origin/main` hay **11 archivos** que referencian `pos_terminals` — entre ellos
`dashboard-app/src/app/api/pos/pin/route.ts`, que es camino caliente del POS — y **4** que
referencian `pos_terminal_enrollments` (`api/platform/terminals/route.ts`,
`api/platform/terminal-claim/route.ts`).
`main` está desplegado en `app.fullsite.mx`.
**Lo que NO verifiqué:** si esas rutas fallan abierto, fallan cerrado, o están detrás de una
guarda que nunca se activa en AMALAY. Eso exige leer cada archivo completo y probar en
runtime. **Estado: HECHO** (las tablas no existen y el código las nombra) **+ NO VERIFICADO**
(el impacto operativo real).
**Propuesta:** correr esas rutas contra prod en lectura y clasificar; luego decidir si se
aplica el DDL o se retira el código.

#### P0-6 · `feat/pos-ui-kit` puede revertir trabajo si se mergea
**Evidencia:** rama del checkout principal, **sólo local**, 58 commits, base **666 commits
atrás** de main, y su versión de `pos/page.tsx` tiene **5,926 líneas contra 7,045 en main**
(`+417/−1536`).
**Mitigante parcial:** existen 3 respaldos remotos (`backup/pos-ui-kit-2026081{8,9,21}`) y
los tres son ancestros de la rama. Pero **10 commits del tip no están en ningún respaldo ni
en main** (los de 2026-08-21 a 2026-08-24: KDS en flujo horizontal, fallback `kds_queue`,
bridge Rappi→KDS Electron, 3 docs de clonabilidad).
**Propuesta:** empujar un cuarto respaldo hoy. Nunca mergear la rama completa.

---

### P1 — ambigüedad de source-of-truth / ramas divergentes

#### P1-1 · 80 ramas con trabajo único y sin respaldo remoto fiel
240 de 543 ramas no tienen remoto idéntico; 80 de ellas tienen parches que no están en main.
Las de mayor volumen: `sandbox/second-customer-skeleton` (**59 commits locales sin empujar**),
`codex/rappi-dev-integration` (146), `codex/integration-admin-skeleton` (126),
`fix/delivery-app-server-read` (103), `codex/founder-control-center` (93),
`agent-os/runtime` (91), `fix/orchestrator-marker-satisfaction` (90),
`rappi/design-v0.3` (85), `codex/full-regression-final-20260912` (67).
Lista completa en `BRANCH-INVENTORY.json` (`BACKED_UP_REMOTE=false` + `UNIQUE_PATCHES>0`).

#### P1-2 · Seis ramas divergidas: un push equivocado pisa trabajo
`docs/migracion-pins` (4↔1), `fix/loopback-address-space` (2↔1), `fix/ordenes-fantasma` (3↔1),
`fix/pos-mesa-nav-offline` (2↔4), `sec/finance-agent-tenant` (2↔1),
`sec/uber-integration-routes-auth` (14↔1). Un `git push --force` masivo destruye una de las
dos mitades. Resolver por contrato, no por fecha.

#### P1-3 · 37 PRs abiertos con base de más de 200 commits de antigüedad
Incluye #20 (838 atrás), #23 (836), #25 (711), #62 (514), #72 (510). `strict=false` en la
protección de main permite mergearlos **sin actualizar**. Un merge de #23 (4 archivos) con
base de agosto puede reintroducir código retirado desde entonces.

#### P1-4 · La línea Electron instalada no es trazable a un SHA
No hay pipeline que ligue main con el instalador. El PR #223 se titula literalmente
"reconciliación línea instalada × main", lo que confirma que divergieron. Además hay 2
archivos **staged sin commitear** en el worktree `build-electron` (detached HEAD).

#### P1-5 · Deriva de esquema entre producción y staging
`pos_terminals` existe en staging y no en prod. CI verde en staging no prueba prod.

#### P1-6 · `sandbox.app.fullsite.mx` apunta al mismo deployment que producción
`vercel inspect app.fullsite.mx` lista ambos alias sobre `dpl_7aHncjNL…`. Lo que alguien
pruebe "en sandbox" está tocando producción.

#### P1-7 · Trazabilidad rama→commit rota por los tres métodos de merge habilitados
449 ramas no son ancestros de main; 358 tienen su contenido dentro. La relación sólo existe
en la API de PRs de GitHub. `delete_branch_on_merge=false` acumula 330 ramas remotas.

#### P1-8 · #416 está abierto y mergeable pese a decir "NO MERGEAR" en su título
Duplica 8 PRs abiertos. Nada en la configuración lo impide.

#### P1-9 · `enforce_admins=false` y un solo check obligatorio
El único check requerido es `test`, de 81 workflows. El owner puede saltarse la protección.

#### P1-10 · Escritura concurrente durante la auditoría
Varios procesos `claude` activos (uno con `--dangerously-skip-permissions`). En 7 minutos:
main avanzó un commit, se borró una rama remota, se disparó un deploy a producción.
Ninguna limpieza basada en esta foto es segura sin revalidar el SHA.

#### P1-11 · Seis migraciones aplicadas en prod cuyo archivo no está en main
Ver `MIGRATION-STATE-SUMMARY.md` §A2. Un clon nuevo nace sin esos seis cambios.

#### P1-12 · 26 migraciones aplicadas en prod sin archivo en ninguna rama
Incluye DDL de seguridad (`skel04_b0_critical_security`, `rls_anon_to_authenticated_hardening`,
`revoke_pos_staff_anon_read`). El repo no contiene el DDL que hoy protege producción.

---

### P2 — deuda de organización

- **P2-1** · 103 worktrees, 4 huérfanos (`prunable`), repartidos en 6 raíces distintas
  (`~/fullsite-*`, `~/fullsite-worktrees/`, `.claude/worktrees/`, `.codex/worktrees/`,
  `.octogent/worktrees/`, `/private/tmp/`). No hay convención única.
- **P2-2** · 8 stashes, el más viejo de 2026-07-31 con 61 archivos de `FULLSITE DOCS/`.
  Todos recuperables, ninguno documentado en su rama de origen.
- **P2-3** · 6 proyectos Vercel en el scope; `dashboard-app` y `cp-wt2` no corresponden a
  nada documentado como activo — riesgo de relink equivocado.
- **P2-4** · Dos apps Electron (`electron-app/` y `electron-kds/`) y cuatro copias de la
  landing (raíz HTML, `landing-site/`, `dashboard/index.html`, `fullsite-web/`).
- **P2-5** · `graphify-out/` (541 archivos) versionado en main; el checkout tiene además 3
  snapshots por fecha sin trackear. El propio CLAUDE.md advierte que el grafo está desfasado.
- **P2-6** · `scripts/buscar-evidencia.sh`, citado en CLAUDE.md como procedimiento probado,
  no está en main: está untracked en el checkout y commiteado sólo en la rama del PR #159
  (abierto desde hace 429 commits).
- **P2-7** · 11 PRs de dependabot abiertos, 9 con base de 288 commits atrás.
- **P2-8** · 2 tags (`field-batch-002-rc1`, `field-pack-2026-08-06`) apuntan a commits que
  no están en main.

---

### P3 — higiene

- **P3-1** · 13 ramas `claude/*` idénticas (mismo trabajo, 123 archivos) con 13 worktrees.
- **P3-2** · 10 ramas `agent-os/TSK-0XX`, todas sólo locales, cada una con 84–97 commits
  acumulados de las anteriores.
- **P3-3** · 4 ramas `fisica/*` + `hmac/*` del 2026-09-14, variantes del mismo experimento.
- **P3-4** · Remote `old-origin` apunta a un repo que devuelve 404. Su ref
  `old-origin/main` no es ancestro de `origin/main`, **pero 0 de sus commits son únicos**
  (`git rev-list --count old-origin/main --not origin/main <todas las refs>` = 0). Sin riesgo,
  sólo ruido.
- **P3-5** · Ramas con nombre no informativo: `pr62`, `pr358`, `tmp-merge-110`,
  `worktree-agent-a747b50cee6f860c6`, `claude/<adjetivo>-<apellido>-<hex>`.
- **P3-6** · 3 ramas `backup/pos-ui-kit-*` remotas sin política de caducidad.

---

## Ramas que NO se deben tocar

| Rama | Por qué |
|---|---|
| `feat/pos-ui-kit` | 10 commits sin respaldo + 17.5k líneas untracked encima. **Empujar antes de nada** |
| `docs/system-state-map` | Todo el cerebro operativo, sin remoto |
| `codex/fullsite-product-closure` | ~30 archivos huérfanos en su worktree |
| `sandbox/second-customer-skeleton` | 59 commits locales sin empujar |
| `offline-shell/local-load` | 5 commits de God Mode sin empujar |
| `integration/client2-rc1` | 8 commits locales sin empujar |
| `release/offline-field-2026-08-06` | 12 commits locales sin empujar |
| Las 6 divergidas (P1-2) | Cualquier push pisa una de las dos mitades |
| Las 10 `agent-os/*` y `codex/founder-control-center` | Sólo locales, 84–126 commits únicos |
| `p0a/po-create-integrity` | Sólo remota, 33 commits, sin PR |

## Ramas seguras de archivar (tras empujarlas como respaldo)

- Las **358** `MERGED_BUT_HISTORY_NOT_MAIN` **cuyo contenido ya está en main** y cuyo PR
  aparece como `MERGED` — verificado por PR, no por nombre.
- 12 de las 13 `claude/*` idénticas (conservar una).
- Las `dependabot/*` con PR cerrado y rama ya borrada (ya no existen).
- `tmp-merge-110`, `pr62`, `pr358` tras confirmar que su contenido está en main.

> **Ninguna de estas listas es una orden de ejecución.** "Seguras de archivar" significa que
> la evidencia recogida hoy lo respalda; el SHA debe revalidarse justo antes, porque el repo
> tiene agentes escribiendo (P1-10).
