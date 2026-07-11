# Productive Validation Runbook — Primer día AMALAY con Fullsite POS

> No improvisar. Cada checkpoint tiene query, criterio PASS/FAIL, y acción si falla.
> Ejecutar DESPUÉS del smoke test, cuando haya órdenes reales de clientes.

---

## Prerequisitos

- Smoke test completado (WAR-ROOM-LUNES.md fases 1-2)
- Al menos 5 órdenes cerradas con clientes reales
- pos_intraday_snapshot workflow activo (cron cada 15 min)
- Acceso a Supabase SQL Editor o Management API
- Este documento abierto

---

## Protocolo de failures

| Tipo | Acción |
|---|---|
| **STOP-THE-LINE** | POS tiene un problema de datos. Investigar inmediatamente. No afecta operación del restaurante pero invalida la validación |
| **DEGRADED** | Agente no produce output correcto. Documentar, no interrumpir servicio. Investigar post-turno |
| **EXPECTED** | Resultado correcto para el estado actual. Pasar al siguiente checkpoint |

---

## A. PRODUCTOR — pos_orders recibe datos reales

### A1. Órdenes cerradas existen

```sql
SELECT count(*) as total,
  count(CASE WHEN status = 'cerrada' THEN 1 END) as cerradas,
  count(CASE WHEN status = 'cancelada' THEN 1 END) as canceladas,
  count(CASE WHEN status = 'enviada' THEN 1 END) as abiertas,
  min(created_at) as primera,
  max(closed_at) as ultima_cerrada
FROM pos_orders
WHERE client_id = 'amalay'
AND created_at >= (current_date AT TIME ZONE 'America/Mexico_City')::date::text || 'T05:00:00-06:00';
```

**PASS:** cerradas >= 5, primera y ultima_cerrada son de hoy
**FAIL:** 0 cerradas → STOP-THE-LINE (POS no está guardando órdenes)

### A2. closed_at correcto

```sql
SELECT id, status, created_at, closed_at,
  EXTRACT(EPOCH FROM (closed_at - created_at))/60 as minutes_open
FROM pos_orders
WHERE client_id = 'amalay' AND status = 'cerrada'
AND created_at >= current_date::text || 'T05:00:00-06:00'
ORDER BY closed_at DESC LIMIT 5;
```

**PASS:** closed_at > created_at, minutes_open > 0 y < 480 (8 horas razonable)
**FAIL:** closed_at IS NULL en cerrada → STOP-THE-LINE
**FAIL:** closed_at < created_at → STOP-THE-LINE (timestamps invertidos)
**FAIL:** minutes_open > 480 → DEGRADED (orden de ayer cerrada hoy, verificar)

### A3. Pagos y pagos mixtos

```sql
SELECT id, total, metodo_pago, pagos::text,
  (SELECT sum((p->>'monto')::numeric) FROM jsonb_array_elements(pagos) p) as pagos_sum
FROM pos_orders
WHERE client_id = 'amalay' AND status = 'cerrada'
AND created_at >= current_date::text || 'T05:00:00-06:00'
ORDER BY closed_at DESC LIMIT 10;
```

**PASS:** pagos_sum = total para cada orden (o NULL pagos con metodo_pago not null)
**FAIL:** pagos_sum != total → STOP-THE-LINE (pagos no cuadran)
**FAIL:** metodo_pago IS NULL AND pagos IS NULL en cerrada → DEGRADED

### A4. Mesero attribution

```sql
SELECT mesero, count(*) as ordenes, sum(total) as ventas
FROM pos_orders
WHERE client_id = 'amalay' AND status = 'cerrada'
AND created_at >= current_date::text || 'T05:00:00-06:00'
GROUP BY mesero ORDER BY ventas DESC;
```

**PASS:** mesero NOT NULL en todas, nombres reconocibles (del staff AMALAY)
**FAIL:** mesero IS NULL → DEGRADED (orden sin mesero asignado)
**FAIL:** mesero = 'undefined' o 'null' → DEGRADED

### A5. Propina real

```sql
SELECT count(*) as con_propina,
  sum(propina) as total_propinas,
  avg(propina) FILTER (WHERE propina > 0) as propina_promedio
FROM pos_orders
WHERE client_id = 'amalay' AND status = 'cerrada'
AND created_at >= current_date::text || 'T05:00:00-06:00';
```

**PASS:** Cualquier resultado (propinas pueden ser $0 legitimamente)
**EXPECTED:** Si con_propina = 0 después de 20+ órdenes, verificar si el flujo de propina funciona

### A6. Canceladas excluidas de revenue

```sql
SELECT status, count(*), sum(total) as total_revenue
FROM pos_orders
WHERE client_id = 'amalay'
AND created_at >= current_date::text || 'T05:00:00-06:00'
GROUP BY status;
```

**PASS:** Solo status='cerrada' tiene revenue > 0. cancelada/anulada tienen revenue que NO se cuenta
**EXPECTED:** Si 0 canceladas, es normal para un día tranquilo

### A7. Business date / timezone

```sql
SELECT
  id,
  closed_at,
  (closed_at AT TIME ZONE 'America/Mexico_City')::date as business_date_mx,
  closed_at::date as utc_date
FROM pos_orders
WHERE client_id = 'amalay' AND status = 'cerrada'
AND created_at >= current_date::text || 'T05:00:00-06:00'
ORDER BY closed_at DESC LIMIT 5;
```

**PASS:** business_date_mx = fecha de hoy para todas las órdenes
**FAIL:** business_date_mx != hoy → DEGRADED (timezone issue)

---

## B. SNAPSHOTS — ops_daily recibe datos intradía

### B1. Primer snapshot Fullsite aparece

```sql
SELECT id, fecha, record_type, source_system, bucket_start,
  ventas_dia, tickets_count, personas_restaurant,
  generated_at, data_freshness, rows_aggregated
FROM ops_daily
WHERE client_id = 'amalay'
AND source_system = 'fullsite'
AND record_type = 'snapshot'
ORDER BY generated_at DESC LIMIT 5;
```

**PASS:** Al menos 1 fila con source_system='fullsite', record_type='snapshot'
**FAIL:** 0 filas → STOP-THE-LINE (pos_intraday_snapshot no está corriendo o no encuentra órdenes)

### B2. bucket_start correcto

```sql
SELECT bucket_start,
  EXTRACT(MINUTE FROM bucket_start) as minute_part,
  EXTRACT(MINUTE FROM bucket_start)::int % 15 as remainder
FROM ops_daily
WHERE client_id = 'amalay' AND record_type = 'snapshot'
AND fecha = current_date
ORDER BY bucket_start DESC LIMIT 5;
```

**PASS:** remainder = 0 para todos (bucket alineado a 15 min)
**FAIL:** remainder != 0 → DEGRADED (bucket mal calculado)

### B3. Snapshots cada 15 minutos

```sql
SELECT bucket_start,
  bucket_start - LAG(bucket_start) OVER (ORDER BY bucket_start) as gap
FROM ops_daily
WHERE client_id = 'amalay' AND record_type = 'snapshot'
AND fecha = current_date
ORDER BY bucket_start;
```

**PASS:** gap = 15 minutes (o NULL para el primero)
**WARN:** gap > 30 min → degradación tolerable (snapshots missing, pipeline puede estar caído)
**FAIL:** gap > 45 min → intelligence closed loop ROTO (snapshot pierde elegibilidad en ops_daily_live, agentes LIVE caen a fallback Wansoft o no_data). No es STOP-THE-LINE del POS ni motivo de rollback, pero impide declarar validado el closed loop Fullsite

### B4. generated_at fresh (pipeline freshness)

```sql
SELECT bucket_start, generated_at,
  EXTRACT(EPOCH FROM (now() - generated_at))/60 as minutes_ago
FROM ops_daily
WHERE client_id = 'amalay' AND record_type = 'snapshot'
AND fecha = current_date
ORDER BY generated_at DESC LIMIT 1;
```

**PASS:** minutes_ago < 20 (snapshot generado en los últimos 20 min)
**WARN:** minutes_ago > 30 → pipeline degradado, próximo snapshot debería corregir
**FAIL:** minutes_ago > 45 → intelligence closed loop ROTO (ops_daily_live descarta este snapshot por pipeline stale, agentes LIVE pierden datos Fullsite). Mismo criterio que B3

### B5. data_freshness refleja último evento

```sql
SELECT o.data_freshness as snapshot_freshness,
  (SELECT max(closed_at) FROM pos_orders
   WHERE client_id = 'amalay' AND status = 'cerrada'
   AND closed_at >= current_date::text || 'T05:00:00-06:00') as actual_last_close
FROM ops_daily o
WHERE o.client_id = 'amalay' AND o.record_type = 'snapshot'
AND o.fecha = current_date
ORDER BY o.generated_at DESC LIMIT 1;
```

**PASS:** snapshot_freshness = actual_last_close (o muy cercano, <1 min)
**FAIL:** snapshot_freshness IS NULL con órdenes cerradas → DEGRADED
**EXPECTED:** Si no hubo ventas recientes, data_freshness puede ser anterior a generated_at (quiet period)

### B6. Métricas reconciliadas contra pos_orders

```sql
WITH source AS (
  SELECT
    count(*) as src_tickets,
    sum(total) as src_ventas,
    sum(personas) as src_personas
  FROM pos_orders
  WHERE client_id = 'amalay' AND status = 'cerrada'
  AND closed_at >= current_date::text || 'T05:00:00-06:00'
  AND closed_at < (current_date + 1)::text || 'T05:00:00-06:00'
),
snapshot AS (
  SELECT ventas_dia, tickets_count, personas_restaurant, rows_aggregated
  FROM ops_daily
  WHERE client_id = 'amalay' AND record_type = 'snapshot'
  AND fecha = current_date
  ORDER BY generated_at DESC LIMIT 1
)
SELECT
  s.src_tickets, n.tickets_count as snap_tickets,
  s.src_ventas, n.ventas_dia as snap_ventas,
  s.src_personas, n.personas_restaurant as snap_personas,
  n.rows_aggregated
FROM source s, snapshot n;
```

**PASS:** src_tickets = snap_tickets, src_ventas = snap_ventas (exact or within $1 rounding)
**FAIL:** Diferencia > $10 o > 1 ticket → STOP-THE-LINE (aggregation bug)

### B7. ops_daily_live selecciona snapshot Fullsite

```sql
SELECT fecha, record_type, source_system, ventas_dia, generated_at
FROM ops_daily_live
WHERE client_id = 'amalay' AND fecha = current_date;
```

**PASS:** record_type = 'snapshot', source_system = 'fullsite'
**FAIL:** record_type = 'cierre_wansoft' → DEGRADED (Wansoft fallback, snapshot no fresh o no existe)
**FAIL:** No rows → EXPECTED si antes de primera venta del día

---

## C. AGENTES LIVE — runs post-snapshot productivo

Ejecutar DESPUÉS de que existan al menos 2 snapshots productivos (30+ min de servicio).

Disparar manualmente:
```bash
gh workflow run "Agents — Hourly (Anomalías + Predicción + Upselling)" --repo danielfullsite/fullsite
gh workflow run "Proactive Alerts" --repo danielfullsite/fullsite
gh workflow run "Agents — Daily (Kitchen + Table Time + Config Validator)" --repo danielfullsite/fullsite
```

### C1. Verificación general (todos los LIVE agents)

```sql
SELECT agent_id, status, data_status, rows_processed, skip_reason,
  input_freshness, output_summary, error_message
FROM agent_runs
WHERE agent_id IN ('anomaly-detector', 'close-predictor', 'upselling', 'proactive-alerts', 'table-time')
AND created_at > now() - interval '30 minutes'
ORDER BY agent_id;
```

**PASS por agente:**
- status = 'success'
- data_status = 'ok'
- rows_processed > 0
- skip_reason IS NULL
- output_summary no vacío

**FAIL:** status = 'error' → DEGRADED (agent code bug, not POS issue)
**FAIL:** data_status = 'no_data' → EXPECTED si ejecutado antes de snapshots

### C2. anomaly-detector — sanity check

```sql
SELECT output_summary FROM agent_runs
WHERE agent_id = 'anomaly-detector'
AND created_at > now() - interval '30 minutes'
ORDER BY created_at DESC LIMIT 1;
```

**PASS:** output contiene "anomalies: N" con N >= 0. Si N > 0, verificar que las anomalías detectadas son semánticamente coherentes con el día real.
**EXPECTED:** En el primer día, sin baseline Fullsite previo, puede reportar anomalías por comparar snapshot parcial vs cierre Wansoft completo.

### C3. close-predictor — validación profunda

```sql
-- Step 1: Cuántos snapshots usó
SELECT count(*) as snapshots_available
FROM ops_daily
WHERE client_id = 'amalay' AND fecha = current_date AND record_type = 'snapshot';
```

```sql
-- Step 2: Output del predictor
SELECT output_summary, data_status, rows_processed, input_freshness
FROM agent_runs
WHERE agent_id = 'close-predictor'
AND created_at > now() - interval '30 minutes'
ORDER BY created_at DESC LIMIT 1;
```

```sql
-- Step 3: Datos reales para validar
SELECT ventas_dia FROM ops_daily_live
WHERE client_id = 'amalay' AND fecha = current_date;
```

**PASS criteria (estricto, no solo "generó un número"):**
1. snapshots_available >= 2
2. output_summary contiene "projected:" con número > 0
3. El número proyectado es >= ventas actuales del snapshot
4. Si output menciona curva source, debe decir "snapshot" no "hardcoded"
5. rows_processed > 0

**FAIL:** projected < ventas actuales → STOP-THE-LINE (proyección incoherente)
**FAIL:** snapshots_available < 2 AND output usa hardcoded curve → EXPECTED (fallback legítimo, no HEALTHY todavía)
**DEGRADED:** projected > 3x ventas actuales con >70% del día transcurrido → calibración sospechosa

### C4. proactive-alerts — verificación

```sql
SELECT output_summary, data_status, error_message
FROM agent_runs
WHERE agent_id = 'proactive-alerts'
AND created_at > now() - interval '30 minutes'
ORDER BY created_at DESC LIMIT 1;
```

**PASS:** status = 'success', output no contiene "Wansoft login"
**FAIL:** error_message contiene "login" → STOP-THE-LINE (Wansoft dependency not removed)
**EXPECTED:** "No anomalies detected" si el día está dentro de rangos normales

### C5. table-time — source efectiva

```sql
SELECT output_summary FROM agent_runs
WHERE agent_id = 'table-time'
AND created_at > now() - interval '30 minutes'
ORDER BY created_at DESC LIMIT 1;
```

**PASS:** output contiene "source=pos_data" o "source=fullsite" (usando pos_orders reales)
**DEGRADED:** output contiene "source=wansoft_estimate" (todavía en fallback, <4 órdenes POS)
**EXPECTED:** wansoft_estimate hasta que haya >4 órdenes cerradas hoy

---

## D. CIERRE — end-of-day reconciliation

Ejecutar DESPUÉS del cierre de turno. Disparar:
```bash
gh workflow run "POS Daily Aggregator" --repo danielfullsite/fullsite
```

### D1. Cierre Fullsite en ops_daily

```sql
SELECT fecha, record_type, source_system, ventas_dia, tickets_count,
  personas_restaurant, efectivo, tarjeta, generated_at, rows_aggregated
FROM ops_daily
WHERE client_id = 'amalay' AND fecha = current_date
AND record_type = 'cierre' AND source_system = 'fullsite';
```

**PASS:** 1 fila con record_type='cierre', ventas_dia > 0
**FAIL:** 0 filas → STOP-THE-LINE (aggregator no escribió cierre)

### D2. Cierre reconcilia con pos_orders

```sql
WITH source AS (
  SELECT count(*) as tickets, sum(total) as ventas, sum(personas) as personas,
    sum(propina) as propinas
  FROM pos_orders
  WHERE client_id = 'amalay' AND status = 'cerrada'
  AND closed_at >= current_date::text || 'T05:00:00-06:00'
  AND closed_at < (current_date + 1)::text || 'T05:00:00-06:00'
),
cierre AS (
  SELECT ventas_dia, tickets_count, personas_restaurant, propinas_total
  FROM ops_daily
  WHERE client_id = 'amalay' AND fecha = current_date
  AND record_type = 'cierre' AND source_system = 'fullsite'
)
SELECT
  s.tickets as src, c.tickets_count as cierre,
  s.ventas as src_ventas, c.ventas_dia as cierre_ventas,
  s.personas as src_pers, c.personas_restaurant as cierre_pers,
  s.propinas as src_prop, c.propinas_total as cierre_prop,
  abs(s.ventas - c.ventas_dia) as diff_ventas
FROM source s, cierre c;
```

**PASS:** diff_ventas < $1 (rounding), tickets match exactly
**FAIL:** diff_ventas > $10 → STOP-THE-LINE

### D3. ops_daily_history prefiere cierre Fullsite

```sql
SELECT record_type, source_system, ventas_dia
FROM ops_daily_history
WHERE client_id = 'amalay' AND fecha = current_date;
```

**PASS:** record_type = 'cierre', source_system = 'fullsite'
**FAIL:** record_type = 'cierre_wansoft' → DEGRADED (Wansoft cierre existe y tiene precedencia, verificar si aggregator corrió)

### D4. ops_daily_live post-cierre

```sql
SELECT record_type, source_system, ventas_dia
FROM ops_daily_live
WHERE client_id = 'amalay' AND fecha = current_date;
```

**PASS:** record_type = 'cierre' (cierre wins over snapshots post-cierre)
**FAIL:** record_type = 'snapshot' → DEGRADED (snapshot más reciente que cierre por generated_at, posible re-run issue)

### D5. Dual-write bridge no diverge

```sql
SELECT
  o.ventas_dia as ops_ventas, w.ventas_dia as wansoft_ventas,
  o.tickets_count as ops_tickets, w.tickets_count as wansoft_tickets,
  abs(o.ventas_dia - w.ventas_dia) as diff
FROM ops_daily o
JOIN wansoft_daily w ON w.fecha = o.fecha
WHERE o.client_id = 'amalay' AND o.fecha = current_date
AND o.record_type = 'cierre' AND o.source_system = 'fullsite'
AND w.client_slug = 'amalay';
```

**PASS:** diff = 0 (exact match between ops_daily cierre and wansoft_daily bridge)
**FAIL:** diff > $1 → DEGRADED (dual-write divergence, investigate aggregator)

---

## E. TRUTHFULNESS FINAL — Matriz post-productivo

Después de D, ejecutar TODOS los agentes:
```bash
gh workflow run "Agents — Hourly (Anomalías + Predicción + Upselling)" --repo danielfullsite/fullsite
gh workflow run "Agents — Daily (Kitchen + Table Time + Config Validator)" --repo danielfullsite/fullsite
gh workflow run "Agents — Weekly (Staffing + Menu + Suppliers + Anti-Fraud + Tips + Waste)" --repo danielfullsite/fullsite
gh workflow run "Hermes — Agent Improvement System" --repo danielfullsite/fullsite
gh workflow run "Auto-86 Agent" --repo danielfullsite/fullsite
gh workflow run "Stock Alert Agent" --repo danielfullsite/fullsite
gh workflow run "Climate + Events Agent" --repo danielfullsite/fullsite
gh workflow run "Cost Variance Agent" --repo danielfullsite/fullsite
gh workflow run "Uptime Monitor" --repo danielfullsite/fullsite
gh workflow run "POS Daily Aggregator" --repo danielfullsite/fullsite
```

### E1. Matriz nominal post-productiva

```sql
SELECT DISTINCT ON (agent_id)
  agent_id, status, data_status, rows_processed, skip_reason,
  input_freshness, output_summary, created_at
FROM agent_runs
WHERE created_at > now() - interval '1 hour'
ORDER BY agent_id, created_at DESC;
```

Para cada agente, clasificar usando:

| Criterio | Clasificación |
|---|---|
| status=success, data_status=ok, rows>0, output semánticamente válido | **HEALTHY** |
| status=success, data_status=ok, output correcto pero fuente parcialmente stale | **HEALTHY-BUT-STALE** |
| status=success, data_status=no_data, skip_reason presente | **NO_DATA-LEGIT** |
| status=success, data_status=stale_data | **STALE DATA** |
| status=error | **BROKEN** |

**Regla:** Los 4 PRE-CUTOVER NO_DATA-LEGIT (anomaly-detector, close-predictor, upselling, pos-daily-aggregator) NO pasan automáticamente a HEALTHY. Cada uno requiere:
- status = success
- data_status = ok
- rows_processed > 0
- output con contenido semánticamente verificable
- sanity check manual del output vs datos reales

**close-predictor específicamente** requiere:
- snapshots_available >= 4 (al menos 1 hora de curva)
- projected > ventas_actuales
- projected < 3x ventas_actuales (si >50% del día transcurrido)
- source = snapshot curve, no hardcoded

---

## Rollback si algo crítico falla

| Checkpoint | Falla | Acción |
|---|---|---|
| A1-A3 | POS no guarda órdenes, pagos no cuadran | STOP. Revertir a Wansoft POS. No es problema de agentes |
| B1 | Snapshots no aparecen | Verificar workflow pos_intraday_snapshot. No afecta POS |
| B6 | Snapshot no reconcilia con pos_orders | Bug en aggregation. Desactivar snapshot, agentes usan ops_daily_history |
| C3 | close-predictor incoherente | No afecta operación. Documentar para fix |
| D1-D2 | Cierre no reconcilia | Bug en aggregator. Agentes HISTORY siguen funcionando con backfill Wansoft |
| D5 | Dual-write diverge | Bug en aggregator. wansoft_daily bridge sigue siendo fuente para agentes no migrados |

**Ningún fallo de agentes o snapshots justifica revertir el POS.** Los agentes son inteligencia, no operación. El restaurante opera sin ellos.

---

*Este runbook se ejecuta una sola vez: el primer día productivo. Los resultados van a FIELD-NOTES.md.*
