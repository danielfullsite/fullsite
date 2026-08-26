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
| `r1_save_order(…)` | no | **sí** | preexistente | 🔴 **ABIERTA** — ver abajo |
| `r1_observation_sample()` | no | **sí** | preexistente | 🟡 abierta, riesgo bajo |
| `fn_default_inventory_policy_on_menu_item()` | **sí** | **sí** | preexistente | 🟡 abierta, riesgo bajo |

## `r1_save_order` — el que importa

**HECHO** (consultado y leído):

- Tiene `EXECUTE` para `authenticated`, y es `SECURITY DEFINER` ⇒ corre como `postgres` y
  **evade RLS**.
- Recibe `p_client_id` **como argumento** y lo usa tal cual en el `INSERT`. No verifica que
  el tenant del argumento sea el de quien llama.
- **La aplicación no necesita ese grant.**
  [`save-order/route.ts:116`](../../dashboard-app/src/app/api/pos/save-order/route.ts:116)
  la invoca con `SUPABASE_SERVICE_KEY`, no con el token del usuario.

**INFERENCIA FUERTE:** un usuario con sesión iniciada del restaurante B puede llamar
`POST /rest/v1/rpc/r1_save_order` con `p_client_id: "A"` y escribir o sobrescribir órdenes
del restaurante A. Escritura cruzada entre tenants — justo lo que CLAUDE.md §12 prohíbe.

**NO VERIFICADO:** no lo ejecuté con un JWT real de un usuario. Hacerlo exigiría emitir una
credencial de un tenant contra producción, y eso deja de ser diagnóstico en sólo lectura. La
conclusión se apoya en el grant, el cuerpo de la función y el llamador — **no en una
explotación observada.**

**Fix propuesto — de una línea, reversible, y SIN APLICAR.** Es un P0 preexistente de otra
capacidad: va en su propia rama, no colgado del PR de la limpieza.

```sql
REVOKE EXECUTE ON FUNCTION public.r1_save_order(
  text,text,bigint,text,text,text,integer,text,numeric,numeric,numeric,numeric,numeric,
  text,jsonb,text,text,jsonb,timestamptz
) FROM authenticated;
```

Antes de aplicarlo hay que comprobar dos cosas que todavía **no** se comprobaron:

1. La otra sobrecarga (`p_mesa integer`, oid 27937) — puede tener el mismo grant.
2. Que ningún cliente la llame con el token del usuario. La lectura de `save-order/route.ts`
   dice que no, pero falta un `rg` por todo el repo **y por el instalador de Electron**.

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
