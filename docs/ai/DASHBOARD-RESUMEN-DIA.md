# Dashboard — resumen del día (fuente viva y por qué)

> Verificado en campo el **2026-09-30** (amalay), con Daniel. Si tocas el camino de
> datos del dashboard (`dashboard-app/src/lib/data.ts`, `api/dashboard/*`,
> `public/sw.js`), **lee esto antes**. Cada decisión de abajo salió de un bug real.

## El modelo: una espina, muchas vistas

- **La espina (la verdad):** `pos_orders` + funciones `fs_*`, regla única `fs_es_venta`,
  "hoy" = `dia_venta`. La vista **`ocm_daily`** agrega esa espina a **1 fila por día**
  (es la "fuente viva" que ya nombra el CLAUDE.md raíz).
- **Las vistas:** el **dashboard** muestra los pocos números que el dueño acciona a
  diario; el **chat (free-SQL)** contesta la cola infinita; agentes/reportes toman su
  rebanada. No se mete todo al dashboard: lo que "no cabe" vive en el chat.
- **Dirección:** espina primero, vistas después. Diseñar vista-primero produjo números
  que no cuadraban entre capas (el bug de abajo).

## El incidente (2026-09-30)

El dashboard de amalay mostraba **$23,863 / 33 órdenes** cuando el día real era
**$49,761 / 73**. No era caché del navegador (pasaba hasta en incógnito y con el SW
desregistrado): el **servidor devolvía bien** (la URL directa de `/api/dashboard/pos-daily`
traía las 73), pero el **cliente caía al respaldo** `wansoft_daily`, congelado
(coincidía exacto: 33/$23,863/50 personas).

### Causa raíz (medida, no inferida)

`getRecentDays()` armaba el histórico leyendo **90 días de `pos_orders` CRUDO**:
**6,202 órdenes / ~5.9 MB / 7 páginas keyset** en cada carga. Eso excedía el timeout del
cliente → `getDashboardFromPosOrders` lanzaba → el merge caía a `wansoft_daily` (muerto
desde 2026-09-08). Un Service Worker con `NETWORK_TIMEOUT_MS = 2500` lo empeoraba
sirviendo la copia vieja aún más rápido.

## Los tres fixes (en orden, todos en main)

1. **Ingesta a `pos_orders` restaurada** — el job externo `historico_tickets → pos_orders`
   (filas `wh-`) murió ~13:05 del 2026-09-30. Se creó la función
   `fs_sync_pos_orders_desde_historico(p_dias int)` (SECURITY DEFINER) + **pg_cron
   `fs-sync-pos-orders` cada minuto**.
   - **SALVAGUARDA multi-tenant:** sólo sincroniza tenants **ESPEJO** (pos_orders 100%
     `wh-`, sin filas nativas). Hoy sólo **amalay**. Los tenants con POS nativo
     (scyf-demo, lab-resto, tekila-rg, diezmex-demo, …) **NO** se tocan — sincronizarlos
     DUPLICARÍA sus ventas. No hardcodea `amalay`: se auto-clasifica en runtime.
   - Idempotente (inserta sólo `wh-<ticket_id>` faltantes). Sólo `cancelado=false`
     (el feed externo nunca metió cancelados). `EXECUTE` revocado a anon/authenticated.
2. **Service Worker (#455)** — `/api/dashboard/` entra a `NEVER_CACHE_PATTERNS` en
   `public/sw.js` (como `pos_orders`/`pos_mesas`: dato vivo que nunca se sirve viejo) y
   la ruta responde `Cache-Control: no-store`. No toca el arranque en frío.
3. **Lectura ligera (#456)** — nueva ruta **`api/dashboard/ocm-daily`** lee `ocm_daily`
   (~90 filas, instantáneo) para el histórico/tendencias **sin filtro de sucursal**. El
   **número + detalle del día** salen de una lectura CORTA de `pos_orders` (hoy+ayer,
   ~150 filas). **Con** filtro de sucursal: sigue en `pos_orders` (`ocm_daily` no tiene
   `location_id`) → cero regresión multisucursal.

## Confirmado · Pendiente

**Confirmado (2026-09-30):**
- `ocm_daily == pos_orders` crudo (fs_es_venta), 10/10 días, amalay. Peso por peso.
- amalay 2026-09-30: $49,761 / 73 tickets = reporte Wansoft. Lectura `ocm_daily` ~4 ms.

**Pendiente (no bloquea):**
- **"Al segundo" real:** que `ingesta-pos` escriba `pos_orders` al instante (sin cron).
  Hoy la frescura es ≤60s (cron).
- `api/predict` y los agentes Python siguen leyendo legacy (deuda ya conocida).
- Otros restaurantes a modo espejo: el cron los toma solo cuando su `pos_orders` sea
  100% `wh-` (sin cambiar código).

## No romper

- El dashboard **nunca** debe servir `wansoft_daily` como "hoy" (muerto desde 2026-09-08);
  es sólo histórico importado.
- No volver a leer 90 días de `pos_orders` crudo para el histórico del dashboard.
- El cron de sincronización **sólo** tenants espejo. Nunca forzar un tenant con nativos.
