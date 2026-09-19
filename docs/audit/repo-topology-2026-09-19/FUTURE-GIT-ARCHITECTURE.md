# ARQUITECTURA GIT FUTURA — propuesta

> 2026-09-19 · **Propuesta, no ejecución.** Nada de lo que sigue se aplicó.
> Preferencia declarada por Daniel: 1 repo de producto + posiblemente 1 repo privado de
> operaciones. No 20 microrepos. La evidencia de la auditoría respalda esa forma.

---

## 1. Evaluación de la topología

### PRODUCT_MONOREPO — `danielfullsite/fullsite`

**Veredicto: conservar el monorepo.** La evidencia lo apoya, no sólo la preferencia.

A favor:
- POS, KDS, Pedro, offline y las migraciones **cambian juntos**. El PR #397 toca 174
  archivos cruzando `dashboard-app/`, `electron-app/` y `supabase/` en un solo cambio
  coherente. Partirlos en repos convierte cada cambio en una coreografía de 3 PRs.
- El contrato POS↔Pedro↔KDS no está versionado como paquete; vive en el código. Separar
  repos exige inventar ese paquete antes, y eso es trabajo que hoy no está hecho.
- El `ignoreCommand` de `vercel.json` ya resuelve el único problema real del monorepo
  (builds innecesarios), y funciona.

En contra, y hay que arreglarlo dentro del monorepo:
- Hoy mezcla producto con **negocio**: `data/` con ventas reales, `docs/customers/`,
  `docs/strategy/`, `docs/legal/`, `docs/audit/`. En un repo **público**. Eso no es deuda de
  organización, es P0-1.

**Qué debe contener:**
```
dashboard-app/        electron-app/        electron-kds/  (o retirarlo)
print-bridge/         supabase/migrations/ scripts/
agents/ .github/      tools/schema-drift/  ← subir desde la rama local
dashboard-app/e2e/paridad/cert/            ← subir el rig desde cert/rig-v1-pr1
docs/  (sólo ingeniería: arquitectura, contratos, runbooks, ADRs)
```

**Qué debe salir:** `data/`, `docs/customers/`, `docs/strategy/`, `docs/legal/`,
`docs/audit/`, `content-engine/export/`, `"FULLSITE DOCS"/`, `output/`, `graphify-out/`
(generado; debería ir a `.gitignore` y a un artefacto de CI).

### INTERNAL_OPERATIONAL_REPO — `danielfullsite/fullsite-ops` (privado)

**Veredicto: crear uno, y sólo uno.** Justificación por evidencia:
- Hay **14 activos privados** identificados (tabla de `GIT-RISK-REGISTER.md` §7), de los
  cuales 9 no tienen respaldo remoto.
- El Operational Brain observa **el estado de la flota, no el código**. Su cadencia es
  diaria, la del producto es por PR. Mezclarlos ensucia el historial del producto con
  `observations/*.json` cada día.
- Los dossiers de clientes y la estrategia no pueden estar en un repo público, y tampoco
  deben bloquear un `git clone` del producto para un contratista.

**Qué debe contener:**
```
brain/          (tools/brain: brain.mjs, detectors.mjs, AGENT_REGISTRY.json, observations/)
system/         (SOURCE-OF-TRUTH.md, SYSTEM-MAP.md, RELEASE-BOARD.md, AGENT_SAFETY_POLICY.md)
customers/      (dossiers, SCYF, demos, LOIs)
strategy/       (BIBLE-SQUARE, PLAN-SQUARE-FULLSITE, LOGICA-POR-VERTICAL, tesis)
legal/          (IMPI, SAS, contratos)
audit/          (auditorías de seguridad, incluido este directorio)
field/          (evidencia de campo, actas de certificación)
data/           (backfills, extractos — nunca en el producto)
```

**Qué NO debe contener:** `tools/schema-drift/`. Ese es un guardián que debe correr en el CI
del producto. Va al monorepo.

### Lo que NO se propone
- **No** repos por dominio (pos/kds/pedro). El acoplamiento es real y la ganancia nula.
- **No** submódulos. Añaden un modo de fallo (submódulo desactualizado) que este equipo, con
  agentes 24/7, va a pisar.
- **No** mover `fullsite-web/`: ya vive aparte y funciona.

---

## 2. Reglas propuestas

### `main`
1. Única rama que despliega producción. Ya se cumple (120/120 deploys).
2. **Protección: `strict = true`.** Hoy es `false`; por eso hay 37 PRs mergeables con base de
   200+ commits. Con `strict=true`, un PR verde contra base vieja no se puede mergear.
3. **`enforce_admins = true`.** Hoy es `false`.
4. **Un solo método de merge: squash.** Deshabilitar merge commit y rebase merge. Hoy los
   tres están activos y por eso la trazabilidad rama→main sólo vive en la API de GitHub.
5. **`delete_branch_on_merge = true`.** Causa directa de las 330 ramas remotas.
6. El mensaje de squash debe llevar `(#NNN)` — ya se cumple de facto.
7. `required_conversation_resolution = true`.

### Feature branches
```
<tipo>/<slug-corto>        fix/ feat/ sec/ chore/ docs/ perf/
agente/<agente>/<slug>     para trabajo de agente
rescate/<fecha>-<slug>     para respaldo de trabajo encontrado sin commitear
```
- **Una rama = un PR = un propósito.** Ya está en `CLAUDE.md` §7; hoy se incumple
  (#397 con 174 archivos bajo el título "barrido integral").
- Prohibido apilar más de 2 niveles. Hoy hay una cadena de 3 (#395←#396←#397).
- Toda rama nace de un SHA de `origin/main`, nunca de otra feature branch, salvo excepción
  declarada en el cuerpo del PR.

### PRs
- **Límite duro de tamaño: 40 archivos o 1,500 líneas netas.** Por encima, exige aprobación
  explícita en el cuerpo. Los 4 PRs que hoy rompen ese techo (#397, #399, #20, #395) son
  exactamente los que nadie ha podido revisar en 5 días a 5 semanas.
- El Definition of Done de `CLAUDE.md` §19 ya define el contenido. Añadir dos campos:
  **`MIGRACIONES:`** (ninguna / lista con estado FILE-LEDGER-EFFECT) y
  **`REQUIERE INSTALADOR: sí/no`**.
- Ningún PR puede titularse "NO MERGEAR": si no debe mergearse, es draft o no existe (#416).

### CI
- **Checks obligatorios (hoy sólo hay uno, `test`):**
  1. `test` — suite del dashboard
  2. `typecheck`
  3. `lint` contra baseline
  4. `build` de producción
  5. **`drift-guard`** — nuevo: falla si un archivo `supabase/migrations/*.sql` sin prefijo
     `PENDIENTE_` no tiene su objeto en la BD objetivo, o si un `PENDIENTE_` sí lo tiene.
     Es `tools/schema-drift/drift-guard.mjs`, que ya está escrito y vive en una rama local.
  6. **`no-huerfanos`** — nuevo: falla si el PR agrega un archivo bajo `dashboard-app/src/`
     que ninguna otra ruta importa.
- `strict=true` obliga a que el verde sea contra la punta de main.

> **Principio del proyecto que esto aplica:** *lo que no se puede olvidar es lo que se ejecuta
> solo.* Los seis drifts de migración de esta auditoría los detecta `drift-guard` en 200 ms.
> Un documento que diga "acuérdate de aplicar la migración" no los habría detectado, y de
> hecho no los detectó.

### Worktrees
- **Una sola raíz:** `~/fullsite-wt/<slug>`. Hoy hay seis raíces distintas.
- **Prohibido crear worktrees en `/private/tmp`.** Hoy hay 16, y uno guarda el único ejemplar
  de 3 archivos del cerebro operativo.
- `git worktree prune` semanal, automatizado.
- Un worktree que lleve 7 días con cambios sin commitear dispara alerta. Hoy hay 14 sucios,
  el más antiguo desde el 2026-09-05.

### Ramas de agentes
- Namespace obligatorio `agente/<nombre>/<tarea>`.
- **Un agente no reutiliza la rama de otro.** Las 13 `claude/*` idénticas son el costo de no
  tener esta regla.
- El agente empuja **al crear la rama**, no al terminar. Es la regla que convierte a todas las
  P0 de pérdida de esta auditoría en imposibles.

### Ramas temporales
- Prefijo `tmp/` y caducidad de 7 días.
- `pr62`, `pr358`, `tmp-merge-110`, `worktree-agent-<hex>` se archivan.

### Cleanup
- **Archivar ≠ borrar.** Antes de borrar cualquier rama: empujarla a
  `archive/<fecha>/<nombre>` y sólo entonces borrar la original.
- Caducidad automática: rama remota sin commits en 90 días y con contenido en main → archivo.
- **Nunca borrar por nombre ni por "no es ancestro de main".** Sólo con evidencia de
  `TREE_CONTENT_ALREADY_IN_MAIN` **y** PR `MERGED`.

### Backups
- Ninguna rama debe existir sólo en local por más de 24 horas. Hoy son 240.
- Espejo automático diario del repo completo (`git clone --mirror`) a almacenamiento
  independiente de GitHub. Un `git bundle --all` **no captura stashes** — hay 8.
- Los stashes se convierten en ramas `tmp/stash-<n>-<fecha>` o se descartan explícitamente.

### Releases
- Tag `v<major>.<minor>.<patch>` en cada corte que llega a campo.
- El tag debe referenciar un commit de `main`. Hoy 2 de 5 tags no están en main.
- El instalador de Electron lleva el SHA embebido y lo reporta en `/health`. Hoy la línea
  instalada no es trazable (P1-4).

### Migrations
- `PENDIENTE_` significa **exactamente** "no aplicada en ningún entorno". Hoy hay un archivo
  que lo incumple.
- Al aplicarse, se renombra quitando el prefijo **en el mismo PR** que registra la evidencia.
- El ledger de Supabase es la única autoridad sobre qué está aplicado; el nombre del archivo
  es documentación, no evidencia.
- Toda migración lleva su `_ROLLBACK.sql`. Hoy 1 de 13 lo tiene.
- Prohibido aplicar DDL desde MCP o desde el dashboard de Supabase sin su archivo en el repo.
  Las 26 migraciones sin archivo (M-3) salieron de ahí.

### Operational artifacts
- Van al repo interno, nunca al de producto.
- `observations/` y `out/` se generan: a `.gitignore`, y el estado se publica como artefacto,
  no como commit.
- `AGENT_REGISTRY.json` y `SIGNAL_EXPECTATIONS.json` **sí** se versionan: son contrato.

---

## 3. Reglas específicas para agentes 24/7

Las ocho que pediste, con la evidencia de esta auditoría que justifica cada una:

| Regla | Evidencia que la justifica hoy |
|---|---|
| **Ningún agente trabaja directo en `main`** | Se cumple: 120/120 deploys vienen de PRs. Formalizarlo con `enforce_admins=true` |
| **Cada tarea tiene branch/worktree aislado** | Se cumple en forma, pero con 6 raíces y 103 worktrees. Falta la raíz única |
| **Cada agente parte del SHA aprobado** | **Se incumple:** 37 PRs con base de 200+ commits; `feat/pos-ui-kit` 666 atrás. `strict=true` lo obliga |
| **PR pequeño** | **Se incumple:** #397 = 174 archivos. Techo de 40 archivos / 1,500 líneas |
| **CI obligatorio** | **Se incumple parcialmente:** 1 check de 81 workflows. Subir a 6 |
| **Verificador separado** | Existe (`/code-review`, codex challenge), no es obligatorio. Hacerlo requerido para PRs que tocan POS, offline, caja o migraciones |
| **Merge policy** | **Se incumple:** tres métodos habilitados. Squash único |
| **Branch expiry** | **Se incumple:** 330 ramas remotas, `delete_branch_on_merge=false` |
| **No local-only work** | **Se incumple gravemente:** 240 ramas sin remoto fiel, 80 con trabajo único. **Push al crear la rama** |

### Tres reglas adicionales que esta auditoría hace obvias

**A) Un agente no termina su turno con el worktree sucio.**
Al cerrar, o commitea y empuja, o declara explícitamente qué deja sin commitear y por qué.
14 worktrees sucios y 17,536 líneas huérfanas son el costo acumulado de no tener esta regla.

**B) Ningún agente crea worktrees en directorios efímeros.**
16 worktrees en `/private/tmp`. Uno de ellos guarda el único ejemplar de tres archivos del
cerebro operativo.

**C) Un agente que va a borrar algo prueba primero que existe en otro lado.**
La prueba es `git log --all -- <ruta>` para archivos y `TREE_CONTENT_ALREADY_IN_MAIN` + PR
`MERGED` para ramas. No el nombre, no la fecha, no "parece obvio".

---

## 4. Secuencia propuesta (no ejecutada)

Ordenada por "qué deja de poder perderse", no por esfuerzo.

| # | Acción | Cierra |
|---|---|---|
| 0 | Commitear y empujar todo lo huérfano a ramas `rescate/*`: checkout principal, product-closure, wt-sistema | P0-2, P0-3, P0-4 |
| 1 | `git push` de las 80 ramas locales con trabajo único | P1-1 |
| 2 | Empujar respaldo nuevo de `feat/pos-ui-kit` | P0-6 |
| 3 | Decidir visibilidad del repo; sacar `data/`, `docs/customers|strategy|legal|audit/` | P0-1 |
| 4 | Clasificar el impacto real de `pos_terminals` / `tenant_source_authority` en runtime | P0-5 |
| 5 | `strict=true`, `enforce_admins=true`, squash único, `delete_branch_on_merge=true` | P1-3, P1-7, P1-9 |
| 6 | Subir `tools/schema-drift/` a main y volverlo check obligatorio | M-1…M-6 |
| 7 | Crear `fullsite-ops` privado y mover los 14 activos | P0-3, P2 |
| 8 | Espejo diario + convertir los 8 stashes en ramas | backups |
| 9 | Archivar (no borrar) las 358 con contenido en main y PR merged | P2-1, P3 |
| 10 | Raíz única de worktrees + `prune` semanal | P2-1 |

**STOP.** Nada de esto se ejecutó.
