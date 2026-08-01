# Tenant Isolation — Aislamiento Multi-Tenant

> **Frozen ref:** Foundation v1 · 2026-07-29  
> Actualizar solo vía ADR.

---

## Invariante fundamental

Toda tabla que contiene datos de tenant tiene una columna `client_id TEXT` con FK a `clients.id`. Sin excepciones.

---

## Dos capas de aislamiento

| Capa | Mecanismo | Cobertura |
|---|---|---|
| Aplicación | `_cid()` helper → `client_id = _cid()` en cada query | Todas las lecturas/escrituras desde Next.js |
| Base de datos (RLS) | `auth_client_id()` PostgreSQL SECURITY DEFINER | 13 tablas core POS — rol authenticated |

**Por qué dos capas:** la capa de aplicación es rápida y cubre 100% del código propio. La capa de DB es la última línea de defensa — protege contra bugs en la capa de aplicación, acceso directo a la DB, y fugas de queries mal escritos.

---

## La función auth_client_id()

```sql
CREATE OR REPLACE FUNCTION auth_client_id()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT cu.client_id FROM client_users cu
  WHERE cu.user_id = auth.uid() LIMIT 1;
$$;
```

`SECURITY DEFINER` es crítico: la función corre con los permisos del owner (postgres), no del caller. Esto permite que RLS funcione incluso cuando el rol authenticated no tiene acceso directo a `client_users`.

---

## Patrón RLS estándar (13 tablas POS)

```sql
-- anon: compatibilidad con POS terminal (el app filtra por client_id en capa de aplicación)
CREATE POLICY "anon_read" ON <tabla> FOR SELECT TO anon USING (true);

-- authenticated: aislamiento a nivel DB
CREATE POLICY "auth_tenant" ON <tabla> FOR ALL TO authenticated
  USING (client_id = auth_client_id())
  WITH CHECK (client_id = auth_client_id());
```

### Tablas con RLS auth_tenant activo

`pos_menu_categories`, `pos_menu_items`, `pos_modifier_groups`, `pos_modifiers`,
`pos_payment_methods`, `pos_staff`, `pos_orders`, `pos_inventory`,
`pos_staff_shifts`, `pos_turnos`, `pos_cierres`, `pos_cash_movements`, `pos_customers`

---

## Gotcha crítico: políticas {public} vs {anon}

Las políticas `TO public` se aplican a authenticated Y anon simultáneamente. Una política `public SELECT USING (true)` en una tabla de tenant anula la política `auth_tenant` vía OR-combination.

**Regla:** en tablas con datos de tenant, todas las políticas de lectura pública deben ser `TO anon`, nunca `TO public`. Este bug fue encontrado y corregido en SKEL-04.

---

## Source of truth para client_id

`client_users.client_id` es la fuente canónica. `raw_user_meta_data.client_id` es solo conveniencia — nunca autoritative para RLS.

---

## Proyectos Supabase

| Proyecto | Ref | Regla |
|---|---|---|
| `fullsite-amalay` | `qjiomlvudfmzuvqvhwpk` | **NUNCA tocar** — producción |
| `fullsite-warroom-staging` | `jkcnxfbbuyyfhwfjizgw` | Sandbox seguro |

La guardia de producción está en `onboard_client.py`: `FORBIDDEN_CLIENT_IDS = {"amalay"}` y `--confirm-ref` obligatorio.
