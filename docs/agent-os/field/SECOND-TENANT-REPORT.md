# SECOND-TENANT-REPORT — War-Room Clonability Gate

**Fecha:** 2026-08-05
**Staging project:** fullsite-staging (via MCP `supabase-fullsite-staging`)
**Producción AMALAY (`qjiomlvudfmzuvqvhwpk`):** NO tocada — solo referenciada como guard.

---

## 1. Tenant status

Staging ahora tiene **3 tenants + 1 sandbox de integración**, cero datos de AMALAY:

| Tenant | Origen | Contenido | AMALAY refs |
|---|---|---|---|
| `vantara` (Grupo VANTARA) | pre-existente (`scripts/sql/sandbox/migrations/SKEL-01_seed_vantara.sql`) | 3 categorías, 11 items, 4 staff (admin + 3 meseros), 4 payment methods, 3 modifier groups / 9 modifiers, auth user `owner@vantara.sandbox` (rol `dueño`) | 0 |
| `prueba-3` | pre-existente | 1 categoría, 1 item, 1 staff, 1 payment method, auth user `owner@prueba3.sandbox` | 0 |
| `demo` (El Molcajete Demo) | **seeded en esta sesión** vía `scripts/demo/second_tenant_config.sql` | 1 sucursal (`demo-centro`), 5 categorías, 30 items, 5 staff (roles distintos: admin/cajero/mesero), 4 payment methods (sin Ubereats — distinto de AMALAY), config distinta (Guadalajara, tema/acento propios) | 0 |
| `sandbox-client` | integración Uber Eats | 1 fila en `integration_store_mappings` | 0 |

**Verificado:** 0 filas con `client_id ILIKE '%amalay%'` en **todas** las tablas públicas con columna `client_id` (scan dinámico); 0 menciones de `amalay`/`qjiomlvudfmzuvqvhwpk` en el texto completo de `clients`; 0 usuarios auth con email amalay.

### Distinción demo vs AMALAY (gate requirements)

| Requisito | Estado |
|---|---|
| Sucursal distinta | ✅ `client_locations.demo-centro` "Sucursal Centro Demo" (AMALAY no tiene filas en staging) |
| Menú distinto | ✅ 30 items El Molcajete (Entradas/Platillos fuertes/Tacos/Bebidas/Postres) — 0 overlap con menú Wansoft AMALAY |
| Usuarios distintos | ⚠️ `owner@vantara.sandbox` / `owner@prueba3.sandbox` existen; auth user `owner@demo.sandbox` **pendiente** (requiere Admin API — comando documentado en el SQL) |
| Roles distintos | ✅ demo: `admin`, `cajero`, `mesero` (con `role_display`); vantara: `admin` + `mesero`; `client_users.role='dueño'` |
| Impresoras distintas | ✅ (por diseño) impresoras viven en `printers.json` local del Bridge, no en DB — config demo COCINA-DEMO/BARRA-DEMO/CAJA-DEMO documentada en `second_tenant_config.sql` |
| Config distinta | ✅ clients row propia: Guadalajara, iva 0.16, features propias, receipt_footer propio |
| Cero refs AMALAY | ✅ en datos de staging (código: ver §4) |

---

## 2. Seed command (ready-to-run)

### ⚠️ `demo_seed.py` NO es ejecutable contra el staging actual (schema drift)

`scripts/demo/demo_seed.py` escribe columnas/tablas que **no existen** en staging:

| Script espera | Staging real |
|---|---|
| `clients.slug`, `clients.name`, `clients.environment`, `clients.source` | no existen (hay `display_name`; sin columnas de tagging) |
| `pos_menu_items.category_name`, `.source`, `.environment` | no existen (`category_id` es FK real a `pos_menu_categories`, que el script no puebla) |
| tabla `pos_tables` | **no existe** en staging |
| `pos_staff.source`, `.environment` | no existen |

PostgREST rechaza upserts con columnas desconocidas → el seed fallaría en la primera llamada. Los 45 tests pasan porque todo está mockeado.

### Lo que SÍ se ejecutó (y es re-ejecutable)

```
# Idempotente (ON CONFLICT DO UPDATE), reversible (bloque TEARDOWN al final del archivo)
# Ejecutar vía MCP supabase-fullsite-staging execute_sql, o:
psql "$STAGING_DATABASE_URL" -f scripts/demo/second_tenant_config.sql
```

Env vars requeridas (solo NOMBRES — nunca imprimir valores): `STAGING_DATABASE_URL` o (`STAGING_SUPABASE_URL` + `STAGING_SUPABASE_KEY`) para la vía REST/Admin API.

Si se corrige `demo_seed.py` al schema real, el comando sería:
```
STAGING_SUPABASE_URL=... STAGING_SUPABASE_KEY=... STAGING_URL_FRAGMENT=<staging-ref> \
  python scripts/demo/demo_seed.py --seed 42
```
(los guards IG-01/IG-02 fail-closed ya bloquean AMALAY prod correctamente).

---

## 3. Isolation check results (staging, 2026-08-05)

Adaptados de `scripts/tenant-isolation/ti_checks.sql` (tenant de sesión: `vantara`).
Ejecutados **dos veces**: como service_role (indicativo) y **simulando sesión autenticada real** (`SET LOCAL role='authenticated'` + `request.jwt.claims.sub = <user vantara>`), que es la vía válida para el gate según el README.

| Check | Descripción | Sesión autenticada vantara | Resultado |
|---|---|---|---|
| TI-01 | 0 órdenes de otros tenants visibles | 0 visibles | **PASS** |
| TI-02 | 0 categorías de otros tenants | 0 visibles (demo+prueba-3 existen pero invisibles) | **PASS** |
| TI-02b | 0 menu items de otros tenants | 0 visibles (30 items demo invisibles) | **PASS** |
| TI-03 | 0 staff de otros tenants | 0 visibles | **PASS** |
| TI-03b | 0 payment methods de otros tenants | 0 visibles | **PASS** |
| TI-05 | 0 datos de amalay/demo/prueba-3 en pos_orders | 0 | **PASS** |
| TI-A (extra) | 0 filas `client_id~amalay` en TODAS las tablas con client_id | 0 (scan dinámico, service_role = ve todo) | **PASS** |
| TI-A2 (extra) | 0 texto amalay/`qjiomlvudfmzuvqvhwpk` en `clients`; 0 auth users amalay | 0 / 0 | **PASS** |
| ANON | rol `anon` no puede leer tablas pos_* | `permission denied` (sin GRANT SELECT) | **PASS** |
| TI-04 | Manual: ninguna pantalla muestra "AMALAY" | no ejecutado (requiere UI) — ver hallazgos §4 que lo romperían | **PENDING** |
| TI-06 | Manual: AI Chat no responde meseros AMALAY | no ejecutado | **PENDING** |

**Nota RLS:** las políticas `auth_tenant` (`client_id = auth_client_id()`) funcionan. Existen políticas residuales `anon_read` con `qual=true` sobre `pos_*` (y `anon_insert/update` en `pos_orders`), pero son **inertes**: el rol `anon` no tiene GRANT SELECT/INSERT/UPDATE a nivel tabla (verificado: solo TRUNCATE/REFERENCES/TRIGGER). Recomendado eliminarlas (defensa en profundidad) — si alguien restaura grants a `anon`, se abre lectura cross-tenant total.

---

## 4. Hardcoded AMALAY references (POS/Bridge/installer path)

Scan: `grep -rniE 'amalay|qjiomlvudfmzuvqvhwpk' scripts/ electron-app/ dashboard-app/src/` (1,099 hits brutos; website/marketing/docs/agents fuera de scope). Clasificación:

### BLOCKS-CLONABILITY (8 hallazgos)

| # | Ubicación | Problema | Fix |
|---|---|---|---|
| B1 | `dashboard-app/src/components/POSCopilot.tsx:70` | `COMBO_RULES` hardcodea `'Combo Desayuno AMALAY'` — se sugiere a CUALQUIER tenant (rompe TI-04) | mover combos a config por cliente |
| B2 | `dashboard-app/src/app/reservar/page.tsx:25,74,76,235,237,678` | Página pública de reservas 100% AMALAY (logo "AMALAY", paquetes "Taquitos Amalay", footer "AMALAY Monterrey", cafeamalay.com) horneada en la app compartida sin gating por tenant | gate por client o mover a config |
| B3 | `dashboard-app/src/lib/agents/finance.ts:10,53` | Agentes leen `wansoft_daily`/`wansoft_kpis` globales "exclusivas de AMALAY" sin filtro `client_id` — un segundo tenant con agentes vería/mezclaría datos AMALAY | filtrar por client / gate por data_source |
| B4 | `dashboard-app/src/app/api/integrations/uber-eats/sandbox/route.ts:75,111` | Mock sandbox devuelve `name: 'AMALAY Coffee & Market'` a cualquier tenant probando la integración | derivar de `clients.display_name` |
| B5 | `dashboard-app/src/app/admin/usuarios/page.tsx:354` | Placeholder `juan@amalay.mx` visible en UI compartida (TI-04) | placeholder neutro |
| B6 | `dashboard-app/src/app/admin/vault/page.tsx:201` | Label ejemplo `"Rappi AMALAY"` visible (TI-04) | texto neutro |
| B7 | `dashboard-app/src/app/internal/vault/page.tsx:190` | Ídem B6 | texto neutro |
| B8 | `electron-app/setup.html:232` | Installer/setup del Bridge muestra placeholder `ej. amalay-principal` | `ej. mirestaurante-principal` |

### BENIGN (muestra representativa; no bloquean)

| Ubicación | Por qué es benigno |
|---|---|
| `dashboard-app/src/lib/pos-data.ts:1267` `getMesasConfig` | correctamente gated: `if (clientId === 'amalay')`; otros tenants reciben layout genérico |
| `dashboard-app/src/app/pos/mesas/page.tsx:736` | plano físico gated con `_cid() === 'amalay'` |
| `dashboard-app/src/app/internal/chat-logs/page.tsx:159` | gated `log.client_id !== 'amalay'` |
| `dashboard-app/src/lib/pos-data.ts:834-975` `MENU_CATEGORIES` estático (menú AMALAY) | legacy fallback; el POS carga menú por DB con `client_id=eq.<tenant>`; para otros tenants el lookup estático devuelve `''` y cae a keywords → nunca muestra items AMALAY. Recomendado retirar igualmente |
| `dashboard-app/src/lib/pos-data.ts:720-730,2415` aliases fuzzy / `mkt-amalay` | inertes: solo matchean si el tenant tiene items con esos nombres/ids |
| `dashboard-app/src/lib/pos-constants.ts:189` `'amalay -'` en `CAJA_KEYWORDS`; `dashboard-app/src/app/cocina/page.tsx:458` `'combo amalay'` | keywords de routing inertes para otros tenants |
| `dashboard-app/src/app/page.tsx:38` `'SEMILLAS Y DULCES AMALAY'` | rename map — solo aplica si la categoría existe |
| `dashboard-app/src/lib/data.ts:37-56` | client id viene de `NEXT_PUBLIC_DEFAULT_CLIENT_ID` (env), sin fallback hardcodeado a amalay |
| `electron-app/main.js:43,128,160`; `electron-app/local-server/adapters/printer-config-schema.js:13` | migración legacy v1→v2 de installs AMALAY existentes — back-compat intencional |
| `scripts/onboarding/{vercel_provision,onboard_client,menu_import,contract}.py` (`AMALAY_REF = "qjiomlvudfmzuvqvhwpk"`, `FORBIDDEN={"amalay"}`) | **guards de seguridad intencionales** que bloquean apuntar a prod AMALAY |
| `scripts/demo/demo_seed.py:41-42`, `PROVENANCE.md`, `tests/test_demo_isolation.py` | fragmentos de bloqueo prod + tests de los guards |
| `scripts/manifests/amalay.json` | manifiesto per-cliente de AMALAY — correcto que exista |
| `scripts/sql/migrations/*` (P1-D03-amalay-*, 010_consolidated, etc.), `scripts/sql/sandbox/*`, `scripts/migration-pipeline/*`, exports JSON | migraciones históricas/one-off de AMALAY, generadores sandbox que precisamente filtran amalay, reportes de dry-run |
| `scripts/migrate-wansoft-to-supabase.py` | script de migración exclusivo de AMALAY por diseño |
| `dashboard-app/src/__tests__/**` (~40 archivos) | fixtures de test |
| comentarios: `pos-config.ts`, `facturama.ts`, `cfdi-xml-parser.ts`, `server-discovery.ts:311`, `pos/layout.tsx:143`, `pos/delivery/page.tsx:4`, `food-cost/page.tsx`, `mission-control` (`weekly-amalay` = nombre real de workflow) | comentarios/docs/nombres de workflows reales |

---

## 5. Gaps restantes para CLONABILITY PASS

1. **Fix B1–B8** (§4) — 6 de 8 son cambios de una línea (placeholders/mocks); B2 (página reservar) y B3 (agentes wansoft) requieren gating por tenant.
2. **Auth user del tenant demo** — crear `owner@demo.sandbox` vía Admin API y ligar en `client_users` (comando documentado en `second_tenant_config.sql`). Vantara ya cumple este punto si se usa como segundo tenant del gate.
3. **`demo_seed.py` schema drift** — actualizar el script al schema real de staging (sin `pos_tables`, sin columnas `source`/`environment`, `clients.display_name`, poblar `pos_menu_categories` con FK real) o añadir esas columnas/tabla vía migración. Hoy los 45 tests pasan solo porque todo está mockeado.
4. **TI-04 / TI-06 manuales** — pendientes de ejecutar con sesión demo/vantara en el UI de staging (TI-04 fallaría hoy por B1/B5/B6/B7).
5. **Limpiar políticas `anon_read`/`anon_insert`/`anon_update` residuales** en `pos_*` (hoy inertes por falta de GRANTs, pero son una mina si se restauran grants a `anon`).
6. **Printers**: validar en el Bridge una instalación con `printers.json` demo (COCINA-DEMO/BARRA-DEMO/CAJA-DEMO) — no hay representación en DB que verificar.

**Veredicto:** datos de staging = CLEAN (0 AMALAY). Aislamiento RLS autenticado = PASS. Clonabilidad de código = **NO PASS aún** (8 refs bloqueantes, mayormente triviales).
