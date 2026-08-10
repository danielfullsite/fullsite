# HANDOFF → Claude 1: Café Nómada VIVO en el deploy público (staging jkcnxf), sin tocar AMALAY

**De:** sesión 07efb7c1 · **Objetivo:** que el deploy público existente (tuyo) muestre datos
vivos de Café Nómada (tenant `nomada`) sobre **staging `jkcnxfbbuyyfhwfjizgw`**, con aislamiento
JWT/RLS y branding demo, **sin localhost, sin nuevo entorno/tenant/UI, sin tocar AMALAY**.

Contexto: la "corrección de UI" que hice en localhost NO fue código nuevo — fue (a) apuntar la app
a staging, (b) resolver la fuente de datos por tenant, (c) reconciliar el status de las órdenes.
Aquí está exactamente lo portable.

---

## 1. DATA — fix tenant-safe (YA aplicado por mí en staging)

- `update clients set data_source='fullsite' where id='nomada';` — **ya ejecutado en jkcnxf.**
  Con esto, el código EXISTENTE de `AuthContext.tsx:101` (`if (ds === 'fullsite')`) auto-setea
  `localStorage.fullsite_data_source='fullsite'` al login → el dashboard lee `pos_orders`
  (no `wansoft_daily`). Ya no se necesita ningún hack manual de localStorage.
- Seed corregido para clonar futuros clientes bien: `scripts/seed/nomada/v1_client.sql`
  ahora usa `data_source='fullsite'` (antes `'supabase'`).

**⚠️ NO hacer el "fix" de código obvio** (`if ds==='fullsite' || ds==='supabase'`): **rompe AMALAY.**
AMALAY prod también tiene `data_source='supabase'` pero lee `wansoft_daily` (histórico). El fix
correcto es POR TENANT (solo `nomada`→`'fullsite'`), no un mapeo global. AMALAY queda intacto.

## 2. ENV del deploy público (Vercel — tu dominio)

- `NEXT_PUBLIC_SUPABASE_URL = https://jkcnxfbbuyyfhwfjizgw.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY = <anon de staging (pública)>` → `supabase projects api-keys --project-ref jkcnxfbbuyyfhwfjizgw`
- `SUPABASE_URL = jkcnxf` (server) · `SUPABASE_SERVICE_KEY = <service key de STAGING, solo server>` — **nunca la de prod, nunca al browser**
- `NEXT_PUBLIC_DEFAULT_CLIENT_ID = ''` (vacío, **NO `amalay`**) — el tenant se resuelve por sesión
- `SANDBOX_ENV = true` — el guard en `next.config.ts` **aborta el build si la URL apunta a qjiom (AMALAY prod)**. Es tu red-line anti-fuga.
- **Verificar en runtime:** red del browser 100% `jkcnxf`, **0 `qjiom`**. (En localhost verifiqué 36/0.)
  El pin a prod que vi en dev venía de heredar `SUPABASE_URL/DATABASE_URL` del shell + `.next` stale;
  eso NO ocurre en Vercel si el proyecto tiene el env correcto y no hereda vars de prod.

## 3. RECONCILIACIÓN con Claude 2 (generador) — REQUERIDA para "datos vivos"

Estado actual de `nomada` en staging (reconciliado 2026-08-10): **67 órdenes / $11,904.68**.
| status | n | total | ¿visible en dashboard? |
|---|---|---|---|
| **cerrada** | 2 | **$510.00** | **SÍ** (mis 2 demo — convención canónica) |
| cobrada | 58 | $9,963.24 | **NO** (generador de Claude 2) |
| cancelada | 5 | $1,112.44 | no (correcto) |
| enviada | 2 | $319.00 | no (en cocina) |

- **Explicación $510 vs generador:** los **$510 / 2 órdenes** son mis órdenes demo en `status='cerrada'`.
  Los **$9,963 / 58** del generador están en `status='cobrada'` y el dashboard **no los cuenta**.
- **Causa:** `getDashboardFromPosOrders` (data.ts:437) filtra `status=eq.cerrada`. Verifiqué la
  convención CANÓNICA en **AMALAY prod: 1,842 `cerrada`, CERO `cobrada`.** El dashboard es correcto;
  **el generador escribe un status (`cobrada`) que no existe en prod → invisible.**
- **Reconciliación (Claude 2 debe cambiar):** el generador debe emitir órdenes pagadas/cerradas con
  **`status='cerrada'`** (o transicionar `cobrada`→`cerrada` al cerrar turno). **NO** cambiar el
  dashboard a contar `cobrada` (divergiría de AMALAY prod).
- Consistente ya: **tenant** `nomada` ✓ · **business date** 2026-08-09 Monterrey (`business_day_start_local='07:00'`) ✓ · **fuente** `pos_orders` (tras §1) ✓.

## 4. RLS / aislamiento — YA correcto, NO cambiar

jkcnxf ya scope-a por JWT/membresía (`private.user_has_client_access(client_id)` + `client_users`).
Verificado: nómada autenticado lee solo lo suyo (self=2/$510, o el total `cerrada` tras §3),
**cross-read=0, cross-write bloqueado, anon 403.** Evidencia: `scripts/onboarding/verify_tenant_rls_nomada.sql`
(commit `0c3c87e`). **No apliques migración RLS.**

## 5. Branding demo — YA funciona

El banner "Café Nómada — DEMO / DATOS SINTÉTICOS" se renderiza de la config del tenant. Sin cambios.

---

## Criterio de terminado (tuyo, Claude 1)

Deploy público en jkcnxf → login `owner@nomada.staging` → dashboard con ventas **vivas** de Café
Nómada (tras §3), red 100% jkcnxf / 0 qjiom, **0 `amalay` en la UI**, AMALAY intacto.

## NO hacer
- No mapear `'supabase'→'fullsite'` en código (rompe AMALAY).
- No apuntar el deploy a qjiom; no usar service key de prod; no tocar AMALAY.
- No usar localhost como entrega; no crear otro tenant/UI/entorno.

## Artefactos
- Fix de datos + seed: este doc + `scripts/seed/nomada/v1_client.sql` (data_source='fullsite').
- Wrapper de referencia (solo para reproducir local, NO es el deploy): `scripts/onboarding/run_dashboard_staging.sh`.
- Evidencia UI ($510): `scratchpad/nomada-14-final.png`. Verificación RLS: `scripts/onboarding/verify_tenant_rls_nomada.sql`.
- Provisioning + E2E: `scripts/seed/nomada/`, `scripts/onboarding/verify_nomada_e2e.sql`, `docs/platform/CLIENT2-NOMADA-STAGING.md`.
