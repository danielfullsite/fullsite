# BUG-019 — Cambios de aplicación (acompañan la migración RLS)

La migración `BUG-019-tenant-rls-fix.sql` corta el acceso anon a las tablas POS
y exige identidad `authenticated` con membership real (`client_users`). Para que
la app siga funcionando (y offline no se rompa), estos cambios de app son
**obligatorios y deben desplegarse JUNTO con la migración** (o antes):

## Aplicados en este branch (`bug-019/tenant-rls`)

1. **`src/lib/supabase-fetch-patch.ts`** — se quitó la exclusión de páginas POS.
   Ahora TODA llamada directa a `/rest/v1/` que use la anon key como Bearer se
   actualiza al **JWT de sesión** del dispositivo (dashboard Y POS). Como el
   patch intercepta `window.fetch` global, esto cubre también el replay offline
   `SUPABASE_REST` de `pos-offline-db.ts` (cash/turnos/cierres): esas escrituras
   ahora viajan con el token de sesión → RLS las valida (el `client_id` de la
   fila debe pertenecer al tenant del usuario; `WITH CHECK` bloquea cross-tenant).

2. **`src/app/api/pos/pin/route.ts`** — el lookup de `pos_staff` para el login
   por PIN usa ahora `SUPABASE_SERVICE_KEY` (server-side, bypassa RLS) en vez de
   la anon key (que ya no puede leer `pos_staff`). El `client_id` se sigue
   filtrando explícitamente y el shift-token ata al operador al tenant.

3. **RPC `public.get_public_menu(client_id)`** (en la migración) — path público
   para la carta QR sin login. `SECURITY DEFINER`, granted a anon; devuelve solo
   el menú del tenant pedido, sin exponer acceso de tabla a anon.

## Pendientes (follow-up, NO en el critical path del release operador)

4. **Página QR `/menu/[mesa]`** (self-order de cliente, customer-facing):
   - Lectura de menú: cambiar `getMenuCategoriesFromDB()` por `get_public_menu()`
     (el POS logueado sigue leyendo `pos_menu_*` con sesión vía el patch).
   - Envío de orden: hoy hace `INSERT pos_orders` con anon → ahora bloqueado por
     RLS (correcto). Para re-habilitar self-order de forma segura se necesita un
     endpoint server `/api/public/qr-order` que valide el QR/mesa y haga el
     insert con service_role y `client_id` resuelto en servidor.
   - No es parte del release CONTROLLED (POS+KDS+Dashboard de operador).

5. **Endurecimiento del patch (offline multi-día):** si la sesión Supabase del
   dispositivo expira tras días offline, en reconexión el token cacheado puede
   estar viejo → 401 en el replay `SUPABASE_REST`. El path crítico de órdenes va
   por `APP_API` (shift-token 8h + service_role) y NO se ve afectado. Mitigación
   opcional: que el patch refresque la sesión (`supabase.auth.getSession()`)
   antes de inyectar el token, o mover cash/turnos/cierres a endpoints `APP_API`.

## Alcance real (auditoría de schema 2026-08-07)

La migración NO cubre 12 tablas — la auditoría completa encontró **93 tablas con
`client_id`** (la mayoría con el mismo patrón permisivo anon), **6 con RLS
desactivada**, **6 views** que bypassan RLS (security_invoker off, anon-readable),
y funciones SECURITY DEFINER con EXECUTE para anon (`r1_save_order`,
`r1_merge_orders`, `r1_reconcile_*`, `r1_adjust_market_stock`, etc.) que permitían
crear/mutar datos de cualquier tenant vía RPC directo con la anon key. La
migración ahora es **dinámica**: cubre todas las tablas con `client_id`, habilita
RLS en las que estaban off, endurece `client_users` (solo lectura de la fila
propia; escrituras solo por service_role), pone `security_invoker=true` + revoca
anon en las views, y deja a anon SOLO `EXECUTE get_public_menu`.

Impacto app: sin cambios de código adicionales — la app lee estas tablas vía el
JWT de sesión (patch) y escribe vía endpoints server (service_role). Flujos
customer-facing con anon (QR self-order, reservaciones públicas) quedan como
follow-up (endpoints dedicados), fuera del release operador.

## Requisito de deploy

- La migración y el bundle de app deben salir **coordinados**. Si la migración
  entra sin el bundle nuevo, el POS/dashboard en clientes viejos romperá lecturas
  (anon denegado). Si el bundle entra sin la migración, no hay daño (sigue usando
  sesión donde puede, anon donde aún se permite) pero tampoco cierra el hueco.
- Orden recomendado: desplegar app → verificar → aplicar migración → verificar.
