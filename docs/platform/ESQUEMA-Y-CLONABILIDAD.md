# El esquema no vive en el repositorio

**Medido el 2026-08-26** contra `origin/main` (`24d6aea6`) y la base de producción
`qjiomlvudfmzuvqvhwpk`, por introspección read-only.

> ## ⚠️ Estado al 2026-08-26 05:40 — lo de abajo ya no describe el presente
>
> El diagnóstico original valía cuando `supabase/migrations/` tenía 8 tablas. **El
> baseline ya se generó y se commiteó** (#123, `00000000000000_baseline_esquema.sql`,
> 10,372 renglones): 132 tablas, 345 políticas, 24 funciones propias.
>
> Lee este documento como el porqué. Para el estado actual, salta a
> [Qué quedó pendiente después del baseline](#qué-quedó-pendiente-después-del-baseline).

---

## El hallazgo en una línea

`supabase/migrations/` describe **8 tablas**. La base tiene **132**. No se puede
construir una base de Fullsite desde este repositorio.

*(Corregido el 2026-08-26 por #123 — ver el aviso de arriba.)*

Eso hace falsa la afirmación "somos clonables" en su sentido más básico: un
restaurante nuevo no nace del repositorio, nace de copiar AMALAY a mano.

---

## Los números

| | |
|---|---:|
| Tablas en la base (`public`) | 132 |
| Tablas definidas en `supabase/migrations/` | **8** |
| Tablas con un `CREATE TABLE` en *algún* `.sql` del repo | 108 |
| Tablas sin definición en ningún lado | **24** |
| Archivos `.sql` en el repositorio | 78 |
| Directorios distintos donde viven | **20** |
| Vistas en la base | 10 |
| Vistas definidas en el repositorio | **0** |
| Políticas RLS en la base | 350 |
| Funciones (`public` + `private`) | 65 |
| Índices que no vienen de una constraint | 115 |
| Tablas sin RLS | 0 ✅ |

Las 8 que sí están son todas de integraciones y plataforma: `feature_flags`,
`integration_audit_log`, `integration_providers`, `integration_store_mappings`,
`integration_webhook_dlq`, `integration_webhook_events`, `platform_audit_log`,
`platform_settings`.

**Los 108 "cubiertos" no salvan nada.** Están regados en 20 directorios
(`dashboard-app/sql/`, `dashboard-app/migrations/`, `scripts/seed/`, `docs/release/`,
`agents/reviews-manager/migrations/`, …) sin orden de aplicación, sin idempotencia
garantizada y sin manera de saber cuál está vigente. No es un esquema, es un archivero.

---

## Las 24 huérfanas, por uso real

Filas aproximadas de `pg_stat_user_tables` al 2026-08-26.

### En uso hoy — un clon las necesitaría desde el minuto cero

| Tabla | Filas | Qué se rompe sin ella |
|---|---:|---|
| `pos_clients` | 12,195 | Clientes del POS |
| `agent_insights` | 2,383 | Lo que producen los agentes de IA |
| `tasks` | 505 | Tareas |
| `content` | 258 | Contenido |
| `pos_menu_item_recipes` | 69 | Enlace platillo→receta (costeo) |
| `pos_recipe_details` | 51 | Detalle de recetas |
| `agent_events` | 12 | **Las alertas de los agentes.** Es la tabla donde escriben los 5 agentes y la que lee `/api/agents/*` |
| `platform_admins` | 1 | Quién puede entrar al panel de plataforma |

### Vacías hoy, pero son contrato de código vivo

`agent_messages`, `platform_2fa_codes`, `platform_2fa_enrollment`, `pos_bridge_logs`,
`pos_price_types`, `pos_promos`, `pos_retail_groups`, `pos_retail_promotions`,
`pos_survey`, `pos_time_clock`, **`provisioning_tokens`**.

`provisioning_tokens` merece nota aparte: es la tabla del propio sistema de
aprovisionamiento. El mecanismo que debería dar de alta restaurantes nuevos no está
descrito en el repositorio.

### Diagnóstico / históricas

`lab_issues`, `parity_reports`, `r1_observation_baseline`, `r1_observation_final`,
`r1_observation_log`.

---

## Las 10 vistas: cero en el repositorio

`ocm_daily`, `ocm_waiter_rankings`, `ocm_menu_groups`, `ocm_menu_items`,
`ops_daily_live`, `ops_daily_history`, `pos_recipes_canonical`,
`reservaciones_activas`, `reservaciones_hoy`, `reviews_pending`.

Las cuatro `ocm_*` son las que CLAUDE.md declara **la fuente viva de datos de negocio**.
Un clon nuevo no las tendría, así que el dashboard y los agentes leerían de la nada.

Ojo con el matiz: `supabase/migrations/20260826_cerrar_vistas_ocm.sql` (PR #104) sí está
en el repositorio, pero sólo hace `ALTER VIEW … SET (security_invoker = on)` y `REVOKE`.
Endurece vistas que asume existentes; no las crea. Aplicado a una base recién nacida
fallaría, porque ahí no hay ninguna vista que alterar.

---

## Por qué importa ahora

La fuga cross-tenant de esas mismas vistas se cerró el 2026-08-26 (PR #104, aplicado y
verificado: un usuario de `boruca` pasó de ver 1,415 filas de 5 restaurantes a ver sus
31). Ese arreglo vive en la base de producción **y ahora también en el repositorio**.

Pero si un clon se construye copiando la base a mano, nada garantiza que el clon herede
el arreglo. El repositorio tiene que ser la fuente, o cada restaurante nuevo es una
tirada de dados sobre si nace seguro.

---

## Lo que se hizo

`.github/workflows/esquema-baseline.yml` — vuelca el esquema real con la **CLI oficial
de Supabase** (`pg_dump` por debajo), lo revisa, y lo compara contra el baseline del
repositorio. Semanal para detectar deriva; a mano con `commitear: true` para abrir el PR.

`.github/scripts/revisar_dump_esquema.py` — dos trabajos:

1. **Secretos.** Un volcado de esquema no lleva filas, pero el cuerpo de una función
   viaja completo y ahí cabe una llave. Si encuentra algo con forma de credencial falla
   y reporta *archivo:renglón*, nunca el contenido — imprimirlo lo publicaría en los
   registros de la Action, que es justo lo que se evita (CLAUDE.md §13).
   Comprobado read-only el 2026-08-26: hoy ninguna de las 65 funciones tiene
   credenciales incrustadas, así que el primer volcado será limpio.
2. **Deriva.** Compara inventarios y dice qué objeto existe en la base y no en el
   repositorio. Cada uno de esos es algo que un restaurante nuevo *no* tendría.

**Por qué la CLI y no un script nuestro:** el volcado son ~250 KB — 132 tablas, 1,538
columnas, 350 políticas. Transcribirlo a mano es factible y es exactamente el error que
no hay que cometer: una errata en el predicado de una política es un hueco de seguridad
silencioso, y un baseline en el que la gente confía sin que sea fiel es peor que no
tener baseline.

---

## Lo que faltaba — dos secretos ✅ RESUELTO

> Los secretos se agregaron y el workflow corrió. El baseline entró en **#123** el
> 2026-08-26 a las 02:38. Lo de abajo queda como referencia del procedimiento.

El workflow está listo pero se detiene con un mensaje claro hasta que existan:

| Secreto | De dónde sale |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens — Daniel ya lo tiene en su `~/.zshrc` |
| `SUPABASE_DB_PASSWORD` | Dashboard → Project Settings → Database → Database password |

Se agregan en **Settings → Secrets and variables → Actions**. Después:
`Actions → "Esquema — baseline y deriva" → Run workflow → commitear: true`.

Eso abre un PR con el primer baseline real. A partir de ahí la deriva se detecta sola
cada lunes.

---

## Lo que esto NO resuelve

Honestidad sobre el alcance:

- **Tener el esquema en el repositorio no es lo mismo que poder aprovisionar.** El
  baseline te deja *crear la forma* de una base nueva. Los datos semilla (menú, roles,
  métodos de pago, configuración del cliente) y los 17 pasos manuales de
  aprovisionamiento son otro trabajo.
- **El baseline no reordena los 78 `.sql` regados.** Quedan como están; el baseline los
  vuelve redundantes pero no los borra. Consolidarlos es un trabajo aparte, y borrar
  archivos ajenos sin revisarlos uno por uno sería justo lo que el protocolo prohíbe.
- **No cubre `auth`, `storage` ni otros esquemas de Supabase.** Sólo `public` y
  `private`.
- ~~**El workflow no se ha ejecutado nunca**, porque faltan los secretos.~~ **Ya corrió**
  y produjo el baseline de #123 el 2026-08-26. Lo que sigue sin validarse de punta a punta
  es lo de verdad importante: **nadie ha construido una base nueva desde este baseline.**
  Y no se puede todavía — truena en el primer `GRANT` a `fullsite_readonly` (ver
  [Qué quedó pendiente](#qué-quedó-pendiente-después-del-baseline)).

---

## Cómo se midió

Todo read-only, vía el MCP `supabase-amalay` y `git show origin/main:<ruta>`:

- Tablas de la base: `pg_tables WHERE schemaname='public'`.
- Tablas del repositorio: `CREATE TABLE` extraído de los 78 `.sql` de `origin/main`.
- Filas: `pg_stat_user_tables.n_live_tup` (aproximado, es un estimado del planificador).
- Vistas, políticas, funciones, índices: `pg_class`, `pg_policies`, `pg_proc`,
  `pg_indexes`.
- Credenciales en funciones: `pg_proc.prosrc` contra los patrones del script.

---

## Qué quedó pendiente después del baseline

**Medido el 2026-08-26 a las 05:40**, comparando el baseline commiteado en #123 contra
producción, todo read-only.

| | Producción | Baseline |
|---|---:|---:|
| Tablas | 132 | **132** ✅ |
| Políticas RLS | 345 | **345** ✅ |
| Funciones propias | 24 | **24** ✅ |
| Vistas | 11 | **10** ⚠️ |

> Ojo con la cifra de funciones. Este documento decía **65** más arriba, contando
> `pg_proc` a secas. De esas, **41 pertenecen a extensiones** (`pgcrypto`, `uuid-ossp`, …)
> y `pg_dump` las excluye a propósito, porque las crea la extensión. Las propias son 24 y
> están todas. **No hay hueco de funciones.**

### 1. Tres vistas del pipeline de `ops_daily` derivaron

El baseline se tomó a las 02:38. Después de eso, alguien redefinió el pipeline
directamente en la base:

| Vista | Baseline | Producción |
|---|---|---|
| `ops_daily_desde_pos` | **no existe** | cierre diario calculado desde `pos_orders` |
| `ops_daily_history` | lee sólo de `ops_daily` | une `ops_daily_desde_pos` (prioridad 1) con `ops_daily` (prioridad 2) |
| `ops_daily_live` | `true AS pipeline_fresh` — **clavado** | lo calcula contra la fecha |

La tercera es la que más importa: un clon construido desde el repositorio **reportaría el
pipeline siempre fresco**, aunque llevara días muerto. Una señal de monitoreo que miente
es peor que no tenerla.

Cerrado en `supabase/migrations/20260826120000_ops_daily_desde_pos.sql`, con las
definiciones que devuelve `pg_get_viewdef()` — no transcritas a mano.

> **La lección de proceso, que vale más que las tres vistas:** el baseline tiene fecha de
> caducidad desde el minuto en que se commitea. Cambiar el esquema en la base sin pasar
> por una migración lo deja atrás en silencio. La detección semanal de deriva lo habría
> encontrado el lunes; esto se encontró horas después por casualidad.

### 2. Los roles del baseline no se crean en la ruta de migración ✅ RESUELTO

El baseline hace **342 `GRANT`** a `fullsite_readonly` y `fullsite_agent`. `pg_dump` no
vuelca roles — son del clúster, no de la base — así que los `GRANT` llegan sin que exista
a quién otorgarle.

Los roles **sí están definidos** en el repositorio, pero en
[`.github/migrations/001_create_readonly_role.sql`](../../.github/migrations/001_create_readonly_role.sql),
que **no vive en `supabase/migrations/`** y por lo tanto no corre antes del baseline.

Un `supabase db push` contra un proyecto nuevo truena en el primer `GRANT`:

```
ERROR: role "fullsite_readonly" does not exist
```

#### Cómo se resolvió

**No cambiando el orden de las migraciones.** Renombrar archivos para que uno gane
lexicográficamente es una garantía frágil: se rompe el día que alguien agrega otro
archivo, y no hay nada que avise.

En vez de eso, los roles se **anteponen al volcado dentro del propio baseline**:

```bash
# .github/workflows/esquema-baseline.yml
cat supabase/preambulo_roles.sql esquema_nuevo.sql > "$BASELINE"
```

[`supabase/preambulo_roles.sql`](../../supabase/preambulo_roles.sql) sólo crea los dos
roles, de forma idempotente. **Los permisos no van ahí**: los trae el volcado, que es la
fuente fiel de lo que hay en producción. Duplicarlos sería inventar una segunda verdad
que se desincroniza en silencio.

Así el orden lo garantiza **el archivo, no su nombre**, y sobrevive a la regeneración
semanal porque quien regenera es el mismo workflow que antepone.

**Verificado:**

- El volcado quedó **idéntico byte a byte** bajo el preámbulo — se compararon los 10,372
  renglones originales contra los mismos 46 renglones más abajo.
- El detector de deriva **sigue diciendo "sin deriva"** (código 0). Su inventario cuenta
  tablas, vistas, políticas, funciones, índices y triggers; `CREATE ROLE` no es ninguno,
  así que el preámbulo no genera un falso positivo permanente.
- El revisor de secretos no marca nada: los roles se crean **sin contraseña**. `LOGIN` sin
  contraseña no puede autenticarse; el rol existe para recibir los `GRANT`, y quien lo
  necesite para conectarse le pone contraseña fuera del repositorio.

> Nota sobre la próxima corrida semanal: `ops_daily_desde_pos` va como migración aparte
> (`20260826120000_ops_daily_desde_pos.sql`), no dentro del baseline. El detector compara
> el volcado **sólo contra el baseline**, así que reportará esa vista como deriva hasta
> que se regenere el baseline. No es un error: el baseline efectivamente no la tiene. Se
> resuelve solo en la siguiente regeneración.

### 3. Residuo de permisos en las vistas OCM

En producción, `anon` tiene `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` sobre
`ocm_daily` — todo **menos `SELECT`**. Es lo que quedó cuando #104 revocó la lectura.

**No es explotable hoy**, y se verificó en vez de suponerlo:

- `anon` recibe `permission denied` al leer las 11 vistas ✅
- `ocm_daily` es una vista con `UNION` y `GROUP BY` → no es actualizable, así que
  `INSERT`/`UPDATE`/`DELETE` fallan
- `anon` **no tiene `CREATE` en el esquema `public`**, así que no puede crear la función
  que haría falta para aprovechar el privilegio `TRIGGER`

Pero es basura que todo clon heredaría. Limpiarlo es un `REVOKE` sobre producción, que no
se hace sin Daniel despierto.

---

## Cómo se midió lo de arriba

```sql
-- inventario de producción
select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r') as tablas,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='v') as vistas,
       (select count(*) from pg_policies where schemaname='public') as politicas;

-- funciones propias vs de extensión
select count(*) filter (where d.objid is null) as propias,
       count(*) filter (where d.objid is not null) as de_extension
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
 where n.nspname in ('public','private');

-- permiso real, no el que dice information_schema
select c.relname, has_table_privilege('anon', c.oid, 'SELECT') as anon
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v';
```

> Un apunte de método: `information_schema.role_table_grants` decía que `anon` tenía
> permisos sobre 8 vistas. `has_table_privilege` y un `set local role anon` decían que no.
> Ganó la prueba directa. Para permisos, **preguntarle al motor, no al catálogo**.
