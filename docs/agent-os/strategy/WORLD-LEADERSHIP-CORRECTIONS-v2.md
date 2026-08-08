# WORLD LEADERSHIP PROGRAM — CORRECTION PASS v2
> Registro de correcciones aplicadas a los cuatro documentos de estrategia.
> **Fecha:** 2026-08-05
> **Versión:** 2.0
> **Estado:** Pendiente aprobación del Founder.
> No implementar código ni migraciones hasta aprobación explícita.

---

## Resumen ejecutivo de correcciones

| # | Área | Tipo de error | Gravedad |
|---|---|---|---|
| C-01 | Pricing Fullsite | Afirmación sin validación externa presentada como FACT | ALTA |
| C-02 | Competitive claims absolutos | Lenguaje absoluto sin evidencia clasificada | ALTA |
| C-03 | Grupo Galería LOI | Clasificación incompleta; archivo en repo = template sin firma visible | MEDIA |
| C-04 | Agent certification levels | Research Pass y Production Certified mezclados | ALTA |
| C-05 | EXC-001 dependencies | Bloqueado innecesariamente por P&L completo | MEDIA |
| C-06 | CFDI classification | Tratado como bloqueante universal; debe ser segmento-específico | MEDIA |
| C-07 | Diagnostic visit duration | "15 minutos" subestima la sesión completa | BAJA |
| C-08 | FIELD VERIFIED rigor | Dim 10 Multi-tenant clasificado FIELD VERIFIED siendo sandbox | MEDIA |
| C-09 | Wansoft pricing | "$102K año 1" era una estimación compuesta, no cotización directa | MEDIA |
| C-10 | Roadmap parallel workstreams | Trabajo de labeling, GTM, docs presentado como estrictamente secuencial | BAJA |
| C-11 | Milestone confidence | Semanas 4, 8, 10, 12 presentadas sin nivel de confianza ni slip triggers | MEDIA |
| C-12 | Defensible advantages classification | Ventajas terminadas vs emergentes vs potenciales mezcladas | BAJA |

---

## Detalle de correcciones

---

### C-01 — Pricing Fullsite

**ORIGINAL CLAIM:**
> "Fullsite $4,999/mes sin costo de instalación = propuesta irrechazable vs Wansoft"
> Aparece en: COMPETITIVE-MOAT-MAP.md (WHERE WE CAN WIN #5), COMPETITIVE-MOAT-MAP.md (Ventaja Fullsite vs Wansoft)

**PROBLEM:**
El precio de Fullsite ($4,999 MXN/mes) es un precio interno provisional. No existe pricing público aprobado, ni validación de disposición a pagar con clientes externos. Presentarlo como FACT vs Wansoft es una afirmación sin validar que puede comprometer credibilidad si se usa en conversaciones comerciales.

**CORRECTED CLAIM:**
```text
FULLSITE PRICE = UNKNOWN / HYPOTHESIS PENDING VALIDATION
Lower deployment cost = HYPOTHESIS (reutilizar hardware compatible, evitar consultoría obligatoria)
Wansoft quotation for AMALAY = FACT (ver C-09)
```

**OLD CLASSIFICATION:** FACT implícito
**NEW CLASSIFICATION:** HYPOTHESIS
**EVIDENCE:** Ninguna validación externa de WTP documentada.
**FILES UPDATED:** COMPETITIVE-MOAT-MAP.md, WORLD-CLASS-ROADMAP-90D.md

---

### C-02 — Competitive claims absolutos

**ORIGINAL CLAIM:**
> "Fullsite puede ser el primero en certificar agentes" — presentado como afirmación definitiva
> "combinación inédita mundial"
> "ningún competidor publica precision/recall"
> "Para que un analytics player replique esto: Necesitan lanzar un POS competitivo"

**PROBLEM:**
Afirmaciones absolutas sobre competidores requieren evidencia clasificada. El hecho de que no encontremos métricas públicas de agentes no prueba que no existan. Los competidores pueden tener capacidades internas no publicadas.

**CORRECTED CLAIM:**
```text
FACT:
Durante esta investigación no se encontraron métricas públicas de precision y recall
para agentes de restaurante comparables.

HYPOTHESIS:
Publicar certificación transparente de agentes podría convertirse en una oportunidad
de posicionamiento para Fullsite.

UNKNOWN:
No sabemos si competidores tienen métricas internas no publicadas.
```

Para la ventaja del ciclo de datos:
```text
Los productos que no originan eventos operativos tienen una desventaja estructural
para controlar y medir el ciclo completo, salvo que construyan, compren o integren
profundamente un sistema de registro. [INFERENCE]
```

**OLD CLASSIFICATION:** Varios — afirmaciones absolutas sin clasificación
**NEW CLASSIFICATION:** FACT / INFERENCE / HYPOTHESIS / UNKNOWN según corresponda
**EVIDENCE:** No aplica — corrección es de metodología de clasificación
**FILES UPDATED:** COMPETITIVE-MOAT-MAP.md, WORLD-LEADERSHIP-GAP-AUDIT.md

---

### C-03 — Grupo Galería LOI

**ORIGINAL CLAIM:**
> Memory: "LOI firmado 2026-07-28"
> No incluido como evidencia estructurada en ningún documento de estrategia

**PROBLEM:**
El archivo en el repo (`docs/legal/loi-fullsite-grupo-galeria.html`) muestra bloques de firma con indicadores `SIGN HERE` en rojo y líneas de fecha vacías. El archivo en el repo parece ser el template/borrador, no necesariamente la versión firmada. La versión firmada puede existir como documento físico o PDF fuera del repositorio.

**CORRECTED CLASSIFICATION:**
```text
GRUPO GALERÍA LOI = FACT (intención documentada de explorar piloto)

FILE PATH:       docs/legal/loi-fullsite-grupo-galeria.html
DOCUMENT DATE:   Julio 2026
COUNTERPART:     Monica Garcia Pons, Board Member, Grupo Galería
SIGNATORIES:     Daniel Ramonfaur (Fullsite), Monica Garcia Pons (Grupo Galería)
SCOPE:           POS, KDS, Inventory, Purchasing, Dashboards, AI Intelligence Layer
                 en marcas: Dunkin Mexico, Carl's Jr, BWW, IHOP
RESTAURANT/LOCATION: Piloto en "selected locations" (no especificadas)
COMMERCIAL CONDITIONS: No definidas — "a definir en próximos 6 meses"
VALIDITY:        6 meses para definir parámetros de piloto
BINDING STATUS:  NON-BINDING (Sección 2 explícita: "not a binding agreement")
AGREED NEXT STEPS: Definir selección de location, timeline, y success metrics
SIGNATURE STATUS: El archivo HTML en el repo contiene placeholders de firma sin llenar.
                  Confirmar si existe versión firmada física/PDF fuera del repo.

LO QUE PRUEBA EL LOI:
- Interés comercial formal de una contraparte externa identificada
- Apertura documentada a explorar un piloto
- Candidato real para primer cliente externo

LO QUE NO PRUEBA EL LOI:
- Cliente pagando
- Revenue o MRR
- Contrato definitivo
- Implementación completada
- Operación en producción
- Demanda repetible
- Product-market fit
```

**FORMULACIÓN CORRECTA PARA EL ROADMAP:**
> Candidato a primer cliente externo respaldado por un LOI firmado con Grupo Galería, sujeto a los gates técnicos, operativos y comerciales de implementación. Semana 12 clasificada como TARGET, no resultado garantizado.

**OLD CLASSIFICATION:** Mencionado en memory pero sin estructura en documentos de estrategia
**NEW CLASSIFICATION:** FACT (con scope explícito) — ver detalle arriba
**FILES UPDATED:** COMPETITIVE-MOAT-MAP.md, WORLD-CLASS-ROADMAP-90D.md

---

### C-04 — Agent certification levels

**ORIGINAL CLAIM:**
> "F1 ≥ 0.82" presentado como threshold de certificación
> Mezclado con "Precision ≥90%, Recall ≥75%" sin distinción de nivel

**PROBLEM:**
F1 ≥ 0.78–0.82 es un umbral de Research Pass — útil para continuar shadow testing, pero insuficiente para autorizar uso autónomo en producción. Los dos niveles deben estar separados con consecuencias distintas.

**CORRECTED CLAIM:**

**RESEARCH PASS** (autoriza shadow testing continuo):
```text
F1 >= 0.78
Minimum labeled sample reached (≥30 days)
Backtest completed
Useful for: continued shadow testing, threshold refinement
NOT authorized for: autonomous production use
```

**PRODUCTION CERTIFIED** (autoriza uso autónomo en producción):
```text
Precision >= 90%
Recall >= 75%
False-positive rate <= 10%
Provenance = 100%
Freshness validated
Abstention supported and tested
Calibration measured
Shadow mode PASS (≥14 days)
Human review PASS (≥30 operator labels)
No silent source mixing
```

**OLD CLASSIFICATION:** Un solo nivel de certificación mezclado
**NEW CLASSIFICATION:** Dos niveles distintos con consecuencias diferentes
**FILES UPDATED:** AGENT-ACCURACY-PROGRAM.md

---

### C-05 — EXC-001 dependencies

**ORIGINAL CLAIM:**
> EXC-001 en Fase 3 (Margin Wedge), bloqueado implícitamente por P&L completo

**PROBLEM:**
EXC-001 detecta cancelaciones, descuentos, cortesías, autorizaciones, órdenes modificadas y montos afectados usando datos de `pos_orders` — sin necesitar P&L. Bloquear EXC-001 por el Margin Engine retrasa una capacidad que ya tiene datos disponibles.

**CORRECTED CLAIM:**
Tres capacidades distintas con dependencias separadas:

```text
CAPACIDAD 1: Operational exception detection
→ Cancellations, discounts, modifications, authorizations
→ Datos: pos_orders (status, cancellation_reason, staff_id, discount_amount)
→ NO requiere P&L ni yield factor
→ EXC-001 puede certificarse sin Margin Engine

CAPACIDAD 2: Estimated transaction exposure
→ Monto MXN afectado por excepciones detectadas
→ Datos: pos_orders (total, discount_amount)
→ NO requiere P&L completo
→ EXC-001 puede reportar esto

CAPACIDAD 3: Full financial impact
→ Impacto en contribution margin, food cost, labor cost
→ SÍ requiere Margin Engine completo
→ Fase posterior — no prerequisito para EXC-001 CERTIFIED
```

**CORRECTED TIMELINE:**
EXC-001 shadow mode puede iniciar en Fase 2 (semana 6) en paralelo con ANO-001.
EXC-001 puede certificarse en semana 10 para capacidades 1 y 2.
Capacidad 3 (full financial impact) requiere Fase 3.

**OLD CLASSIFICATION:** EXC-001 bloqueado por Margin Engine
**NEW CLASSIFICATION:** EXC-001 PARALLEL con ANO-001/DOB-001 para capacidades 1 y 2
**FILES UPDATED:** AGENT-ACCURACY-PROGRAM.md, WORLD-CLASS-ROADMAP-90D.md

---

### C-06 — CFDI classification

**ORIGINAL CLAIM:**
> "Sin CFDI, cliente corporativo no puede usar Fullsite"
> CFDI como bloqueante universal

**PROBLEM:**
CFDI es un bloqueante segmento-específico, no universal. Muchos restaurantes SME en México operan con facturación paralela (facturista externo) o no requieren CFDI inmediato para iniciar operaciones.

**CORRECTED CLAIM:**
```text
CFDI CLASSIFICATION = SEGMENT-SPECIFIC COMMERCIAL BLOCKER

BLOQUEANTE DESDE DÍA 1 (sin workaround):
- Cadenas corporativas con contratos de empresa a empresa
- Restaurantes con empleados que requieren factura de gastos
- Clientes Grupo Galería (si su política requiere CFDI para cualquier proveedor)
- Cualquier cliente que requiera CFDI para pago

BLOQUEANTE DIFERIDO (transición temporal posible):
- Restaurantes SME independientes que facturan <10% de ventas
- Clientes donde el dueño puede usar facturista externo temporalmente
- Pilotos de evaluación donde billing es post-piloto

WORKAROUND TEMPORAL:
Uso de facturista externo (ej. Facturapi configurado por cliente)
o facturación directa del cliente hasta que CSD esté disponible.
Riesgo operativo: dependencia de proceso manual del cliente.

DECISIÓN REQUERIDA ANTES DEL PILOTO:
¿Requiere Grupo Galería CFDI en todas las transacciones desde día 1?
Si sí: CFDI = hard blocker para ese piloto.
Si no: piloto puede iniciar con workaround documentado.

NO AFIRMAR que CFDI está disponible hasta contar con evidencia en producción.
```

**OLD CLASSIFICATION:** Bloqueante universal
**NEW CLASSIFICATION:** SEGMENT-SPECIFIC COMMERCIAL BLOCKER
**FILES UPDATED:** COMPETITIVE-MOAT-MAP.md, WORLD-LEADERSHIP-GAP-AUDIT.md

---

### C-07 — Diagnostic visit duration

**ORIGINAL CLAIM:**
> "Diagnostic Visit AMALAY — Duración estimada en campo: 15 minutos"

**PROBLEM:**
La sesión de diagnóstico requiere ejecutar scripts, capturar ZIPs, verificar ramas del registro NSIS, y documentar con fotos y hashes. La ejecución del script puede ser corta, pero la sesión completa no.

**CORRECTED CLAIM:**
```text
DIAGNOSTIC SESSION DURATION: 30–45 minutos
Script execution may be shorter (5–10 min for Branch A check)
Total session includes: script + ZIP capture + photo + hash verification + branch determination

OUTPUT REQUIRED:
DEPLOYMENT TYPE: [Branch A NSIS / Branch B manual]
ROLLBACK INPUTS CAPTURED: [Y/N]
RECOMMENDED MIGRATION BRANCH: [A/B]
BLOCKERS: [list or none]
INSTALLATION AUTHORIZED: [Y/N]
```

**OLD CLASSIFICATION:** "15 minutos"
**NEW CLASSIFICATION:** "30–45 minutos; script execution puede ser más corto"
**FILES UPDATED:** WORLD-CLASS-ROADMAP-90D.md

---

### C-08 — FIELD VERIFIED rigor — Dimensión 10 Multi-tenant

**ORIGINAL CLAIM:**
> Dim 10 (Multi-tenant isolation): FIELD VERIFIED

**PROBLEM:**
El segundo tenant onboarded (vantara) es un tenant de sandbox — no un cliente pagando con operaciones reales en campo. El aislamiento de datos fue verificado en condiciones controladas, no en operación de campo real.

**CORRECTED CLASSIFICATION:**
```text
Dim 10 Multi-tenant isolation: LAB VERIFIED

RATIONALE:
vantara = sandbox tenant creado para testing, no cliente pagando en campo.
RLS auditada y 5 bugs corregidos.
Isolation verificado en entorno controlado.
No equivale a FIELD VERIFIED (operación real con cliente externo).
```

**FIELD VERIFICATION REGISTER:**
Las 8 dimensiones que mantienen FIELD VERIFIED (post-corrección) deben cumplir:

| Dim | Capacidad | Fecha campo | Ubicación | Terminal | Escenario | Resultado | Evidencia | Testigo | Reproducible |
|---|---|---|---|---|---|---|---|---|---|
| 1 | POS flujo completo | 2026-07-16 | AMALAY, Monterrey | CAJA + BARRA + COCINA | R1 Validation 12/12 scenarios | PASS | R1-AMALAY-VALIDATION.md | Eduardo Esquivel | Sí |
| 2 | KDS básico (bump, display) | 2026-07-12 | AMALAY | KDS cocina + barra | Bump de ítem, display de orden | PASS | FIELD-NOTES-PREFLIGHT-JUL12.md | Daniel Ramonfaur | Sí — station filter NO validado post-RC2 |
| 3 | Impresión multi-estación | 2026-07-12 | AMALAY | 4 impresoras (cocina fría, caliente, barra, caja) | Smoke test: imprimir en todas las estaciones | PASS | FIELD-NOTES-PREFLIGHT-JUL12.md | Daniel Ramonfaur | Sí — retry con impresora caída NO field-tested |
| 4 | Cobro efectivo + tarjeta externa | 2026-07-16 + operación diaria | AMALAY | CAJA | Cobro real con efectivo y Getnet/MP Point | PASS | R1-AMALAY-VALIDATION.md | Eduardo Esquivel | Sí — Getnet requiere entrada manual de monto |
| 5 | Offline básico (8 órdenes) | 2026-07-27 | AMALAY | SERVER1 | Desconectar WAN, crear 8 órdenes, reconectar, verificar sync | PASS (básico) | DEPLOYMENT-STATE.md Visit 3 | Eduardo + Daniel | Parcial — OCS P2.5.9 completo PENDING FIELD |
| 12 | Business date / turno lifecycle | Operación diaria desde Jul-16 | AMALAY | CAJA | Eduardo abre y cierra turno diariamente | PASS | Operación observada | Eduardo Esquivel | Sí |
| 13 | Recetas y food cost | 2026-07-07 | AMALAY | app.fullsite.mx | R1 revisión con Eduardo: 63 recetas, food cost ~27.6% | PASS | R1-AMALAY-VALIDATION.md | Eduardo Esquivel | Sí — yield factor NO implementado |
| 27 | UX operadores | 2026-07-16 + diario | AMALAY | Tablets POS | Eduardo opera el sistema independientemente | PASS | Operación observada, feedback "Ha que fregón" | Eduardo Esquivel | Sí |

**RECLASSIFICATIONS:**
```text
Dim 10 Multi-tenant: FIELD VERIFIED → LAB VERIFIED
Motivo: vantara = sandbox tenant, no cliente pagando en campo.
```

**FIELD VERIFIED BEFORE:** 9
**FIELD VERIFIED AFTER:** 8
**RECLASSIFIED:** Dim 10 Multi-tenant (FIELD VERIFIED → LAB VERIFIED)

**OLD CLASSIFICATION:** FIELD VERIFIED (Dim 10)
**NEW CLASSIFICATION:** LAB VERIFIED (Dim 10)
**EVIDENCE:** vantara es sandbox — no cliente pagando en operación real
**FILES UPDATED:** WORLD-LEADERSHIP-GAP-AUDIT.md

---

### C-09 — Wansoft pricing evidence

**ORIGINAL CLAIM:**
> "Wansoft cobra $2,800+IVA/mes + $23K consultoría + $1,160/hr soporte"
> "$102K año 1" como FACT en sección de moat

**PROBLEM:**
La cotización real documentada para AMALAY fue específica y diferente. El "$102K año 1" era una estimación compuesta de múltiples fuentes. No debe presentarse como FACT sin la cotización original.

**CORRECTED CLAIM:**
```text
WANSOFT QUOTATION FOR AMALAY = FACT (cotización documentada):
- Hardware (antes de IVA): $130,466.01 MXN
- Renta mensual: $1,500 MXN/mes
- Cargo anual: $1,293 MXN
- Total inmediato cotizado (con IVA): $154,580.45 MXN
- Estimación 12 meses completos: ~$173,720.45 MXN con IVA

FUENTE: Cotización Wansoft para AMALAY. Ver DEPLOYMENT-STATE.md.

Wansoft pricing general del mercado (encuesta, no cotización directa):
- Renta: ~$2,800+IVA/mes (otros clientes, no AMALAY)
- Consultoría: $23K+ (Eduardo interview, campo)
- Soporte: $1,160/hr (cotización documentada)
CLASIFICACIÓN: FACT con fuente identificada.

NO usar "$102K año 1" como FACT directo — era estimación compuesta.
```

**OLD CLASSIFICATION:** FACT mezclado con estimación
**NEW CLASSIFICATION:** FACT (cotización AMALAY) / FACT con fuente (mercado general)
**EVIDENCE:** DEPLOYMENT-STATE.md (cotización AMALAY), encuesta Wansoft, Eduardo interview
**FILES UPDATED:** COMPETITIVE-MOAT-MAP.md

---

### C-10 — Roadmap parallel workstreams

**ORIGINAL CLAIM:**
> Todo el trabajo secuenciado estrictamente semana por semana sin identificar paralelos

**PROBLEM:**
Trabajo de labeling de agentes, GTM, documentación de onboarding, y pricing research no dependen de offline certification. Presentarlos como secuenciales subestima la capacidad de avanzar en paralelo.

**CORRECTED CLAIM:**
```text
HARD DEPENDENCY (no puede iniciar hasta que el prerequisito esté CLOSED):
- Field Batch #2 ETAPA 1 → depende de ETAPA 0 PASS
- OCS P2.5.9 → depende de v1.3.3 instalado
- Agent certification → depende de shadow mode infrastructure
- Cutover externo → depende de Core Offline CERTIFIED

SOFT DEPENDENCY (puede iniciar antes pero se completa después):
- Agent labeling (Eduardo) → puede iniciar ahora, no requiere offline cert
- Wansoft cotización formal → puede obtenerse en paralelo
- EXC-001 shadow mode → puede correr en paralelo con ANO-001

PARALLEL WORKSTREAM (completamente independiente):
- Website / GTM updates → no depende de ningún gate técnico
- Sales discovery / qualification → no depende de ningún gate técnico
- Onboarding documentation (genérica) → puede avanzar en paralelo
- Pricing research / WTP validation → puede avanzar en paralelo
- Grupo Galería pilot parameters → puede avanzar en paralelo
```

**OLD CLASSIFICATION:** Secuencial implícito
**NEW CLASSIFICATION:** HARD DEPENDENCY / SOFT DEPENDENCY / PARALLEL WORKSTREAM
**FILES UPDATED:** WORLD-CLASS-ROADMAP-90D.md

---

### C-11 — Milestone confidence

**ORIGINAL CLAIM:**
> Semanas 4, 8, 10, 12 presentadas como gates sin nivel de confianza

**PROBLEM:**
Un gate sin confidence level y sin slip triggers es un deadline, no un plan. La confianza depende de condiciones de entrada verificadas. Sin slip triggers, no hay protocolo de respuesta si el gate falla.

**CORRECTED STRUCTURE (ejemplo):**
```text
TARGET: Week 4 — P0-4 Offline Field Certification
CONFIDENCE: Medium
ENTRY CONDITIONS:
  - Diagnostic completed
  - Rollback inputs captured
  - Migration branch approved
  - No unresolved P0 blocker
EXIT CONDITIONS:
  - Cold start offline PASS
  - Order → KDS → print → persist PASS
  - Restart recovery PASS
  - Reconnect and dedup PASS
  - Evidence package complete
SLIP TRIGGERS:
  - Diagnostic visit blocked or rescheduled
  - P0 blocker found during ETAPA 0
  - Hardware failure during field test
FALLBACK:
  - Document failure, fix, repeat within 2 weeks
```

**OLD CLASSIFICATION:** Fechas sin confidence ni slip trigger
**NEW CLASSIFICATION:** TARGET + CONFIDENCE + ENTRY/EXIT CONDITIONS + SLIP TRIGGERS
**FILES UPDATED:** WORLD-CLASS-ROADMAP-90D.md

---

### C-12 — Defensible advantages classification

**ORIGINAL CLAIM:**
> "TOP 5 DEFENSIBLE ADVANTAGES" mezclando ventajas actuales con potenciales

**CORRECTED CLASSIFICATION:**

**CURRENT (evidencia real hoy):**
- Profundidad operativa del POS (FIELD VERIFIED en AMALAY)
- Conocimiento de operación real de restaurante mexicano (Eduardo, Wansoft, AMALAY)
- Fuente propia de eventos operativos (cada orden, pago, ítem = datos propios)
- LOI externo de Grupo Galería (interés comercial formal documentado)

**EMERGING (en progreso, evidencia parcial):**
- Core Offline en certificación (P0-4 pendiente field)
- Onboarding repetible (1 sandbox completado, segundo real pendiente)
- Agent Accuracy Program (framework diseñado, sin agente certificado aún)

**POTENTIAL (no demostrado aún):**
- Liderazgo en restaurant AI certification (HYPOTHESIS — nadie publica métricas hoy, pero puede cambiar)
- Menor costo total de despliegue vs Wansoft (HYPOTHESIS — precio Fullsite sin validar)
- ROI medido por acción (ningún outcome tracked aún)
- Aprendizaje multi-sucursal (requiere 3+ clientes)
- Action Engine autónomo (Fase 4+)

**OLD CLASSIFICATION:** Sin distinción CURRENT / EMERGING / POTENTIAL
**NEW CLASSIFICATION:** Tres niveles explícitos
**FILES UPDATED:** COMPETITIVE-MOAT-MAP.md

---

## LOI Grupo Galería — Nota de due diligence

El archivo `docs/legal/loi-fullsite-grupo-galeria.html` contiene bloques de firma con indicadores `SIGN HERE` activos y líneas de fecha vacías. Esto sugiere que el archivo en el repositorio es el **template no firmado**.

**Acción requerida:**
Confirmar si existe versión firmada (PDF físico, firma digital) fuera del repositorio.
Si no existe versión firmada, reclasificar el LOI como "PROPOSED / NOT YET SIGNED" en documentos de estrategia.

---

## Index de archivos actualizados

| Documento | Correcciones aplicadas |
|---|---|
| COMPETITIVE-MOAT-MAP.md | C-01, C-02, C-03, C-06, C-09, C-12 |
| WORLD-LEADERSHIP-GAP-AUDIT.md | C-02, C-06, C-08 |
| AGENT-ACCURACY-PROGRAM.md | C-04, C-05 |
| WORLD-CLASS-ROADMAP-90D.md | C-01, C-03, C-05, C-07, C-10, C-11 |
| WORLD-LEADERSHIP-CORRECTIONS-v2.md | Este documento |
| WORLD-CLASS-BACKLOG-90D.md | Nuevo documento |
