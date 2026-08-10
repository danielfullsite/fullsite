-- Client #2 owner auth user for La Costa Verde (id: lacosta) — STAGING ONLY.
-- Creates the GoTrue email/password user + email identity + single client_users membership.
-- Follows the vantara recipe: app_metadata.client_id + role, empty-string token columns (GoTrue
-- breaks on NULLs), email identity for signInWithPassword. Idempotent (updates if the user exists).
-- Login: owner@lacosta.sandbox / Costa#Verde2026  (synthetic demo credential, no real secret).
do $$
declare new_id uuid;
begin
  select id into new_id from auth.users where email='owner@lacosta.sandbox';
  if new_id is null then
    new_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
      'owner@lacosta.sandbox', crypt('Costa#Verde2026', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"],"client_id":"lacosta","role":"admin"}'::jsonb,
      '{"name":"Ana Dueña","role":"dueño","client_id":"lacosta"}'::jsonb, now(), now(),
      '', '', '', '', ''
    );
    -- auth.identities.email is a GENERATED column -> do NOT insert it.
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), new_id::text, new_id,
      jsonb_build_object('sub',new_id::text,'email','owner@lacosta.sandbox','email_verified',true),
      'email', now(), now(), now());
  else
    update auth.users set encrypted_password=crypt('Costa#Verde2026', gen_salt('bf')),
      email_confirmed_at=now(), updated_at=now(),
      raw_app_meta_data='{"provider":"email","providers":["email"],"client_id":"lacosta","role":"admin"}'::jsonb,
      raw_user_meta_data='{"name":"Ana Dueña","role":"dueño","client_id":"lacosta"}'::jsonb,
      confirmation_token='',recovery_token='',email_change_token_new='',email_change='',reauthentication_token=''
      where id=new_id;
    if not exists (select 1 from auth.identities where user_id=new_id and provider='email') then
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), new_id::text, new_id,
        jsonb_build_object('sub',new_id::text,'email','owner@lacosta.sandbox','email_verified',true),
        'email', now(), now(), now());
    end if;
  end if;
  delete from client_users where user_id=new_id;           -- single membership (no duplicate)
  insert into client_users (id, user_id, client_id, role) values (gen_random_uuid(), new_id, 'lacosta', 'dueño');
end $$;
