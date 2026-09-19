# SOURCE-OF-TRUTH MAP — Fullsite

> Baseline `origin/main` = `10a1caa7`. Read-only. 2026-09-19.

## Los cinco estados, que no son sinónimos

| Estado | Qué prueba | Cómo se comprueba aquí |
|---|---|---|
| `IN_REPO` | El archivo existe en alguna rama | `git log --all -- <ruta>` |
| `IN_MAIN` | Está en `origin/main` | `git cat-file -e origin/main:<ruta>` |
| `DEPLOYED` | Corre en `app.fullsite.mx` | `vercel ls fullsite --prod -F json` → `meta.githubCommitSha` |
| `DB_APPLIED` | El ledger de Supabase lo registra | MCP `supabase-amalay` → `list_migrations` |
| `RUNTIME_ACTIVE` | El objeto existe de verdad en la BD | `pg_class` / `pg_attribute` |

En Fullsite hoy **los cinco se separan de forma medible**: hay objetos `IN_MAIN` +
`DEPLOYED` que no son `DB_APPLIED` ni `RUNTIME_ACTIVE` (ver
[`MIGRATION-STATE-SUMMARY.md`](MIGRATION-STATE-SUMMARY.md)).

---

## Mapa por dominio

Conteos = archivos en `origin/main`.

### dashboard / web
```
PATHS                        dashboard-app/ (1,015 archivos)
                             + raíz: index.html, precios.html, landing.html, nosotros.html,
                               producto/, soluciones/, comparar/, blog/, en/, landing-site/ (65),
                               dashboard/index.html, warroom.html, warroom-dashboard.html
RUNTIME                      Next.js App Router (bun install / bun run build)
DEPLOY_TARGET                Vercel, proyecto `fullsite` → app.fullsite.mx
SOURCE_OF_TRUTH              origin/main  (confirmado: 120/120 deploys de prod vienen de main)
HAS_DUPLICATE_IMPLEMENTATION SÍ — la landing vive en 4 sitios: HTML en la raíz, `landing-site/`,
                             `dashboard/index.html`, y `fullsite-web/` (untracked en el
                             checkout, presente en ramas agent-os/*). `.vercelignore` excluye
                             `fullsite-web/` → "separate project" (repo danielfullsite/fullsite-web)
BRANCHES_WITH_UNMERGED_CHANGES  redesign/app-ui · redesign/dashboard-v1 · redesign/ds-v2.2 ·
                             barrido3/lentes-restantes (#395) · codex/bug-sweep (#397)
```

### POS
```
PATHS                        dashboard-app/src/app/pos/ (35) · src/components/pos/ ·
                             src/lib/pos-*.ts
RUNTIME                      Next.js en el navegador + Electron (caja)
DEPLOY_TARGET                Vercel (capa web, se toma con F5) — el shell Electron NO
SOURCE_OF_TRUTH              origin/main
HAS_DUPLICATE_IMPLEMENTATION SÍ — ver PARALLEL-REALITIES PR-01 (5 versiones de pos/page.tsx)
BRANCHES_WITH_UNMERGED_CHANGES  #395 #396 #397 #399 #408 #416 + feat/pos-ui-kit (local, 666 atrás)
```

### KDS
```
PATHS                        dashboard-app/src/app/kds/ (2) · src/app/pos/cocina/ ·
                             src/app/cocina/ · electron-kds/ (2)
RUNTIME                      Next.js + Electron (KDS de Eduardo corre en Electron)
DEPLOY_TARGET                Vercel para la vista web; Electron requiere instalador
SOURCE_OF_TRUTH              origin/main para la capa web; para el Electron instalado, NO HAY
                             fuente única declarada (ver PR-09)
HAS_DUPLICATE_IMPLEMENTATION SÍ — /kds simplificado vs /pos/cocina (KDS Eduardo) vs electron-kds/
BRANCHES_WITH_UNMERGED_CHANGES  factory/kds-aislamiento (#199) · codex/kds-close-responsive ·
                             codex/kds-patch-rollback-20260912 · fix/kds-lan-cancelada ·
                             fix/kds-filtro-dia-venta · codex/electron-kds-offline-main
```

### API routes
```
PATHS                        dashboard-app/src/app/api/ (118 archivos)
RUNTIME                      Vercel Functions (Node.js, Fluid Compute)
DEPLOY_TARGET                Vercel — automático con cada merge a main
SOURCE_OF_TRUTH              origin/main
HAS_DUPLICATE_IMPLEMENTATION Parcial: /api/pos/db/route.ts y /api/pos/db/[...path]/route.ts
BRANCHES_WITH_UNMERGED_CHANGES  #164 sec/kitchen-cierra · #143 feat/kitchen-token-grace ·
                             #167 #172 #178 #272 #273 #404
```

### Pedro / servidor local
```
PATHS                        electron-app/local-server/ (127 archivos) · print-bridge/ (4)
RUNTIME                      Node.js dentro de Electron, en la caja de AMALAY, LAN sin WAN
DEPLOY_TARGET                NO ES VERCEL. Requiere instalador nuevo + reinstalación física
SOURCE_OF_TRUTH              origin/main es la referencia, pero NO hay evidencia de que la
                             línea instalada corresponda a un SHA de main (ver PR-09)
HAS_DUPLICATE_IMPLEMENTATION SÍ — worktrees .codex/worktrees/closure-{pos,durability,transport}
                             con core/order-domain.js, core/cash-movements.js,
                             core/controlled-print.js, core/actor-authority.js SIN COMMITEAR
BRANCHES_WITH_UNMERGED_CHANGES  codex/closure-pos · codex/closure-durability ·
                             codex/closure-transport · codex/fullsite-product-closure ·
                             integracion/electron-1.3.12 (#223)
```

### Electron
```
PATHS                        electron-app/ (171) · electron-kds/ (2) · electron-app/lab/ (18)
RUNTIME                      Electron, Windows en campo
DEPLOY_TARGET                Instalador. Workflow `.github/workflows/electron-build.yml`.
                             Excluido de Vercel por .vercelignore y por el ignoreCommand
SOURCE_OF_TRUTH              AMBIGUO — ver GIT-RISK-REGISTER P1-4
BRANCHES_WITH_UNMERGED_CHANGES  integracion/electron-1.3.12 (#223, draft, 376 commits atrás) ·
                             codex/electron-upgrade-20260912 · codex/electron-amalay-qa (sucio) ·
                             worktree build-electron (2 archivos STAGED sin commit)
```

### offline
```
PATHS                        dashboard-app/src/lib/pos-offline-db.ts · sw.js · pwa/ (16) ·
                             electron-app/local-server/core/event-store.js ·
                             dashboard-app/src/__tests__/offline-sw.test.ts
RUNTIME                      Service Worker + IndexedDB + event store local
DEPLOY_TARGET                Mixto: SW y IndexedDB por Vercel; event store por instalador
SOURCE_OF_TRUTH              origin/main + docs/pos/PIPELINE-POS-KDS-OFFLINE.md como contrato
HAS_DUPLICATE_IMPLEMENTATION No detectada en main
BRANCHES_WITH_UNMERGED_CHANGES  #405 fix/la-cola-se-drena-sola · #338 · fix/sw-killswitch
                             (PR #281 CERRADO sin merge, rama remota viva) ·
                             offline-shell/local-load (5 commits locales sin empujar)
```

### inventory
```
PATHS                        dashboard-app/src/lib/inventory.ts · src/app/inventario/ ·
                             src/app/inventario-real/
DEPLOY_TARGET                Vercel
SOURCE_OF_TRUTH              origin/main; la verdad de datos son pos_recipes (no wansoft_food_cost)
HAS_DUPLICATE_IMPLEMENTATION SÍ — inventory-movement-contract.ts / inventory-pending-intent.ts
                             existen sólo en el worktree product-closure, sin commitear
BRANCHES_WITH_UNMERGED_CHANGES  #387 feat/inventario-consumo-teorico (57 commits locales sin empujar)
```

### purchases (compras)
```
PATHS                        dashboard-app/src/app/api/pos/purchase-orders/route.ts ·
                             src/app/inventario-real/orden-compra/
DEPLOY_TARGET                Vercel
SOURCE_OF_TRUTH              origin/main — es el dominio más activo: #423 #424 #425 #426
                             mergeados en las últimas 6 horas del baseline
BRANCHES_WITH_UNMERGED_CHANGES  p0a/po-create-integrity (SÓLO REMOTA, 33 commits, sin PR) ·
                             p0a/recepcion-sin-fail-open (1 commit local sin empujar) ·
                             p0a/po-ui-tax-consistency
```

### cash / shifts (caja y turnos)
```
PATHS                        src/components/pos/{CajonDeCaja,MovimientoDeCaja,ReporteDeCaja,
                             CierreCajaWizard,TurnoDeCaja,CobroDeCaja}.tsx ·
                             src/app/caja/ · src/app/cortes/ · src/app/pos/corte/ ·
                             electron-app/local-server/core/financial-domain.js
DEPLOY_TARGET                Vercel (UI) + instalador (dominio financiero local)
SOURCE_OF_TRUTH              origin/main
HAS_DUPLICATE_IMPLEMENTATION SÍ — ver PARALLEL-REALITIES PR-03. Implementación rival completa,
                             SIN COMMITEAR, en .codex/worktrees/product-closure-20260905
BRANCHES_WITH_UNMERGED_CHANGES  #403 fix/cierre-z-cuentas-invisibles · #409 · fix/turno-verdad-unica ·
                             fix/cierre-z-limpia-el-dia · codex/pos-mandatory-daily-z
```

### migrations
```
PATHS                        supabase/migrations/ (51 archivos en main: 37 normales,
                             13 PENDIENTE_, 1 README)
RUNTIME                      PostgreSQL (Supabase)
DEPLOY_TARGET                **NINGUNO AUTOMÁTICO.** Se aplican a mano. No hay workflow que
                             las corra contra AMALAY prod
SOURCE_OF_TRUTH              DISPUTADO — el ledger de la BD y los archivos del repo no cuadran.
                             Ver MIGRATION-STATE-SUMMARY.md
HAS_DUPLICATE_IMPLEMENTATION SÍ — 14 migraciones existen en ramas y no en main; 2 pares con el
                             mismo objetivo y distinto timestamp
BRANCHES_WITH_UNMERGED_CHANGES  ~13 ramas con PENDIENTE_* propias
```

### agents
```
PATHS                        agents/ (82) · .github/scripts/ (117) · dashboard-app/src/lib/agents/
RUNTIME                      GitHub Actions (cron) + Groq + Supabase REST + Telegram
DEPLOY_TARGET                GitHub Actions. `/agents/` y `/scripts/` están excluidos de Vercel
SOURCE_OF_TRUTH              origin/main
BRANCHES_WITH_UNMERGED_CHANGES  agent-os/* (10 ramas, 84–97 commits cada una, TODAS sólo locales) ·
                             agent-os/runtime · agent-os/integration
```

### certification rigs
```
PATHS                        dashboard-app/e2e/paridad/ (15) · dashboard-app/e2e/paridad/cert/
RUNTIME                      Playwright / Node
DEPLOY_TARGET                CI y laboratorio local
SOURCE_OF_TRUTH              NO ESTÁ EN MAIN. Vive en cert/rig-v1-pr1 (PR #418) cuya base es
                             golden/candidate-20260914, no main
BRANCHES_WITH_UNMERGED_CHANGES  cert/rig-v1-pr1 (#418) · cert/rig-v1-pr2 · golden/candidate-20260914
```

### scripts
```
PATHS                        scripts/ (84)
DEPLOY_TARGET                Ninguno (excluido de Vercel)
SOURCE_OF_TRUTH              origin/main
NOTA                         `scripts/buscar-evidencia.sh`, que CLAUDE.md cita como procedimiento
                             probado, está UNTRACKED en el checkout principal. Sí existe
                             commiteado en la rama docs/arquitectura-offline-al-repo (PR #159,
                             abierto desde hace 429 commits) — o sea, **no está en main**
```

### GitHub Actions
```
PATHS                        .github/workflows/ (81 workflows)
SOURCE_OF_TRUTH              origin/main
NOTA                         Sólo UN check es obligatorio para mergear a main: `test`.
                             Los otros 80 workflows no bloquean
```

### docs / architecture
```
PATHS                        docs/ (497) · "FULLSITE DOCS"/ (45) · .context/
SOURCE_OF_TRUTH              docs/DECISION-BRAIN.md es el router declarado
NOTA                         El mapa maestro del sistema (docs/system/SYSTEM-MAP.md,
                             SOURCE-OF-TRUTH.md, FIELD_CERT_CONTRACT.md) NO está en main:
                             vive sólo en la rama local docs/system-state-map
```

### operational artifacts
```
PATHS                        tools/brain/ · tools/schema-drift/ · docs/system/
RUNTIME                      Node (brain.mjs, drift-guard.mjs)
DEPLOY_TARGET                Ninguno
SOURCE_OF_TRUTH              **FUERA DE MAIN Y SIN RESPALDO REMOTO** — rama local
                             docs/system-state-map, worktree en /private/tmp. Ver P0-3
```

### demos / scratchpads
```
PATHS                        dashboard-app/src/app/demo/ · demo.html · caso-amalay.html ·
                             content-engine/ (89) · output/ · data/
NOTA                         data/backfill/amalay-wansoft-2026-07-11_2026-09-09.json (238 KB)
                             contiene ventas diarias reales de AMALAY, nombres de meseros y
                             propinas — en un repositorio PÚBLICO. Ver P0-1
```

---

## Deployment source of truth

### Qué dispara Vercel
`vercel.json` en la raíz define un `ignoreCommand` que **cancela el build** si el commit sólo
toca `docs/`, `Legal/`, `AMALAY X FULLSITE/`, `electron-app/`, `electron-kds/`,
`electron-dashboard/`, `print-bridge/`, `agents/`, `scripts/`, `graphify-out/`, `ios/`,
`fullsite-web/`, `tests/` o `.github/`. Todo lo demás construye.

### Qué rama despliega producción
**Sólo `main`.** Verificado sobre los **120 deployments de producción** entre 2026-09-01 y
2026-09-19: los 120 traen `meta.githubCommitSha`, y el conjunto de `githubCommitRef` es
exactamente `{main}`. **Cero deploys de producción sin metadata de git en esa ventana.**

> Alcance de esa negación: la ventana empieza el 2026-09-01. No cubre el incidente conocido
> de deploy sin git del 2026-08-28. No afirmo que nunca haya pasado; afirmo que no pasó en
> septiembre.

### ¿Cada merge a main despliega automáticamente?
Sí. Cinco de cinco, con desfase de 2–4 segundos entre el merge y la creación del deployment:

| PR | Merge (CST) | Deployment creado | SHA |
|---|---|---|---|
| #426 | 00:09:20 | 00:09:23 | `418933f4` |
| #425 | 23:57:05 | 23:57:07 | `10a1caa7` |
| #424 | 22:23:41 | 22:23:44 | `de435f5d` |
| #423 | 19:36:04 | 19:36:07 | `427af68c` |
| #417 | 10:15:20 (15-sep) | 10:15:23 | `10017cf9` |

### Qué SHA sirve app.fullsite.mx
Al cierre de la auditoría: deployment `dpl_7aHncjNL1JzyDsqo9NqfbDr4i7Br`, SHA `418933f4`,
alias `app.fullsite.mx`, `sandbox.app.fullsite.mx`, `fullsite-sage.vercel.app`,
`fullsite-git-main-…`.

> `sandbox.app.fullsite.mx` apunta al **mismo deployment de producción**. No es un entorno
> separado. Ver P1-6.

### Los 6 proyectos Vercel del scope

| Proyecto | URL de producción | Última actualización |
|---|---|---|
| `fullsite` | app.fullsite.mx | 7 min |
| `fullsite-uber-sandbox` | fullsite-uber-sandbox.vercel.app | 21 días |
| `fullsite-diezmex-demo` | diezmex.fullsite.mx | 22 días |
| `dashboard-app` | dashboard-app-…vercel.app | 29 días |
| `cp-wt2` | cp-wt2-…vercel.app | 38 días |
| `fullsite-client2-demo` | fullsite-client2-demo.vercel.app | 40 días |

`dashboard-app` y `cp-wt2` no corresponden a ningún directorio/rama documentado como activo.
Son candidatos a despliegue equivocado si alguien los relinkea desde la raíz del repo.

### Qué NO se despliega solo

| Artefacto | Cómo llega a producción |
|---|---|
| `electron-app/`, `electron-kds/`, `print-bridge/` | Instalador + reinstalación física en la caja |
| `supabase/migrations/**` | **A mano.** No hay workflow que las aplique |
| `agents/`, `.github/scripts/` | Corren en GitHub Actions desde main; no viajan por Vercel |
| `scripts/` | Nunca se despliega |
| `fullsite-web/` | Proyecto aparte (Cloudflare Pages, repo `danielfullsite/fullsite-web`) |

### Código que puede estar en main y no estar activo
- **Todo lo que dependa de `pos_terminals`, `pos_terminal_enrollments` o
  `tenant_source_authority`**: 11 + 4 + 1 archivos en main referencian tablas que **no existen
  en la BD de AMALAY**. Ver P0-5.
- Las 13 migraciones `PENDIENTE_*` de main: están versionadas, desplegadas como texto, y sin
  efecto en la BD.
- Rutas detrás de banderas: `redesign/pos-tile` (#408) se describe como "rediseño tras bandera
  reversible" — si la bandera está apagada, el código viaja pero no se ve.

---

## Protección de `main` (estado actual)

```
required_status_checks   = ["test"]      strict = false   ← se puede mergear con base vieja
enforce_admins           = false         ← el owner puede saltarse la protección
required_linear_history  = false
allow_force_pushes       = false   ✔
allow_deletions          = false   ✔
required_conversation_resolution = false
rulesets                 = []            (ninguno)
delete_branch_on_merge   = false         ← causa raíz de las 330 ramas remotas
allow_squash / merge_commit / rebase = los tres habilitados
```
