-- PENDIENTE: NO aplicada. Requiere autorización de Daniel y el camino normal de migraciones
-- (staging primero). Aplicar SIEMPRE con `psql -v ON_ERROR_STOP=1 -f <archivo>`.
-- Rollback: PENDIENTE_20260925010000_pos_staff_endurecimiento_ROLLBACK.sql
--
-- ── EL HALLAZGO (catálogo de producción, 2026-09-24, APPENDIX-QB3-STRUCTURAL-EVIDENCE.md) ──
--
--   · RLS activa en pos_staff; `authenticated` tiene SELECT/INSERT/UPDATE/DELETE/TRUNCATE de
--     TABLA (sin ACL por columna) y cuatro políticas PERMISSIVE con
--     `private.user_has_client_access(client_id)`, que da true con CUALQUIER membresía en
--     client_users, sin mirar el rol.
--   · ⇒ cualquier miembro del restaurante (incluso el rol más bajo del dashboard) puede, por
--     PostgREST con su JWT: leer `pin`, reescribir `pin`, subir `role` a admin, crear personal
--     con PIN propio y borrar personal. Con ese PIN entra al POS con el rol elegido.
--   · `anon` tiene SELECT/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN de tabla; sin política → lee 0
--     filas, pero TRUNCATE no pasa por RLS.
--
-- PR3 (PENDIENTE_20260924060000) cierra la lectura de `pin` y las escrituras de pin/rol, pero
-- deja a CUALQUIER miembro: UPDATE de name/active/hourly_rate/weekly_salary (apagar a un
-- gerente, cambiar sueldos), DELETE de personal, y la lectura de sueldos; no toca anon ni
-- TRUNCATE, ni audita en la base. Esta migración es la versión completa y es AUTOSUFICIENTE:
-- produce el mismo estado final se haya aplicado PR3 antes o no.
--
-- ── QUÉ HACE ──────────────────────────────────────────────────────────────────────────────
--
--   1. pos_staff · navegador (authenticated): SOLO lectura de columnas no sensibles
--      (id, client_id, name, role, role_display, active, created_at). Ninguna escritura, ni
--      TRUNCATE, ni pin/pin_hash/pin_hash_v, ni sueldos. Toda escritura va por la API del
--      servidor (/api/owner/staff, /api/platform/staff, provisionTenant), que autoriza con el
--      rol de client_users (no con un rol que el usuario pueda editarse) y con jerarquía.
--   2. pos_staff · anon: ningún privilegio.
--   3. Se BORRAN las políticas de escritura de authenticated (ins/upd/del): aunque alguien
--      re-otorgue privilegios por error, la RLS vuelve a negar (falla cerrado en dos capas).
--   4. client_id inmutable: un trigger BEFORE UPDATE rechaza mover una fila de restaurante,
--      venga de donde venga (service_role incluido). No hay ruta legítima que lo haga.
--   5. Auditoría en la base: trigger AFTER INSERT/UPDATE/DELETE → pos_staff_audit con
--      action ∈ {created, deleted, role_changed, pin_reset, deactivated, reactivated,
--      updated}, NOMBRES de campos cambiados (nunca valores) y el actor del JWT o del rol de BD.
--      Si la auditoría falla, la escritura falla (misma transacción): falla cerrado.
--      La API sigue escribiendo su propia fila (con el nombre humano del actor); la del
--      trigger lleva origen = 'db_trigger' y garantiza que ninguna escritura quede sin rastro
--      (scripts, proxy, SQL manual).
--   6. pos_staff_audit: authenticated solo lee (política existente); anon, nada.
--
-- ── LO QUE NO HACE ────────────────────────────────────────────────────────────────────────
--   · No toca la columna `pin` ni el esquema de hash: eso es PENDIENTE_20260914120000 (F1) y
--     las fases F2–F6 de docs/security/PLAN-PIN-HASH.md. El trigger de auditoría ya reconoce
--     `pin_hash` si la columna existe (compara por nombre con to_jsonb, sin referenciarla).
--   · No cambia `private.user_has_client_access` (eso es PR5).
--   · No revoca TRUNCATE en otras tablas: eso es PENDIENTE_20260925020000.
--
-- ── COMPATIBILIDAD (inventario del 2026-09-25 sobre 733fbf45) ─────────────────────────────
--   Lectores directos del navegador (siguen funcionando: sólo piden columnas otorgadas):
--     src/lib/pos-data.ts:1493 (fetchMeseros)          select=name
--     src/app/pos/configuracion/page.tsx:255            select=id,name,role,active
--     src/app/admin/exportar/page.tsx:19                select=id,name,role,active
--   Se rompen (muertos o retirados; ver POS-STAFF-CONSUMER-INVENTORY.md):
--     src/app/admin/onboarding/page.tsx:63 (POST con pin) · src/lib/backup.ts (select=*) ·
--     mobile-app/src/screens/LoginScreen.tsx (llave anon).
--   Servidor (service_role, no afectado por grants): /api/owner/staff, /api/platform/staff,
--     /api/pos/pin, /api/pos/staff, /api/pos/time-clock, /api/labor, /api/voice, /api/chat,
--     /api/backup, /api/platform/export, /api/pos/db (proxy; pos_staff pasa a solo lectura en
--     el mismo PR), provision-tenant, scripts de .github/scripts.
--   Caché: public/sw.js NO sube de versión. La v49 (PR3) ya purga todo caché ≤ v48, que es
--     donde podía haber `pin`; desde PR3 una lectura del navegador que pida pin o `*` da
--     42501 y no se cachea, y los tres lectores sólo piden columnas no sensibles. El proxy
--     /api/pos/db (también cacheado por el SW) redacta pin/pin_hash/pin_hash_v desde este
--     PR — por eso el CÓDIGO se despliega ANTES que F1 (ver PLAN-DESPLIEGUE). Un bump
--     extra del SW tocaría el arranque en frío offline (T-25) sin cerrar nada.
--     `pos_staff_cache` (localStorage) guarda un SHA-256 derivado en la terminal, no algo
--     que la base entregue: es el riesgo R-5, P0 aparte con validación de campo.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- ── 1–2. Privilegios de pos_staff ─────────────────────────────────────────────────────────
-- Revocar de TABLA (quita SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN)
revoke all on table public.pos_staff from anon, authenticated;
-- y de COLUMNA (lo que PR3 hubiera otorgado). Revocar un privilegio no otorgado no falla.
revoke select (id, client_id, name, role, role_display, active, created_at, hourly_rate, weekly_salary)
  on table public.pos_staff from authenticated;
revoke update (name, active, hourly_rate, weekly_salary)
  on table public.pos_staff from authenticated;

grant select (id, client_id, name, role, role_display, active, created_at)
  on table public.pos_staff to authenticated;

-- ── 3. Políticas: sólo lectura por membresía; escritura sólo service_role ──────────────────
drop policy if exists pos_staff_ins on public.pos_staff;
drop policy if exists pos_staff_upd on public.pos_staff;
drop policy if exists pos_staff_del on public.pos_staff;
-- pos_staff_sel (SELECT, authenticated, user_has_client_access) y pos_staff_svc se conservan.

-- ── 4. client_id inmutable ────────────────────────────────────────────────────────────────
create or replace function private.pos_staff_client_id_inmutable()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.client_id is distinct from old.client_id then
    raise exception 'pos_staff.client_id es inmutable (fila %)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function private.pos_staff_client_id_inmutable() from public, anon, authenticated;

drop trigger if exists pos_staff_client_id_inmutable on public.pos_staff;
create trigger pos_staff_client_id_inmutable
  before update on public.pos_staff
  for each row execute function private.pos_staff_client_id_inmutable();

-- ── 5. Auditoría en la base ───────────────────────────────────────────────────────────────
alter table public.pos_staff_audit add column if not exists origen text not null default 'api';

create or replace function private.pos_staff_audit_trg()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
declare
  vigilados constant text[] := array['name','pin','pin_hash','pin_hash_v','role','role_display',
                                     'active','hourly_rate','weekly_salary'];
  viejo jsonb;
  nuevo jsonb;
  campos text[] := '{}';
  accion text;
  actor text;
  k text;
begin
  -- Actor: el `sub` del JWT si la escritura vino por PostgREST con sesión; si no, el rol ACTIVO
  -- de la sesión. OJO: dentro de SECURITY DEFINER `current_user` es el DUEÑO de la función
  -- (postgres), no quien escribió; el rol activo (`SET ROLE`, que es lo que hace PostgREST)
  -- está en el GUC `role`. Si no hubo SET ROLE vale 'none' y se cae a session_user.
  -- Nunca datos de la fila.
  actor := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), ''),
    'db:' || coalesce(nullif(nullif(current_setting('role', true), ''), 'none'), session_user::text)
  );

  if tg_op = 'INSERT' then
    nuevo := to_jsonb(new);
    foreach k in array vigilados loop
      if nuevo ? k and nuevo -> k <> 'null'::jsonb then campos := campos || k; end if;
    end loop;
    accion := 'created';
  elsif tg_op = 'DELETE' then
    viejo := to_jsonb(old);
    accion := 'deleted';
  else
    viejo := to_jsonb(old);
    nuevo := to_jsonb(new);
    foreach k in array vigilados loop
      if (viejo -> k) is distinct from (nuevo -> k) then campos := campos || k; end if;
    end loop;
    if array_length(campos, 1) is null then
      return new;                                   -- nada vigilado cambió: no hay qué auditar
    end if;
    accion := case
      when 'role' = any(campos)                         then 'role_changed'
      when 'pin' = any(campos) or 'pin_hash' = any(campos) then 'pin_reset'
      when 'active' = any(campos) and array_length(campos, 1) = 1
        then case when (nuevo ->> 'active')::boolean then 'reactivated' else 'deactivated' end
      else 'updated'
    end;
  end if;

  insert into public.pos_staff_audit (client_id, staff_id, action, changed_fields, changed_by, origen)
  values (
    coalesce(nuevo ->> 'client_id', viejo ->> 'client_id'),
    coalesce(nuevo ->> 'id', viejo ->> 'id'),
    accion,
    to_jsonb(campos),
    actor,
    'db_trigger'
  );
  return coalesce(new, old);
end
$$;
revoke all on function private.pos_staff_audit_trg() from public, anon, authenticated;

drop trigger if exists pos_staff_audit_trg on public.pos_staff;
create trigger pos_staff_audit_trg
  after insert or update or delete on public.pos_staff
  for each row execute function private.pos_staff_audit_trg();

-- ── 6. pos_staff_audit: el navegador sólo lee ─────────────────────────────────────────────
revoke all on table public.pos_staff_audit from anon, authenticated;
grant select on table public.pos_staff_audit to authenticated;   -- RLS: authread_pos_staff_audit
revoke all on sequence public.pos_staff_audit_id_seq from anon, authenticated;

commit;
