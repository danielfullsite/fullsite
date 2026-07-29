# Operational Canonical Model (OCM) — Contrato v0.1

**Fecha:** 2026-07-29
**Estado:** Contrato formal aprobado — sin implementación todavía.
**Supersede:** `OPERATIONAL-CANONICAL-MODEL-v0.md`
**Próximo paso:** SQL de Fase 1 (`020_ocm_views.sql`) después de SKEL-04.

**Regla de oro:** Los agentes de IA nunca consultan `wansoft_daily`, `pos_orders` ni
ninguna tabla de fuente directamente. Toda la inteligencia operativa pasa por el OCM.

---

## 1. Problema que resuelve

```
Hoy:
  AMALAY  → wansoft_daily     → AI agents   ✓
  VANTARA → pos_orders         → AI agents   ✗ (agentes ciegos)
  Delivery → (sin tabla)       → AI agents   ✗

Con OCM:
  AMALAY  → wansoft_daily ──┐
  VANTARA → pos_orders    ──┤→  OCM (vistas)  →  AI agents  ✓ todos
  Delivery → delivery_orders ─┘
```

---

## 2. Arquitectura de capas

```
┌─────────────────────────────────────────────────────────────────┐
│  Fuentes de datos (por restaurante, por sucursal)               │
│  • wansoft_daily      (Wansoft POS)                             │
│  • pos_orders         (Fullsite POS)                            │
│  • delivery_orders    (Rappi / Uber Eats — futuro)              │
│  • import_batches     (cargas manuales — futuro)                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  OCM — Private Tenant Layer                                      │
│  Vistas Postgres por client_id + branch_id                       │
│  • ocm_daily_sales          • ocm_products                       │
│  • ocm_orders               • ocm_operations                     │
│  • ocm_inventory_snapshot   • ocm_data_quality                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
          ┌─────────────────▼──────────────────┐
          │  AI Agents / Analytics / Dashboard  │
          │  (leen solo OCM, nunca fuentes)     │
          └────────────────────────────────────┘

          ← Límite de privacidad del tenant →

┌─────────────────────────────────────────────────────────────────┐
│  Privacy & Aggregation Gateway                                   │
│  Agrega, anonimiza y aplica grupos mínimos antes de cruzar      │
│  la frontera del restaurante                                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  Network Intelligence Dataset                                    │
│  Benchmarks / Patrones / Fullsite Intelligence                   │
│  Sin nombres, sin tickets individuales, sin proveedores          │
└─────────────────────────────────────────────────────────────────┘
```

### Regla estricta de flujo

Un agente en capa 3 (AI/Dashboard) NUNCA salta a capa 5 (Network Intelligence).
Un componente en capa 5 NUNCA tiene acceso hacia atrás a capa 2 (fuentes raw).

---

## 3. Identidad mínima de cada registro (Sección A)

Todo registro que fluya por el OCM debe incluir estos campos de identidad
cuando aplique a la granularidad del registro:

| Campo | Tipo | Descripción |
|---|---|---|
| `client_id` | TEXT | Tenant actual (slug) |
| `organization_id` | UUID | Futuro: organización dueña del tenant |
| `branch_id` | UUID | Sucursal (si el tenant tiene múltiples) |
| `business_date` | DATE | Fecha operativa del restaurante (no timestamp de inserción) |
| `source_system` | TEXT | `'wansoft'` \| `'fullsite'` \| `'rappi'` \| `'uber_eats'` \| `'manual'` |
| `source_record_id` | TEXT | ID del registro en la fuente original |

`organization_id` y `branch_id` se vuelven requeridos cuando exista el esquema
de Foundation. Por ahora son `NULL`-able.

---

## 4. Trazabilidad (Sección B)

Cada registro derivado debe poder rastrearse hasta su fuente sin exponerla a
usuarios no autorizados. Campos requeridos en vistas que materializan datos:

| Campo | Tipo | Descripción |
|---|---|---|
| `source_system` | TEXT | Sistema de origen |
| `source_table` | TEXT | Tabla de origen (`'wansoft_daily'`, `'pos_orders'`) |
| `source_record_id` | TEXT | PK del registro original |
| `ingested_at` | TIMESTAMPTZ | Cuándo llegó el dato al pipeline |
| `transformed_at` | TIMESTAMPTZ | Cuándo fue transformado por el OCM |
| `schema_version` | TEXT | Versión del contrato OCM aplicado (ej. `'v0.1'`) |

La trazabilidad permite auditoría interna (Support mode) sin exponer
datos raw a la capa de inteligencia global.

---

## 5. Calidad de datos (Sección C)

Los agentes deben saber cuándo un dato es confiable, incompleto o viejo.
Cada vista del OCM incluye estos indicadores:

| Campo | Tipo | Descripción |
|---|---|---|
| `is_complete` | BOOL | El registro tiene todos los campos requeridos |
| `is_reconciled` | BOOL | Fue conciliado contra otra fuente (ej. cierre de caja) |
| `quality_score` | FLOAT | 0.0–1.0 — completitud ponderada del registro |
| `freshness_seconds` | INT | Segundos desde el dato más reciente en este agregado |
| `anomaly_flags` | TEXT[] | Lista de flags: `'missing_tip'`, `'negative_discount'`, etc. |

Un agente que reciba `quality_score < 0.6` debe declarar incertidumbre en su
respuesta en lugar de presentar datos como hechos.

---

## 6. Clasificación de privacidad (Sección D)

Todos los campos del OCM tienen una de estas cinco clasificaciones:

| Clasificación | Definición | Puede fluir a Network Intelligence |
|---|---|---|
| `operational` | Métricas de operación sin PII | Sí — sin restricción |
| `aggregated-safe` | Suma/promedio sobre ≥ grupo mínimo | Sí — requiere n ≥ 5 |
| `financial` | Montos individuales, nómina, costos | No — solo en tenant privado |
| `confidential` | Recetas, proveedores, márgenes reales | No |
| `personal` | Nombre, teléfono, CURP, RFC de empleados o clientes | Nunca |

La capa de inteligencia global (Network Intelligence Dataset) **nunca** recibe
campos `financial`, `confidential` ni `personal`. Recibe únicamente `operational`
y `aggregated-safe` con grupos mínimos aplicados.

---

## 7. Métricas semánticas canónicas (Sección F)

Una sola definición por métrica. Los agentes usan estos nombres — no los
nombres de columna de la fuente.

| Métrica | Definición canónica | Clasificación |
|---|---|---|
| `gross_sales` | Suma de totales de todos los tickets antes de descuentos y devoluciones | operational |
| `net_sales` | `gross_sales - discounts - refunds` | operational |
| `discounts` | Suma de descuentos aplicados (cortesías, promociones, errores) | operational |
| `refunds` | Devoluciones de efectivo o crédito por ticket anulado o parcial | operational |
| `taxes` | IVA y otros impuestos cobrados (campo separado de net_sales) | financial |
| `tips` | Propinas pagadas por clientes — total y por mesero | financial |
| `covers` | Número de personas atendidas en el restaurante | operational |
| `tickets` | Número de órdenes cerradas (= tickets de caja) | operational |
| `average_ticket` | `net_sales / tickets` (tickets ≥ 1) | operational |
| `voids` | Órdenes anuladas antes de cierre — no cuentan como refunds | operational |
| `labor_hours` | Horas trabajadas por turno (cuando disponible en nómina) | financial |
| `food_cost` | Costo de ingredientes / net_sales — en el periodo dado | confidential |
| `stock_variance` | Diferencia entre inventario teórico y físico — en unidades y valor | confidential |

**Regla:** si una fuente llama a una métrica de forma diferente (ej. Wansoft usa
`ventas_dia` para net_sales), la vista OCM hace el mapeo. El agente siempre
recibe `net_sales`.

---

## 8. Escala temporal (Sección G)

Las vistas del OCM deben funcionar en estas granularidades. No asumir que el
día operativo termina a medianoche.

| Granularidad | Definición |
|---|---|
| `event` | Ítem individual en una orden (línea de ticket) |
| `order` | Ticket completo (una mesa o una entrega) |
| `shift` | Turno de operación (puede cruzar medianoche) |
| `business_day` | Día operativo del restaurante — puede ser 6am–4am del siguiente día |
| `week` | Lunes–Domingo o el período definido por el cliente |
| `accounting_period` | Mes contable o período de nómina |

Las vistas aceptan un parámetro `business_date DATE` donde el valor es la fecha
del **inicio del turno**, no la fecha del registro en la base de datos.

---

## 9. Las seis vistas del OCM

### 9.1 `ocm_daily_sales(client_id, business_date)`

Ventas del día operativo.

```
Output (clasificación):
  business_date         DATE         operational
  client_id             TEXT         operational
  branch_id             UUID         operational
  gross_sales           NUMERIC      operational
  net_sales             NUMERIC      operational
  discounts             NUMERIC      operational
  refunds               NUMERIC      operational
  taxes                 NUMERIC      financial
  tips_total            NUMERIC      financial
  tickets               INT          operational
  covers                INT          operational
  average_ticket        NUMERIC      operational
  voids                 INT          operational
  cash                  NUMERIC      financial
  card_credit           NUMERIC      financial
  card_debit            NUMERIC      financial
  transfer              NUMERIC      financial
  platform              NUMERIC      financial      (Rappi/UberEats)
  source_system         TEXT         operational
  is_complete           BOOL         operational
  quality_score         FLOAT        operational
  freshness_seconds     INT          operational
  schema_version        TEXT         operational
```

Rama wansoft: lee `wansoft_daily WHERE fecha = business_date AND client_id = $1`
Rama fullsite: agrega `pos_orders WHERE DATE(created_at) = business_date AND client_id = $1 AND status = 'closed'`

### 9.2 `ocm_orders(client_id, desde, hasta)`

Órdenes individuales normalizadas.

```
Output:
  order_id              TEXT         operational
  business_date         DATE         operational
  hour_of_day           INT          operational
  table_number          INT          operational
  staff_name            TEXT         personal (→ aggregated-safe cuando fluye a red)
  subtotal              NUMERIC      financial
  total                 NUMERIC      financial
  payment_method        TEXT         operational
  status                TEXT         operational
  items_json            JSONB        operational
  covers                INT          operational
  source_system         TEXT
  source_record_id      TEXT
```

### 9.3 `ocm_products(client_id, desde, hasta)`

Ventas por platillo — ranking, popularidad, ingeniería de menú.

```
Output:
  product_name          TEXT         operational
  category_name         TEXT         operational
  units_sold            INT          operational
  gross_revenue         NUMERIC      financial
  avg_price             NUMERIC      operational
  source_system         TEXT
```

### 9.4 `ocm_inventory_snapshot(client_id)`

Niveles de inventario actuales. Retorna vacío cuando no hay inventario configurado
(no lanza error — el agente maneja el caso vacío).

```
Output:
  ingredient_name       TEXT         confidential
  unit                  TEXT         operational
  current_stock         NUMERIC      confidential
  min_stock             NUMERIC      confidential
  days_remaining        NUMERIC      operational
  reorder_urgency       TEXT         operational   ('ok'|'low'|'critical')
  source_system         TEXT
  freshness_seconds     INT
```

### 9.5 `ocm_operations(client_id, business_date)`

Métricas operativas del día — turno, personal, pico.

```
Output:
  business_date         DATE         operational
  peak_hour             TEXT         operational
  tables_served         INT          operational
  open_orders           INT          operational
  average_ticket        NUMERIC      operational
  staff_performance     JSONB        financial  [{staff_name, net_sales, tips}]
  shift_summary         JSONB        operational
  source_system         TEXT
  freshness_seconds     INT
```

### 9.6 `ocm_data_quality(client_id, business_date)`

Estado de calidad y frescura de datos. **Reemplaza el health check basado en
filas de `wansoft_daily`.** Es la fuente de verdad sobre si un tenant tiene
datos operacionales confiables.

```
Output:
  client_id             TEXT
  branch_id             UUID
  source_system         TEXT
  business_date         DATE
  last_sync_at          TIMESTAMPTZ
  delay_seconds         INT        — segundos desde la última sincronización
  incomplete_records    INT        — registros con is_complete = false
  discrepancies         INT        — registros con is_reconciled = false
  transform_errors      INT        — errores en el pipeline de transformación
  source_offline        BOOL       — la fuente no ha respondido en > umbral
  confidence_level      TEXT       — 'high' | 'medium' | 'low' | 'unavailable'
  freshness_status      TEXT       — 'fresh' | 'stale' | 'missing'
  notes                 TEXT[]     — razones legibles si confidence_level < high
```

`confidence_level` se calcula así:
- `high`: `delay_seconds < 3600`, `incomplete_records = 0`, `source_offline = false`
- `medium`: `delay_seconds < 86400`, `incomplete_records ≤ 5%` del total
- `low`: cualquier cosa fuera de los umbrales anteriores
- `unavailable`: sin ningún dato para esa fecha

Los agentes que reciban `confidence_level = 'low'` o `'unavailable'` deben
declararlo explícitamente en su respuesta.

---

## 10. Daniel Control Tower — Modos de acceso (Sección 8)

La cuenta `daniel@fullsite.mx` opera en tres modos separados y exclusivos.
Nunca acceso automático ilimitado al contenido privado de cada restaurante.

### Modo A — Platform (acceso automático)
```
Accede a:
  • Salud de la plataforma (uptime, errores, versiones)
  • Estado de dispositivos (POS, impresoras, KDS)
  • Métricas de uso (sesiones, tickets procesados, agents runs)
  • Alertas y notificaciones de infraestructura
  • Facturación y estado de suscripciones
  • ocm_data_quality agregado (sin datos operativos privados)

No accede a:
  • Ventas individuales de ningún restaurante
  • Órdenes, meseros, propinas de ningún tenant
  • Recetas, costos, proveedores de ningún tenant
```

### Modo B — Support (acceso temporal con auditoría)
```
Requiere:
  • Motivo explícito (campo obligatorio)
  • Expiración: tiempo máximo definido (ej. 4 horas)
  • Aprobación del dueño del restaurante cuando aplique
  • Log de auditoría: qué vio, cuándo, cuánto tiempo

Accede a:
  • Cualquier vista OCM del tenant afectado
  • Logs de errores específicos del caso de soporte

No accede a:
  • Datos fuera del tenant del caso de soporte
  • Datos más allá del período de expiración
```

### Modo C — Intelligence (agregado, sin identificadores)
```
Accede a:
  • Network Intelligence Dataset (capa 5 en el diagrama de arquitectura)
  • Benchmarks sectoriales agregados
  • Patrones de comportamiento sin nombres ni IDs individuales

Reglas estrictas:
  • Grupos mínimos: n ≥ 5 restaurantes antes de publicar cualquier agregado
  • Sin nombres de restaurantes individuales
  • Sin tickets individuales ni órdenes específicas
  • Sin recetas, empleados ni proveedores identificables
  • Sin geografía más específica que ciudad/zona
```

---

## 11. Privacidad antes de Network Intelligence

El flujo hacia la capa de inteligencia global requiere pasar por el
Privacy & Aggregation Gateway que aplica:

1. **Supresión**: campos `personal`, `confidential`, `financial` eliminados antes de cruzar la frontera
2. **Grupos mínimos**: ningún valor que pueda identificar a un restaurante específico si n < 5
3. **Rounding**: montos redondeados a intervalos que impidan ingeniería inversa
4. **Diferencial de privacidad**: ruido estadístico calibrado para métricas sensibles (futuro)

Un agente global en capa 5 nunca puede pedir "dame los datos de AMALAY".
Solo puede pedir "dame el promedio de ticket_promedio en restaurantes de Monterrey (n=12)".

---

## 12. Fases de implementación

### Fase 1 — Antes del siguiente demo (P1)
- [ ] Vista `ocm_daily_sales` con rama wansoft y rama fullsite
- [ ] Vista `ocm_operations` con la misma lógica de bifurcación
- [ ] Vista `ocm_data_quality` (reemplaza health check)
- [ ] Migrar `daily_briefing.py` y `wansoft_query.py` a leer del OCM
- [ ] Test: chat IA responde correctamente para VANTARA (datos de pos_orders) y AMALAY (sin regresión)

### Fase 2 — Sprint posterior
- [ ] Vista `ocm_products` (top platillos multi-fuente)
- [ ] Vista `ocm_orders` (granular histórico)
- [ ] Migrar dashboard de top platillos y meseros

### Fase 3 — Con inventario configurado
- [ ] Vista `ocm_inventory_snapshot` (requiere pos_ingredients poblado)
- [ ] Migrar predictor de inventario

### Fase 4 — Network Intelligence (futuro)
- [ ] Privacy & Aggregation Gateway
- [ ] Network Intelligence Dataset (solo cuando n ≥ 3 clientes productivos)
- [ ] Daniel Control Tower — modos A/B/C implementados

---

## 13. Criterios de aceptación para Fase 1

```
✓ ocm_daily_sales('vantara', '2026-08-01') retorna ventas reales de pos_orders
✓ ocm_daily_sales('amalay',  '2026-08-01') retorna ventas reales de wansoft_daily
✓ Chat IA: "¿cuánto vendiste hoy?" responde correctamente para VANTARA
✓ Chat IA: "¿cuánto vendiste hoy?" responde correctamente para AMALAY (sin regresión)
✓ ocm_data_quality('vantara', today) retorna confidence_level in ('high','medium')
✓ /api/health retorna OK para VANTARA sin leer wansoft_daily
✓ daily_briefing.py genera brief correcto para ambos clientes desde el mismo código
✓ Ningún agente lee wansoft_daily o pos_orders directamente (grep verifica esto)
```

---

*Este documento es el contrato. Toda implementación debe cumplirlo.*
*Actualizar con ADRs al resolver decisiones abiertas — no expandir el roadmap aquí.*
