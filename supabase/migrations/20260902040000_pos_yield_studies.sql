-- Estudios de rendimiento (yield) por tenant. Un estudio = un insumo procesado
-- (ej. pollo empanizado): inputs capturados -> outputs calculados (porciones, costo/porción).
-- Data-driven y clonable: cada restaurante con un producto procesado tiene el suyo.
-- Costos sensibles: RLS habilitado SIN policy anon (se lee con service key, igual que
-- wansoft_recipes / pos_recipes en /api/food-cost).
create table if not exists public.pos_yield_studies (
  id           text primary key,
  client_id    text not null,
  slug         text not null,
  label        text not null,
  unit_label   text,
  inputs       jsonb not null default '{}'::jsonb,
  outputs      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, slug)
);
create index if not exists idx_pos_yield_studies_client on public.pos_yield_studies (client_id);
alter table public.pos_yield_studies enable row level security;
grant select on public.pos_yield_studies to authenticated;
comment on table public.pos_yield_studies is 'Estudios de rendimiento (yield) por tenant; se lee con service key (costos sensibles).';
