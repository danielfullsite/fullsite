# `SECURITY DEFINER` alcanzables por `authenticated` — barrido del 2026-08-26

**Origen: yo introduje una de éstas.** Al aplicar
`20260826200000_cleanup_orders_transaccional.sql` revoqué `FROM PUBLIC, anon` y **di por
hecho** que la función quedaba sólo para `service_role`. El linter de Supabase (regla 0029)
lo desmintió minutos después.

## La trampa, en concreto

Supabase tiene un `ALTER DEFAULT PRIVILEGES` que otorga `EXECUTE` a `authenticated` sobre
las funciones nuevas de `public`, **como grant directo**. Un `REVOKE … FROM PUBLIC` no lo
toca:

```
proacl: postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
                              └── éste sobrevive al REVOKE a PUBLIC
```

El SQL se *ve* correcto. La única forma de verlo es consultar `proacl` o preguntar
`has_function_privilege`. **Escribir el `REVOKE` no es verificarlo.**

```sql
-- La consulta que sí lo comprueba
select p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef;
```

## Qué habría permitido

Cualquier usuario con sesión iniciada —de cualquier restaurante, con cualquier rol— podía:

```
POST /rest/v1/rpc/r1_cleanup_orders  { "p_client_id": "<otro tenant>", … }
```

y borrar **todas** las órdenes de ese tenant. Saltándose el guardián de la ruta
(`canCleanupAllOrders`: tenant + nombre), el rol mínimo `gerente`, el texto literal de
confirmación y la verificación del digest. O sea: **peor que el defecto que la migración
venía a corregir.**

Cerrado en `20260826213000_cleanup_orders_revocar_authenticated.sql`. Comprobado después:

```
r1_cleanup_orders    anon:false  authenticated:false  service_role:true
r1_cleanup_restore   anon:false  authenticated:false  service_role:true
```

Y prueba de humo bajo `service_role` para confirmar que no cerré la puerta con la ruta
adentro: borrado `deleted:2` · restauración `restored:2` · estado final sin residuo
(`total_global: 6,309`, `amalay: 0`).

## Estado del barrido

Todas las `SECURITY DEFINER` de `public` alcanzables por `anon` o `authenticated`:

| Función | `anon` | `authenticated` | Quién la introdujo | Estado |
|---|:--:|:--:|---|---|
| `r1_cleanup_orders(…)` | — | — | **esta sesión** | ✅ **CERRADA** (`20260826213000`) |
| `r1_cleanup_restore(…)` | — | — | **esta sesión** | ✅ **CERRADA** (`20260826213000`) |
| `r1_save_order(…)` | no | **no** | preexistente | ✅ cerrada por `20260827021347` (otra sesión) — y **nunca fue la vía**, ver abajo |
| `r1_observation_sample()` | no | **sí** | preexistente | 🟡 abierta, riesgo bajo |
| `fn_default_inventory_policy_on_menu_item()` | **sí** | **sí** | preexistente | 🟡 abierta, riesgo bajo |

## `r1_save_order` — **esta sección era falsa. Corregida el 2026-08-27.**

> ### Lo que decía, y por qué estaba mal
>
> Afirmaba como **HECHO** que la función *"recibe `p_client_id` como argumento y lo usa tal
> cual en el `INSERT`. No verifica que el tenant del argumento sea el de quien llama"*, y
> sobre eso construía una **INFERENCIA FUERTE** de escritura cruzada entre tenants.
>
> **Las dos cosas son falsas.** La función abre con un guardián, y es su primera sentencia:
>
> ```sql
> -- Tenant guard
> IF NOT private.can_write_client(p_client_id) THEN
>   RETURN jsonb_build_object('ok', false, ..., 'error', 'FORBIDDEN_CLIENT');
> END IF;
> ```
>
> **Cómo se produjo el error:** busqué en `prosrc` las cadenas `user_has_client_access`,
> `auth.uid`, `client_users` y `current_setting`. Las cuatro dieron falso — porque la
> comprobación entra por `private.can_write_client`, una indirección que no busqué. Reporté
> el resultado de ese grep como si fuera una lectura de la función.
>
> Es el error de método que [CLAUDE.md §17](../../CLAUDE.md) describe: **conclusión sobre un
> fragmento, sin abrir la fuente completa.** Y no fue gratis: Daniel priorizó trabajo sobre
> esa base.

### Lo que sí es cierto, ahora demostrado por ejecución

Mismo llamado, mismo tenant ajeno, sobre un tenant sintético en producción:

```
claims.role = 'service_role'   → r1_save_order(...) → { ok: true, revision: 1 }
claims.role = 'authenticated'  → r1_save_order(...) → { ok: false, FORBIDDEN_CLIENT }
```

| | |
|---|---|
| **HECHO** | Un llamador `authenticated` recibe `FORBIDDEN_CLIENT`. El grant **nunca fue** una vía de escritura cruzada. |
| **HECHO** | Bajo `service_role` el guardián devuelve `true` — incluso para un tenant que no existe. Es su primera rama: `if v_role = 'service_role' then return true`. |
| **HECHO** | La aplicación no necesita el grant: [`save-order/route.ts:116`](../../dashboard-app/src/app/api/pos/save-order/route.ts:116) llama con `SUPABASE_SERVICE_KEY`. |

Sigue siendo superficie innecesaria. **Pero no era el riesgo que dije.**

### Dónde estaba el riesgo de verdad

Al ir a verificar esto apareció el camino que sí estaba abierto, y es peor: el proxy
`/api/pos/db/[...path]` prestaba `service_role` a **cualquier** RPC — sin lista blanca, sin
forzar tenant y sin gate de rol. Como el guardián deja pasar a `service_role`, cualquier
shift token, de cualquier restaurante y cualquier rol, podía escribir en otro tenant y
alcanzar también las funciones destructivas `r1_cleanup_*`.

Cerrado en [PR #169](https://github.com/danielfullsite/fullsite/pull/169).

> **La lección de método, que es lo que hay que conservar:** un `REVOKE` a `authenticated`
> no protege de un llamador que llega como `service_role`. Preguntar *"¿quién puede ejecutar
> esta función?"* no basta. Hay que preguntar *"¿quién puede hacer que alguien más la
> ejecute por él?"*

### El estado del grant

Otra sesión aplicó `20260827021347_r1_save_order_ambigua` mientras se investigaba esto. Esa
migración eliminó la sobrecarga `p_mesa text` —la que tenía el grant— y dejó sólo la de
`p_mesa integer`. Comprobado después:

```
r1_save_order            anon:false  authenticated:false  service_role:true
r1_save_order_idempotent anon:false  authenticated:false  service_role:true
r1_reconcile_order       anon:false  authenticated:false  service_role:true
```

**El grant ya no existe en producción.** Queda un pendiente distinto: la línea 8712 de
`supabase/migrations/00000000000000_baseline_esquema.sql` todavía lo contiene, así que
**cualquier despliegue nuevo construido desde el repo lo reproduciría.** Ese archivo se
regenera con el workflow `esquema-baseline.yml`; correrlo con `commitear: true` lo alinea.

## Los dos de riesgo bajo

- **`r1_observation_sample()`** — sin argumentos, muestreo de observabilidad. Un usuario con
  sesión puede dispararlo; el daño sería escritura de telemetría, no de negocio. Revisar al
  cerrar la deuda de observabilidad.
- **`fn_default_inventory_policy_on_menu_item()`** — alcanzable incluso por `anon`. Por el
  nombre es una función de disparador, y una función de disparador **no tiene por qué estar
  expuesta como RPC**. Riesgo bajo, superficie innecesaria.

## La regla que sale de aquí

> Al crear una función `SECURITY DEFINER` en `public`: revocar explícitamente a
> **`authenticated`** —no sólo a `PUBLIC` y `anon`— y **comprobarlo con
> `has_function_privilege`**, porque el `REVOKE` puede verse correcto y no serlo.

Es la misma forma que la regla de la cita de CLAUDE.md §17, aplicada a permisos:
**escribir la instrucción no es verificar el efecto.**
