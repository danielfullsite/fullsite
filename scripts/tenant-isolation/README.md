# Tenant Isolation Checks — Café Nómada

Queries de verificación para el Gate P0 del PAE. Ver `PAE.md §5` para contexto.

## Los 6 checks

| ID | Tipo | Descripción |
|---|---|---|
| TI-01 | SQL | 0 órdenes de otros tenants visibles desde sesión nomada |
| TI-02 | SQL | 0 categorías de menú de otros tenants visibles |
| TI-03 | SQL | 0 staff de otros tenants visible |
| TI-04 | Manual | Ninguna pantalla del POS/Dashboard muestra texto "AMALAY" |
| TI-05 | SQL | 0 datos de ventas de amalay/vantara visibles en Dashboard |
| TI-06 | Manual | AI Chat: "¿Quiénes son mis meseros?" no responde con nombres de AMALAY |

## Cómo ejecutar los checks SQL (TI-01, TI-02, TI-03, TI-05)

### Requisito crítico: sesión autenticada como nomada

Ejecutar `ti_checks.sql` SIEMPRE autenticado como `admin@nomada.test`, no como service_role.

Con service_role, RLS se bypassa y los checks pasarán aunque el aislamiento esté roto.

### Opción A — psql con Supabase JWT

```bash
# 1. Obtener token de sesión de nomada
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nomada.test","password":"<password>"}' \
  | jq -r '.access_token')

# 2. Ejecutar checks via REST
curl -s "$SUPABASE_URL/rest/v1/rpc/run_ti_checks" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $TOKEN"
```

### Opción B — Supabase MCP (staging)

Ejecutar cada bloque de `ti_checks.sql` desde `mcp__supabase-fullsite-staging__execute_sql`.
Los resultados con service_role son indicativos pero NO suficientes para Gate P0.
Complementar con verificación manual (TI-04 y TI-06).

## Política de fallo

Si cualquier TI devuelve `pass = false`:
1. STOP — no continuar con smoke tests
2. Ejecutar teardown: `scripts/teardown/nomada_teardown.sql`
3. Identificar qué Debt item no estaba realmente resuelto
4. Aplicar fix
5. Re-provision desde `scripts/seed/nomada/v1_client.sql`
6. Re-run TI checks desde cero

No hay parche. No hay "provisoriamente OK". Teardown completo siempre.

## Checks manuales (TI-04 y TI-06)

**TI-04 — Inspección visual POS + Dashboard:**
- Login como admin@nomada.test en staging POS
- Navegar: Menú, KDS, Dashboard, Cierre
- Buscar visualmente cualquier texto "AMALAY", "amalay", "AFO200806JI0", o nombres de meseros AMALAY (Omar Aguilera, Hector Enrique, etc.)
- PASS: ninguna referencia a AMALAY en ninguna pantalla

**TI-06 — AI Chat:**
- Abrir AI Chat en Dashboard de nomada
- Escribir: "¿Quiénes son mis meseros?"
- PASS: respuesta lista únicamente Ana García, Carlos Méndez, Diana Torres, Eduardo Reyes
- FAIL: cualquier nombre de mesero de AMALAY aparece en la respuesta

Requiere Debt D-11 resuelto para PASS.
