# Reporte de Onboarding — client3-demo

**Status:** PASS
**Cliente:** Bistro Horizonte — DEMO
**Inicio:** 2026-08-10T07:20:31Z
**Fin:** 2026-08-10T07:20:43Z
**Duración total:** 11.6s

## Pipeline

| # | Paso | Status | Duración | Creados | Act. | Warns | Errors | Nota |
|---|------|--------|----------|---------|------|-------|--------|------|
| 1 | `env_validation` | ✓ PASS | 0ms | 0 | 0 | 0 | 0 |  |
| 2 | `schema_check` | ✓ PASS | 127ms | 0 | 0 | 0 | 0 |  |
| 3 | `client_create` | ✓ PASS | 282ms | 1 | 0 | 0 | 0 |  |
| 4 | `menu_seed` | ✓ PASS | 3.1s | 11 | 0 | 0 | 0 |  |
| 5 | `modifiers_seed` | ✓ PASS | 4.0s | 15 | 0 | 0 | 0 |  |
| 6 | `payment_methods_seed` | ✓ PASS | 1.5s | 4 | 0 | 0 | 0 |  |
| 7 | `staff_seed` | ✓ PASS | 797ms | 3 | 0 | 0 | 0 |  |
| 8 | `auth_user_create` | ✓ PASS | 348ms | 1 | 0 | 0 | 0 |  |
| 9 | `client_users_create` | ✓ PASS | 274ms | 1 | 0 | 0 | 0 |  |
| 10 | `menu_import` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.menu_csv no definido |
| 11 | `diff_report` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.menu_csv no definido |
| 12 | `staff_import` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.staff_csv no definido |
| 13 | `vercel_provision` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.vercel_project no definido |
| 14 | `dns_provision` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.subdomain no definido |
| 15 | `smoke_check` | ✓ PASS | 1.2s | 0 | 0 | 0 | 0 |  |

## Totales

- Registros creados: **36**
- Registros actualizados: **0**
- Warnings: 0
- Errors: 0
- Pasos ejecutados: 10
- Pasos omitidos: 5

---
*Generado por Fullsite onboard_client.py · 2026-08-10T07:20:43Z*