# AGENT ACCURACY PROGRAM
> Framework de certificación para agentes de Fullsite.
> **Fecha:** 2026-08-05
> **Versión:** 1.0 — Para revisión del Founder.
>
> ## Principio rector
> El número de agentes deja de ser una métrica importante.
> La única métrica que importa: cuántos agentes están CERTIFIED.
>
> Un agente CERTIFIED cumple:
> - Dataset etiquetado con ≥30 días de human labels
> - Backtest documentado
> - Shadow mode completado antes de producción
> - Precision y recall medidos y publicados
> - Abstención implementada y probada
> - Impacto financiero medido (no solo estimado)

---

## Schema de certificación (por agente)

```
Agent ID:              Identificador único (ej. ANO-001)
Agent Name:            Nombre descriptivo
Business Decision:     Qué decisión de negocio apoya
Required Inputs:       Tablas, campos, fuentes requeridas
Data Coverage:         % de operaciones cubiertas por los datos disponibles
Data Freshness:        Máxima antigüedad aceptable por fuente
Provenance:            Fuentes declaradas con timestamp
Eligibility:           Condiciones mínimas para producir output
Abstention Conditions: Cuándo el agente DEBE abstenerse (no puede ser vacío)
Confidence Score:      Metodología de cálculo (0-1)
Benchmark Dataset:     N días, cómo fue etiquetado, quién etiquetó
Human Labels:          N labels, metodología, acuerdo entre etiquetadores
True Positives:        N
False Positives:       N
False Negatives:       N
Precision:             TP / (TP + FP)
Recall:                TP / (TP + FN)
F1:                    2 × (P × R) / (P + R)
Calibration Error:     |confidence predicha - frecuencia real| promedio
Shadow Mode Results:   N días en shadow, comparación vs producción
Operator Acceptance:   % de alerts que el gerente marcó como útiles (≥30 samples)
Financial Impact:      Impacto estimado vs impacto MEDIDO (ambos obligatorios)
Certification Status:  PENDING | SHADOW | CERTIFIED | SUSPENDED
```

---

## Niveles de certificación

### RESEARCH PASS
Autoriza continuar shadow testing y refinamiento de thresholds. **NO autoriza uso autónomo en producción.**
```
F1:                     ≥ 0.78
Labeled sample:         ≥ 30 days reached
Backtest:               Completed and documented
Shadow mode:            Running
Abstention:             Implemented
AUTHORIZED FOR:         Shadow testing, threshold refinement, continued labeling
NOT AUTHORIZED FOR:     Autonomous production alerts, public claims
```

### PRODUCTION CERTIFIED
Autoriza uso autónomo en producción con impacto operativo.
```
Precision:              ≥ 90%
Recall:                 ≥ 75%
False-positive rate:    ≤ 10%
Provenance:             100% — sources_used en cada run
Freshness validated:    100% — abstención si dato > threshold
Abstention:             Supported and tested
Calibration error:      Medido y publicado
Shadow mode:            ≥ 14 días completados con PASS
Human review:           ≥ 30 operator labels con acceptance ≥ 70%
Silent source mixing:   ZERO
AUTHORIZED FOR:         Autonomous production alerts, public claims con métricas
```

**REGLA:** F1 ≥ 0.78 es Research Pass — no equivale a Production Certified. No presentar como estándar de liderazgo.

Cada agente tiene thresholds propios según el riesgo de la decisión que soporta.

---

## Targets por tipo de agente

### Agentes de hechos
Ejemplos: ventas del día, descuentos aplicados, cancelaciones.
```
Data accuracy:          ≥ 99.9%
Provenance:             100% con fuente y timestamp
Freshness validated:    100% — abstención si dato > threshold
Silent source mixing:   ZERO — fuentes siempre declaradas
```

### Agentes de detección
Ejemplos: anomalías, excepciones, retrasos.

**Research Pass:**
```
F1:                     ≥ 0.78
Labeled sample:         ≥ 30 days
```

**Production Certified:**
```
Precision:              ≥ 90%
Recall:                 ≥ 75%
False-positive rate:    ≤ 10%
Abstention supported:   YES — condiciones documentadas
F1:                     ≥ 0.82 (calculado de los anteriores)
```

### Agentes predictivos
```
Baseline comparación:   Debe superar predicción naive (promedio DOW últimas 4 semanas)
Error medido:           MAE y MAPE por sucursal y daypart
Confidence interval:    Obligatorio en cada output
Drift detection:        Alerta cuando MAPE sube >50% vs baseline
Backtest:               ≥ 90 días antes de producción
Shadow mode:            ≥ 14 días antes de producción
```

---

## Prioridad de certificación

### Fase 1 (ahora — siguiente visita AMALAY)

**SOS-001 — Speed of Service**
**ANO-001 — Anomaly Detection**

### Fase 2 (después de Fase 1)

**DOB-001 — Daily Operational Brief**
**EXC-001 — Cancellation/Discount Exception**

### Fase 3 (bloqueada por inventory truth)

**STOCK-001 — Stockout/Purchase Risk**

---

## SOS-001 — Speed of Service

```
Agent ID:         SOS-001
Agent Name:       Speed of Service
Business Decision: ¿El tiempo de servicio está dentro del rango aceptable?
                   ¿Hay meseros o mesas con tiempos consistentemente altos?
```

**Required Inputs:**
| Campo | Tabla | Tipo | Freshness |
|---|---|---|---|
| order_id | pos_orders | uuid | <15 min |
| created_at | pos_orders | timestamptz | <15 min |
| sent_to_kitchen_at | pos_orders | timestamptz | <15 min |
| mesa | pos_orders | text | <15 min |
| staff_id | pos_orders | text | <15 min |
| delivered_at | pos_orders | timestamptz | <15 min — ACTUALMENTE FALTA |

**BLOCKER:** `delivered_at` no se captura actualmente en pos_orders. Sin este campo, Speed of Service solo puede medir tiempo orden→cocina, no el ciclo completo. Agente debe abstenerse de reportar "tiempo de servicio" y reportar solo "tiempo de envío a cocina".

**Data Coverage:** 100% de órdenes tienen `created_at` y `sent_to_kitchen_at`. 0% tienen `delivered_at`. Cobertura efectiva: PARCIAL — solo primera mitad del ciclo.

**Data Freshness:** Datos deben ser <15 minutos. Abstención si último registro tiene >15 min (turno cerrado o sistema detenido).

**Eligibility Conditions:**
- Mínimo 10 órdenes en la última hora
- Turno activo (turno_status = 'abierto')
- Data freshness <15 min

**Abstention Conditions:**
- Menos de 10 órdenes en la última hora
- `delivered_at` ausente → abstenerse de reportar ciclo completo, reportar solo envío a cocina con disclaimer
- Data freshness >15 min
- Turno cerrado

**Confidence Score:** Basado en N de órdenes: N<10=0.3, N<25=0.6, N<50=0.8, N≥50=0.95

**Benchmark Dataset:**
- N días a etiquetar: 30 días de operación AMALAY
- Quién etiqueta: Eduardo (gerente) evalúa si el reporte del día fue útil y correcto
- Escala: 1-5 (1=completamente incorrecto, 5=completamente útil y correcto)
- N mínimo de labels: 30

**Targets:**
- Operator Acceptance: ≥70% de días calificados ≥4/5 por Eduardo
- Factual accuracy: 100% (tiempos reportados = tiempos en DB)

**Certification Status:** PENDING
**Blocker:** `delivered_at` field en pos_orders. Requiere cambio de schema + UI para capturar entrega.

**Financial Impact:** UNKNOWN hasta tener baseline. Hipótesis: reducir tiempo promedio de servicio en 2 min puede aumentar rotación de mesa en 1 turno/semana → +X% revenue. **No publicar hasta medir.**

---

## ANO-001 — Anomaly Detection

```
Agent ID:         ANO-001
Agent Name:       Anomaly Detection
Business Decision: ¿Las métricas operativas de hoy son materialmente diferentes
                   del patrón histórico para este día de la semana?
                   ¿Requiere investigación o acción inmediata?
```

**Required Inputs:**
| Campo | Tabla | Tipo | Freshness |
|---|---|---|---|
| ventas_dia | ops_daily_live / wansoft_kpis | numeric | <2h |
| tickets_count | ops_daily_live / wansoft_kpis | integer | <2h |
| ticket_promedio_restaurant | ops_daily_live / wansoft_kpis | numeric | <2h |
| meseros (JSONB) | ops_daily_live / wansoft_kpis | jsonb | <2h |
| ventas_por_grupo (JSONB) | ops_daily_live / wansoft_kpis | jsonb | <2h |
| Histórico DOW | wansoft_daily | numeric | <25h (ayer) |

**Eligibility Conditions:**
- ≥4 registros históricos para el mismo día de semana
- Datos actuales con freshness <2h
- Mínimo 2 horas de operación del día actual (evitar falsos positivos a primera hora)

**Abstention Conditions:**
- Freshness datos actuales >2h → ABSTENERSE, mensaje: "Datos desactualizados — sincronización en curso o sistema detenido"
- <4 puntos históricos para este DOW → ABSTENERSE, mensaje: "Histórico insuficiente para este día de la semana"
- Hora <10am → NO CORRER (demasiado temprano para comparar con patrón del día)
- Día festivo identificado → advertencia "posible varianza por festivo"

**Umbrales actuales (HARDCODED — NO CALIBRADOS):**
```python
VENTAS_THRESHOLD = 0.20    # 20% — origen: estimación, no datos
TICKET_THRESHOLD = 0.15    # 15% — origen: estimación, no datos
MESERO_THRESHOLD = 0.50    # 50% — origen: estimación, no datos
CATEGORY_THRESHOLD = 0.30  # 30% — origen: estimación, no datos
```

**Plan de calibración:**
1. Recopilar 90 días de datos históricos (wansoft_daily existente)
2. Calcular desviación estándar por métrica por DOW
3. Usar 2σ como threshold inicial (corresponde a ~95% de días normales)
4. Eduardo etiqueta 30 días de alertas generadas: "¿Esta alerta fue correcta?"
5. Calcular precision/recall con etiquetas
6. Ajustar thresholds hasta precision ≥90%, FP ≤10%

**Confidence Score:**
```
base_confidence = 0.5
+ 0.1 si N histórico ≥ 8 (DOW bien representado)
+ 0.1 si desviación es ≥ 3σ (más extrema = más confianza)
+ 0.1 si múltiples métricas confirman anomalía simultáneamente
+ 0.1 si freshness <30 min
- 0.2 si solo 1 métrica diverge
- 0.3 si freshness 1-2h
```

**Benchmark Dataset:**
- 90 días de wansoft_daily (2026-05-01 a 2026-07-30) — YA DISPONIBLE
- Eduardo etiqueta 30 días de outputs: "¿Alertó correctamente? ¿Fue útil?"
- Acuerdo inter-etiquetador: no aplica (solo un etiquetador)
- N mínimo para CERTIFIED: 30 days etiquetados + backtest en 90 días históricos

**Targets:**
```
Precision:         ≥90%
Recall:            ≥75%
F1:                ≥0.82
FP rate:           ≤10%
Operator Acceptance: ≥70%
```

**Proceso de certificación:**
1. **Backtest (semana 1):** Correr detector en 90 días históricos. Etiquetar outputs. Calcular precision/recall. Ajustar thresholds.
2. **Shadow mode (semanas 2-3):** Correr en paralelo con producción sin enviar alertas a Telegram. Comparar outputs con lo que habría alertado.
3. **Human review (semana 4):** Eduardo revisa outputs de shadow mode. ≥30 days. Calcular acceptance.
4. **Certification (semana 5 si targets PASS):** Publicar métricas. Marcar CERTIFIED.

**Certification Status:** PENDING — backtest pendiente
**Estimated time to certification:** 5 semanas

**Financial Impact:**
- Hipótesis: anomalía de descuento detectada a tiempo evita pérdida de X MXN/evento
- Metodología: registrar `estimated_value` al crear alerta. Registrar `outcome` (si se investigó, qué se encontró) en agent_events.
- **No publicar impacto hasta tener ≥10 casos con outcome registrado.**

---

## DOB-001 — Daily Operational Brief

```
Agent ID:         DOB-001
Agent Name:       Daily Operational Brief
Business Decision: ¿Cuáles son las 3 acciones más importantes del día
                   para gerente/dueño?
```

**Tipo:** Agente de hechos (no detección, no predicción)

**Required Inputs:**
| Campo | Tabla | Freshness |
|---|---|---|
| Ventas ayer completo | wansoft_daily | <25h |
| KPIs actuales | wansoft_kpis | <1h |
| Reservaciones próximas 48h | amalay_reservaciones | <4h |
| Events activos | agent_events (estimated_value > 0) | <24h |

**Abstention Conditions:**
- wansoft_daily ayer >25h de antigüedad → NO PUBLICAR dato de ayer, indicar "sin dato reciente"
- wansoft_kpis >1h → advertencia "KPIs pueden estar desactualizados"
- Cualquier afirmación sobre "hoy" requiere freshness <1h de wansoft_kpis

**Confidence:** No aplica — todos los outputs son hechos verificables en DB, no estimaciones.

**Regla de oro:** Si el dato no está en DB con provenance claro, el brief no lo incluye. No interpolar. No estimar. Solo hechos.

**Benchmark Dataset:**
- Eduardo evalúa cada briefing diario por 30 días en escala 1-5
- Preguntas de evaluación: "¿Era correcto?" (accuracy), "¿Tomé alguna acción?" (utility)
- N mínimo: 30 evaluaciones

**Targets:**
- Factual accuracy: 100% (zero datos incorrectos)
- Utility (al menos 1 acción tomada): ≥60% de días

**Certification Status:** PENDING
**Estimated time to certification:** 4 semanas (recolectar evaluaciones de Eduardo)

---

## EXC-001 — Cancellation/Discount Exception

```
Agent ID:         EXC-001
Agent Name:       Cancellation and Discount Exception Detector
Business Decision: ¿Hay un patrón inusual de cancelaciones o descuentos
                   que sugiera error operativo o fraude?
```

**SEPARACIÓN DE CAPACIDADES:**
EXC-001 cubre tres capacidades con dependencias distintas. No todas requieren P&L completo.

```
CAPACIDAD 1 — Operational exception detection
Detecta: cancelaciones, descuentos, cortesías, autorizaciones, órdenes modificadas
Datos requeridos: pos_orders (status, cancellation_reason, staff_id, discount_amount)
Requiere P&L: NO
Puede certificarse: SÍ, con shadow mode de capacidad 1 únicamente

CAPACIDAD 2 — Estimated transaction exposure
Reporta: monto MXN afectado por excepciones detectadas
Datos requeridos: pos_orders (total, discount_amount)
Requiere P&L: NO
Puede certificarse: SÍ, junto con capacidad 1

CAPACIDAD 3 — Full financial impact
Reporta: impacto en contribution margin, food cost, labor
Requiere P&L: SÍ — Margin Engine (Fase 3)
Puede certificarse: Fase posterior — NO prerequisito para EXC-001 CERTIFIED
```

**EXC-001 no está bloqueado por el Margin Engine para las capacidades 1 y 2.**
Shadow mode puede iniciar en semana 6, en paralelo con ANO-001.

**Required Inputs (capacidades 1 y 2):**
| Campo | Tabla | Freshness |
|---|---|---|
| pos_orders canceladas | pos_orders (status=cancelled) | <2h |
| cancellation_reason | pos_orders | <2h |
| staff_id (quien canceló) | pos_orders | <2h |
| Descuentos aplicados | pos_orders (discount_amount) | <2h |
| Histórico de cancelaciones por DOW | wansoft_daily | <25h |

**Abstention Conditions:**
- cancellation_reason NULL en >20% de órdenes → ABSTENERSE: "Datos de razón de cancelación insuficientes"
- N de cancelaciones del día <3 → demasiado pequeño para análisis estadístico
- Freshness >2h → ABSTENERSE

**Confidence Score:**
```
base_confidence = 0.4
+ 0.2 si patrón es ≥3σ fuera de normal
+ 0.2 si mismo staff aparece en ≥70% de excepciones
+ 0.1 si hay múltiples días consecutivos del mismo patrón
- 0.3 si solo una cancelación desencadena la alerta
```

**Abstención explícita:** Si confidence <0.6 → abstenerse de enviar alerta. Registrar en agent_events con status='abstained', razón documentada.

**Benchmark Dataset:**
- 30 semanas de datos históricos de wansoft_daily (descuentos y cancelaciones)
- Etiquetar: ¿esta semana hubo un evento de excepción real? (Eduardo + Daniel)
- Acuerdo inter-etiquetador entre Eduardo y Daniel: κ ≥ 0.7 requerido

**Targets (capacidades 1 y 2):**
```
Precision:           ≥ 85%
FP rate:             ≤ 15%
Operator Acceptance: ≥ 70%
Research Pass F1:    ≥ 0.78
```

**Certification Status:** PENDING
**Shadow mode puede iniciar:** Semana 6 — PARALLEL con ANO-001, sin esperar Margin Engine

---

## STOCK-001 — Stockout/Purchase Risk

```
Agent ID:         STOCK-001
Agent Name:       Stockout and Purchase Risk
Business Decision: ¿Hay riesgo de quedarse sin ingredientes críticos
                   antes del próximo ciclo de compra?
```

**BLOQUEADO — NO INICIAR hasta:**
1. Inventario propio (pos_inventory) con datos en tiempo real
2. Conteo físico validado en AMALAY
3. Recetas con yield factor

**Razón:** Los datos de inventario actuales vienen de Wansoft (externo, no tiempo real). Un agente de stockout basado en datos stale de Wansoft tendría precision potencialmente <50%. Es más perjudicial tenerlo que no tenerlo.

**Certification Status:** BLOCKED
**Unblocked by:** Inventory truth (Dimensión 14 del Gap Audit, Priority P2)

---

## Infraestructura requerida para el programa

### 1. Label collection table
```sql
CREATE TABLE agent_labels (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id    text NOT NULL,          -- ej. 'ANO-001'
  run_date    date NOT NULL,
  labeled_by  text NOT NULL,          -- ej. 'eduardo', 'daniel'
  label       boolean NOT NULL,       -- true = alert was correct/useful
  confidence  integer,               -- etiquetador: 1-5
  notes       text,
  created_at  timestamptz DEFAULT now()
);
```

### 2. Shadow mode flag en agent_events
```sql
ALTER TABLE agent_events
  ADD COLUMN IF NOT EXISTS shadow_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sources_used jsonb,
  ADD COLUMN IF NOT EXISTS freshness_ok boolean,
  ADD COLUMN IF NOT EXISTS abstained boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS abstention_reason text,
  ADD COLUMN IF NOT EXISTS confidence_score numeric(4,3);
```

### 3. Certification registry
```sql
CREATE TABLE agent_certifications (
  agent_id              text PRIMARY KEY,
  certification_status  text NOT NULL,  -- 'PENDING','SHADOW','CERTIFIED','SUSPENDED'
  certified_at          timestamptz,
  certified_by          text,
  precision_score       numeric(5,3),
  recall_score          numeric(5,3),
  f1_score              numeric(5,3),
  fpr_score             numeric(5,3),
  operator_acceptance   numeric(5,3),
  benchmark_start_date  date,
  benchmark_end_date    date,
  benchmark_n_samples   integer,
  shadow_start_date     date,
  shadow_end_date       date,
  notes                 text,
  updated_at            timestamptz DEFAULT now()
);
```

### 4. Human review process
- Eduardo recibe 1 mensaje/semana con resumen de alertas de la semana
- Para cada alerta: ¿fue correcta? ¿tomaste alguna acción? (reply rápido)
- Daniel agrega al agent_labels table
- Process time: ~5 min/semana para Eduardo

---

## Timeline de certificación

| Semana | Agente | Actividad | Nivel |
|---|---|---|---|
| 5 | ANO-001 | Backtest en 90 días históricos. Calcular precision/recall inicial. Ajustar thresholds. | Backtest |
| 5 | DOB-001 | Iniciar recolección de evaluaciones de Eduardo (daily). | Labeling |
| 5 | EXC-001 | Iniciar backtest en datos históricos de cancelaciones (capacidades 1+2). | Backtest |
| 5 | ANO-001 | Iniciar shadow mode con thresholds calibrados. | Shadow |
| 6 | ANO-001 | Shadow mode. Eduardo revisa outputs. | Shadow |
| 6 | EXC-001 | Shadow mode (capacidades 1+2) — paralelo a ANO-001. | Shadow |
| 6 | SOS-001 | Añadir `delivered_at` al schema + UI. Iniciar captura. | Schema |
| 7 | ANO-001 | Human review ≥20 labels. Calcular Research Pass (F1 ≥ 0.78). | Research Pass |
| 7 | DOB-001 | 21+ evaluaciones acumuladas. Verificar accuracy interim. | Labeling |
| 8 | ANO-001 | Si precision ≥90% → PRODUCTION CERTIFIED. Si no → shadow semana adicional. | Certification |
| 8 | DOB-001 | ≥30 evaluaciones → calcular accuracy y utility → PRODUCTION CERTIFIED. | Certification |
| 8 | SOS-001 | Con 30+ días de `delivered_at` capturado → iniciar benchmark. | Benchmark |
| 10 | EXC-001 | Si targets PASS (cap. 1+2) → PRODUCTION CERTIFIED. | Certification |
| 12 | SOS-001 | Si targets PASS → PRODUCTION CERTIFIED. | Certification |

**Meta 90 días:** 3 agentes PRODUCTION CERTIFIED (ANO-001, DOB-001, EXC-001).
**STOCK-001:** Bloqueado hasta P2 inventory truth completado.

**Nota:** Las semanas 5-12 en esta tabla corresponden a las fases 2-4 del Roadmap.
EXC-001 shadow mode avanza en PARALELO a ANO-001 desde semana 6 — no requiere P&L completo.

---

## Reglas permanentes del programa

1. **Ningún agente se declara CERTIFIED sin benchmark de ≥30 días etiquetados.**
2. **Ningún agente se declara CERTIFIED sin shadow mode completado.**
3. **Si precision cae por debajo del target → agente pasa a SUSPENDED automáticamente.**
4. **Todos los agentes CERTIFIED re-evalúan cada 90 días (drift check).**
5. **Impacto financiero: solo publicar MEASURED, nunca solo ESTIMATED.**
6. **Abstención: si un agente no tiene condiciones de abstención documentadas, no puede ser CERTIFIED.**
7. **El número total de agentes no es una métrica. El único número que importa: agentes CERTIFIED.**
