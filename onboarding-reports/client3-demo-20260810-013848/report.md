# Reporte de Onboarding — client3-demo

**Status:** PASS
**Cliente:** Bistro Horizonte — DEMO
**Inicio:** 2026-08-10T07:38:48Z
**Fin:** 2026-08-10T07:38:55Z
**Duración total:** 7.1s

## Pipeline

| # | Paso | Status | Duración | Creados | Act. | Warns | Errors | Nota |
|---|------|--------|----------|---------|------|-------|--------|------|
| 1 | `env_validation` | ✓ PASS | 0ms | 0 | 0 | 0 | 0 |  |
| 2 | `schema_check` | ✓ PASS | 429ms | 0 | 0 | 0 | 0 |  |
| 3 | `client_create` | ✓ PASS | 154ms | 0 | 1 | 0 | 0 |  |
| 4 | `menu_seed` | ✓ PASS | 1.6s | 0 | 0 | 0 | 0 |  |
| 5 | `modifiers_seed` | ✓ PASS | 2.1s | 0 | 0 | 0 | 0 |  |
| 6 | `payment_methods_seed` | ✓ PASS | 591ms | 0 | 0 | 0 | 0 |  |
| 7 | `staff_seed` | ✓ PASS | 384ms | 0 | 0 | 0 | 0 |  |
| 8 | `auth_user_create` | ✓ PASS | 354ms | 0 | 1 | 0 | 0 |  |
| 9 | `client_users_create` | ✓ PASS | 134ms | 0 | 1 | 0 | 0 |  |
| 10 | `menu_import` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.menu_csv no definido |
| 11 | `diff_report` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.menu_csv no definido |
| 12 | `staff_import` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.staff_csv no definido |
| 13 | `vercel_provision` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.vercel_project no definido |
| 14 | `dns_provision` | · SKIP | 0ms | 0 | 0 | 0 | 0 | omitido — manifest.subdomain no definido |
| 15 | `smoke_check` | ✓ PASS | 1.3s | 0 | 0 | 0 | 0 |  |

## Totales

- Registros creados: **0**
- Registros actualizados: **3**
- Warnings: 0
- Errors: 0
- Pasos ejecutados: 10
- Pasos omitidos: 5

---
*Generado por Fullsite onboard_client.py · 2026-08-10T07:38:55Z*