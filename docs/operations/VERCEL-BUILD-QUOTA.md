# Vercel: por qué la cola de PRs estaba en rojo

> 2026-08-26. Diagnóstico y arreglo del `build-rate-limit` que tenía media cola
> de PRs en rojo con las pruebas en verde.

## El síntoma

Cinco PRs abiertos (#125, #128, #136, #139, #143) mostraban el check de Vercel en
**FAILURE**, mientras `test` y `local-server` pasaban en todos.

Leído rápido parecía que el código estaba roto. No lo estaba.

## La causa

El check apuntaba a:

```
https://vercel.com/daniel-ramonfaur-s-projects?upgradeToPro=build-rate-limit
```

La cuenta llegó al **tope de builds del plan**. Vercel dejó de construir y marcó
los checks en rojo. No es una falla de código: es cuota agotada.

## Por qué se agotó

`.vercelignore` decide **qué archivos se suben**, no **si el build se dispara**.
Sin un *Ignore Build Step*, cada push a cualquier rama lanza un preview.

Con ~20 PRs abiertos y 104 ramas sin mergear, eso son muchos builds. Y buena
parte no podía cambiar nada de lo desplegado:

- **#142, #141, #140, #138 son 100% documentación** — cero archivos fuera de `docs/`.
- Commits recientes de `main` que sólo tocan `.github/` (workflows, scripts de
  agentes) también disparaban build.

Se estaba gastando cuota para desplegar markdown.

## El arreglo

`vercel.json` en la raíz con un `ignoreCommand` que salta el build cuando el diff
no toca nada desplegable.

**El contrato de Vercel va al revés de la intuición:**

| exit code | efecto |
|---|---|
| `0` | **salta** el build |
| `1` | **construye** |

El comando usa `git diff --quiet`, que devuelve `0` cuando no hay diferencias —
o sea, encaja exacto: sin cambios desplegables → salta.

### Qué se excluye

La lista sale de `.vercelignore` (lo que no se sube) más test y CI:

`docs/` · `Legal/` · `AMALAY X FULLSITE/` · `electron-app/` · `electron-kds/` ·
`electron-dashboard/` · `print-bridge/` · `agents/` · `scripts/` ·
`graphify-out/` · `ios/` · `fullsite-web/` · `tests/` · `.github/`

**`dashboard-app/` nunca se excluye** — es lo que se despliega. Hay una prueba
que lo fija.

### Qué NO se excluye, a propósito

`supabase/migrations/` construye aunque no cambie el bundle. Es la decisión
conservadora: un build de más cuesta cuota, uno de menos deja producción sin
desplegar.

### Por qué va inline y no como script

`.vercelignore` excluye `/scripts/` y además `*.sh`. Un archivo aparte podría no
existir cuando Vercel corre el paso, y el fallo sería silencioso. Inline no
depende de ningún archivo.

## Verificación

**Contra historia real de `main`** — se corrió el comando parado en 15 commits
con resultado conocido: **15/15 correctos**. Ocho que debían saltar (4 sólo
`docs/`, 4 sólo `.github/`) y siete que debían construir (4 con `dashboard-app/`,
3 con migraciones SQL).

**Pruebas de regresión** — `tests/ci/vercel-ignore-build.test.js`, 20 casos
verdes, incluido el sentido de los exit codes en ambas direcciones y el caso
"casi todo docs pero un archivo de app".

**Impacto medido** — sobre los últimos 80 commits de `main`: **21 de 80 builds se
habrían saltado (26%)**. En ramas de PR el ahorro debería ser mayor, porque cada
push dispara preview y ahí viven los PR de sólo-docs, pero eso **no está medido**.

## Modo de falla

El default siempre es **construir**:

- Sin `HEAD^` (primer commit, clone raro) → construye.
- Error de git, comando ausente, sintaxis mala → exit distinto de 0 → construye.

Saltar por error dejaría producción sin desplegar en silencio. Construir de más
sólo cuesta cuota.

## Lo que esto NO arregla

El ahorro del 26% ayuda, pero la causa de fondo es **la cantidad de ramas y PRs
abiertos**: 20 PRs, 104 ramas sin mergear, 63 worktrees activos. Mientras eso no
baje, la cuota se va a volver a apretar.

Si aun con esto se vuelve a topar, la salida es Vercel Pro (~20 USD/mes).

## Si agregas rutas a `.vercelignore`

Agrégalas también al `ignoreCommand` de `vercel.json`, o se seguirán construyendo
builds para archivos que no se suben.
