# DECISIONS — Registro Histórico de Decisiones

> Cada decisión importante con contexto, alternativas consideradas, y resultado.
> Formato: fecha | decisión | por qué | alternativas descartadas | resultado/estado.
> Si no está aquí, no fue una decisión consciente — fue inercia.
> Última actualización: 2026-07-02

---

## Cómo usar este documento

Antes de tomar una decisión importante, busca aquí si algo similar ya se decidió.
Si está aquí, respeta la decisión a menos que haya evidencia nueva que la invalide.
Si la invalidas, documenta por qué y agrega la nueva decisión.

---

## Decisiones de Arquitectura

---

### 2026-06-12 — Event Store en Shadow Mode

**Decisión:** Correr el Event Store de Fullsite en paralelo a Wansoft, capturando
todos los eventos sin reemplazarlo todavía.

**Contexto:** El objetivo era validar que el Event Store podía capturar fielmente
la operación real antes de depender de él como fuente de verdad.

**Por qué:** Reemplazar Wansoft antes de tener confianza en el Event Store
es un riesgo operativo inaceptable. El restaurante no puede perder ventas
por una decisión de arquitectura prematura.

**Alternativas descartadas:**
- Reemplazar Wansoft directamente → riesgo de pérdida de datos en producción
- No tener Event Store hasta post-cutover → pierde semanas de datos reales

**Resultado:** Event Store activo desde 2026-06-12. Datos acumulándose.
Validación en AMALAY programada para julio 2026.

---

### 2026-06-30 — Concurrencia: Opción A ahora, Opción B post-cutover

**Decisión:** Implementar parches de concurrencia (Opción A) para el cutover,
y normalizar el modelo de datos (Opción B) en las primeras semanas post-cutover.
Opción C (Event Sourcing completo) queda para cuando haya equipo de 3+ devs.

**Contexto:** Auditoría reveló 4 bugs críticos de race condition en el POS
causados por el JSON monolítico en `pos_orders.items`.

**Por qué:**
- AMALAY opera con 1 terminal POS — los bugs no se manifiestan hoy.
- El cutover no puede esperar 7 días de desarrollo para Opción B.
- Opción C con 1 developer antes del primer cliente es sobreingeniería prematura.

**Alternativas descartadas:**
- Opción B antes del cutover → retrasa 7 días con riesgo de regresiones
- Opción C ahora → 12-16 días, cambio radical, requiere equipo

**Resultado:** Parches aplicados (updated_at en handlePayment, fix 409, kds_status separado).
Normalización programada para semana 2-3 post-cutover.

Ver: `docs/architecture/adr/ADR-CONCURRENCY.md`

---

### 2026-06-30 — Turno lifecycle: por terminal, no global

**Decisión:** El turno es por terminal, no global. Múltiples terminales pueden
tener turnos abiertos simultáneamente. Un turno cerrado no se reabre — se crea uno nuevo.

**Por qué:** Compatible con multi-terminal futuro. Auditabilidad completa.
El fondo inicial no se puede editar — errores se corrigen via depósito/retiro.

**Alternativas descartadas:**
- Turno global único → no escala a múltiples terminales ni a multi-sucursal
- Reabrir turno cerrado → rompe la inmutabilidad del audit log

Ver: `docs/architecture/adr/ADR-TURNO-LIFECYCLE.md`

---

### 2026-06-30 — Modelo fiscal genérico (IVA + IEPS + retenciones)

**Decisión:** Implementar modelo fiscal genérico con `pos_tax_rules` + `pos_item_taxes` (N:M)
en vez de hardcodear IVA al 16%.

**Por qué:** IEPS aplica a bebidas alcohólicas (tequila, cerveza) que AMALAY vende.
Un modelo rígido requeriría reescritura para cada tipo de tasa. El modelo genérico
soporta IVA, IEPS, exento, cuota fija, y retenciones con el mismo código.

**Bloqueado hasta:** Tener XML CFDI real de Wansoft como referencia de validación.

Ver: `docs/architecture/adr/ADR-FISCAL-MODEL.md`

---

## Decisiones de Stack y Tecnología

---

### 2026-05-XX — Stack: Next.js + Supabase + Python agents

**Decisión:** Next.js 15 + React + Tailwind (PWA) para el frontend.
Supabase (Postgres + Auth + RLS) como backend. Python para agentes de IA.

**Por qué:**
- Next.js: deploy automático en Vercel, server-side rendering, PWA sin app nativa.
- Supabase: RLS por defecto, Realtime disponible, Auth integrado, costo bajo.
- Python: ecosistema de ML/AI maduro, integración simple con Groq/Claude.

**Nota crítica:** Usar `fetch()` directo en Next.js, no el SDK de Supabase.
El SDK tiene un bug que causa hangs en entornos serverless de Next.js.

---

### 2026-05-XX — Haiku sobre Groq para agentes de IA

**Decisión:** Claude Haiku ($0.004/query) es el modelo preferido para agentes.
No usar Groq para producción.

**Por qué:** Haiku no tiene límites de rate y es confiable. Groq tiene límites
que rompen en producción.

---

### 2026-05-XX — Bridge de impresión local (localhost:7717)

**Decisión:** Node.js bridge corriendo en localhost que recibe comandos via HTTP
y envía ESC/POS a impresoras via TCP/USB.

**Por qué:** Las impresoras térmicas no tienen API web. El bridge es el único
patrón que funciona con impresoras de restaurante sin modificar el hardware.
Alternativa (impresión cloud) tiene latencia inaceptable (15s+ vs <1s local).

---

## Decisiones de Producto

---

### 2026-07-02 — Parking lot como proceso de priorización

**Decisión:** Toda idea de feature que no tenga evidencia operativa inmediata
va al parking lot con formato: Idea / Evidencia disponible / Impacto estimado / Decisión / Fecha de revisión.

**Por qué:** Las entrevistas con Hugo y Mike confirmaron que el mayor error
de productos en etapa temprana es convertir incertidumbre en código.
Si no hay 100 restaurantes pidiéndolo → parking lot.

---

### 2026-07-02 — Spec antes de código (Samuel)

**Decisión:** Para cualquier feature nueva a partir del post-cutover,
el orden obligatorio es: especificación → interfaces → contratos → criterios de aceptación → código.

**Por qué:** Samuel identificó que el código generado sin spec tiende a ser
complejo de mantener y crea dependencias no explícitas. El spec también
funciona como documentación automática.

**Cuándo aplica:** Post-cutover. Durante la estabilización de AMALAY, la prioridad
es operación, no nuevas features.

---

### 2026-07-02 — Observabilidad como requisito de producción

**Decisión:** Ningún componente está "listo para producción" si puede fallar silenciosamente.
El bridge, las impresoras, el event store, y Supabase deben tener indicadores
de estado visibles sin depender de que Daniel revise logs manualmente.

**Por qué:** La noche de AMALAY (julio 2026) reveló que esta observabilidad no existe todavía.
Es un blocker para el Shadow Day.

---

## Decisiones de Negocio y Estrategia

---

### 2026-05-XX — YC como objetivo de funding (Winter 2027)

**Decisión:** Target YC Winter 2027 como primer round institucional.
Dalus Capital como opción de seed si hay tracción antes.

**Por qué:** YC rejection (batch anterior) confirmó que el producto necesitaba
más validación en producción. Winter 2027 da tiempo para: AMALAY operando,
primeros 5-10 restaurantes, y métricas reales.

---

### 2026-07-02 — Founder Commitment como filtro duro para cofundadores

**Decisión:** Ningún candidato a cofundador avanza sin claridad en Founder Commitment.
La pregunta concreta: "YC nos acepta. Tenemos que estar en SF en 8 semanas. ¿Qué te detiene?"

**Por qué:** Fullsite quiere construir una empresa global. Un cofundador que no está
dispuesto a mudarse a SF si YC acepta es un cofundador que no tiene el mismo nivel
de compromiso que se necesita en early stage.

---

### 2026-07-01 — LOI con Grupo Galería (no-binding)

**Decisión:** Firmar LOI no-binding con Monica (Board Member, Grupo Galería) para
evaluar Fullsite en Dunkin México, Carl's Jr, BWW, iHop (12+ ubicaciones).

**Contexto:** Monica tiene 20% equity en Fullsite y relación directa con Grupo Galería.
El LOI se incluyó en el deck de Dalus Capital con nota de transparencia ("Relationship disclosed").

---

### 2026-06-XX — No construir terminal bancaria antes del cutover

**Decisión:** Getnet standalone durante AMALAY. Integración Clip REST después del cutover.

**Por qué:** La complejidad de integración bancaria puede retrasar el cutover semanas.
El riesgo no vale el beneficio cuando Getnet funciona como solución independiente.

---

### 2026-06-XX — No construir event sourcing antes de tener equipo

**Decisión:** Event sourcing completo (Opción C en ADR-CONCURRENCY) se evalúa
cuando haya equipo de 3+ developers o 50+ restaurantes.

**Por qué:** Event sourcing con 1 developer antes del primer cliente en producción
es la definición de sobreingeniería prematura. La curva de aprendizaje es la barrera principal.

---

## Decisiones Descartadas (y por qué)

| Decisión considerada | Por qué se descartó |
|---|---|
| Reemplazar Wansoft desde el día 1 | Riesgo operativo inaceptable. Shadow mode primero. |
| Construir app nativa antes de PWA | Ciclo de publicación lento, sin ventaja frente a PWA en restaurantes |
| Multi-sucursal antes de 10 restaurantes | Complejidad prematura sin evidencia de que es lo que frena crecimiento |
| Lealtad/puntos antes de CRM básico | Sin CRM, la lealtad no tiene base de datos |
| VP Sales antes de proceso repetible | La persona escala el proceso. Sin proceso, solo quema runway. |

---

> Este documento es la memoria de la empresa.
> Si se toma una decisión importante sin registrarla aquí, se pierde.
> Actualizar inmediatamente después de cualquier decisión significativa.
