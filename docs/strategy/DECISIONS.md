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

### 2026-08-25 — La red y la marca se pagan con revenue share, no con equity

**Decisión:** A los partners que aportan **red y acceso** (no construcción) se les paga con
**comisión sobre el primer año** de cada contrato que cierren. El equity se reserva para quien
construye un activo permanente de la empresa, y sólo después de un entregable verificable.

**Contexto:** Conversación con **JC Tame** (restaurantero, consultor de aperturas de barras de
café). Ofrece identidad de marca, red de pilotos y modelo de equipo comercial. No pidió nada
a cambio — textual: *"la regalía es lo de menos"*. Fullsite: 1 restaurante en producción,
7 demos, cero revenue.

**Estructura acordada como recomendación:**

| Momento | Instrumento | Cantidad |
|---|---|---|
| Hoy (plática) | Nada | 0% |
| Tras el primer entregable verificable | Advisor grant | 1%, vesting 2 años, cliff 3 meses |
| Si se vuelve operativo (dueño del go-to-market) | Equity de operador | 5% base, earn-up a 10% por hitos de revenue, vesting 4 años, cliff 1 año |
| Siempre, en paralelo | Revenue share | 10-15% del primer año de cada contrato que él cierre |

**Por qué:**
1. El equity es para quien construye la compañía; el revenue share para quien trae los deals.
   Confundirlos es el error clásico del founder solo.
2. Un partner que trae 10 restaurantes cobrando 12% del primer año se paga con dinero que **no
   existía sin él** — el cap table queda intacto.
3. Ofrecer doble dígito a alguien que no ha pedido nada abarata el equity y se lee como
   desesperación. JC negocia con proveedores toda su vida; lo notaría.
4. Aplica el mismo patrón que con Hugo Vaquera: **founding sprint antes de firmar equity.**

**El ask correcto — no pedirle una lista de leads.** Si el activo es su nombre, un lead frío
vale poco y una presentación con su nombre de por medio vale todo. El entregable es:
*"escoge un lugar donde tu palabra pese, nos sentamos los tres, tú abres y yo enseño el
sistema."* Eso consigue el piloto, prueba si la red es real, y lo compromete públicamente.

**Alternativas descartadas:**
- *10-15% de equity de entrada, como Hugo:* Hugo compromete 2-4 años y transiciona su ingreso
  al mes 18. JC no va a cerrar su consultoría — su valor depende de que siga adentro del
  circuito. Contribución estructuralmente parcial.
- *Nada hasta que traiga clientes:* deja enfriar a alguien con red. La gente con nombre tiene
  diez conversaciones interesantes al mes; la que se enfría es la que no recibió algo suyo que
  empujar en la primera quincena.

**⚠️ Pendiente que bloquea cualquier oferta formal — el cap table no está resuelto.**
`DUE-DILIGENCE-v2.md` registra a Monica con **20% sin contrato legal**, más las propuestas de
Eduardo y Hugo. FULLSITE SAS se constituyó (2026-06-11) con Daniel como **único accionista**.
Legalmente hay 100%; en compromisos verbales no. **Antes de ofrecerle equity a nadie más hay
que reconciliar y documentar el cap table real.** Suma comprometida estimada: Monica 20% +
Hugo 15% + Eduardo 4% + pool 10% + aceleradora 7% + seed ~18% = **~74%**.

**Estado:** decisión tomada, oferta no presentada. Ver `memory/project_jc_tame_brand_partner.md`.

---

### 2026-08-25 — Sin acta de línea base no hay instalación

**Decisión:** Ningún restaurante se instala sin haber levantado y firmado el
**acta de línea base** ([`../playbooks/guides/ACTA-LINEA-BASE.md`](../playbooks/guides/ACTA-LINEA-BASE.md)).
Un restaurante instalado sin acta se registra como *"sin línea base"* y **no se usa como caso
de éxito**.

**Por qué:** El caso de éxito se construye el día cero o no existe. Sin el antes medido, a los
seis meses hay una anécdota — *"les fue mejor"* — que no convence a un dueño escéptico ni
sostiene una nota de prensa ni se presenta a un inversionista. El playbook de onboarding cubría
bien la configuración técnica y **no medía nada del negocio**. Hueco cerrado en §1E.

**Regla asociada:** cada dato lleva fuente y confiabilidad (`MEDIDO` / `EXPORTADO` /
`DECLARADO` / `ESTIMADO`). Nunca presentar un dato declarado por el dueño como medido por
nosotros. Al comparar contra el día 30/60/90, anotar qué más cambió en el periodo — atribuirle
a Fullsite un cambio que fue del mercado destruye la credibilidad de todos los casos.

---

### 2026-08-25 — Posicionamiento: "el punto de venta final"

**Decisión:** Adoptar **"el punto de venta final"** como frase de posicionamiento hacia afuera.
Documento: [`POSICIONAMIENTO.md`](POSICIONAMIENTO.md). Estado: **borrador, pendiente de
validación en las primeras tres conversaciones de venta reales.**

**Contexto:** Diagnóstico de JC Tame, textual: *"si yo no veo lo que tú tienes en persona, lo
visualizo como otro punto de venta más."* El problema no es de producto — es de encuadre.
Al presentarnos como "punto de venta" entramos a la lista de los cinco que el dueño ya vio, y
ahí se compite por precio.

**Consecuencia operativa inmediata:** el demo **deja de abrir en la pantalla de mesas.**
Abrir en la cuadrícula es entrar por la puerta de "otro POS más". El demo abre con el hallazgo
que su sistema actual no le puede dar; el POS se enseña después, como prueba de que el hallazgo
salió de su operación real. Secuencia: **hallazgo → de dónde salió → cómo se opera.**

**Límite explícito:** sólo se venden los pilares con evidencia (opera sin fallar · piensa por
ti). La capa de proveedores, benchmark de precios entre clientes y consultoría de apertura es
**tesis, no producto** — se cuenta como visión y nunca como capacidad.

**Lo que NO se dice (verificado contra el repo el 2026-08-25):** que el sistema le manda solo el
correo al proveedor. `inventory_auto_order.py`, `purchase_predictor.py`, `stock_alert_agent.py`
y `supplier_monitor.py` detectan el reorden, predicen la compra y sugieren la orden — pero el
envío es **Telegram al dueño**. El tramo hacia el proveedor no existe, y cuando exista es un
efecto externo Tipo A con aprobación humana obligatoria.

---

### 2026-08-25 — Marca y red corren en paralelo; no tocan el núcleo

**Decisión:** El trabajo de marca, red y pilotos es **clase B**: corre en paralelo, **no bloquea
el núcleo** (offline, cutover de AMALAY, camino del dinero) y **no consume tiempo de producto
de Daniel**.

**Por qué:** La prioridad 20 del `CLAUDE.md` sigue vigente — no se abren iniciativas nuevas
mientras el núcleo crítico no esté certificado. Pero la conversación con JC cambió la urgencia
en el otro sentido: si abre una puerta en dos semanas, el cutover deja de ser tarea técnica y
se vuelve **prerrequisito comercial**. No se puede instalar en un restaurante que nos presentó
alguien que puso su nombre de por medio, con un producto que no se ha ejercido físicamente.

**No se empieza:** rediseño de marca, logo, redes o campaña · benchmark de precios cross-tenant
y "academia de restaurantes" (requiere agregación anónima con opt-in) · agentes nuevos
(AI Ops v1 está completo; sólo refinamientos por evidencia real).

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
