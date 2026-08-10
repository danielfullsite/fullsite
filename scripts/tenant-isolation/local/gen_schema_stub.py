#!/usr/bin/env python3
"""BUG-019 · Barrido de esquema — genera stubs mínimos desde el esquema REAL.

Parsea los CREATE TABLE del esquema consolidado real (010/011) y emite, para CADA
tabla, un stub mínimo que preserva SOLO lo que la migración RLS necesita para
decidir su forma de política:
  - tablas con columna client_id  -> (id, client_id text not null, data text)   [§1]
  - tablas hijas conocidas (§7b)   -> (id, <fk> bigint)                          [§7b]
  - legacy §7a conocidas           -> forma real mínima                          [§7a]
  - client_users / clients         -> forma especial
NO carga el DDL supabase-específico (extensiones pg_cron/vault, tipos, auth.users
FKs). Reutiliza la INVENTARIO real de tablas para que el barrido cubra el 100%
de las tablas con client_id sin reconstruir 126 tablas a mano.

Salida: SQL en stdout (bootstrap de esquema-barrido).
"""
import re, sys, os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FILES = [
    os.path.join(REPO, 'scripts/sql/migrations/010_consolidated_core.sql'),
    os.path.join(REPO, 'scripts/sql/migrations/011_consolidated_pipeline.sql'),
]

# §7b hijas: (child, fk_col, parent) — igual que la migración
CHILD = {
    'pos_purchase_order_items': ('order_id', 'pos_purchase_orders'),
    'pos_sub_recipe_ingredients': ('sub_recipe_id', 'pos_sub_recipes'),
}
# §7a legacy sin client_id ni padre
LEGACY = {'wansoft_daily', 'wansoft_kpis', 'amalay_reservaciones'}
SPECIAL = {'client_users', 'clients'}


def parse_tables(sql):
    """Return {table_name: has_client_id} for every CREATE TABLE block."""
    out = {}
    # Cada bloque CREATE TABLE ... ( ... );  (no anidado)
    for m in re.finditer(r'CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)\s*\((.*?)\n\);',
                         sql, re.S | re.I):
        name, body = m.group(1), m.group(2)
        has_cid = bool(re.search(r'\bclient_id\b', body))
        out[name] = has_cid
    return out


def main():
    tables = {}
    for f in FILES:
        if os.path.exists(f):
            tables.update(parse_tables(open(f).read()))

    cid_tables = sorted(t for t, c in tables.items() if c and t not in SPECIAL)
    print("-- AUTOGEN desde esquema real (010/011). NO editar a mano.")
    print(f"-- tablas totales parseadas: {len(tables)} | con client_id (no especiales): {len(cid_tables)}")

    # clients + client_users (especiales)
    print("create table if not exists public.clients (id text primary key, display_name text);")
    print("create table if not exists public.client_users (user_id uuid, client_id text, role text, primary key(user_id,client_id));")

    # §1 tablas con client_id
    for t in cid_tables:
        if t in CHILD or t in LEGACY:
            continue
        print(f"create table if not exists public.{t} (id bigserial primary key, client_id text not null, data text);")

    # §7a legacy
    print("create table if not exists public.wansoft_daily (fecha date primary key, ventas_dia numeric);")
    print("create table if not exists public.wansoft_kpis (id text primary key, val numeric);")
    print("create table if not exists public.amalay_reservaciones (id bigserial primary key, nombre text, telefono text);")

    # §7b padres (con client_id) + hijas
    parents = set(p for _, p in CHILD.values())
    for p in sorted(parents):
        print(f"create table if not exists public.{p} (id bigserial primary key, client_id text not null, folio text);")
    for child, (fk, parent) in CHILD.items():
        print(f"create table if not exists public.{child} (id bigserial primary key, {fk} bigint not null, data text);")

    # RLS ON en todas las públicas base
    print("""do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;""")

    # Emit the list of client_id tables (excl special/legacy/children) for the sweep to check
    checklist = [t for t in cid_tables if t not in CHILD and t not in LEGACY]
    print("create table if not exists _sweep_expected (name text primary key);")
    if checklist:
        vals = ",".join(f"('{t}')" for t in checklist)
        print(f"insert into _sweep_expected values {vals} on conflict do nothing;")
    print(f"-- SWEEP_EXPECTED_COUNT={len(checklist)}")


if __name__ == '__main__':
    main()
