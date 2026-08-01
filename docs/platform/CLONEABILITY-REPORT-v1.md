# Cloneability Report v1

**Fecha:** 2026-07-29  
**Rama base:** `sandbox/second-customer-skeleton`  
**Tenant de referencia:** VANTARA (cliente #2 en fullsite-sandbox)  
**KPI objetivo:** tiempo para crear un tercer restaurante desde cero

---

## 1. ¿Qué siguió funcionando sin modificar código?

| Feature | Mecanismo | Estado |
|---|---|---|
| Login / sesión | Lee `client_users.client_id` desde Supabase Auth | Funciona — source of truth correcto |
| Menú POS | `pos_menu_items WHERE client_id = _cid()` | Funciona — segmentado por tenant |
| Categorías | `pos_menu_categories WHERE client_id = _cid()` | Funciona |
| Modificadores | `pos_item_modifier_groups / pos_modifiers WHERE client_id` | Funciona |
| Mesas | `clients.mesas INTEGER` → grilla numérica genérica | Funciona — VANTARA muestra 12 mesas |
| Métodos de pago | `pos_payment_methods WHERE client_id` | Funciona |
| Staff / PIN | `pos_staff WHERE client_id` con UNIQUE (pin, client_id) | Funciona — PINs aislados por tenant |
| Crear / cerrar orden | `pos_orders INSERT/UPDATE con client_id` | Funciona |
| Configuración de recibo | `clients.receipt_footer / iva_rate / display_name` | Funciona — datos de VANTARA |
| Dashboard (ventas) | Fallback automático: si wansoft_daily vacío → lee `pos_orders` | Funciona — path `data_source='fullsite'` |
| Dashboard (meseros) | Fallback → `pos_orders.mesero` | Funciona |
| Dashboard (platillos) | Fallback → `pos_orders.items` JSONB | Funciona |
| Cortes de caja | `pos_cierres WHERE client_id` | Funciona — vacío en restaurante nuevo |

**Conclusión:** el flujo POS completo (login → orden → cobro → dashboard) funciona para un segundo cliente sin ningún cambio de código, siempre que `client_users` esté sembrado correctamente.

---

## 2. ¿Qué requirió parametrización?

| Paso | Tiempo manual estimado | Notas |
|---|---|---|
| Crear proyecto Supabase | 5 min | UI manual — no hay API en tier gratuito |
| Aplicar 7 archivos SQL uno por uno | 10 min | SQL Editor en Supabase — tedioso pero predecible |
| Ejecutar `bootstrap_auth.py` | 1 min | Scriptable — corre en cualquier máquina con Python 3 |
| Crear proyecto Vercel | 5 min | UI manual (aunque existe Vercel CLI / API) |
| Configurar 4 env vars en Vercel | 2 min | UI o `vercel env add` |
| DNS CNAME | 2 min + propagación | Cloudflare — 1 record |
| Agregar dominio en Vercel | 1 min | |

**Total actual: ~26 min operativo + 5–15 min de propagación DNS.**  
Esto no incluye el tiempo de decidir nombres, PINs, emails, etc.

---

## 3. ¿Qué sigue hardcodeado?

### Crítico (puede causar mal comportamiento en VANTARA)

| Archivo | Línea | Problema | Impacto en VANTARA |
|---|---|---|---|
| `src/lib/pos-config.ts` | 28 | SSR fallback: `typeof window === 'undefined' ? 'amalay'` | Durante SSR el servidor busca config de AMALAY antes de hidratar con VANTARA. **Flicker visual** en carga inicial del POS. No causa datos incorrectos. |
| `src/lib/pos-data.ts` | 1258 | `if (clientId === 'amalay') return MESAS_CONFIG` | VANTARA cae al path genérico (grilla por número). Funcional, pero AMALAY tiene un plano físico especial. |
| `src/app/admin/tarjetas-regalo/page.tsx` | 23 | `empty = { ..., client_id: 'amalay' }` | Si se crea una tarjeta regalo desde la UI sin modificar el estado inicial, se asigna a AMALAY. **Bug de datos** — baja prioridad. |

### Menor (no bloquea demo)

| Archivo | Línea | Problema |
|---|---|---|
| `src/app/pos/mesas/page.tsx` | 725 | Feature visible solo si `_cid() === 'amalay'`. VANTARA no lo ve — correcto pero no scalable. |
| `src/app/admin/vault/page.tsx` | 181 | Dropdown de clientes tiene solo `<option value="amalay">`. VANTARA no aparecería. |
| `src/app/internal/vault/page.tsx` | 170 | Mismo problema. |
| `src/app/admin/chat-logs/page.tsx` | 159 | Condición de display `log.client_id !== 'amalay'`. Funcional pero confuso para otros clientes. |
| `src/lib/client-config.ts` | 183 | Email map `ramonfaur.daniel@gmail.com → 'amalay'`. Legacy fallback — **no bloquea** porque `client_users` tiene prioridad. |
| `src/app/api/health/route.ts` | 16, 32 | Health check lee `wansoft_daily` — falla para clientes `data_source='fullsite'` con tabla vacía. Muestra error en `/api/health` pero no rompe la app. |

### Profundo (AI/Analytics)

| Feature | Estado en VANTARA |
|---|---|
| AI Chat (`/api/chat`) | Lee `wansoft_daily` primero — devuelve vacío. Fallback a `pos_orders` disponible pero no siempre activado. |
| AI Coach (`/api/coach`) | Solo lee `wansoft_daily`. No funciona para VANTARA hasta que se integre el fallback. |
| Inventory predictor (`/api/inventory/predict`) | Lee `wansoft_daily` para volúmenes. No funciona para VANTARA. |
| Agents / GitHub Actions | Todos hardcodeados contra AMALAY Supabase. No aplican al sandbox. |

---

## 4. ¿Qué impide hoy crear un tercer restaurante en menos de 10 minutos?

**Tiempo mínimo actual: ~26 min** (sin propagación DNS).

Los cuellos de botella, ordenados por impacto:

| # | Cuello de botella | Tiempo | Solución |
|---|---|---|---|
| 1 | Aplicar 7 archivos SQL manualmente uno por uno | 10 min | Un script `onboard_client.py` que los aplique vía Supabase REST (o psql con `DATABASE_URL`) |
| 2 | Crear proyecto Vercel + env vars manualmente | 7 min | `vercel project add` + `vercel env add` via CLI. Scriptable. |
| 3 | DNS CNAME + propagación | 2 min + variable | Cloudflare API. Scriptable. |
| 4 | Crear proyecto Supabase | 5 min | Supabase Management API (disponible en todos los tiers). Scriptable. |
| 5 | Correr `bootstrap_auth.py` | 1 min | Ya scriptable — queda en el flujo |

Si se automatizan los pasos 1–4, el tiempo objetivo baja a **~5 min**: proporcionar 5 parámetros, correr un script, esperar DNS.

---

## 5. ¿Cuál sería el siguiente PR con mayor impacto?

### `scripts/sql/sandbox/onboard_client.py` — "New Client in 5 min"

**Qué haría:**

```bash
python3 scripts/sql/sandbox/onboard_client.py \
  --client-id     vantara \
  --display-name  "Grupo VANTARA" \
  --supabase-url  https://<ref>.supabase.co \
  --service-key   <service-key> \
  --owner-email   owner@vantara.sandbox \
  --owner-pass    "ChangeMe123!"
```

**Pasos que automatiza:**

1. Aplica las 7 migraciones en orden via Supabase REST (ejecuta SQL directamente con `Content-Type: application/json` al endpoint `/rest/v1/rpc` o via `pg` si se provee DATABASE_URL)
2. Inserta el registro en `clients` con los parámetros dados
3. Inserta categorías y platillos de un template configurable
4. Inserta métodos de pago y staff desde un template
5. Crea auth user y `client_users` row (código ya existe en `bootstrap_auth.py`)
6. Imprime resumen: qué se creó, qué falta (Vercel, DNS)

**Lo que aún requeriría UI (inicialmente):**
- Crear el proyecto Supabase (o proveer DATABASE_URL de uno existente)
- Crear el proyecto Vercel y setear las env vars

**Impacto:**  
Reduce el tiempo operativo de 26 min → ~8 min.  
Es el único cambio que mueve el KPI de "tercer restaurante en <10 min" dentro del rango posible.

**Alcance:** ~200 líneas de Python. Sin dependencias externas. Idempotente. Reutiliza código de `bootstrap_auth.py`.

---

## Resumen ejecutivo

| Dimensión | Estado |
|---|---|
| POS flow completo (orden → cobro) | **Funciona sin cambios de código** |
| Dashboard básico (ventas del día) | **Funciona** — fallback a pos_orders |
| Flujo completo de onboarding | **Funciona** — manual, ~26 min |
| AI Chat / Coach / Inventory prediction | **No funciona** — lee solo wansoft_daily |
| Tercer restaurante en <10 min | **No posible hoy** — mínimo ~26 min |
| Siguiente acción de mayor impacto | `onboard_client.py` — reduce a ~8 min |
