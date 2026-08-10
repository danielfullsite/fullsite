# Cloneability Report v1

**Fecha:** 2026-07-29  
**Rama base:** `sandbox/second-customer-skeleton`  
**Tenant de referencia:** VANTARA (cliente #2 en fullsite-sandbox)  
**KPI objetivo:** tiempo para crear un tercer restaurante desde cero

---

## Revalidación 2026-08-10 — Client #3 sintético

La conclusión histórica de ~26 minutos ya no describe el path compartido actual. El pipeline
`scripts/onboarding/onboard_client.py` provisionó **Bistro Horizonte — DEMO** (`client3-demo`) en el
staging hospedado `jkcnxfbbuyyfhwfjizgw`, sin infraestructura ni código por restaurante:

| Evidencia | Resultado |
|---|---|
| Alta inicial | PASS · 36 registros · 11.6 s · 0 warnings |
| Re-ejecución idempotente | PASS · 0 registros nuevos · 7.1 s · 0 warnings |
| CLON-SMOKE turno→orden→cobro→cierre+cleanup | 15/15 PASS · 2.5 s |
| Aislamiento real `client3-demo` ↔ `nomada` | 19/19 PASS · GoTrue JWT + `apikey=anon` |
| Import menú/staff por dueño autenticado | PASS · JWT/RLS real · menú 10/10 · staff 1/1 · diff 0 |
| Rerun de importadores | PASS · 0 creados · 0 actualizados · PIN preservado |
| Gate de hardcodes runtime | PASS · 742 archivos · 53 excepciones justificadas · 0 violaciones |
| UI pública compartida | Login + PIN + identidad visible en `https://fullsite-client2-demo.vercel.app` |
| Red UI | staging presente · requests a producción `qjiom…` = 0 |

Artefactos reproducibles:

- Manifest: `scripts/onboarding/examples/client3-demo.json` (password solo por secret env).
- Primera alta: `onboarding-reports/client3-demo-20260810-012031/`.
- Rerun TLS-verificado/idempotente: `onboarding-reports/client3-demo-20260810-013848/`.
- Fixes de onboarding: `17290dd`, `3bca37e`.
- Runner de aislamiento con roles reales: `e3cbf7f`.
- Identidad de restaurante visible en POS: `238d7ad`.
- Hardcodes runtime y fallback móvil eliminados/gateados: `be02c9b`.
- Importadores reales con JWT/RLS e idempotencia: `78dfb39`.

**Claim permitido:** CODE + HOSTED TEST VERIFIED para onboarding de un tercer tenant sobre la
infraestructura compartida existente. **No es FIELD CERTIFIED:** siguen pendientes terminal física,
impresora, entrenamiento y Shadow Day del cliente real.

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

`scripts/check_hardcodes.sh` inspecciona código runtime clonado y falla ante project refs de
producción, defaults/fallbacks/comparaciones de identidad AMALAY y credenciales JWT embebidas en
assets públicos. Resultado actual: **742 archivos, 53 excepciones explícitas, 0 violaciones**.

Las excepciones no son defaults de tenant: son guards que bloquean producción, compatibilidad
legacy AMALAY explícitamente cerrada, el plano físico AMALAY y automatizaciones Wansoft/Agent
Company fuera del core POS clonable. Cada excepción tiene path, regla y motivo en
`scripts/hardcode_allowlist.json`.

El fallback móvil a Supabase/tenant AMALAY fue eliminado: URL, anon key y client ID son ahora
configuración obligatoria y fail-closed. El panel HTML standalone que embebía el ref de producción
se neutralizó en favor de la ruta canónica `/internal`. Chat logs agrega scope explícito por
`clientId`, manteniendo RLS como frontera final.

---

## 4. ¿Qué impide hoy crear un tercer restaurante en menos de 10 minutos?

El alta de datos en la infraestructura compartida ya no es el cuello de botella: Client #3 se creó
en **11.6 segundos** y su rerun tomó 7.1 segundos. Menú/staff pueden importarse con un JWT real del
dueño y RLS, sin extraer service-role; el diff exacto queda en 0.

Lo pendiente es operación física: terminal, impresora, entrenamiento y Shadow Day. DNS/proyecto
propio solo aplican cuando el producto decida infraestructura dedicada; no son requisito del tenant
aislado sobre el proyecto compartido actual.

---

## 5. ¿Cuál sería el siguiente PR con mayor impacto?

No falta otro PR de arquitectura para demostrar clonabilidad remota. El siguiente incremento de
evidencia es **Shadow Day/Field Batch físico**, usando el runbook existente y corrigiendo únicamente
defectos observados. El track Golden Skeleton conserva su gate formal PENDING-GATE; esta evidencia
no lo salta ni convierte una prueba hospedada en certificación de campo.

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
