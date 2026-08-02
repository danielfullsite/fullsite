# Café Nómada — Seed v1

Dataset canónico del PAE. Lee PAE.md antes de ejecutar.

## Prerequisitos

- `scripts/seed/nomada/` completo y en repo
- Deuda P0 resuelta (D-01, D-02, D-09, D-21, D-22) — ver PAE-IMPLEMENTATION-PLAN.md
- Bootstrap F1 ejecutado: fila `nomada` ya existe en `clients`
- Variables de entorno: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

## Orden de aplicación (obligatorio)

```
1. v1_client.sql          — INSERT clients WHERE id='nomada'
2. v1_staff.sql           — pos_staff
3. v1_payment_methods.sql — pos_payment_methods
4. v1_menu.sql            — pos_menu_categories + pos_menu_items
5. v1_ingredients.sql     — pos_ingredients
6. v1_recipes.sql         — pos_recipe_versions + pos_recipe_lines
7. v1_verify.sql          — SELECT count(*) — confirma que todo insertó bien
```

Si cualquier paso falla, ejecutar teardown completo antes de reintentar:
```
psql "$DATABASE_URL" -f scripts/teardown/nomada_teardown.sql
```

## Cómo ejecutar

```bash
# Con psql directo al staging DB
for f in v1_client v1_staff v1_payment_methods v1_menu v1_ingredients v1_recipes; do
  echo "--- $f ---"
  psql "$STAGING_DATABASE_URL" -f scripts/seed/nomada/${f}.sql
done
psql "$STAGING_DATABASE_URL" -f scripts/seed/nomada/v1_verify.sql
```

## Datos de acceso (solo staging — ficticios)

| Usuario | PIN | Rol |
|---|---|---|
| Ana García | 9001 | admin |
| Carlos Méndez | 1001 | mesero |
| Diana Torres | 1002 | mesero |
| Eduardo Reyes | 1003 | mesero |

Estos PINs son datos de test. Nunca reutilizar en clientes reales.

## Modificar el dataset

Cualquier cambio al dataset canónico → versionar el archivo como `v2_*.sql`.
Nunca modificar v1 ya aplicado. El teardown siempre limpia por `client_id='nomada'` sin importar la versión.
