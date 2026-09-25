-- PENDIENTE: NO aplicada. Requiere autorización de Daniel y el camino normal (staging primero).
-- Aplicar con `psql -v ON_ERROR_STOP=1 -f <archivo>`.
-- Rollback: PENDIENTE_20260925030000_pos_aprobaciones_usadas_ROLLBACK.sql
--
-- Registro de USO de los tokens de aprobación de gerente (manager-approval.ts,
-- registrarUsoDeAprobacion). Un token de aprobación trae `jti`; su primer uso queda aquí con
-- la operación que autorizó. Reintentar la MISMA operación vale; usarlo para otra es replay.
--
-- También lo usan los recibos de aprobación OFFLINE firmados por la Caja (bloque POS, PR 03):
-- su `nonce` entra como `jti` con prefijo `recibo:`.
--
-- Sin esta tabla el código no se rompe: `registrarUsoDeAprobacion` devuelve `sin-registro`
-- y, fuera del modo estricto (POS_APROBACION_V2_ESTRICTA), la aprobación se acepta marcada
-- `sin_registro` en la bitácora. Con el modo estricto, sin tabla no hay aprobaciones: por eso
-- esta migración va ANTES de prender la bandera.
--
-- Sólo service_role la toca. Los privilegios por defecto de Supabase le darían ALL a anon y
-- authenticated al crearla; se revocan explícitamente, y RLS queda activa sin políticas.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table if not exists public.pos_aprobaciones_usadas (
  jti        text primary key,
  client_id  text not null,
  operacion  text not null,
  used_at    timestamptz not null default now(),
  constraint pos_aprobaciones_usadas_jti_chk check (length(jti) between 8 and 200),
  constraint pos_aprobaciones_usadas_op_chk check (length(operacion) between 1 and 300)
);

create index if not exists pos_aprobaciones_usadas_used_at on public.pos_aprobaciones_usadas (used_at);

alter table public.pos_aprobaciones_usadas enable row level security;
revoke all on table public.pos_aprobaciones_usadas from anon, authenticated;

commit;
