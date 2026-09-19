-- Telemetría de observación del POS — infraestructura de certificación de campo.
--
-- NO es fuente de verdad y NO es una bitácora de negocio. Existe para que F8/F9
-- del field cert se puedan observar en software en vez de sólo en papel.
--
-- Por qué una tabla nueva y no una existente. Medido el 2026-09-19 en los ocho
-- esquemas no-sistema del proyecto compartido:
--
--   · `events` es la ÚNICA append-only de la base, pero no tiene `client_id`:
--     el inquilino vive dentro del payload. Una tabla de observación sin acotar
--     por inquilino es exactamente la forma del problema que ya costó una
--     limpieza esta semana.
--   · `pos_audit_log` es lo más parecido y aun así no sirve: no tiene columna de
--     terminal, NO es append-only (cero triggers, `service_role` puede UPDATE y
--     DELETE) y es la bitácora de NEGOCIO — 1,709 filas de `payment_processed`,
--     `order_sent_kitchen`, `cash_deposito`. Mezclar observación ahí vuelve
--     ambiguo qué es fuente de verdad.
--   · sólo tres tablas en toda la base tienen columna de terminal
--     (`pos_attendance`, `pos_local_events`, `pos_sessions`) y ninguna es una
--     bitácora.
--   · las `r1_observation_*` son contadores tipados de la ventana R1, sin
--     `client_id` y sin payload genérico.
--
-- Decisiones del contrato:
--
--   PK (client_id, event_id) — la idempotencia es POR INQUILINO. Con una llave
--   global, una colisión de id entre restaurantes suprimiría la observación del
--   otro, y el que se queda sin fila es justo el que estás certificando.
--
--   Dos tiempos. `observed_at` es cuándo pasó EN la terminal; `recorded_at`
--   cuándo llegó a la nube. Toda la telemetría offline llega tarde por
--   definición: sin el par no se puede reconstruir una racha. `events` ya usa
--   esa forma, así que no se inventa nada.
--
--   SIN trigger de inmutabilidad, a propósito. `events` lo tiene y por eso sus
--   filas de prueba no se pueden borrar nunca. Para infraestructura de
--   observación, poder limpiar el laboratorio vale más que la inmutabilidad —
--   y esta tabla no es fuente de verdad de nada.
--
--   `terminal_id` es NULLABLE. Una terminal sin identidad provisionada se
--   registra como NULL, nunca con un id inventado: `pos_terminal_id` lo fabrica
--   `pos-sessions.ts:23` en un navegador (`term_<base36>_<random>`) y lo
--   inyecta Electron desde `config.terminal_id` en una caja real. Misma llave,
--   dos significados. La única señal inequívoca es `FULLSITE_TERMINAL_ID`.
--
--   El CHECK de `event_type` es la allowlist del PR. Un tipo nuevo exige tocar
--   esta migración, que es precisamente el freno que se quiere.

create table public.pos_telemetry (
  client_id   text not null,
  event_id    text not null,
  terminal_id text,
  event_type  text not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  payload     jsonb not null default '{}'::jsonb,

  primary key (client_id, event_id),

  constraint pos_telemetry_event_type_check
    check (
      event_type in (
        'command_queued',
        'reconnect_detected',
        'queue_drain_started',
        'queue_drain_completed'
      )
    )
);

create index pos_telemetry_tenant_tiempo
  on public.pos_telemetry (client_id, observed_at);

alter table public.pos_telemetry enable row level security;

-- Sin políticas: nadie entra por RLS. El único escritor es
-- `/api/pos/telemetry`, que autentica con `withPOSAuth` y escribe con la llave
-- privilegiada del servidor, la cual salta RLS. Revocar además de no dar
-- políticas es cinturón y tirantes: si mañana alguien agrega una política
-- permisiva, el grant seguirá faltando.
revoke all on public.pos_telemetry from public, anon, authenticated;

comment on table public.pos_telemetry is
  'Observación del POS para certificación de campo (F8/F9). No es fuente de verdad ni bitácora de negocio.';
comment on column public.pos_telemetry.terminal_id is
  'Identidad PROVISIONADA (FULLSITE_TERMINAL_ID). NULL = desconocida; jamás un id inventado.';
comment on column public.pos_telemetry.observed_at is
  'Cuándo ocurrió en la terminal. Puede ser muy anterior a recorded_at: la telemetría offline llega al reconectar.';
