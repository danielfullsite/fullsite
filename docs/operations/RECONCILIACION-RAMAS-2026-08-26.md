# Reconciliación de ramas — 2026-08-26

**Medido a las 06:00 del 2026-08-26** contra `origin/main` (`b5fe8bb2`), cruzando
`git branch -r --no-merged` contra los 138 PRs del repositorio.

> Este documento **no borra nada**. Clasifica, y dice qué se puede borrar sin perder
> trabajo y qué no. Borrar ramas ajenas sin comprobar de quién son y en qué estado están
> es justo lo que el protocolo prohíbe (CLAUDE.md §3, §18).

---

## El resultado

**104 ramas remotas sin mergear a `main`.** No son 104 pendientes:

| | Ramas | Qué son |
|---|---:|---|
| **PR ya mergeado** | **65** | El contenido está en `main`. La rama sobró del *squash merge*. Ruido puro. |
| **PR abierto** | 18 | Trabajo vivo, en revisión |
| **Sin PR** | 21 | Las únicas que hay que mirar una por una |

Cero PRs cerrados sin mergear — nada se descartó a medias.

> El 63% del "desorden" es un artefacto del *squash merge*: GitHub no borra la rama, y
> `--no-merged` no reconoce el squash porque el commit resultante tiene otro *patch-id*.
> Por eso `git branch --merged` no sirve aquí y hay que cruzar contra los PRs.

---

## Las 21 sin PR

`atrás` = commits de `main` que la rama no tiene. `integra` = si `git merge-tree` produce
conflictos contra `main` hoy.

| Rama | Último | Archivos | Atrás | Integra | Veredicto |
|---|---|---:|---:|---|---|
| `uber/validation-ready` | 08-26 | **35** | 390 | 🔴 conflicto | **Rescatar.** 3,144 renglones de la certificación de Uber |
| `docs/revision-20260826` | 08-26 | 1 | 16 | ✅ limpio | PR abierto → #140 |
| `codex/rappi-kds-bridge-138` | 08-24 | 56 | 215 | 🔴 conflicto | Revisar contra el puente de Rappi que ya está en `main` |
| `codex/delivery-test-mode` | 08-24 | 56 | 215 | 🔴 conflicto | Mismo tamaño que la anterior — probablemente hermanas |
| `redesign/ds-v2.2` | 08-23 | 6 | 94 | 🔴 conflicto | Rama de *preview*, marcada **NO merge a main** |
| `fix/pos-offline-mesa-nav` | 08-23 | 2 | 94 | ✅ limpio | **Muerta a propósito** — ver abajo |
| `docs/fullsite-master-execution` | 08-21 | 2 | 112 | ✅ limpio | PR abierto → #141 |
| `backup/pos-ui-kit-20260821` | 08-19 | 54 | 215 | 🔴 conflicto | Respaldo, por nombre |
| `backup/pos-ui-kit-20260819` | 08-19 | 54 | 215 | 🔴 conflicto | Respaldo |
| `backup/pos-ui-kit-20260818` | 08-18 | 37 | 215 | 🔴 conflicto | Respaldo |
| `fix/kds-public-route` | 08-18 | 37 | 191 | 🔴 conflicto | Trae los commits de blindaje B1–B3 y F1–F2 |
| `offline-shell/local-load` | 08-14 | **315** | 390 | 🔴 conflicto | La más grande. Decisión, no limpieza |
| `redesign/dashboard-v1` | 08-11 | 36 | 385 | 🔴 conflicto | Rediseño |
| `golden-skeleton/v1` | 08-11 | 259 | 390 | 🔴 conflicto | Decisión |
| `integration/client2-rc1` | 08-08 | 159 | 387 | 🔴 conflicto | Decisión |
| `bug-019/tenant-rls` | 08-07 | 188 | 390 | 🔴 conflicto | Decisión |
| `docs/clonable-core-v1` | 08-07 | 183 | 390 | 🔴 conflicto | Decisión |
| `release/offline-field-2026-08-06` | 08-06 | 182 | 390 | 🔴 conflicto | Corte de versión |
| `build/installer-v1.3.4` | 08-06 | 182 | 390 | 🔴 conflicto | Corte de versión |
| `integrations/uber-eats` | 07-31 | 1 | 485 | 🔴 conflicto | Antecesora de `uber/validation-ready` |
| `old-origin/main` | — | 0 | — | — | Artefacto de una migración de remoto |

### Lo que hay que rescatar: `uber/validation-ready`

**35 archivos, 3,144 inserciones, sin PR.** Es toda la certificación de Uber Eats: los
arreglos de contrato en `menu.ts` (`day_of_week`, `time_periods`, `modifier_group_ids`,
títulos con `translations`), más `promotions.ts`, `fulfillment.ts`, `reporting.ts`,
`oauth.ts`, y ocho documentos — el runbook de la orden de prueba, el checklist de
despliegue, la evidencia de validación y el mapa de identidades y accesos.

**Está 390 commits atrás de `main` y tiene conflictos.** Rebasarla no es limpieza: es
trabajo de integración sobre código que no se puede verificar sin el *sandbox* de Uber
respondiendo. Por eso no se hizo de madrugada.

### La que está muerta con razón: `fix/pos-offline-mesa-nav`

Vale la pena dejarlo escrito, porque parece trabajo perdido y no lo es.

La rama cambia abrir mesa de `window.location.href` a `router.push`, con este argumento:

> *"La navegación DURA rompía offline: forzaba recarga completa → dependía del SW."*

`main` hace lo contrario, y también cita evidencia de campo:

> *"En este Next.js (16.2) `router.push('/pos?mesa=N')` desde `/pos/mesas` SOLTABA el
> `?mesa=` y caía al default (mesa 1) — tocabas la 52 y abría la 1."*

Parece una contradicción sin resolver entre dos observaciones de campo. Sobre la **rama**
no lo es: el commit de `main` es literalmente un `Revert` del suyo, **el mismo día**.
Además arrastra un commit marcado **"(NO merge a main)"** — un *fallback* de
`NEXT_PUBLIC_SUPABASE_*` en `next.config.ts` para que compilara el preview. Mergearla
metería eso a producción.

**Veredicto sobre la rama: borrable.**

### Corrección — el problema NO estaba resuelto

La primera versión de este documento decía que la objeción de offline "quedó contestada"
por el comentario que sobrevivió en `main`:

> *"Offline el SW sirve `/pos` del cache (con `ignoreVary`), así que funciona sin internet
> igual."*

**Eso era creerle a un comentario, no a una medición.** El PR **#110**
(`fix/pos-mesa-nav-offline`, abierto el 2026-08-26) mide las dos y encuentra que ninguna
funciona sola:

> · `window.location.href` → recarga dura → depende del SW **+ gate de auth** → no abría nada
> · `router.push` → resolvía el shell cacheado **sin `?mesa=`** → caía a la mesa 1

La solución es una tercera: llevar la mesa por `sessionStorage` en vez del *query string*,
más una prueba que **fija el método** para que deje de oscilar. El handler ya había
cambiado de técnica varias veces.

O sea: la rama vieja está muerta, pero **el problema siguió abierto un mes** y se está
cerrando ahora en #110. Dos ramas revertiéndose entre sí no son un empate — son la señal
de que a las dos les faltaba una pieza.

---

## Las 65 sobrantes

Todas tienen un PR mergeado. Su contenido **ya está en `main`**; sólo sobró la rama.

Para borrarlas, una por una y comprobando antes:

```bash
gh pr list --state merged --head <rama> --json number,mergedAt
git push origin --delete <rama>
```

<details>
<summary>Las 65, con su PR</summary>

| Rama | PR | Último commit |
|---|---|---|
| `codex/login-loading-hotfix` | #21 | 2026-08-10 |
| `golden-skeleton/v2` | #22 | 2026-08-11 |
| `codex/rappi-kds-bridge` | #58 | 2026-08-24 |
| `codex/uber-promotion-scope` | #57 | 2026-08-24 |
| `docs/protocolo-y-runbook` | #70 | 2026-08-24 |
| `docs/rollback-y-checklist-campo` | #71 | 2026-08-24 |
| `fix/ci-required-check-always-reports` | #67 | 2026-08-24 |
| `fix/ci-stale-tests` | #64 | 2026-08-24 |
| `fix/local-server-identity` | #66 | 2026-08-24 |
| `fix/offline-modifier-groups` | #63 | 2026-08-24 |
| `fix/replay-business-403` | #61 | 2026-08-24 |
| `fix/staff-onboarding` | #65 | 2026-08-24 |
| `docs/gtm-linea-base` | #95 | 2026-08-25 |
| `docs/matriz-dinero` | #74 | 2026-08-25 |
| `docs/rappi-estado-real` | #102 | 2026-08-25 |
| `feat/campana-en-cristiano` | #100 | 2026-08-25 |
| `feat/centro-agentes` | #88 | 2026-08-25 |
| `feat/nav-y-graficas` | #92 | 2026-08-25 |
| `feat/promover-rediseno` | #90 | 2026-08-25 |
| `fix/coma-tabular` | #94 | 2026-08-25 |
| `fix/config-por-tenant` | #101 | 2026-08-25 |
| `fix/dashboard-detalles` | #86 | 2026-08-25 |
| `fix/fraud-watcher-caido` | #99 | 2026-08-25 |
| `fix/logo-notificacion` | #97 | 2026-08-25 |
| `fix/piso-tactil` | #93 | 2026-08-25 |
| `fix/telegram-no-tumba-ci` | #96 | 2026-08-25 |
| `fix/visual-picker` | #89 | 2026-08-25 |
| `p0/agent-briefing-tenant` | #87 | 2026-08-25 |
| `p0/agente-fuga-tenant` | #98 | 2026-08-25 |
| `p0/rutas-sin-auth` | #103 | 2026-08-25 |
| `p0/tenant-sin-sesion` | #91 | 2026-08-25 |
| `redesign/dashboard-restaurantero` | #85 | 2026-08-25 |
| `redesign/dashboard-turno` | #82 | 2026-08-25 |
| `redesign/ds-v3-componentes` | #77 | 2026-08-25 |
| `redesign/ds-v3-tokens` | #75 | 2026-08-25 |
| `redesign/ola1-tablas` | #79 | 2026-08-25 |
| `redesign/piloto-ajustes` | #80 | 2026-08-25 |
| `redesign/piloto-tipografia` | #81 | 2026-08-25 |
| `redesign/savio` | #84 | 2026-08-25 |
| `redesign/table-dialog` | #73 | 2026-08-25 |
| `sec/pos-db-proxy` | #76 | 2026-08-25 |
| `chore/baseline-esquema-32947802599` | #123 | 2026-08-26 |
| `chore/esquema-baseline` | #111 | 2026-08-26 |
| `docs/cron-desplegado` | #135 | 2026-08-26 |
| `docs/kitchen-token-abierto` | #131 | 2026-08-26 |
| `docs/migracion-pins` | #122 | 2026-08-26 |
| `feat/demo-24-7` | #137 | 2026-08-26 |
| `feat/ocm-fase3-yoy` | #119 | 2026-08-26 |
| `fix/baseline-primera-corrida` | #121 | 2026-08-26 |
| `fix/build-sin-credenciales` | #114 | 2026-08-26 |
| `fix/cron-fail-closed` | #130 | 2026-08-26 |
| `fix/detector-por-tabla` | #127 | 2026-08-26 |
| `fix/dia-uno` | #105 | 2026-08-26 |
| `fix/roi-honesto` | #106 | 2026-08-26 |
| `fix/token-no-cachea-su-fallo` | #108 | 2026-08-26 |
| `fix/uber-day3-desglose-apis` | #113 | 2026-08-26 |
| `fix/uber-pause-offline-until` | #116 | 2026-08-26 |
| `fix/uber-scope-probe-promotions` | #112 | 2026-08-26 |
| `fix/uber-store-id-nueva` | #120 | 2026-08-26 |
| `fix/uber-store-status-pause` | #115 | 2026-08-26 |
| `fix/workflow-pr-degradado` | #124 | 2026-08-26 |
| `sec/finance-agent-tenant` | #126 | 2026-08-26 |
| `sec/politicas-permisivas` | #117 | 2026-08-26 |
| `sec/uber-integration-routes-auth` | #107 | 2026-08-26 |
| `test/rutas-sin-guardian` | #109 | 2026-08-26 |

</details>

---

## Cómo se midió

```bash
# ramas sin mergear
git branch -r --no-merged origin/main

# todos los PRs, para cruzar
gh pr list --state all --limit 400 --json number,state,headRefName,mergedAt

# por rama: archivos que difieren, cuánto atrás va, si integra limpio
git diff --name-only origin/main...origin/<rama> | wc -l
git rev-list --count origin/<rama>..origin/main
git merge-tree --write-tree origin/main origin/<rama>
```

`git merge-tree --write-tree` prueba la fusión **sin tocar el árbol de trabajo** — se
puede correr sobre 104 ramas sin riesgo de dejar el repositorio a medias.

> Un apunte de método: el primer intento usó `git diff origin/main...origin/<rama>` para
> detectar ramas ya integradas. Dio **CON-DIFF en las 104** — inútil. La razón es que un
> *squash merge* no deja rastro que `git` reconozca del lado de la rama. La señal buena
> no estaba en `git`, estaba en GitHub: el estado del PR.
