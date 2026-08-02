# F1 Runbook — Bootstrap de Café Nómada

> **Cuándo ejecutar este runbook:** Solo después de que Gate P1 esté autorizado por Daniel.  
> **Prerequisito:** Todos los ítems de Deuda P0 (D-01, D-02, D-03, D-04, D-09, D-11, D-21, D-22, D-23, D-25) deben estar resueltos y en commit.  
> **Restricción:** NO ejecutar mientras P0-4 Offline esté abierto.

---

## Checklist de prerequisitos (verificar antes de empezar F1)

Confirmar cada ítem antes de abrir el primer terminal:

- [ ] Branch: `main` — todos los Debt P0 en commit
- [ ] D-01 `FALLBACKS.amalay` eliminado de `lib/client-config.ts`
- [ ] D-02 `EMAIL_MAP` sin hardcodes de AMALAY
- [ ] D-03 `settings.ts` routing sin defaults AMALAY
- [ ] D-04 `pos-constants.ts STATION_CATEGORIES` genérico
- [ ] D-09 migración `004_remove_amalay_defaults.sql` aplicada en staging
- [ ] D-11 meseros desde DB (no hardcodeados en AI context)
- [ ] D-21 `pos-config.ts` sin SSR fallback `'amalay'`
- [ ] D-22 `encuestas/page.tsx` sin fallback `'amalay'`
- [ ] D-23 health check sin suponer wansoft
- [ ] D-25 `CierreCajaWizard` sin `<h2>AMALAY</h2>`
- [ ] Variables de entorno disponibles: `STAGING_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`

---

## FASE 1 — Pasos (tiempo objetivo: <30 min total)

### Paso 1 — Verificar que nomada NO existe aún (2 min)

```bash
# Debe devolver 0 filas
psql "$STAGING_DATABASE_URL" -c "SELECT id FROM clients WHERE id='nomada';"
```

Si ya existe, ejecutar teardown completo antes de continuar:
```bash
psql "$STAGING_DATABASE_URL" -f scripts/teardown/nomada_teardown.sql
psql "$STAGING_DATABASE_URL" -f scripts/teardown/nomada_verify_clean.sql
```

### Paso 2 — Crear usuario auth en staging (5 min)

Crear el usuario auth en Supabase Dashboard → Authentication → Users:

| Campo | Valor |
|---|---|
| Email | admin@nomada.test |
| Password | Generar seguro (guardar en password manager) |
| Email confirm | Activado manualmente |

Anotar el UUID del usuario creado: `NOMADA_USER_UUID=___________`

### Paso 3 — Aplicar seeds (10 min)

```bash
# Ejecutar en orden estricto
for seed in v1_client v1_staff v1_payment_methods v1_menu v1_ingredients v1_recipes; do
  echo "=== Aplicando $seed.sql ==="
  psql "$STAGING_DATABASE_URL" -f scripts/seed/nomada/${seed}.sql
  if [ $? -ne 0 ]; then
    echo "ERROR en $seed — abortando"
    exit 1
  fi
done

# Verificar conteos post-seed
psql "$STAGING_DATABASE_URL" -f scripts/seed/nomada/v1_verify.sql
```

PASS: todas las filas en `v1_verify.sql` muestran `ok = true`.  
FAIL: cualquier `ok = false` → teardown + investigar + reintentar.

### Paso 4 — Vincular usuario auth al tenant (3 min)

```bash
# Reemplazar $NOMADA_USER_UUID con el UUID del Paso 2
psql "$STAGING_DATABASE_URL" -c "
INSERT INTO client_users (user_id, client_id, role)
VALUES ('$NOMADA_USER_UUID', 'nomada', 'admin')
ON CONFLICT DO NOTHING;
"
```

### Paso 5 — Gate P0: Tenant Isolation (5 min)

```bash
# Ejecutar checks SQL (indicativo — complementar con checks manuales TI-04 y TI-06)
psql "$STAGING_DATABASE_URL" -f scripts/tenant-isolation/ti_checks.sql
```

Para TI-04 (visual) y TI-06 (AI chat): seguir instrucciones en
`scripts/tenant-isolation/README.md`.

PASS: 6/6 checks OK.  
FAIL: teardown + identificar debt no resuelto + fix + reintentar desde Paso 1.

### Paso 6 — Verificar tiempo total (1 min)

Registrar timestamps:
- Inicio F1 (Paso 1): `T_START=___________`
- Fin Gate P0 (Paso 5): `T_END=___________`
- Duración: `T_END - T_START` debe ser < 30 minutos

Si > 30 minutos: documentar causa y ajustar proceso. No es FAIL para Gate P1 si los checks pasan.

---

## Próximo paso después de F1

Una vez F1 completo y Gate P0 OK, ejecutar la suite de smoke tests:

```bash
# Script de smoke tests (SM-01..SM-12)
python scripts/smoke/nomada_smoke.py --client-id nomada --base-url https://staging.app.fullsite.mx
```

12/12 PASS + evidencia = **Gate P1 — PAE Ready**.

---

## Contacto de blockers

Si algo falla durante F1 y no hay solución en < 15 minutos:
1. Ejecutar teardown
2. Documentar el step exacto que falló
3. Identificar qué Debt item no estaba realmente resuelto
4. Abrir issue en `docs/state/BUGS.md` con tag `[PAE-F1]`
5. No continuar hasta que el debt esté fix + commit
