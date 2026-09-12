-- CANDIDATA, NO APLICADA.
--
-- `/api/pos/save-order` no puede validar una venta offline contra las tablas
-- mutables del menu: el precio pudo cambiar entre captura y replay. Esta migracion
-- agrega la pieza minima que falta, un snapshot economico inmutable por tenant.
-- No activa enforcement ni cambia r1_save_order. La activacion requiere actualizar
-- primero el contrato HTTP/RPC y drenar las colas legacy (ver el documento de diseño).

create table if not exists public.pos_pricing_catalog_snapshots (
  client_id text not null references public.clients(id) on delete restrict,
  revision text not null,
  schema_version smallint not null default 1,
  catalog jsonb not null,
  published_at timestamptz not null default clock_timestamp(),
  published_by text not null,
  primary key (client_id, revision),
  constraint pos_pricing_catalog_revision_sha256
    check (revision ~ '^[0-9a-f]{64}$'),
  constraint pos_pricing_catalog_schema_v1
    check (schema_version = 1 and catalog->>'schema_version' = '1'),
  constraint pos_pricing_catalog_tenant
    check (catalog->>'restaurant_id' = client_id),
  constraint pos_pricing_catalog_complete
    check (catalog->>'complete' = 'true'),
  constraint pos_pricing_catalog_checksum
    check (revision = encode(digest(convert_to(catalog::text, 'UTF8'), 'sha256'), 'hex'))
);

alter table public.pos_pricing_catalog_snapshots enable row level security;
revoke all on public.pos_pricing_catalog_snapshots from public, anon, authenticated;
grant select on public.pos_pricing_catalog_snapshots to service_role;

create or replace function public.reject_pos_pricing_catalog_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'PRICING_CATALOG_IMMUTABLE';
end;
$$;

drop trigger if exists trg_pos_pricing_catalog_immutable
  on public.pos_pricing_catalog_snapshots;
create trigger trg_pos_pricing_catalog_immutable
  before update or delete on public.pos_pricing_catalog_snapshots
  for each row execute function public.reject_pos_pricing_catalog_mutation();

-- El modo empieza en legacy. `versioned_required` solo se habilita despues de
-- comprobar que todas las terminales emiten revision y que la cola anterior esta
-- vacia. `captured_at` no sirve como bypass: viene del navegador.
create table if not exists public.pos_price_authority_modes (
  client_id text primary key references public.clients(id) on delete restrict,
  mode text not null default 'legacy',
  activated_at timestamptz,
  activated_by text,
  constraint pos_price_authority_mode_check
    check (mode in ('legacy', 'observe', 'versioned_required')),
  constraint pos_price_authority_activation_check
    check ((mode = 'legacy' and activated_at is null and activated_by is null) or
           (mode <> 'legacy' and activated_at is not null and nullif(activated_by, '') is not null))
);

alter table public.pos_price_authority_modes enable row level security;
revoke all on public.pos_price_authority_modes from public, anon, authenticated;
grant select, insert, update on public.pos_price_authority_modes to service_role;

-- Publica todos los datos que cambian el importe en UNA lectura SQL. Las listas se
-- ordenan antes del hash: dos snapshots economicamente iguales producen la misma
-- revision. No acepta un catalogo armado por el navegador.
create or replace function public.publish_pos_pricing_catalog(
  p_client_id text,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog jsonb;
  v_revision text;
begin
  if nullif(trim(p_client_id), '') is null or nullif(trim(p_actor), '') is null then
    raise exception 'INVALID_PRICING_CATALOG_PUBLISH';
  end if;

  select jsonb_build_object(
    'schema_version', 1,
    'complete', true,
    'restaurant_id', c.id,
    'iva_rate', c.iva_rate,
    'timezone', c.timezone,
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'sort_order', x.sort_order
      ) order by x.sort_order, x.id), '[]'::jsonb)
      from public.pos_menu_categories x
      where x.client_id = c.id and x.active = true
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'category_id', x.category_id, 'name', x.name,
        'price', x.price, 'sort_order', x.sort_order,
        'aplica_2x1', x.aplica_2x1,
        'aplica_descuento', x.aplica_descuento,
        'aplica_cortesia', x.aplica_cortesia
      ) order by x.sort_order, x.id), '[]'::jsonb)
      from public.pos_menu_items x
      join public.pos_menu_categories category
        on category.client_id = x.client_id and category.id = x.category_id
       and category.active = true
      where x.client_id = c.id and x.active = true
    ),
    'modifier_groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'level', x.level,
        'min_selections', x.min_selections, 'max_selections', x.max_selections,
        'required', x.required, 'sort_order', x.sort_order
      ) order by x.level, x.sort_order, x.id), '[]'::jsonb)
      from public.pos_modifier_groups x
      where x.client_id = c.id and x.active = true
    ),
    'modifiers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'group_id', x.group_id, 'name', x.name,
        'price', x.price, 'sort_order', x.sort_order
      ) order by x.sort_order, x.id), '[]'::jsonb)
      from public.pos_modifiers x
      join public.pos_modifier_groups g
        on g.client_id = x.client_id and g.id = x.group_id and g.active = true
      where x.client_id = c.id and x.active = true
    ),
    'item_modifier_links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', x.item_id, 'group_id', x.group_id
      ) order by x.item_id, x.group_id), '[]'::jsonb)
      from public.pos_item_modifier_groups x
      join public.pos_menu_items i
        on i.client_id = x.client_id and i.id = x.item_id and i.active = true
      join public.pos_modifier_groups g
        on g.client_id = x.client_id and g.id = x.group_id and g.active = true
      where x.client_id = c.id
    ),
    'category_modifier_links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category_id', x.category_id, 'group_id', x.modifier_group_id
      ) order by x.category_id, x.modifier_group_id), '[]'::jsonb)
      from public.pos_category_modifiers x
      join public.pos_menu_categories category
        on category.client_id = x.client_id and category.id = x.category_id
       and category.active = true
      join public.pos_modifier_groups g
        on g.client_id = x.client_id and g.id = x.modifier_group_id and g.active = true
      where x.client_id = c.id
    ),
    'combos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'items', x.items,
        'price', x.price, 'upsell', x.upsell, 'schedule', x.schedule
      ) order by x.id), '[]'::jsonb)
      from public.pos_combos x
      where x.client_id = c.id and x.active = true
    ),
    'promotions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'type', x.type, 'value', x.value,
        'applies_to', x.applies_to, 'category_ids', x.category_ids,
        'item_ids', x.item_ids, 'schedule', x.schedule,
        'auto_apply', x.auto_apply, 'max_per_day', x.max_per_day
      ) order by x.id), '[]'::jsonb)
      from public.pos_promotions x
      where x.client_id = c.id and x.active = true
    )
  ) into v_catalog
  from public.clients c
  where c.id = p_client_id;

  if v_catalog is null then raise exception 'PRICING_CATALOG_CLIENT_NOT_FOUND'; end if;
  v_revision := encode(digest(convert_to(v_catalog::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.pos_pricing_catalog_snapshots(
    client_id, revision, schema_version, catalog, published_by
  ) values (p_client_id, v_revision, 1, v_catalog, p_actor)
  on conflict (client_id, revision) do nothing;

  return v_revision;
end;
$$;

revoke all on function public.publish_pos_pricing_catalog(text, text)
  from public, anon, authenticated;
grant execute on function public.publish_pos_pricing_catalog(text, text)
  to service_role;

comment on table public.pos_pricing_catalog_snapshots is
  'Snapshot economico inmutable para validar replays offline por revision; no sustituye la activacion coordinada del escritor.';
