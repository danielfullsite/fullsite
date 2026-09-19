# REPO / BRANCH / SOURCE-OF-TRUTH AUDIT — Fullsite

> **Fecha:** 2026-09-19 · **Modo:** READ-ONLY. No hubo merge, rebase, cherry-pick, borrado de
> ramas, push, tag, commit, deploy ni escritura a BD. La única escritura fue `git fetch origin
> --no-prune` (aditivo, no borra refs) y la creación de los 7 archivos de este directorio.
>
> **Baseline de comparación:** `MAIN_SHA = 10a1caa76e63caebd0c4bf7efcd9976b30abd8ac`
> (`fix(compras): un número tiene que ser un número (#425)`, 2026-09-18 23:57).
>
> **⚠ El baseline se movió durante la auditoría.** A las 00:09 del 2026-09-19 otra sesión
> mergeó el PR #426 y `origin/main` pasó a `418933f4`. La rama `fix/inventario-al-moverse`
> existía como ref remoto al inicio del escaneo y ya no existe al final. Todas las cifras de
> este documento están ancladas al baseline; lee la sección §8 sobre trabajo concurrente.

---

## PARTE 1 — INVENTARIO

```
REPOSITORY               = danielfullsite/fullsite
VISIBILITY               = PUBLIC          ← ver GIT-RISK-REGISTER P0-1
DEFAULT_BRANCH           = main
MAIN_SHA (baseline)      = 10a1caa76e63caebd0c4bf7efcd9976b30abd8ac
MAIN_SHA (fin auditoría) = 418933f4
REMOTES                  = origin     https://github.com/danielfullsite/fullsite.git  (vivo)
                           old-origin https://github.com/ramonfaurdaniel-png/fullsite.git (404 — repo no existe)
LOCAL_BRANCH_COUNT       = 517
REMOTE_BRANCH_COUNT      = 330 (origin) + 1 (old-origin/main, ref muerto)
UNIQUE_BRANCH_NAMES      = 543  (303 en ambos · 214 sólo locales · 26 sólo remotas)
OPEN_PR_COUNT            = 58
CLOSED_UNMERGED_PR_COUNT = 27
MERGED_PR_COUNT          = 340
TAG_COUNT                = 5   (2 NO están en main)
WORKTREES                = 103
STASHES                  = 8
DIRTY_WORKTREES          = 14 con archivos trackeados modificados · 25 con untracked
```

### Worktrees — dónde están

| Ubicación | Cantidad | Riesgo de volatilidad |
|---|---:|---|
| `/Users/danielrg/fullsite` (checkout principal) | 1 | Persistente. **Sucio: 58 modificados + 65 untracked** |
| `/Users/danielrg/fullsite-*` y `fullsite-worktrees/*` | 30 | Persistente |
| `/Users/danielrg/fullsite/.claude/worktrees/*` | 20 | Persistente |
| `/Users/danielrg/fullsite/.codex/worktrees/*` | 33 | Persistente |
| `/Users/danielrg/fullsite/.octogent/worktrees/*` | 3 | Persistente |
| **`/private/tmp/claude-501/.../scratchpad/wt-*`** | **16** | **VOLÁTIL — `/private/tmp` se limpia** |

4 worktrees están marcados `prunable` (su directorio ya no existe): `wt-aislamiento`,
`wt-pra`, `wt-touch`, `wt-tile`. Sus ramas siguen vivas en `.git`; sólo se perdió el
directorio de trabajo.

**Matiz importante:** las ramas de los worktrees de `/private/tmp` viven en
`/Users/danielrg/fullsite/.git/refs/heads`, no en el directorio temporal. Si `/private/tmp`
se limpia, **la rama sobrevive**; lo que muere es únicamente lo no commiteado dentro de ese
directorio. Hoy eso son 3 archivos en `wt-sistema` (ver P0-3).

### Dónde vive código que no está en ninguna otra parte

| Sólo en… | Hallazgo | Detalle |
|---|---|---|
| **Archivo untracked** | **63 archivos / 17,536 líneas** en el checkout principal que **nunca se han commiteado en ninguna rama, local ni remota** | P0-2 |
| **Rama local** | **80 ramas** con parches únicos no presentes en main y sin respaldo remoto fiel | 240 ramas en total carecen de respaldo remoto idéntico |
| **Worktree (untracked)** | ~30 archivos huérfanos en `.codex/worktrees/product-closure-20260905`, incl. 2 migraciones `PENDIENTE_` | P0-4 |
| **Stash** | 8 stashes, todos recuperables; el más grande (`stash@{7}`) con 61 archivos | P2 |
| **Rama remota sin PR** | 6 ramas remotas con trabajo único y sin PR | incl. `p0a/po-create-integrity` (33 commits, 2026-09-18) |

**Verificación usada** (regla del descubrimiento): para cada ruta untracked se corrió
`git log --all --format=%H -1 -- "<ruta>"`; `--all` cubre `refs/heads` **y** `refs/remotes`.
Un resultado vacío significa "no existe en ninguna ref alcanzable de este clon", no
"no existe en el universo". Ninguna de esas rutas está cubierta por `.gitignore`
(verificado con `git check-ignore`), así que todas son visibles en `git status`.

---

## PARTE 2 — CLASIFICACIÓN DE RAMAS

El detalle por rama, con los 12 campos pedidos, está en
[`BRANCH-INVENTORY.json`](BRANCH-INVENTORY.json). Resumen:

| CATEGORY | Ramas | Qué significa aquí |
|---|---:|---|
| `MERGED_BUT_HISTORY_NOT_MAIN` | 358 | Contenido en main, historia no. Efecto del **squash merge**: el tip de la rama no es ancestro de `main` aunque su árbol sí esté dentro |
| `UNIQUE_UNMERGED_WORK` | 74 | Parches que no existen en main y sin PR que los reclame |
| `ACTIVE` | 59 | Con PR abierto (58) + `main` |
| `GENERATED_OR_CERT` | 27 | `backup/*`, `build/*`, `golden/*`, `cert/*`, `octogent/*`, `fisica/*`, `dependabot/*`, `pr62`, `tmp-merge-110` |
| `PRIVATE_OPERATIONAL` | 15 | Cerebro operativo, mapas de sistema, agent-os, control center |
| `CONTENT_LANDED_VIA_OTHER_PR` | 10 | Sin PR propio; su árbol ya coincide con main |

### La distinción que el encargo pedía separar

`MERGED_INTO_MAIN` (el tip es ancestro de `origin/main`) y
`TREE_CONTENT_ALREADY_IN_MAIN` (main ya contiene ese contenido) **no coinciden**:

```
MERGED_INTO_MAIN = yes .....................  94 de 543  (17%)
TREE_CONTENT_ALREADY_IN_MAIN = yes ......... 98 de 543  (18%)
```

Pero los conjuntos no son el mismo, y el caso general es el inverso: **449 ramas no son
ancestros de main** y sin embargo 358 de ellas tienen su contenido dentro, porque se
integraron por squash. El repo tiene `allow_squash_merge`, `allow_merge_commit` y
`allow_rebase_merge` los tres habilitados, así que **el nombre del método usado no es
deducible desde la rama** — hay que mirar el PR.

**Ejemplo vivo, capturado durante esta auditoría:** el PR #426 se mergeó a las 00:09. Su
commit head `f10a72ea` **no es ancestro** de `origin/main` (`git merge-base --is-ancestor
f10a72ea origin/main` → falso), pero su contenido sí entró. Borrar esa rama por "no es
ancestro de main" habría sido correcto; borrar otra con la misma señal podría no serlo.

### Divergencia local vs remoto

26 ramas tienen SHA local ≠ SHA remoto. Desglose por causa:

| Situación | Ramas | Ejemplos |
|---|---:|---|
| Local **adelante**, con commits únicos sin empujar | 12 | `sandbox/second-customer-skeleton` (**59 commits únicos**), `release/offline-field-2026-08-06` (12), `integration/client2-rc1` (8), `offline-shell/local-load` (5 — *God Mode* de plataforma) |
| Local adelante pero **sin** commits únicos (sólo merges de main) | 5 | `codex/integrations-100`, `lab/electron-en-ci`, `fix/pos-staff-cache-collision` |
| **Divergidas** (ambas adelantadas) | 6 | `fix/pos-mesa-nav-offline` (2 vs 4), `fix/ordenes-fantasma` (3 vs 1), `sec/uber-integration-routes-auth` (14 vs 1) |
| Remoto adelante (local rezagado, sin riesgo) | 3 | `docs/biblia-competencia` (+69), `fix/agent-results-jsonb` (+68), `rescue/pre-optimization-2026-07-24` (+10) |
| `main` local rezagada 192 commits, **0 commits locales** | 1 | Sin riesgo |

> **`git push` masivo sería destructivo aquí.** 6 ramas están divergidas: un push a esas
> requiere decidir por contrato, no por "la mía es más nueva".

### Duplicación estructural de ramas de agente

13 ramas `claude/<adjetivo>-<apellido>-<hex>` apuntan a **exactamente el mismo trabajo**
(37 commits, 34 parches, 123 archivos, "installer gap kit", 2026-08-05). Son worktrees de
agente que nunca se limpiaron. Mismo patrón en `agent-os/TSK-0XX` (10 ramas con 84-97
commits cada una, todas con la misma base acumulada) y `fisica/*` + `hmac/*` (4 ramas,
2026-09-14, variantes del mismo experimento de huella).

---

## PARTE 3 — REALIDADES PARALELAS

Detalle estructurado en [`PARALLEL-REALITIES.json`](PARALLEL-REALITIES.json). Titulares:

1. **`dashboard-app/src/app/pos/page.tsx` tiene 5 versiones divergentes vivas.**
   7,045 líneas en main; `barrido3/lentes-restantes` (#395) −65, `claude/pos-touch-first`
   (#399) +147, `redesign/pos-tile` (#408) −45, y **`feat/pos-ui-kit` (la rama del checkout
   principal) −1,119 líneas** sobre una base **666 commits atrás de main**. Mergear esa
   última revertiría trabajo.

2. **Cadena apilada #395 ← #396 ← #397** (28 → 31 → 174 archivos, +10,468/−6,486 en el
   último). No apunta a main; el eslabón final depende de dos PRs abiertos.

3. **Caja/corte implementado dos veces.** Main tiene `CajonDeCaja.tsx`,
   `MovimientoDeCaja.tsx`, `ReporteDeCaja.tsx`, `CierreCajaWizard.tsx`. El worktree
   `.codex/worktrees/product-closure-20260905` tiene sin commitear `CorteDeCaja.tsx`,
   `MovimientosDeCaja.tsx`, `caja-reportes.ts`, `caja-reporte-cloud.ts` — nombres distintos,
   mismo objetivo, y **ninguno existe en ninguna rama**.

4. **Delivery→KDS por dos caminos:** `fix/delivery-kds-server-read` (#23, draft, 4 archivos,
   base 836 commits atrás) y `fix/delivery-app-server-read` (local-only, 103 commits).

5. **#416 `integracion/campo-20260914` duplica siete PRs abiertos** (#403–#409, #414, #415).
   Su propio título dice *"NO MERGEAR — es prueba"*. Es una realidad paralela deliberada,
   pero está abierta y mergeable.

6. **Migraciones con el mismo objetivo y distinto timestamp:**
   `20260914210000_ocm_daily_security_invoker.sql` (en rama) vs
   `20260915040000_ocm_daily_security_invoker.sql` (en main).

7. **Dos apps Electron en el árbol:** `electron-app/` (171 archivos) y `electron-kds/`
   (2 archivos: `main.js`, `preload.js`).

---

## PARTE 4 — MAPA DE CÓDIGO

Ver [`SOURCE-OF-TRUTH-MAP.md`](SOURCE-OF-TRUTH-MAP.md).

---

## PARTE 5 — DESPLIEGUE

Ver [`SOURCE-OF-TRUTH-MAP.md`](SOURCE-OF-TRUTH-MAP.md) §Deployment.

---

## PARTE 6 — MIGRACIONES

Ver [`MIGRATION-STATE-SUMMARY.md`](MIGRATION-STATE-SUMMARY.md).

---

## PARTE 7 y 8 — ACTIVOS PRIVADOS Y RIESGO

Ver [`GIT-RISK-REGISTER.md`](GIT-RISK-REGISTER.md).

---

## PARTE 9 — ARQUITECTURA FUTURA

Ver [`FUTURE-GIT-ARCHITECTURE.md`](FUTURE-GIT-ARCHITECTURE.md).

---

## §8 — TRABAJO CONCURRENTE DETECTADO

Durante la auditoría había en la máquina varios procesos `claude` activos (uno con
`--dangerously-skip-permissions`) y un Electron corriendo desde
`/private/tmp/.../wt-golden`. En ~7 minutos de reloj:

- `origin/main` avanzó `10a1caa7` → `418933f4` (PR #426).
- El ref `refs/remotes/origin/fix/inventario-al-moverse` existía al iniciar el escaneo de
  ramas y ya no existía al terminar (rama borrada en GitHub tras el merge).
- Se disparó un deploy de producción a las 00:09:23.
- A las 00:26:38, mientras se redactaban estos entregables, apareció una rama local nueva:
  `docs/field-cert-418933f4` (creada desde `origin/main`, 1 commit `ddb52631`,
  *"runbook F1–F9 pineado a 418933f4"*). El conteo de ramas locales pasó de 517 a 518 sin
  intervención de esta auditoría (verificado por `git reflog show` de esa rama).

**Consecuencia para esta auditoría:** el inventario es una foto, no un estado estable.
Cualquier decisión de limpieza debe revalidar el SHA justo antes de ejecutarse.

---

## Cómo se produjo cada número

| Afirmación | Comando |
|---|---|
| Conteos de ramas | `git for-each-ref refs/heads` / `refs/remotes/origin` |
| Ancestría | `git merge-base --is-ancestor <tip> origin/main` |
| Contenido ya en main | `git diff --name-only origin/main <tip>` vacío |
| Parches únicos | `git cherry origin/main <tip>` → líneas `+` |
| Untracked nunca commiteado | `git log --all --format=%H -1 -- <ruta>` vacío |
| Estado de worktrees | `git worktree list --porcelain` + `git -C <path> status --porcelain` |
| PRs | `gh pr list --state all --limit 1000 --json …` (425 PRs) |
| Deploys | `vercel ls fullsite --prod -F json` (120 deployments, 2026-09-01→19) |
| Ledger de migraciones | MCP `supabase-amalay` → `list_migrations` (read-only) |
| Efecto en BD | `pg_class` / `pg_attribute` (no `information_schema`, que filtra por privilegios) |
| Visibilidad y protección | `gh api repos/danielfullsite/fullsite` y `…/branches/main/protection` |
