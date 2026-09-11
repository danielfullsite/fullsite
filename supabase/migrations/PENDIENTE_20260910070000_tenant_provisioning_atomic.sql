-- Candidate only. Existing tenants keep NULL state and their activation flag.
-- Duplicate memberships stop this migration for explicit reconciliation; no row
-- is deleted or promoted automatically.
begin;
alter table public.clients add column if not exists provisioning_state text
  check (provisioning_state in ('pending','complete'));
alter table public.clients add column if not exists provisioning_plan jsonb;
create unique index if not exists client_users_user_tenant_identity on public.client_users(user_id,client_id);
create table if not exists public.pos_tenant_provisioning_ready (
  client_id text primary key references public.clients(id),
  verified_at timestamptz not null default now()
);
alter table public.pos_tenant_provisioning_ready enable row level security;
revoke all on public.pos_tenant_provisioning_ready from public,anon,authenticated,service_role;

create or replace function public.pos_assert_tenant_skeleton(p_client_id text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.clients where id=p_client_id) or
    not exists(select 1 from public.client_locations where client_id=p_client_id) or
    not exists(select 1 from public.pos_menu_categories where client_id=p_client_id) or
    not exists(select 1 from public.pos_menu_items where client_id=p_client_id) or
    not exists(select 1 from public.pos_payment_methods where client_id=p_client_id) or
    not exists(select 1 from public.pos_staff where client_id=p_client_id) or
    not exists(select 1 from public.pos_mutation_authority where client_id=p_client_id) or
    exists(select 1 from public.pos_menu_items i where i.client_id=p_client_id and not exists(
      select 1 from public.pos_item_inventory_policy p where p.client_id=p_client_id and p.menu_item_id=i.id)) or
    (select count(*) from public.pos_mesas where client_id=p_client_id) < coalesce((select mesas from public.clients where id=p_client_id),0)
    then raise exception 'TENANT_SKELETON_INCOMPLETE'; end if;
end $$;
revoke all on function public.pos_assert_tenant_skeleton(text) from public,anon,authenticated,service_role;

create or replace function public.pos_mark_tenant_provisioned(p_client_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.clients where id=p_client_id for update;
  if not found then raise exception 'TENANT_NOT_FOUND'; end if;
  perform public.pos_assert_tenant_skeleton(p_client_id);
  insert into public.pos_tenant_provisioning_ready(client_id) values(p_client_id) on conflict(client_id) do nothing;
  return jsonb_build_object('ready',true);
end $$;
revoke all on function public.pos_mark_tenant_provisioned(text) from public,anon,authenticated;
grant execute on function public.pos_mark_tenant_provisioned(text) to service_role;

create or replace function public.pos_activate_provisioned_tenant(p_client_id text,p_owner_user_id uuid,p_service_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare tenant public.clients%rowtype; identity uuid; expected_role text; membership_role text; activated boolean:=false; staff_setup_required boolean;
begin
  select * into tenant from public.clients where id=p_client_id for update;
  if not found then raise exception 'TENANT_NOT_FOUND'; end if;
  staff_setup_required := not exists(select 1 from public.pos_staff where client_id=p_client_id and active=true and pin ~ '^[0-9]{4,10}$' and role in ('dueño','admin','gerente','capitan','cajero','mesero'));
  if tenant.provisioning_state is distinct from 'pending' and tenant.active is distinct from true then
    return jsonb_build_object('activated',false,'provisioning_state',tenant.provisioning_state,'active',false,'staff_setup_required',staff_setup_required);
  end if;
  if not exists(select 1 from public.pos_tenant_provisioning_ready where client_id=p_client_id) then raise exception 'TENANT_NOT_READY'; end if;
  perform public.pos_assert_tenant_skeleton(p_client_id);
  if p_owner_user_id is null or p_owner_user_id=p_service_user_id or
    not exists(select 1 from auth.users where id=p_owner_user_id) or
    (p_service_user_id is not null and not exists(select 1 from auth.users where id=p_service_user_id)) then raise exception 'PROVISION_USER_INVALID'; end if;
  for identity,expected_role in select p_owner_user_id,'dueño' union all select p_service_user_id,'local_server' where p_service_user_id is not null loop
    insert into public.client_users(user_id,client_id,role) values(identity,p_client_id,expected_role)
      on conflict(user_id,client_id) do nothing;
    select role into membership_role from public.client_users where user_id=identity and client_id=p_client_id for update;
    if membership_role is distinct from expected_role then raise exception 'PROVISION_MEMBERSHIP_ROLE_CONFLICT'; end if;
  end loop;
  if tenant.provisioning_state='pending' then
    update public.clients set active=true,provisioning_state='complete' where id=p_client_id and provisioning_state='pending';
    activated:=true;tenant.active:=true;tenant.provisioning_state:='complete';
  end if;
  -- No complete/legacy tenant is reactivated, including a suspended tenant.
  return jsonb_build_object('activated',activated,'provisioning_state',tenant.provisioning_state,'active',coalesce(tenant.active,false),'staff_setup_required',staff_setup_required);
end $$;
revoke all on function public.pos_activate_provisioned_tenant(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pos_activate_provisioned_tenant(text,uuid,uuid) to service_role;
commit;
