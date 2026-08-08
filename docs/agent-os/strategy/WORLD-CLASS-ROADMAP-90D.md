# WORLD-CLASS ROADMAP — 90 DÍAS
> Secuencia ejecutable con gates. No aspiracional.
> **Fecha inicio:** 2026-08-05
> **Fecha fin:** 2026-11-03
> **Para revisión del Founder antes de iniciar.**
>
> ## Principio de secuencia
> Cada fase tiene gates binarios. Una fase no inicia hasta que todos los gates de la anterior están CLOSED con evidencia.
> La autonomía se certifica acción por acción, no como promesa general.
> No romper lo que ya funciona.

---

## NORTH STAR — 90 días

Al final de este roadmap, Fullsite debe poder demostrar:

1. Un restaurante opera, reinicia y se recupera sin internet sin perder ninguna operación. **[FIELD VERIFIED]**
2. Un segundo cliente fue onboarded sin la intervención del fundador. **[FIELD VERIFIED]**
3. Tres agentes tienen precision/recall publicados con metodología reproducible. **[CERTIFIED]**
4. El impacto financiero de al menos una intervención está medido (no estimado). **[MEASURED]**

---

## FASE 1 — INDESTRUCTIBLE OPERATIONS
**Semanas 1–4 (2026-08-05 a 2026-09-02)**

### Objetivo
```
El restaurante puede operar, reiniciar y recuperarse sin internet
sin perder, duplicar ni corromper una operación.
```

### Secuencia de ejecución

**Paso 1.1 — Diagnostic Session AMALAY (semana 1)**
- Objetivo: Determinar Branch A (NSIS) vs Branch B (legacy) en SERVER1
- Duración estimada de sesión: 30–45 minutos (script puede ser más corto, 5-10 min)
- Output requerido: Branch determinado, state de registro documentado
- Sin instalación, sin cambios al sistema, sin cutover, sin deploy
- ZIPs recolectados, hashes verificados, rollback inputs capturados
- Gate: Branch A/B CONFIRMED con evidencia fotográfica
- Sesión termina con: DEPLOYMENT TYPE / ROLLBACK INPUTS CAPTURED / MIGRATION BRANCH / BLOCKERS / INSTALLATION AUTHORIZED

**Paso 1.2 — Field Batch #2 ETAPA 0 (semana 1, misma semana)**
- Prerequisito: Diagnostic Visit PASS (Branch A o B determinado)
- Instalar v1.3.3 en 1 terminal no crítica siguiendo el runbook branch correcto
- Ejecutar E0-01 a E0-11 completos
- Gate: ETAPA 0 = PASS (7 condiciones simultáneas, incluyendo heartbeat)

**Paso 1.3 — Field Batch #2 ETAPA 1 (semana 2)**
- Prerequisito: ETAPA 0 = PASS
- Instalar v1.3.3 en terminales restantes
- Ejecutar E1-01 a E1-10
- Validar: KDS filtro de estación — cocina NO ve bebidas, barra NO ve comidas
- Gate: Todas las terminales en v1.3.3. KDS station filter FIELD VERIFIED.

**Paso 1.4 — OCS P2.5.9 — Full Offline Suite (semanas 2-3)**
- Prerequisito: v1.3.3 instalado en todas las terminales
- Ejecutar los 12 criterios de OCS P2.5.9 físicamente en AMALAY
- Criterios clave: cold start sin WAN, orden→KDS→print offline, restart durante turno, reconnect sin duplicados, corte X offline, void con PIN offline
- Gate: Los 12 criterios OCS FIELD VERIFIED con evidencia (foto + Supabase query por cada criterio)

**Paso 1.5 — Core Offline CERTIFIED (semana 3)**
- Prerequisito: OCS P2.5.9 todos los criterios FIELD VERIFIED
- Crear docs/certifications/OCS-P2.5.9-FIELD-CERTIFIED.md con evidencia completa
- Actualizar PUBLIC-CLAIMS-REGISTER.md: "Funciona sin internet" → clase FIELD VERIFIED
- Gate: P0-4 CLOSED. Claim publicable.

**Paso 1.6 — Impresión queue persistente (semana 3, paralelo)**
- Hacer que el queue de impresión persista en disco (sobrevive restart del local server)
- Tests: restart del local server con comandas en queue → zero pérdida
- Gate: TEST VERIFIED con ≥3 tests passing

**Paso 1.7 — Sandbox Cliente #2 — Full Isolation (semana 4)**
- Onboarding completo de segundo tenant con nuevo client_slug
- Sin intervención de Daniel en el proceso de provisioning
- Checklist de los 5 bugs encontrados en vantara: verificar que ninguno reaparece
- Smoke test automatizado post-provisioning PASS
- Gate: Segundo tenant operativo con aislamiento verificado. Sin cross-tenant data leak.

### Gates de cierre de Fase 1 (TODOS simultáneos)
```
[ ] Core Offline certificado físicamente — OCS P2.5.9 FIELD VERIFIED
[ ] Cold start sin WAN documentado (<30s)
[ ] Order → KDS → print → persist — FIELD VERIFIED
[ ] Restart y reboot recovery — FIELD VERIFIED
[ ] Reconnect y sync sin duplicados — FIELD VERIFIED
[ ] KDS station filter — FIELD VERIFIED
[ ] Print queue persistente — TEST VERIFIED
[ ] Rollback probado — Branch A o B, ejecutado y documentado
[ ] Diagnóstico remoto — /health respondiendo, heartbeat en Supabase
[ ] Segundo tenant — completamente aislado, onboarding sin Daniel
```

**¿Qué se desbloquea al cerrar Fase 1?**
- Fullsite puede ser deployed a Cliente #2 sin intervención del fundador
- Claims de "offline-first" son publicables con evidencia
- PRR score puede revisarse (esperar ≥6.5/10)

---

## FASE 2 — CERTIFIED INTELLIGENCE
**Semanas 5–8 (2026-09-03 a 2026-09-30)**

### Objetivo
```
Tres agentes certificados con métricas reales.
El impacto financiero de al menos una intervención medido.
```

### Secuencia de ejecución

**Paso 2.1 — Infraestructura de accuracy (semana 5)**
- Crear agent_labels table en Supabase
- Añadir columnas shadow_mode, sources_used, freshness_ok, abstained, confidence_score a agent_events
- Crear agent_certifications registry table
- Enforced check_freshness() en ANO-001 y DOB-001
- Gate: Schema MIGRATED. check_freshness enforced en ambos agentes.

**Paso 2.2 — ANO-001 Backtest (semana 5)**
- Correr anomaly detector en 90 días históricos de wansoft_daily
- Calcular precision/recall con thresholds actuales
- Eduardo etiqueta: "¿Esta semana hubo anomalía real?" para ≥12 semanas históricas
- Ajustar thresholds con datos (2σ por métrica)
- Gate: precision/recall inicial calculado. Thresholds actualizados con metodología.

**Paso 2.3 — ANO-001 Shadow Mode (semanas 5-6)**
- Correr detector en paralelo, outputs a agent_events con shadow_mode=true
- Abstractar si confidence <0.6 (implementar lógica de abstención)
- NO enviar a Telegram durante shadow
- Eduardo revisa outputs semanalmente: "¿Esta alerta habría sido útil?"
- Gate: ≥14 días de shadow mode. ≥20 labels de Eduardo.

**Paso 2.4 — DOB-001 Human Review (semanas 5-8)**
- Eduardo evalúa cada briefing diario: accuracy (1-5) + "¿tomé alguna acción?" (sí/no)
- Registrar en agent_labels
- Gate: ≥30 evaluaciones. accuracy 100%, utility ≥60%.

**Paso 2.5 — ANO-001 Certification (semana 7)**
- Prerequisito: shadow mode ≥14 días, Eduardo labels ≥30
- Calcular: precision, recall, F1, FP rate, operator acceptance
- Si precision ≥90% y FP ≤10%: → CERTIFIED
- Si no: ajustar thresholds y repetir shadow 1 semana más
- Gate: ANO-001 CERTIFIED con métricas publicadas en AGENT-ACCURACY-PROGRAM.md

**Paso 2.6 — DOB-001 Certification (semana 8)**
- Prerequisito: ≥30 evaluaciones de Eduardo
- Si accuracy 100% y utility ≥60%: → CERTIFIED
- Gate: DOB-001 CERTIFIED

**Paso 2.7 — EXC-001 Shadow Mode (semanas 6-8, paralelo)**
- Iniciar backtest en datos históricos de cancelaciones/descuentos
- Eduardo + Daniel etiquetan ≥15 semanas históricas
- Shadow mode ≥14 días
- Gate: Backtest y shadow mode completados. Labels disponibles.

**Paso 2.8 — Alert Lifecycle v1 (semana 6)**
- Crear alert_events table (alert_id, shown_at, viewed_at, action_taken, outcome, financial_impact_measured)
- In-app exception inbox v1 (solo listado de alerts activas, sin approval workflow aún)
- Gate: Alert lifecycle table activa. 3+ alerts con lifecycle tracked.

**Paso 2.9 — Impact Measurement v1 (semana 8)**
- Para ANO-001: cuando Eduardo actúa en una alerta, registrar qué pasó
- Para EXC-001: cuando se investiga una excepción, registrar si era real y qué pérdida evitó
- Target: ≥3 eventos con outcome registrado
- Gate: ≥3 registros en agent_events.outcome con metodología documentada.

### Gates de cierre de Fase 2 (TODOS simultáneos)
```
[ ] agent_labels, agent_certifications tables — ACTIVAS
[ ] check_freshness enforced en todos los agentes activos
[ ] Abstención implementada en ANO-001 y DOB-001
[ ] ANO-001 CERTIFIED — precision ≥90%, FP ≤10%
[ ] DOB-001 CERTIFIED — accuracy 100%, utility ≥60%
[ ] Alert lifecycle activo con ≥3 eventos tracked
[ ] ≥3 outcomes medidos (no solo estimados)
[ ] EXC-001 en shadow mode (≥14 días)
[ ] Shadow mode infrastructure activa para todos
```

**¿Qué se desbloquea al cerrar Fase 2?**
- Fullsite puede publicar: "Dos agentes certificados con precision y recall medidos" — HECHO
- Base para claims de impacto financiero con evidencia
- EXC-001 listo para certificación en Fase 3

---

## FASE 3 — MARGIN WEDGE
**Semanas 9–10 (2026-10-01 a 2026-10-14)**

### Objetivo
```
Contribution margin real por producto.
Food cost + labor cost integrados.
Cada módulo con cobertura, provenance y confidence declarados.
```

**Regla:** No declarar P&L completo mientras esté parcial. Publicar solo lo verificado con disclaimer explícito de cobertura.

### Secuencia de ejecución

**Paso 3.1 — Yield factor en recetas (semana 9)**
- Añadir campo yield_factor (0-1) a pos_recipe_lines
- Eduardo estima yield para top-20 ingredientes (ej. aguacate: 0.75, pollo: 0.65)
- Recalcular food cost con yield factor
- Gate: Yield factor TEST VERIFIED en ≥20 ingredientes. Food cost recalculado publicable.

**Paso 3.2 — Costo por orden en pos_orders (semana 9)**
- Al cerrar una orden, calcular y registrar costo_estimado en pos_orders
- Metodología: sum(recipe_lines.quantity × ingredient.cost × yield_factor) por ítem
- Gate: costo_estimado en 100% de órdenes desde deploy. TEST VERIFIED.

**Paso 3.3 — Labor cost básico (semana 10)**
- Añadir hourly_rate a pos_staff
- Eduardo ingresa salarios básicos (dato confidencial, solo en Supabase)
- Calcular labor_cost_day = sum(horas_trabajadas × hourly_rate) por día
- Fuente de horas: wansoft_asistencia (con disclaimer de dependencia)
- Gate: Labor cost diario calculado en ≥7 días consecutivos. Fuente declarada.

**Paso 3.4 — Contribution margin diario (semana 10)**
- contribution_margin = ventas_dia - costo_comida - labor_cost
- Publicar con cobertura explícita: "ventas ✓ food cost ✓ labor ✓ overhead ✗"
- Sin overhead: contribution margin ≠ profit. Declararlo explícitamente.
- Gate: Contribution margin en dashboard. Disclaimer de cobertura visible.

**Paso 3.5 — EXC-001 Certification (semana 10)**
- Prerequisito: shadow mode ≥14 días (de Fase 2), labels ≥30
- Si precision ≥85%: → CERTIFIED
- Gate: EXC-001 CERTIFIED — tercer agente certificado.

### Gates de cierre de Fase 3 (TODOS simultáneos)
```
[ ] Yield factor en ≥20 ingredientes — TEST VERIFIED
[ ] Costo por orden registrado en pos_orders — TEST VERIFIED
[ ] Labor cost diario calculado con fuente declarada
[ ] Contribution margin en dashboard con disclaimer de cobertura
[ ] Food cost con yield no se declara "exacto" — se declara "estimado con yield factor"
[ ] EXC-001 CERTIFIED
[ ] 3 agentes CERTIFIED total
```

**¿Qué se desbloquea al cerrar Fase 3?**
- Fullsite puede publicar: "Conocemos el margen real de cada plato" — con cobertura declarada
- Caso de cliente concreto con evidencia económica

---

## FASE 4 — MEASURED ACTION LOOP
**Semanas 11–12 (2026-10-15 a 2026-11-03)**

### Objetivo
```
Implementar el primer ciclo completo de acción:
DRAFT → HUMAN REVIEW → APPROVED → EXECUTED → MEASURED
```

**Primera acción a certificar:** Propuesta de orden de compra basada en consumo real.

### Secuencia de ejecución

**Paso 4.1 — PO Draft generator (semana 11)**
- Basado en: consumo promedio de ingredientes (de pos_orders + recetas) vs inventario actual (Wansoft como fuente con disclaimer)
- Output: lista de ingredientes a reponer, cantidades sugeridas, proveedor estimado
- Formato: borrador enviado a Eduardo para revisión (Telegram + in-app)
- Gate: PO draft generado automáticamente para ≥3 ingredientes críticos. Eduardo puede aprobar/rechazar.

**Paso 4.2 — Approval workflow v1 (semana 11)**
- In-app: Eduardo ve el draft, aprueba o ajusta cantidades, marca como "enviada"
- Tracking: approved_at, approved_by, quantities_adjusted
- Gate: Eduardo aprueba ≥1 PO draft desde la app (no desde Telegram).

**Paso 4.3 — Impact measurement (semana 12)**
- Semana siguiente a PO ejecutada: ¿se agotó ese ingrediente? ¿llegó a tiempo?
- Registrar: stockout_occurred (boolean), lead_time_actual, costo_real vs costo_estimado
- Gate: ≥3 POs con outcome medido en agent_events.

**Paso 4.4 — Manager Panel v1 (semana 11-12, paralelo)**
- UI simple: lista de terminales con heartbeat, versión, sync_queue_size, last_log_entry
- Sin código requerido para diagnóstico básico
- Eduardo puede ver si un terminal está "en peligro" sin llamar a Daniel
- Gate: Eduardo usa Manager Panel para diagnosticar problema real o simulado sin asistencia.

### Gates de cierre de Fase 4 (TODOS simultáneos)
```
[ ] PO draft generado automáticamente con metodología documentada
[ ] Eduardo aprueba ≥1 PO desde la app
[ ] ≥3 POs con outcome medido
[ ] Manager Panel v1 — Eduardo lo usa sin asistencia
[ ] Alert lifecycle activo en ≥5 tipos de alerta
[ ] ≥5 acciones con DRAFT→EXECUTED→MEASURED documentadas
```

---

## FASE 5 — EXTERNAL PROOF
**Post-90 días — Sin fecha fija**

Esta fase comienza cuando Fases 1-4 están completas. No tiene deadline porque depende de eventos externos (ventas, onboarding de cliente nuevo).

### Gates obligatorios
```
[ ] Restaurante externo con acuerdo comercial activo (revenue-generating)
    — Precio: HYPOTHESIS PENDING VALIDATION / no publicar precio hasta WTP validado
[ ] Onboarding sin Daniel (<4h, documentado)
[ ] Acciones adoptadas por operadores (≥10 con outcome registrado)
[ ] Impacto económico medido y publicable (con metodología)
[ ] Referencia de cliente (Eduardo o dueño AMALAY dispuesto a hablar)
[ ] Segunda sucursal (mismo cliente o cliente nuevo)
```

**Candidato externo identificado:**
Grupo Galería — LOI firmado Julio 2026, Non-Binding.
Marcas: Dunkin Mexico, Carl's Jr, BWW, IHOP.
Next steps: definir pilot parameters en 6 meses.
Clasificación: TARGET (candidato real, sujeto a gates técnicos/operativos/comerciales).

---

## Resumen de secuencia por semana

| Semana | Fechas | Actividad principal | Gate crítico | Confidence | Dep tipo |
|---|---|---|---|---|---|
| 1 | Ago 05-11 | Diagnostic Session + Field Batch #2 E0 | Branch A/B + ETAPA 0 PASS | High / Medium | HARD |
| 2 | Ago 12-18 | Field Batch #2 E1 + OCS offline inicio | v1.3.3 todas terminales. KDS filtro VERIFIED | Medium | HARD |
| 3 | Ago 19-25 | OCS P2.5.9 completo + print queue | Core Offline CERTIFIED | Medium | HARD |
| 4 | Ago 26-Sep 1 | Sandbox Cliente #2 + smoke test | Segundo tenant aislado | Medium | HARD |
| 5 | Sep 02-08 | Accuracy infra + ANO-001 backtest | Schema activo. Thresholds calibrados | High | PARALLEL (schema) |
| 6 | Sep 09-15 | ANO-001 shadow + EXC-001 inicio + alert lifecycle | Shadow mode activo (ANO + EXC) | High | HARD (schema) |
| 7 | Sep 16-22 | ANO-001 Research Pass + DOB-001 review | ANO-001 Research Pass (F1 ≥ 0.78) | Medium | HARD |
| 8 | Sep 23-30 | ANO-001 Certified + DOB-001 certified + outcomes | ANO-001 CERTIFIED. DOB-001 CERTIFIED. ≥3 outcomes | Medium | HARD |
| 9 | Oct 01-07 | Yield factor + costo por orden | Food cost con yield TEST VERIFIED | High | SOFT |
| 10 | Oct 08-14 | Labor cost + contribution margin + EXC-001 certified | EXC-001 CERTIFIED (cap. 1+2). Margin dashboard | Medium | HARD (EXC shadow) |
| 11 | Oct 15-21 | PO draft + approval workflow + Manager Panel | Eduardo aprueba PO desde app | Medium | SOFT |
| 12 | Oct 22-Nov 3 | Impact measurement + Manager Panel field | ≥5 acciones con MEASURED outcome | Medium | SOFT |

**Slip triggers globales:**
- T-01 retrasado → bloquea T-02, T-03 (HARD chain)
- ANO-001 precision inicial <60% → alargar shadow, semana 8 se mueve
- Eduardo no disponible consecutivamente → DOB-001 y EXC-001 labeling se atrasan
- OC-12 (soak 4h) falla → Core Offline no se certifica → Cliente #2 bloqueado

---

## Clasificación de dependencias

```
HARD DEPENDENCY — no puede iniciar hasta que prerequisito esté CLOSED con evidencia:
- Field Batch #2 ETAPA 1 → depende de ETAPA 0 PASS
- OCS P2.5.9 suite → depende de v1.3.3 instalado en todas las terminales
- Agent shadow mode → depende de schema de accuracy activo
- Cutover externo → depende de Core Offline CERTIFIED

SOFT DEPENDENCY — puede iniciar antes, completa después:
- DOB-001 labeling (Eduardo) → puede iniciar ahora sin prerequisito técnico
- EXC-001 shadow mode → puede correr en paralelo con ANO-001
- Yield factor review con Eduardo → solo necesita tiempo de Eduardo, no código previo

PARALLEL WORKSTREAM — completamente independiente de gates técnicos:
- Agent labeling diario (Eduardo) → no bloquea ninguna tarea técnica
- GTM / sales discovery → no depende de ningún gate de field
- Grupo Galería pilot params → avance independiente del estado técnico
- Onboarding documentation genérica → puede redactarse antes de segundo cliente
- Pricing research / WTP validation → puede avanzar; no publicar hasta validar
- CFDI tramitación (Andy) → proceso SAT independiente
```

---

## Reglas de governance del roadmap

1. **Una fase no inicia hasta que todos los HARD DEPENDENCY gates de la anterior están CLOSED con evidencia.**
2. **SOFT y PARALLEL workstreams pueden avanzar aunque gates duros estén abiertos.**
3. **Nada se marca CLOSED sin evidencia física, documental o de test.**
4. **Si un gate falla, se documenta el fallo antes de intentar corrección.**
5. **El roadmap puede acelerarse, nunca saltarse gates duros.**
6. **Nuevas features fuera de este roadmap requieren aprobación explícita del Founder.**
7. **Semanas son TARGET, no promesas. Cada semana incluye confidence level.**
8. **Sin Agent OS work por iniciativa propia — solo si bloquea un gate de este roadmap.**
9. **Al cerrar cada semana: reporte de gates abiertos/cerrados al Founder.**
