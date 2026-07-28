# Fullsite Product Vision Bible

> El documento más difícil de escribir: el POR QUÉ existe Fullsite,
> el QUÉ NO es, y cómo tomamos decisiones de producto.
>
> Este no es un roadmap. No es un pitch deck. Es la filosofía que gobierna
> cada decisión de producto desde el primer commit hasta el restaurante número 10,000.
>
> Autor: Daniel Ramonfaur — CPO/Fundador
> Fecha: 2026-07-23
> Estado: Documento vivo. Actualizar solo cuando cambia la visión, no cuando cambia el código.

---

### Convención de evidencia

Cada afirmación importante en este documento lleva una de tres etiquetas:

- `[HECHO]` — Existe hoy y fue verificado en código o en campo (AMALAY, Eduardo, documentos de estrategia)
- `[INFERENCIA]` — Deducido del comportamiento observado o del contexto; razonable pero no verificado directamente
- `[PENDIENTE]` — No existe todavía, es una aspiración o una decisión abierta

Nunca se usan palabras como "probablemente", "parece que" o "debería" sin etiqueta explícita. Mezclar visión con realidad es el error más peligroso en documentación de producto.

---

## Índice

1. [Propósito](#1-propósito)
2. [Filosofía](#2-filosofía)
3. [Arquitectura de la propuesta de valor](#3-arquitectura-de-la-propuesta-de-valor)
4. [Flujos principales](#4-flujos-principales)
5. [Reglas de negocio](#5-reglas-de-negocio)
6. [Estados del producto (evolución 0→1→N)](#6-estados-del-producto-evolución-01n)
7. [Source of Truth](#7-source-of-truth)
8. [Invariantes](#8-invariantes)
9. [Casos borde](#9-casos-borde)
10. [Limitaciones actuales](#10-limitaciones-actuales)
11. [Roadmap](#11-roadmap)
12. [Referencias al código](#12-referencias-al-código)
13. [Open Questions & Future Work](#13-open-questions--future-work)

---

## 1. Propósito

### Qué es este documento y para quién

Este documento existe para una audiencia específica y en ese orden:

**Para Daniel (fundador):** El norte. Cuando hay presión de agregar features, cuando un cliente pide algo que no encaja, cuando hay un debate sobre prioridades — este documento es el árbitro. Si una decisión contradice lo que está escrito aquí, hay que actualizar el documento conscientemente o rechazar la decisión.

**Para cualquier cofundador o ingeniería que entre:** El contexto que tarda 3 meses en adquirir de otra forma. Qué problema resuelve Fullsite, por qué las decisiones arquitectónicas son como son, qué nunca se sacrifica.

**Para inversionistas que quieren entender la tesis:** La narrativa honesta — incluyendo qué no es verdad todavía y hacia dónde vamos, sin mezclar una con la otra.

**Para Eduardo Gerente como proxy de cliente:** `[INFERENCIA]` El documento que explica por qué Fullsite hace ciertas cosas de cierta forma y que puede usarse como base para conversaciones de producto.

### Qué NO es este documento

No es un roadmap de features comprometidas.
No es un manual de usuario.
No es un spec técnico.
No es marketing.

### Cómo usarlo

Antes de cualquier decisión de producto que no esté cubierta por un ADR específico, la primera pregunta es: ¿qué dice la Vision Bible? Si la decisión contradice lo que está aquí, tienes tres opciones: actualizar la Bible con evidencia nueva, rechazar la decisión, o documentar conscientemente la excepción.

Si encuentras que algo en este documento contradice lo que el producto realmente hace: no corrijas el código para alinearlo al documento, ni corrijas el documento para tapar la discrepancia. Primero entiende por qué existe la diferencia. Luego decide cuál tiene razón.

---

## 2. Filosofía

Esta sección contiene los principios que gobiernan el producto. Para cada principio: qué es, de dónde viene, qué alternativas se descartaron, y cuándo tendría sentido revisarlo.

### 2.1 Por qué existe Fullsite

`[HECHO]` Los restaurantes mexicanos operan con márgenes de 5-15%. `[HECHO]` El dueño de un restaurante que factura $2M MXN al mes `[HECHO — AMALAY]` sabe qué pasó ayer si el contador ya procesó los datos. Sabe qué pasó el mes pasado si tuvo tiempo de revisar el reporte. Pero no sabe en este momento si su food cost subió, si hay un mesero que está cancelando demasiadas órdenes, si el ingrediente de su platillo estrella se va a acabar mañana.

`[HECHO]` Esa información existe — está en el POS, en los tickets, en los eventos de cocina. Pero está muerta dentro de los sistemas legacy. `[HECHO]` Wansoft captura cada evento en SQL Server local y lo sincroniza al portal cada X horas. Ahí muere. Nadie lo analiza en tiempo real.

**La tesis central de Fullsite:** `[INFERENCIA]` El dato operativo más valioso que un restaurante genera no genera ningún valor. Fullsite existe para cambiar eso — para convertir cada dato operativo en una decisión.

### 2.2 La tesis en una oración

`[HECHO — COMPANY_BRAIN.md]` Los restaurantes no tienen un problema de software. Tienen un problema de decisiones. Fullsite es la capa de inteligencia operativa que los ayuda a tomar mejores decisiones todos los días.

### 2.3 Principio: Fullsite NO es un POS

`[HECHO]` Tenemos un POS. Es parte de Fullsite. Pero no somos un POS.

Un POS maximiza la velocidad de registro de transacciones. El POS de Fullsite existe para generar el dataset que alimenta la inteligencia operativa. Cada orden es un evento que entra al event store y es procesado para generar inteligencia.

`[PENDIENTE]` El POS como puerta de entrada a un sistema más profundo — esta distinción es clara en la visión pero todavía no es completamente visible en el producto hoy.

> **Rationale:**
> - **Tensión:** Posicionarse solo como POS tiene un mercado conocido y ciclos de venta cortos. Posicionarse como "sistema operativo" tiene un mercado más grande pero es más difícil de articular en ventas.
> - **Alternativa descartada:** "Somos un POS más inteligente" — como Parrot o SoftRestaurant con IA agregada. Ese framing limita la percepción de valor y nos mete en una guerra de features con competidores más grandes.
> - **Por qué este enfoque:** El mercado que realmente está disponible no es el de POS (donde Wansoft y SoftRestaurant llevan 20 años). Es el mercado de inteligencia operativa para restaurantes, que no existe todavía. Ser el primero en definir esa categoría es más valioso que ser el número 5 en el mercado de POS.
> - **Tradeoff:** El ciclo de venta es más largo porque hay que educar al cliente sobre el valor de la inteligencia operativa, no solo del cobro. El mensaje de ventas tiene que ser más concreto y menos conceptual.
> - **Cuándo revisarlo:** Si después de 50 restaurantes el churn sigue siendo alto y la razón documentada es "no entienden el valor más allá del POS" — entonces hay que simplificar el posicionamiento.

→ Ver `FULLSITE-POS-BIBLE.md § Filosofía` para cómo el POS implementa este principio en práctica.

### 2.4 Principio: "Operating System para restaurantes"

La metáfora del sistema operativo no es marketing. Es una descripción funcional.

`[HECHO — diseño]` Un OS gestiona recursos, coordina procesos, expone interfaces, y proporciona una base confiable. Fullsite hace lo mismo para un restaurante: gestiona menú/inventario/personal/mesas `[HECHO]`, coordina el flujo de orden→cocina→cobro→contabilidad `[HECHO — parcialmente]`, expone POS para mesero y dashboard para dueño `[HECHO]`, y proporciona datos consistentes y confiables `[HECHO — con limitaciones documentadas en sección 10]`.

La diferencia crucial con un OS de computadora: `[PENDIENTE — en construcción]` Fullsite no es pasivo. No solo gestiona — interpreta. Cada evento que pasa por el sistema es procesado y evaluado para generar inteligencia.

> **Rationale:**
> - **Tensión:** "Restaurant OS" puede sonar demasiado ambicioso para un producto que todavía tiene 1 restaurante activo.
> - **Alternativas descartadas:** "POS con IA" (subestima la propuesta), "ERP para restaurantes" (implica complejidad que no tenemos y no queremos tener), "Dashboard inteligente" (no captura la capa operativa).
> - **Por qué este enfoque:** Toast fue valorado en $20B en parte porque convenció al mercado de que era infraestructura, no software. Un OS tiene mayor fidelidad que un POS porque el restaurante construye sus procesos sobre él. La metáfora de OS también explica por qué los módulos separados (POS, KDS, inventario, dashboard) son partes de un todo coherente.
> - **Tradeoff:** El mensaje es más difícil de articular en los primeros 15 minutos de demo. El restaurantero no compra "sistema operativo" — compra "saber dónde pierdo dinero". La visión es para retención e inversionistas; el mensaje de venta es más concreto.
> - **Cuándo revisarlo:** Nunca hay que cambiar la visión por dificultad de articulación. Hay que mejorar el puente entre la visión y el mensaje de venta.

→ Ver `FULLSITE-DOMAIN-BIBLE.md` para las entidades del dominio que forman el "OS".

### 2.5 Principio: "AI-native" — qué significa y qué NO significa

AI-native no significa que Fullsite tiene un chatbot pegado encima del POS.

`[HECHO]` Fullsite tiene 13 agentes de IA corriendo como GitHub Actions. `[INFERENCIA]` AI-native en el sentido de "IA integrada en el núcleo del sistema, no como feature adicional" — esta visión está clara en la arquitectura pero la integración event-driven real-time todavía no existe.

Lo que AI-native NO significa: que el sistema toma decisiones por el restaurante. Fullsite amplifica la inteligencia del operador. No automatiza la humanidad del restaurante.

`[PENDIENTE]` La IA ideal en Fullsite es invisible cuando funciona bien — la alerta no dice "la IA detectó una anomalía estadística", dice "Oscar canceló 3 platillos en los últimos 45 minutos. Su promedio histórico es menos de 1 por turno." Este nivel de integración natural es el objetivo, no la realidad actual.

> **Rationale:**
> - **Tensión:** "AI-native" como marketing vs "AI-native" como diferenciador técnico real. Si los agentes corren como cron jobs, ¿es realmente AI-native?
> - **Alternativa descartada:** Agregar IA como feature visible ("pregúntale a la IA"). Esto crea dependencia de que el usuario use la IA, en vez de que la IA trabaje en segundo plano.
> - **Por qué este enfoque:** La IA que el restaurantero percibe no es la que dice "powered by AI" — es la que le avisa de cosas antes de que sean un problema. La integración silenciosa crea más confianza que la IA como feature.
> - **Tradeoff:** Es más difícil demostrar el valor de la IA si el usuario no la "ve". Requiere evidencia concreta (alerta real, fraude real detectado) para que el restaurantero crea.
> - **Cuándo revisarlo:** Si los modelos se vuelven suficientemente buenos para hacer razonamiento multi-paso en tiempo real sobre la operación, el posicionamiento de "IA invisible" puede evolucionar a "copiloto activo" más visible.

> ⚠️ DISCREPANCIA: La visión dice "AI-native en el núcleo". La realidad actual `[HECHO]` es que los agentes corren principalmente como GitHub Actions con cron jobs. No hay integración real-time del event store con los agentes. Gap a cerrar en la etapa post-cutover.

→ Ver `FULLSITE-ENGINEERING-BIBLE.md § Agentes` para la arquitectura actual de los agentes.
→ Ver `FULLSITE-OPERATIONS-BIBLE.md § Alertas` para cómo se experimenta la IA en campo.

### 2.6 Principio: Reliability como prerequisito, no como feature

`[HECHO — principio establecido y documentado]` Esta es la primera ley de producto y no tiene excepciones.

La métrica que importa no es uptime. Es **Mean Time Between Staff-Affecting Failures (MTBS)** — el tiempo promedio entre eventos que interrumpen la operación del staff.

La aspiración concreta: `[HECHO — frase original de Daniel]` "El restaurante olvida que Fullsite existe." No porque sea invisible por falta de valor — sino porque funciona tan consistentemente que nadie tiene que pensar en él.

> **Rationale:**
> - **Tensión:** Reliability requiere tiempo de ingeniería que no se convierte en features visibles. Hay presión constante de agregar features en vez de fortalecer lo que ya existe.
> - **Alternativa descartada:** "Reliability > Features solo aplica pre-cutover. Después del cutover podemos movernos más rápido." Esta posición es incorrecta — el costo de un fallo post-cutover es el cliente, no solo un bug.
> - **Por qué este enfoque:** `[HECHO]` Eduardo confirmó: "Si no hay comanda, no te hago nada." Un solo fallo de impresión puede costar el cliente. La experiencia del restaurantero con Wansoft ha calibrado su tolerancia a la inestabilidad en CERO. No tenemos margen de error.
> - **Tradeoff:** Features importantes se difieren. El producto se mueve más lento de lo que la narrativa de startup requiere.
> - **Cuándo revisarlo:** Nunca se revisa la prioridad de reliability. Lo que cambia es qué significa "confiable" a medida que el producto crece (de "el cobro no falla" a "los reportes son siempre correctos" a "las predicciones son precisas").

→ Ver `FULLSITE-ENGINEERING-BIBLE.md § Observabilidad` para cómo se implementa reliability.
→ Ver `FULLSITE-OPERATIONS-BIBLE.md § Soporte` para la experiencia de reliability en campo.

### 2.7 Principio: Wansoft EXIT mindset — copiar problemas, no botones

`[HECHO — principio documentado en feedback_product_philosophy_v2.md]` Este es el principio de producto más importante que existe en Fullsite.

`[HECHO]` Wansoft tiene 822 stored procedures que representan 20 años de requests de clientes y lógica de negocio acumulada. No se descarta ninguna feature de Wansoft sin antes entender por qué existe.

Lo correcto: entender profundamente el problema que resuelve cada feature de Wansoft, y decidir conscientemente cómo Fullsite lo resuelve — igual, mejor, diferente, o con una solución más elegante.

> **Rationale:**
> - **Tensión:** Copiar exactamente lo que Wansoft tiene es la forma más rápida de llegar a parity. Pero produce un clon peor del original.
> - **Alternativa descartada:** "Innovar desde cero, ignorar Wansoft." Esto ignora 20 años de lógica de negocio real acumulada y produce un sistema que no cubre casos que el restaurantero da por sentado. `[HECHO]` Wansoft tiene 47 formatos de impresión — todos existen por una razón operativa real.
> - **Otra alternativa descartada:** "Copiar Wansoft pantalla por pantalla." Esto produce un producto con la misma UX de 2007 y sin ventaja real. El restaurantero tiene razón de preguntarse por qué cambiar.
> - **Por qué este enfoque:** El problema que resuelve la "transferencia de platillos" en Wansoft (trazabilidad cuando una cuenta se mueve) es real. La solución de Wansoft (módulo separado con flujo de aprobación) es la solución de 2007. Fullsite resuelve el mismo problema con registro automático integrado en la vista de mesas. Mismo problema, solución diferente y mejor.
> - **Tradeoff:** Requiere más análisis upfront. Cada feature requiere entender el problema antes de diseñar la solución. Eso es más lento que copiar la pantalla.
> - **Cuándo revisarlo:** Este principio siempre aplica. Lo que cambia es el nivel de análisis requerido para features menores vs features centrales.

→ Ver `FULLSITE-POS-BIBLE.md` para el análisis pantalla por pantalla de Wansoft vs Fullsite.

### 2.8 Principio: Cutover es el objetivo intermedio; retención es el objetivo real

`[HECHO — frase de Daniel documentada en FOUNDER.md]` "El cutover no es el objetivo. El objetivo es que nadie quiera regresar a Wansoft después de 2 semanas."

El objetivo real es que, después de 2 semanas de operación con Fullsite, nadie en el restaurante quiera regresar a Wansoft. No porque sea difícil regresar — sino porque Fullsite ya resolvió problemas que Wansoft nunca pudo.

`[PENDIENTE]` Este criterio todavía no ha sido probado fuera de AMALAY. Es la hipótesis central del negocio.

> **Rationale:**
> - **Tensión:** El cutover es el evento visible y medible. La retención es el resultado que importa pero tarda semanas en observarse.
> - **Alternativa descartada:** "El cutover es el objetivo." Esto optimiza para el momento de la firma, no para la experiencia post-firma. Un cliente que hace cutover pero churnea en el mes 2 es un fracaso, no un éxito.
> - **Por qué este enfoque:** `[HECHO]` El 37% de los restaurantes admite que no cambia de POS porque "tomaría tiempo". La barrera de salida de Fullsite tiene que ser la falta de deseo de salir, no la dificultad técnica. Si la retención depende de que sea difícil irse, tenemos el mismo modelo de negocio extractivo que Wansoft.
> - **Tradeoff:** La métrica de éxito (retención a 60 días) tarda más en observarse que la métrica de vanidad (número de cutovers). Requiere disciplina para no optimizar el número equivocado.
> - **Cuándo revisarlo:** Si la evidencia muestra que la retención a 60 días ya está asegurada con el onboarding actual, el foco puede moverse a velocidad de adquisición.

→ Ver `FULLSITE-OPERATIONS-BIBLE.md § Cutover` para el proceso de cutover en campo.

### 2.9 Principio: Transaction A/B — la orden es sagrada, los efectos secundarios son best-effort

`[HECHO — decisión de arquitectura documentada en ADR-CONCURRENCY.md]` Este principio define qué es sagrado y qué es best-effort en Fullsite.

**Transacción A (sagrada):** El estado de la orden. La orden se crea, se modifica, se cobra. Ese estado tiene que ser 100% consistente. No puede quedar en un estado intermedio. Si algo falla en medio de un cobro, el sistema vuelve al estado anterior.

**Efectos secundarios (best-effort):** El descuento del inventario, la generación del CFDI, el envío de alertas, el cálculo del food cost. Si algo falla, se reintenta. No bloquea la operación.

> **Rationale:**
> - **Tensión:** Si el CFDI no se puede generar, ¿se permite el cobro? Si el inventario no puede actualizarse, ¿se bloquea la venta?
> - **Alternativa descartada:** Hacer todo transaccional (cobro + CFDI + inventario en la misma transacción). Esto hace el cobro dependiente de servicios externos. Si Facturama está caído, el restaurante no puede cobrar. Inaceptable.
> - **Por qué este enfoque:** El cobro tiene que funcionar siempre. Los efectos secundarios pueden fallar y recuperarse después. La orden ya está en la base de datos — el CFDI se puede generar 30 segundos después cuando Facturama responda.
> - **Tradeoff:** El inventario puede quedar desincronizado temporalmente. El CFDI puede llegar tarde. El dueño puede ver diferencias entre lo que el sistema dice que hay y lo que hay físicamente. Esos son problemas manejables. Un cobro que no se pudo registrar no lo es.
> - **Cuándo revisarlo:** Si los servicios externos (Facturama, inventario) alcanzan una confiabilidad de 99.99%, la separación puede relajarse en algunos flujos. Hoy no tienen ese nivel.

→ Ver `FULLSITE-ENGINEERING-BIBLE.md § Transaction A/B` para la implementación técnica.

### 2.10 Principio: Offline-first como diferenciador competitivo

`[HECHO — decisión de arquitectura]` El POS funciona sin internet. No es una feature de resiliencia — es un requisito de diseño.

> **Rationale:**
> - **Tensión:** Offline-first agrega complejidad técnica significativa (sincronización, resolución de conflictos, estado local). Es más fácil construir solo-cloud.
> - **Wansoft y su alternativa:** Wansoft depende de un servidor local (SQL Server). Si se va la luz o falla el servidor, el restaurante para. No es offline-first — es local-first, que es diferente. Si el servidor local falla, nada funciona.
> - **Alternativa cloud-only descartada:** Si Supabase tiene un outage o el restaurante pierde conectividad durante el rush del sábado, el restaurante para. Ese riesgo es inaceptable.
> - **Por qué este enfoque:** `[HECHO]` México tiene problemas de infraestructura de internet. `[HECHO]` Eduardo confirmó que cortes de luz durante operación son un problema real. La pregunta "¿qué pasa si se va el internet en hora pico?" tiene que tener una respuesta que no sea "el restaurante para".
> - **Ventaja competitiva concreta:** Es el único argumento de ventas que tiene la respuesta correcta y verificable. "Si se va el internet durante el rush del sábado, ¿qué pasa con su sistema actual?" La respuesta de Wansoft es incómoda. La de Fullsite es: nada.
> - **Tradeoff:** El estado local y el estado del servidor pueden divergir temporalmente. La resolución de conflictos es compleja. El offline boot (arrancar sin internet) todavía no está implementado — ver Limitación #1.
> - **Cuándo revisarlo:** Si la confiabilidad de internet en restaurantes mexicanos mejora consistentemente a >99.9% y el costo de mantenimiento offline supera el valor, se puede reconsiderar. Hoy no es el caso.

→ Ver `FULLSITE-ENGINEERING-BIBLE.md § Offline` para la arquitectura de sincronización.
→ Ver `FULLSITE-POS-BIBLE.md § Offline` para el impacto en la experiencia del mesero.

### 2.11 Principio: Platform mindset — diseñar para 100 restaurantes desde el día 1

`[HECHO — principio documentado en feedback_platform_mindset.md]` Toda decisión de producto que involucra la operación específica de AMALAY debe evaluarse con la pregunta: "¿Esto funciona para los 100 restaurantes que vendrán?"

`[HECHO]` Onboarding = importar datos + configurar + operar. Sin código custom por restaurante. Esta es la intención. `[PENDIENTE]` La validación de que realmente no hay código custom por restaurante requiere el onboarding del restaurante #2.

> **Rationale:**
> - **Tensión:** AMALAY tiene necesidades específicas (5 estaciones de cocina, 522 platillos, lector HID biométrico) que no todos los restaurantes van a tener. La tentación de hardcodear cosas de AMALAY es constante.
> - **Alternativa descartada:** "Construimos para AMALAY y luego generalizamos." Este enfoque produce sistemas llenos de lógica específica que es difícil de remover. Cada excepción hardcodeada es deuda que crece.
> - **Por qué este enfoque:** El costo de generalizar desde el día 1 es bajo si se hace bien (configuración en vez de hardcode). El costo de refactorizar 50 restaurantes después de haber construido para 1 es altísimo.
> - **Tradeoff:** Algunas features se demoran porque requieren diseñar la abstracción correcta antes de implementar. "Funcionaría para AMALAY en 2 horas" puede tomar 2 días si hay que hacerlo configurable.
> - **Cuándo revisarlo:** Si hay evidencia de que el costo de generalización supera el beneficio para un caso específico, se puede hacer una excepción documentada. Pero la excepción necesita justificación explícita.

### 2.12 Principio: No features sin evidencia operativa

`[HECHO — principio documentado en feedback_product_discipline.md]` Si una idea de feature no tiene evidencia operativa que la justifique, va al Parking Lot.

La pregunta que filtra todo: "¿Si los 100 restaurantes que vamos a tener en 12 meses estuvieran usando Fullsite hoy, cuántos estarían pidiendo esto?"

> **Rationale:**
> - **Tensión:** La intuición del fundador y la lógica de "esto tiene que existir" son tentaciones constantes. El founder que construyó solo el producto tiende a enamorarse de features que no tienen validación.
> - **Alternativa descartada:** "Construimos features razonables que un restaurante necesitaría." Sin evidencia, esto produce sistemas con features que nadie usa y gaps en lo que todos necesitan.
> - **Por qué este enfoque:** `[HECHO — Hugo, cofundador evaluado]` "No agrego nada que no hayan pedido 100 clientes." El parking lot es la implementación concreta de ese principio.
> - **Tradeoff:** Features que serían valiosas se demoran hasta que hay evidencia. A veces la evidencia llega cuando el cliente ya se fue por falta de esa feature.
> - **Cuándo revisarlo:** Si hay una feature que múltiples restaurantes claramente necesitan y es costoso no tenerla (bloqueante de venta), la evidencia puede ser el propio proceso de ventas perdidas, no solo la operación.

### 2.13 Principio: Field evidence > opiniones

`[HECHO]` No construimos features por intuición, por benchmarking competitivo, ni por lo que dice el deck de Dalus.

El proceso: `[HECHO — framework D-F-E-T de COMPANY_BRAIN.md]` Cada hallazgo de campo se clasifica como:
- **D — Dispersa:** La información existe pero está fragmentada.
- **F — Faltante:** La información no existe en ninguna parte.
- **E — Experiencial:** Existe solo como conocimiento tácito del gerente.
- **T — Tardía:** Llega cuando ya no se puede actuar sobre ella.

> **Rationale:**
> - **Tensión:** Las sesiones de campo son costosas en tiempo. El análisis de desk research es más rápido pero menos confiable.
> - **Alternativa descartada:** "Aprendemos de los datos de Wansoft y de benchmarking competitivo." Los datos de Wansoft dicen qué pasa, no por qué. El benchmarking dice qué hacen otros, no qué necesitan los clientes mexicanos específicamente.
> - **Por qué este enfoque:** `[HECHO]` Eduardo detectó en 1 tarde de campo más gaps de producto que semanas de análisis de desk research. Los workarounds del staff son la señal más barata y precisa de qué no funciona.
> - **Tradeoff:** Las decisiones de producto son más lentas porque requieren evidencia de campo. En una startup que necesita velocidad, eso puede sentirse como fricción.
> - **Cuándo revisarlo:** Con 50+ restaurantes, los patrones de uso y churn van a generar evidencia más rápido que las visitas de campo. El balanceo entre field evidence y datos cuantitativos va a cambiar.

→ Ver `FULLSITE-OPERATIONS-BIBLE.md § Product Discovery` para el proceso de visitas de campo.

---

## 3. Arquitectura de la propuesta de valor

*Esta sección describe la arquitectura de la propuesta de valor — no la arquitectura tecnológica (que vive en los ADRs). Aquí se documenta cómo Fullsite crea y captura valor.*

### 3.1 Capas de la propuesta de valor

```
Capa 4: AUTONOMÍA [PENDIENTE — visión a 3+ años]
  El sistema ejecuta decisiones rutinarias automáticamente.
  Reordenar ingredientes, ajustar pricing, redistribuir staff.
  
Capa 3: INTELIGENCIA OPERATIVA [PENDIENTE — en construcción]
  Recomendaciones proactivas. Alertas antes del problema.
  El sistema dice qué hacer, con evidencia de por qué.
  Agentes parcialmente construidos [HECHO] pero no integrados en tiempo real.
  
Capa 2: DATOS EN TIEMPO REAL [HECHO — activo en AMALAY, limitaciones en sección 10]
  Visibilidad completa de la operación en tiempo real.
  El dueño ve desde su celular. El sistema detecta anomalías.
  
Capa 1: OPERACIÓN CONFIABLE [HECHO — activo en AMALAY con bloqueantes conocidos]
  POS. KDS. Impresoras. Corte de caja. CFDI.
  La operación no se puede caer. Los datos no se pueden perder.
```

`[HECHO — principio de Hugo documentado en COMPANY_BRAIN.md]` El error fatal sería construir Capa 3 sin tener Capa 1 sólida. La secuencia es obligatoria: proceso → automatización → inteligencia → autonomía.

### 3.2 Qué NO es parte de la propuesta de valor

Para cada categoría de "no somos X", la razón es estratégica, no técnica:

**No somos un ERP:** `[HECHO — decisión consciente]` Los ERP son comprehensivos por diseño. Fullsite es profundo en lo que importa a restaurantes y deliberadamente estrecho en lo que no. Sin módulo de nómina propio. Sin contabilidad general.

**No somos Toast para México:** `[INFERENCIA]` Toast gana monetizando pagos + SaaS en un ecosistema cerrado con hardware propio. Ese modelo requiere capital y tiempo que Fullsite no tiene en esta etapa y un mercado con características diferentes al mexicano. `[PENDIENTE]` La estrategia de monetización de largo plazo en México no está completamente definida.

**No somos una app de delivery:** `[HECHO]` Integramos con Rappi y Uber Eats porque los restaurantes los usan. `[HECHO — decisión documentada]` Eso es integración de datos, no modelo de negocio. Nuestro cliente es el restaurante.

**No somos un marketplace de proveedores todavía:** `[PENDIENTE — diseñado para R100+]` Está en el horizonte pero requiere masa crítica de restaurantes y datos de compras reales.

### 3.3 El data flywheel — el moat que se construye con el tiempo

```
[PENDIENTE — se activa con R50+]

Más restaurantes
        ↓
Más datos operativos reales
        ↓
Mejores modelos de IA (benchmarks propios, detección de patrones)
        ↓
Mejor producto (alertas más precisas, recomendaciones más confiables)
        ↓
Mayor retención + más restaurantes
        ↑_________________________________↑
```

`[HECHO — evidencia parcial]` El flywheel empieza a tener datos: 887 días de historial de AMALAY + Event Store desde 2026-06-12. `[PENDIENTE]` El flywheel cross-restaurante requiere múltiples clientes activos.

> ⚠️ DISCREPANCIA: La visión describe el data flywheel como el moat central. La realidad actual `[HECHO]` es que Fullsite tiene 1 restaurante activo (AMALAY). El flywheel no está girando todavía entre restaurantes. Gap crítico a cerrar en los próximos 6 meses.

### 3.4 El ICP — a quién sirve Fullsite en esta etapa

`[HECHO — validado con evidencia de AMALAY y del ICP-PLAYBOOK.md]`

| Atributo | Valor | Evidencia |
|---|---|---|
| Facturación mensual | $850K - $3M MXN | HECHO (AMALAY = ~$2.2M/mes) |
| Empleados | 15-60 | HECHO (AMALAY = 40) |
| Terminales POS | 2-4 | HECHO (AMALAY = 3) |
| Sistema actual | Wansoft, Soft Restaurant, National Soft | HECHO (AMALAY = Wansoft) |
| Tipo de operación | Restaurante de mesa, servicio completo | HECHO |
| El dueño opera activamente | Sí | HECHO (condición de retención validada en campo) |

**Los red flags — a quién no vendemos:**
- `[HECHO]` Dueño que busca feature parity exacto con Wansoft antes de moverse
- `[HECHO]` Dueño ausente — el gerente no tiene poder de firma
- `[INFERENCIA]` Facturación menor a $500K MXN/mes — el ROI no justifica $1,999/mes
- `[PENDIENTE]` Cadenas de 10+ sucursales — el onboarding multi-sucursal no está sólido todavía

---

## 4. Flujos principales

*Los "caminos felices" de la propuesta de valor — cómo Fullsite se instala, cómo genera valor, y cómo retiene.*

### 4.1 El flujo de adquisición y conversión

`[HECHO — validado en ICP-PLAYBOOK.md y WHY-RESTAURANTS-SWITCH.md]`

```
Trigger en el restaurante (contrato vence / fraude / sistema se cae)
        ↓
Dueño busca opciones (WhatsApp a conocidos / recomendación)
        ↓
Primer contacto con Fullsite (1-3 días)
        ↓
Demo de 15 minutos ← MOMENTO CRÍTICO: la decisión se toma aquí
        ↓
Evaluación (1-2 semanas): consulta gerente, consulta contador
        ↓
Decisión (1 día)
        ↓
Onboarding
        ↓
Primeros 14 días: evidencia de valor visible ← MOMENTO CRÍTICO DE RETENCIÓN
        ↓
Mes 3: el restaurante no pregunta por Wansoft → retención confirmada
```

`[HECHO — documentado en STRATEGIC-DECISIONS.md]` El principio de los 15 minutos: la decisión emocional de compra se toma en los primeros 15 minutos de la demo. Todo lo demás es validación racional posterior.

`[HECHO — validado en ICP-PLAYBOOK.md]` La secuencia de demo probada:
1. Planograma de mesas propio del restaurante (2 min) — "Este es TU restaurante"
2. Tomar una orden con modificadores (2 min) — "Así de fácil"
3. Comanda impresa en cocina automáticamente (1 min) — "Sin errores"
4. Dashboard en tiempo real desde celular (3 min) — "Esto es lo que no ves hoy"
5. Agente de fraude con dato real (2 min) — "Esto detectó un descuento no autorizado"
6. Precio: $1,999/mes, $0 instalación, sin contrato (30 seg)

Total: 11 minutos. No más.

### 4.2 El flujo de onboarding

`[PENDIENTE]` Aspiration: onboarding completo en menos de 30 minutos de tiempo activo del cliente.

`[HECHO — realizado en AMALAY, no documentado como runbook repetible]`

```
Importar datos de Wansoft (parcialmente automatizado)
        ↓
Verificar menú importado (dueño valida, no reconfigura desde cero)
        ↓
Conectar hardware: tablets, impresoras, cajón de efectivo, lector HID
        ↓
Configurar estaciones de impresión (cocina, barra)
        ↓
Turno de prueba con mesero presente
        ↓
Cutover: primer turno real con Fullsite como sistema primario
```

> ⚠️ DISCREPANCIA: `[PENDIENTE]` La visión dice "<30 minutos". La realidad es que el onboarding de AMALAY tomó semanas porque fue el primero y no había proceso. El proceso no está documentado como runbook automatizable todavía. Gap a cerrar antes de escalar.

### 4.3 El flujo de generación de valor (operación diaria)

`[HECHO — parcialmente activo en AMALAY]`

```
[Día a día del dueño]
Abrir dashboard → ver ventas en tiempo real → revisar alertas activas

[Si hay alerta] [HECHO — agentes corren, alertas vía Telegram]
  → Investigar → Actuar → Registrar decisión

[Al cerrar el día]
  → Corte automático → Comparación vs histórico → Resumen del turno

[Semanal] [HECHO — agentes semanales activos]
  → Reporte de food cost por platillo
  → Revisión de meseros (ventas, propinas, cancelaciones)
  → Alertas de reposición de inventario → Órdenes de compra sugeridas
```

`[PENDIENTE]` El valor de inteligencia de Fullsite todavía no se entrega en tiempo real durante la operación. Las alertas llegan con delay por el cron job. La integración real-time es el trabajo de los próximos 3-6 meses.

### 4.4 El flujo de la orden (flujo core del POS)

`[HECHO — activo en AMALAY]`

```
Mesero identifica con huella → Ve sus mesas asignadas
        ↓
Abre mesa vacía → Selecciona platillos + modificadores
        ↓
Envía a cocina → Comanda impresa en estación correcta automáticamente
        ↓
[En paralelo]
KDS muestra comanda → Cocinero prepara → Marca como lista
Mesero ve notificación de que el platillo está listo
        ↓
[Si hay modificaciones]
Mesero agrega/cancela desde mesa activa → Log de auditoría automático
        ↓
Cliente pide cuenta → Mesero genera precuenta → Cliente aprueba
        ↓
Cobro: selección de método(s) de pago → Confirmación → Ticket impreso
        ↓
[Si cliente pide CFDI]
Captura RFC + email → CFDI generado y enviado → [HECHO — código, PENDIENTE — producción]
        ↓
Mesa se libera → Aparece disponible en el grid
```

---

## 5. Reglas de negocio

*Qué puede y qué no puede pasar, y por qué.*

### 5.1 Reglas de la orden

`[HECHO]` Una orden siempre pertenece a un turno activo. No puede existir orden sin turno.

`[HECHO]` Una orden cerrada no se puede reabrir para modificación. Si hay error, se genera ajuste.

`[HECHO]` Los modificadores que cambian precio son parte integral de la orden — no se pueden cambiar post-envío a cocina sin generar un registro de auditoría.

`[HECHO]` Una cancelación de ítem post-envío requiere registro de razón y queda en el log de auditoría.

`[HECHO]` Una cortesía o descuento requiere el permiso correcto del usuario que la aplica. No hay descuentos anónimos.

### 5.2 Reglas del turno

`[HECHO — ADR-TURNO-LIFECYCLE.md]` El turno es por terminal, no global. Múltiples terminales pueden tener turnos abiertos simultáneamente.

`[HECHO]` Un turno cerrado no se reabre. Si hay error, se corrige con depósito o retiro explícito.

`[HECHO]` El fondo inicial del turno es inmutable una vez registrado.

`[HECHO]` El corte de turno calcula automáticamente la diferencia entre lo que debería haber y lo que hay.

### 5.3 Reglas del cobro

`[HECHO — ADR-CONCURRENCY.md]` Un cobro se procesa exactamente una vez. La idempotencia es obligatoria.

`[HECHO]` El sistema acepta múltiples métodos de pago para una misma cuenta.

`[HECHO]` Un cobro no puede fallar silenciosamente. Si hay error, el estado de la orden se revierte al pre-cobro.

### 5.4 Reglas del inventario

`[HECHO — decisión de arquitectura documentada]` El descuento de inventario es post-procesamiento. No bloquea el cobro.

`[HECHO]` Si un ingrediente llega a cero en el sistema, la venta del platillo sigue siendo posible pero genera una alerta al gerente.

`[HECHO]` El inventario físico tiene precedencia sobre el inventario del sistema. Los conteos físicos se registran como ajustes con razón documentada.

### 5.5 Reglas de permisos

`[HECHO]` Cada acción sensible (descuento, cancelación, cortesía, retiro de caja, cierre de turno) requiere un nivel de permiso específico.

`[HECHO]` Los permisos se configuran por restaurante (multi-tenant), no son hardcodeados.

`[HECHO]` El sistema registra quién hizo cada acción con permiso, cuándo, y en qué contexto.

`[HECHO]` No hay permisos retroactivos. El sistema bloquea antes, no audita después.

### 5.6 Reglas de datos (multi-tenancy)

`[HECHO — auditado julio 20, 59 archivos]` Los datos de cada restaurante están completamente aislados a nivel de base de datos (Row Level Security en Supabase).

`[HECHO — principio de producto]` El restaurante puede exportar todos sus datos en cualquier momento en formato estándar. `[PENDIENTE]` El endpoint de exportación no está implementado todavía.

### 5.7 Reglas de facturación electrónica (CFDI)

`[HECHO — ADR-FISCAL-MODEL.md]` El modelo fiscal es genérico con `pos_tax_rules` + `pos_item_taxes` (N:M). Soporta IVA, IEPS, exento, cuota fija, y retenciones.

`[HECHO]` El CFDI se genera siempre post-cobro, nunca antes.

`[HECHO — RFC registrado: FTE260611P18]` El RFC de AMALAY está en el SAT. `[PENDIENTE]` La integración con Facturama en producción no ha sido validada a escala.

---

## 6. Estados del producto (evolución 0→1→N)

*Para el Product Vision Bible, esta sección documenta los estados de evolución del producto — no los estados técnicos de las entidades (que viven en los ADRs).*

### Estado 0: Pre-producto (completado)

`[HECHO]`

- Wansoft corriendo en AMALAY como sistema primario
- Fullsite en construcción paralela
- Event Store en shadow mode capturando datos desde 2026-06-12
- 887 días de historial de Wansoft importados a Supabase

**Salida del estado:** `[HECHO]` Event Store activo y validando. Decisión tomada: Fullsite puede reemplazar Wansoft.

### Estado 1: Cutover en AMALAY (en progreso — julio 2026)

`[HECHO — parcialmente]` RC2 desplegado con 11 commits. Smoke test en progreso.

**Objetivo del estado:** `[PENDIENTE]` Demostrar que el sistema puede operar 14 días consecutivos sin incidente que requiera volver a Wansoft.

**Bloqueantes actuales:** `[HECHO — documentados]`
- Offline boot desde bundle local (no desde URL de Vercel)
- Huella digital sin teclado físico en todas las terminales
- Facturama en producción no validado
- Smoke test físico completo pendiente

**Criterio de salida:** `[PENDIENTE]` 14 días de operación continua en AMALAY sin intervención técnica de Daniel.

> ⚠️ DISCREPANCIA: `[HECHO]` El documento se escribe durante el Estado 1. El cutover no está completamente terminado — hay bloqueantes activos. El Estado 1 no está cerrado.

### Estado 2: Replicación (primer cliente externo)

`[PENDIENTE]` Primer restaurante que no es AMALAY.

**Objetivo del estado:** Demostrar que el onboarding escala sin que Daniel esté presente en cada instalación.

**Prerrequisitos:**
- `[PENDIENTE]` Runbook de onboarding documentado y repetible
- `[PENDIENTE]` Importación automatizada desde Wansoft
- `[PENDIENTE]` Soporte remoto funcional

**Criterio de salida:** `[PENDIENTE]` 5 restaurantes activos y pagando. Ninguno requirió presencia física de Daniel después del día de instalación.

### Estado 3: Tracción (5-50 restaurantes)

`[PENDIENTE]` Suficientes restaurantes para ver patrones reales de retención y churn.

**Objetivo del estado:** Churn mensual <3%. NPS >50. Data Flywheel empieza a girar.

**Criterio de salida:** `[PENDIENTE]` YC Winter 2027. 50+ restaurantes activos.

### Estado 4: Escala (100+ restaurantes)

`[PENDIENTE]` Masa crítica para que el Data Flywheel genere valor diferencial.

**Objetivo del estado:** Fullsite es el sistema de referencia para restaurantes $1M-$3M MXN en México.

### Transiciones de estado

| Transición | Condición de entrada | Riesgo principal |
|---|---|---|
| 0 → 1 | `[HECHO]` Event Store validado en shadow mode | Rollback a Wansoft si el sistema falla en producción |
| 1 → 2 | `[PENDIENTE]` AMALAY en producción estable 30+ días | Onboarding no escalable, requiere Daniel |
| 2 → 3 | `[PENDIENTE]` 5 restaurantes pagando, churn <5% | Producto no retiene sin soporte personalizado |
| 3 → 4 | `[PENDIENTE]` YC funding + proceso de ventas repetible | Competidor copia el modelo antes de llegar a escala |

---

## 7. Source of Truth

*Para cada entidad o dato importante, dónde vive y quién manda.*

### Por entidad de negocio

| Entidad | Source of Truth | Estado | Nota |
|---|---|---|---|
| Estado de la orden | Supabase `pos_orders` | `[HECHO]` | En offline: almacenamiento local → sync cuando hay conexión |
| Menú y precios | Supabase `pos_menu_items` | `[HECHO]` | Importado desde Wansoft en el onboarding |
| Inventario en tiempo real | Supabase `inventory_stock` | `[HECHO]` | Actualizaciones post-venta asíncronas |
| Historial de ventas (post-Fullsite) | Event Store en Supabase | `[HECHO]` | Append-only, activo desde 2026-06-12 |
| Historial de ventas (pre-Fullsite) | `wansoft_daily` en Supabase | `[HECHO]` | 887 días importados |
| Permisos de usuario | Supabase `staff_permissions` | `[HECHO]` | Configurado por tenant, RLS garantiza aislamiento |
| CFDI emitidos | Facturama + Supabase `pos_invoices` | `[HECHO código, PENDIENTE producción]` | Facturama es el PAC; Supabase tiene ID y estado |
| Configuración del restaurante | Supabase `tenant_config` | `[HECHO]` | Incluye: impresoras, estaciones, horarios, reglas fiscales |

### Por sistema externo

| Sistema | Rol | Estado |
|---|---|---|
| Supabase | Backend principal | `[HECHO]` |
| Facturama | PAC para CFDI 4.0 | `[HECHO código, PENDIENTE producción]` |
| Bridge local (localhost:7717) | Impresión ESC/POS | `[HECHO]` |
| CONTPAQi | Contabilidad del cliente | `[PENDIENTE]` — exportación manual todavía |
| Rappi / Uber Eats | Delivery (integración entrante) | `[INFERENCIA]` — integración mencionada, implementación no verificada |
| Reservy | Reservaciones | `[INFERENCIA]` — integración diseñada, implementación no verificada |

---

## 8. Invariantes

*Qué nunca puede romperse bajo ninguna circunstancia. Estos son los límites que el sistema nunca cruza.*

### Invariante #1: La orden no se puede perder

`[HECHO — principio implementado]` Cada orden que se crea en el POS debe llegar a cocina y quedar registrada. No hay escenario — falla de internet, falla de la app, apagón, timeout — en el que una orden desaparezca silenciosamente.

Si la orden no puede llegar al servidor, se guarda localmente y se sincroniza cuando se restaura la conexión.

`[PENDIENTE]` El offline boot completo (arrancar la app desde bundle local sin internet) todavía no está implementado — es el bloqueante más crítico para este invariante.

### Invariante #2: El cobro no puede duplicarse

`[HECHO — implementado con idempotencia]` Una cuenta se cobra exactamente una vez. UUID por transacción. Si el mismo UUID aparece dos veces, la segunda es ignorada con log de auditoría.

### Invariante #3: El staff nunca puede quedar bloqueado por el sistema

`[HECHO — decisión de arquitectura]` Los componentes de inteligencia (agentes de IA, dashboard, alertas) son adicionales — no requieren para la operación core. Una falla del dashboard no afecta el cobro.

`[INFERENCIA]` La separación en infraestructura de los agentes respecto al POS core está diseñada pero no completamente verificada en condiciones de falla.

### Invariante #4: Los datos de un restaurante no son visibles desde otro

`[HECHO — auditado julio 20]` Row Level Security en todas las tablas operativas. El token JWT del usuario incluye el `tenant_id` que determina qué filas puede ver.

### Invariante #5: El log de auditoría es inmutable

`[HECHO — diseño]` Tabla de auditoría append-only. Sin endpoint de DELETE. Sin UI que permita borrar entradas.

`[INFERENCIA]` La inmutabilidad a nivel de base de datos (permisos RLS que bloquean DELETE en auditoría) no fue verificada explícitamente en el código.

### Invariante #6: Los datos del restaurante son del restaurante

`[HECHO — principio de producto]` El restaurante puede exportar sus datos en formatos estándar.

`[PENDIENTE]` El endpoint de exportación no está implementado. El principio existe, la implementación no.

---

## 9. Casos borde

*Escenarios no obvios que el sistema debe manejar. Cada uno con la decisión tomada.*

### 9.1 Internet se cae durante el cobro

`[HECHO — diseñado]` El POS detecta pérdida de conectividad. Cambia a modo offline. El cobro continúa con datos locales. La transacción se marca como "pendiente de sync". Al restaurarse la conexión, synca automáticamente.

`[PENDIENTE]` El "modo offline" visible al usuario (indicador de estado) no ha sido verificado que esté implementado con este comportamiento exacto.

### 9.2 La impresora falla en hora pico

`[HECHO]` El bridge de impresión detecta el fallo. `[PENDIENTE]` La alerta visible en el POS (no solo en logs) está en el diseño pero no verificada en producción. `[HECHO]` El mesero puede ver la comanda en pantalla; cocina puede ver en el KDS.

### 9.3 Dos meseros intentan tomar la misma mesa simultáneamente

`[HECHO — implementado con lock optimista]` El primero que registra la orden gana. El segundo recibe un conflicto y vuelve a cargar el estado. La mesa no puede estar asignada a dos meseros simultáneamente.

### 9.4 Un platillo se agota durante el turno

`[HECHO]` El sistema no bloquea la venta automáticamente. `[HECHO]` El cocinero puede marcar el platillo como no disponible desde el KDS. `[INFERENCIA]` La notificación al mesero de que el platillo fue marcado no disponible — implementación no verificada directamente.

### 9.5 Supabase tiene un outage

`[HECHO — diseñado]` El POS en modo offline continúa operando. El dashboard no está disponible. Los agentes no corren. El cobro básico funciona.

`[PENDIENTE — bloqueante crítico]` Al restaurarse Supabase, el sync del backlog offline depende del offline boot estando implementado. Si la terminal no arrancó durante el outage y el outage dura hasta el arranque, la app no carga.

### 9.6 Conflicto entre inventario del sistema e inventario físico

`[HECHO]` El inventario físico gana siempre. El conteo físico genera un ajuste en el sistema con razón documentada y timestamp en el log de auditoría.

El sistema nunca corrige automáticamente diferencias de inventario sin registro explícito.

### 9.7 Food cost cambia porque cambió el costo de un ingrediente

`[HECHO — diseñado]` El cambio de costo se registra en `inventory_costs`. El sistema recalcula el food cost de todos los platillos que usan ese ingrediente. `[PENDIENTE]` Si algún platillo cruza el umbral de rentabilidad configurado, genera una alerta al dueño — esta alerta en tiempo real no está implementada todavía (los agentes de food cost corren semanalmente).

### 9.8 Cliente quiere factura después de haber pagado

`[HECHO — diseñado]` Se puede generar CFDI post-pago mientras no se haya hecho el corte fiscal del período. `[PENDIENTE]` No validado en producción con Facturama real.

### 9.9 Gerente intenta abrir el día sin turno activo

`[HECHO — decisión obligatoria de turno]` El sistema bloquea cualquier orden sin turno activo. El gerente debe abrir turno con fondo de caja antes de que el primer mesero pueda operar.

### 9.10 El dueño sale de Fullsite y quiere llevarse sus datos

`[HECHO — principio]` Los datos son del restaurante. `[PENDIENTE]` No hay endpoint de exportación implementado todavía. El restaurante que quiera salir hoy tendría que pedirle a Daniel que extraiga manualmente sus datos de Supabase.

---

## 10. Limitaciones actuales

*Qué existe pero incompleto o con deuda técnica conocida. Honestidad sobre la distancia entre visión y realidad.*

### Limitación #1: Offline boot no está implementado [CRÍTICO — BLOQUEANTE]

`[HECHO — documentado en project_offline_debt.md]`

- **Visión:** La terminal funciona sin internet desde el arranque hasta el cierre.
- **Realidad:** La Electron app carga desde la URL de Vercel. Sin internet al arrancar → la app no carga.
- **Impacto:** Corte de luz + arranque de terminal en zona con mala conectividad = sistema no arranca.
- **Plan:** `[PENDIENTE]` Bundle completo de la app en el instalador de Electron antes de escalar.

### Limitación #2: Agentes de IA no integrados en tiempo real [ALTA]

`[HECHO — documentado implícitamente en la arquitectura actual]`

- **Visión:** Agentes detectan anomalías en tiempo real usando el Event Store.
- **Realidad:** Agentes corren como GitHub Actions con cron jobs. No hay integración event-driven real-time.
- **Impacto:** Alertas de fraude llegan horas después del evento, no en tiempo real.
- **Plan:** `[PENDIENTE]` Webhooks de Supabase → agentes en tiempo real, post-cutover estable.

### Limitación #3: Onboarding no automatizado [ALTA]

`[HECHO — implícito]`

- **Visión:** Onboarding <30 minutos de tiempo activo del cliente.
- **Realidad:** El onboarding de AMALAY tomó semanas. No hay runbook documentado y repetible.
- **Impacto:** No se puede escalar sin que Daniel intervenga en cada instalación.
- **Plan:** `[PENDIENTE]` Documentar el proceso de AMALAY como runbook. Validar con restaurante #2.

### Limitación #4: Huella digital sin solución completa en todas las terminales [BLOQUEANTE]

`[HECHO — documentado en project_huella_blocker.md]`

- **Visión:** Login por huella en todos los dispositivos.
- **Realidad:** Lector HID existe pero sin teclado físico en terminales, el PIN como fallback es difícil.
- **Plan:** `[PENDIENTE]` Resolver hardware antes del cutover completo.

### Limitación #5: Multi-sucursal no probado [MEDIA]

`[INFERENCIA — basado en los 59 archivos auditados para multi-tenancy]`

- **Visión:** Fullsite escala a cadenas de 3-10 sucursales.
- **Realidad:** La arquitectura multi-tenant existe. Ningún caso real de múltiples sucursales probado en producción.
- **Impacto:** No se puede vender a cadenas con honestidad todavía.
- **Plan:** `[PENDIENTE]` Validar con Grupo Galería después de tener el onboarding de sucursal única sólido.

### Limitación #6: Facturama en producción no validado [BLOQUEANTE]

`[HECHO — código construido, producción pendiente]`

- **Visión:** CFDI 4.0 completamente automatizado.
- **Realidad:** Integración construida, RFC registrado (FTE260611P18), pero no validado con facturas reales en producción.
- **Plan:** `[PENDIENTE]` Validar con primeras 10 facturas reales antes del cutover completo.

### Limitación #7: Wansoft como dependencia analítica activa [MEDIA]

`[HECHO — documentado en project_wansoft_elimination.md]`

- **Visión:** Fullsite elimina a Wansoft de la ruta crítica.
- **Realidad:** `[HECHO]` El 64% de los analytics están bloqueados cuando expira la cookie de Wansoft. El cookie relay existe (`wansoft_auth.py`) pero la validación en producción está pendiente.
- **Plan:** `[PENDIENTE]` Completar la eliminación de Wansoft del path crítico antes del cutover completo.

### Limitación #8: Exportación de datos del restaurante no implementada [BAJA]

- **Visión:** El restaurante puede llevarse sus datos en cualquier momento.
- **Realidad:** No existe endpoint de exportación. La portabilidad de datos es un principio sin implementación.
- **Plan:** `[PENDIENTE]` Implementar en Horizonte 2.

---

## 11. Roadmap

*Qué viene después y en qué orden. Este no es un roadmap de features — es un roadmap de capacidades en el orden en que tienen que existir.*

### Horizonte 0: Cutover AMALAY (agosto 2026)

Prerrequisitos que deben estar antes de cualquier otra cosa:

- `[PENDIENTE]` Offline boot: Electron carga desde bundle local, no desde URL de Vercel
- `[PENDIENTE]` Huella digital: todos los dispositivos tienen solución de identificación funcional
- `[PENDIENTE]` Facturama en producción: primeras 10 CFDI reales validadas
- `[PENDIENTE]` Impresoras: monitoreo activo con alertas en caso de fallo
- `[PENDIENTE]` Smoke test físico completo: todos los flujos del checklist RC2 pasados en AMALAY

**Criterio de salida:** 14 días de operación continua en AMALAY sin incidente que requiera intervención técnica de Daniel.

### Horizonte 1: Replicación (restaurante #2, septiembre-octubre 2026)

Capacidades requeridas para onboardear el primer restaurante externo:

- `[PENDIENTE]` Runbook de onboarding documentado y repetible
- `[PENDIENTE]` Importación automatizada desde Wansoft (sin intervención manual de Daniel)
- `[PENDIENTE]` Soporte remoto funcional: diagnosticar y resolver problemas sin estar presente físicamente
- `[PENDIENTE]` Proceso de configuración de hardware estandarizado

**Criterio de salida:** 5 restaurantes activos y pagando. Ninguno requirió presencia física de Daniel después del día de instalación.

### Horizonte 2: Inteligencia operativa en tiempo real (noviembre 2026 - enero 2027)

Capacidades que convierten Fullsite de "POS moderno" a "copiloto operativo":

- `[PENDIENTE]` Alertas de fraude en tiempo real (vs cron job diario actual)
- `[PENDIENTE]` Food cost calculado en tiempo real post-venta
- `[PENDIENTE]` Predictor de cierre integrado en el dashboard (vs agente separado)
- `[PENDIENTE]` Alertas de inventario crítico antes de que el restaurante abra

**Criterio de salida:** Al menos 3 restaurantes activos donde el dueño reporta haber tomado una decisión diferente porque Fullsite lo alertó.

### Horizonte 3: YC Winter 2027 (febrero-marzo 2027)

Capacidades requeridas para una aplicación de YC honesta:

- `[PENDIENTE]` 50+ restaurantes activos
- `[PENDIENTE]` Churn mensual <3%
- `[PENDIENTE]` NPS >50
- `[PENDIENTE]` Al menos 1 caso documentado de ROI concreto por restaurante
- `[PENDIENTE]` El referral es >40% del canal de adquisición
- `[PENDIENTE]` Onboarding completamente remoto (sin presencia física en ningún caso)

### Anti-roadmap — capacidades que explícitamente no construimos antes de Horizonte 3

| Capacidad | Por qué no ahora |
|---|---|
| `[DESCARTADO]` Módulo de nómina propio | CONTPAQi lo resuelve mejor. Integración sí, competencia no. |
| `[DESCARTADO]` App de loyalty para clientes finales | Sin masa crítica, la loyalty no tiene valor para el comensal. |
| `[DESCARTADO]` Marketplace de proveedores | Requiere 100+ restaurantes con datos de compras reales. |
| `[DESCARTADO]` Terminal de pagos propia | Proyecto de 18-24 meses. Clip/Getnet funcionan. |
| `[DESCARTADO]` Módulo de reservaciones propio | Reservy y WhatsApp lo resuelven. Integración sí. |
| `[DESCARTADO]` Multi-sucursal para cadenas >10 | El onboarding de 1 sucursal no está sólido todavía. |
| `[DESCARTADO]` BI avanzado / exportación de Excel | El dueño de Fullsite no exporta a Excel — pregunta en lenguaje natural. |

---

## 12. Referencias al código

*Archivos y funciones relevantes. Etiqueta explícita: `[HECHO]` = verificado en código; `[INFERENCIA]` = deducido del contexto.*

### POS Core

| Archivo | Qué hace | Estado |
|---|---|---|
| `dashboard-app/app/pos/` | Directorio del POS completo | `[HECHO]` |
| `dashboard-app/app/pos/components/FloorPlan.tsx` | Grid de mesas con estado visual | `[HECHO]` |
| `dashboard-app/app/pos/components/OrderPanel.tsx` | Panel de toma de orden con modificadores | `[HECHO]` |
| `dashboard-app/app/pos/components/PaymentModal.tsx` | Flujo de cobro con múltiples métodos de pago | `[HECHO]` |
| `dashboard-app/lib/pos/` | Lógica de negocio del POS (turnos, items, impresión) | `[HECHO]` |

**Nota de implementación:** `[HECHO — documentado en DECISIONS.md]` Usar `fetch()` directo para queries críticos, no el SDK de Supabase. El SDK tiene un bug conocido que causa hangs en entornos serverless de Next.js.

### Event Store e Inteligencia

| Archivo | Qué hace | Estado |
|---|---|---|
| Supabase tabla `pos_order_events` | Event store append-only de todos los eventos de orden | `[HECHO]` |
| `.github/scripts/antifraud_agent.py` | Detección de patrones de fraude (cron, no real-time) | `[HECHO]` |
| `.github/scripts/close_predictor.py` | Predictor de cierre del día (cron 3x/día) | `[HECHO]` |
| `.github/scripts/anomaly_detector.py` | Detector de anomalías vs baseline histórico | `[HECHO]` |
| Webhooks Supabase → agentes real-time | Integración event-driven de agentes | `[INFERENCIA — no implementado]` |

### Dashboard

| Archivo | Qué hace | Estado |
|---|---|---|
| `dashboard-app/app/dashboard/` | 17 páginas del dashboard | `[HECHO]` |
| `dashboard-app/app/dashboard/page.tsx` | Landing del dashboard con KPIs en tiempo real | `[HECHO]` |
| Alertas proactivas push al dueño | Notificaciones de anomalías en tiempo real | `[INFERENCIA — diseñada, implementación parcial]` |

### Multi-tenancy y Seguridad

| Archivo | Qué hace | Estado |
|---|---|---|
| Supabase RLS policies | Row Level Security por `tenant_id` | `[HECHO — auditado julio 20]` |
| `dashboard-app/lib/auth/` | Autenticación con Supabase Auth | `[HECHO]` |
| Device JWT para terminales | Token por terminal con claims de tenant | `[INFERENCIA — diseñado en P0 Tenant Isolation, no implementado]` |

### Hardware Bridge

| Archivo | Qué hace | Estado |
|---|---|---|
| Bridge de impresión `localhost:7717` | Node.js que recibe comandos HTTP → ESC/POS a impresoras | `[HECHO]` |
| Lector HID para huella digital | Integración con lector biométrico | `[HECHO — con limitaciones documentadas en Limitación #4]` |
| Cajón de efectivo RJ-11 | Control de apertura via bridge | `[HECHO]` |

### Facturación CFDI

| Archivo | Qué hace | Estado |
|---|---|---|
| Integración Facturama | Generación de CFDI 4.0 | `[HECHO — código; PENDIENTE — producción]` |
| RFC registrado: FTE260611P18 | SAT registrado, PAC configurado | `[HECHO]` |
| Flujo de CFDI post-pago en POS | Captura RFC + generación automática | `[HECHO — código; PENDIENTE — validación en producción]` |

### Agentes IA (GitHub Actions)

| Archivo | Qué hace | Estado |
|---|---|---|
| `.github/scripts/` | 13 agentes de IA corriendo como cron jobs | `[HECHO]` |
| `.github/workflows/` | 10 workflows activos (cron + on-demand) | `[HECHO]` |
| `agents/orquestador/` | Router central Telegram → tentáculo correcto | `[HECHO]` |
| `.github/scripts/intraday_sales.py` | Reporte intraday con cookie relay de Wansoft | `[HECHO]` |
| `wansoft_auth.py` | Cookie relay para Wansoft (turnstile workaround) | `[HECHO — pendiente validación en producción]` |

---

## 13. Open Questions & Future Work

*El backlog de decisiones de producto pendientes. Preguntas sin respuesta definitiva, features en debate, gaps entre visión y realidad que necesitan un plan.*

---

**[GAP]** Offline boot: Electron app no arranca sin internet
> Descripción: La Electron app carga desde la URL de Vercel. Si no hay internet al arrancar la terminal, el POS no carga. Esto viola el invariante de "el staff nunca puede quedar bloqueado por el sistema".
> Impacto: Un cutover completo no es posible sin esto. Si hay un corte de luz + falla de internet, el restaurante no puede operar cuando vuelve la energía.
> Prioridad sugerida: P0 — bloqueante para el cutover

---

**[GAP]** Integración real-time de agentes con el Event Store
> Descripción: Los agentes de IA corren como cron jobs (diario/semanal), no en respuesta a eventos en tiempo real. La promesa de "detección de fraude en tiempo real" no es la realidad actual.
> Impacto: La propuesta de valor de "copiloto en tiempo real" no está completamente entregada. Las alertas llegan horas después del evento.
> Prioridad sugerida: P1 — pre-Horizonte 2

---

**[GAP]** Exportación de datos del restaurante no implementada
> Descripción: El principio de "los datos del restaurante son del restaurante" existe en la visión pero no hay endpoint de exportación. Si un restaurante quiere salirse hoy, sus datos requieren extracción manual.
> Impacto: Riesgo de relación con clientes si piden sus datos y no pueden obtenerlos. Puede ser un bloqueante legal.
> Prioridad sugerida: P1 — pre-restaurante #2

---

**[DECISIÓN ABIERTA]** Estrategia de monetización de largo plazo
> Descripción: El precio actual es $1,999/mes SaaS puro. Toast monetiza principalmente con pagos. Parrot tiene su propia terminal. La decisión de si Fullsite eventualmente monetiza pagos o se queda en SaaS puro no está tomada.
> Impacto: Esta decisión afecta la arquitectura de la integración bancaria y el posicionamiento competitivo a mediano plazo.
> Prioridad sugerida: P2 — post-tracción, pre-YC

---

**[DUDA]** ¿Es el ICP de Fullsite solo "restaurantes con Wansoft" o incluye a los que no tienen POS?
> Descripción: La estrategia actual apunta a restaurantes que ya tienen Wansoft o un competidor similar. Pero el 90% de restaurantes mexicanos no tienen software. ¿Debería Fullsite bajar el precio para servir ese mercado o quedarse en el segmento premium?
> Impacto: La respuesta a esto cambia el pricing, el onboarding, y el canal de adquisición completamente.
> Prioridad sugerida: P2 — validar primero que el ICP actual retiene

---

**[DECISIÓN ABIERTA]** ¿Cuándo y cómo escalar a CDMX?
> Descripción: El mercado de Monterrey es el foco actual. La expansión a CDMX requiere distribución diferente (el modelo de referido de restauranteros funciona mejor en mercados donde se conocen). ¿Se expande geográficamente en Horizonte 3 o antes?
> Impacto: CDMX tiene 10x el mercado de Monterrey. Pero la operación remota en CDMX sin presencia física tiene más fricción.
> Prioridad sugerida: P2 — post-YC

---

**[GAP]** Multi-sucursal para cadenas 3-10 no probado
> Descripción: La arquitectura multi-tenant soporta múltiples sucursales. La LOI con Grupo Galería (Dunkin, Carl's Jr, BWW, iHop) implica que eventualmente tendremos que soportar 12+ ubicaciones. El producto no ha sido probado con más de 1 sucursal.
> Impacto: Perder la oportunidad de Grupo Galería si no hay evidencia de que funciona a multi-sucursal antes de que pidan demo.
> Prioridad sugerida: P1 — validar arquitectura con caso de 2 sucursales antes de la demo a Grupo Galería

---

**[DUDA]** ¿Cuándo incluir el agente de WhatsApp para clientes finales (Chef's Choice, B2B)?
> Descripción: Chef's Choice (Lalo) es una carnicería B2B que quiere un bot de WhatsApp para órdenes. Esto es adyacente al core de Fullsite pero no está en el ICP definido.
> Impacto: Es un cliente potencial con $3K/mes de revenue. Pero construir para B2B carnicería desvía foco del ICP restaurantero.
> Prioridad sugerida: P2 — solo si hay tracción suficiente en el ICP primario

---

**[DECISIÓN ABIERTA]** ¿Cómo maneja Fullsite el churn del primer cliente que se vaya?
> Descripción: No hay proceso documentado para el churn: cómo exportar los datos, cómo cerrar el tenant, cómo gestionar la relación post-salida. Ni siquiera hay un offboarding mínimo definido.
> Impacto: Si el primer restaurante que se va tiene una mala experiencia de salida, puede convertirse en un detractor activo en la comunidad de restauranteros.
> Prioridad sugerida: P1 — diseñar antes del restaurante #2

---

**[GAP]** El proceso de soporte no está definido para escalar
> Descripción: Hoy Daniel es el soporte. Eso funciona con 1 restaurante. No escala a 10.
> Impacto: La promesa de "soporte en <2 minutos" que está en el ICP-PLAYBOOK como diferenciador vs Wansoft no tiene un proceso que la sustente más allá de Daniel siendo el punto de contacto directo.
> Prioridad sugerida: P0 — definir el modelo de soporte antes del restaurante #2

---

**[DUDA]** ¿Cómo posicionamos Fullsite cuando un restaurante ya tiene Parrot o SoftRestaurant?
> Descripción: El ICP-PLAYBOOK está muy centrado en restaurantes con Wansoft. El mensaje de ventas para un restaurante que ya usa Parrot (más moderno, mejor UI) no está desarrollado con la misma profundidad.
> Impacto: Limitamos el TAM si solo podemos vender a ex-Wansoft efectivamente.
> Prioridad sugerida: P2 — validar primero con el ICP Wansoft, luego expandir el mensaje

---

## Guía de Cross-References a otras Bibles

*Este documento define la visión y los principios. La implementación detallada vive en las otras Bibles. No duplicar — referenciar.*

| Tema | Bible | Sección |
|---|---|---|
| Cómo el POS implementa los principios de visión en práctica | `FULLSITE-POS-BIBLE.md` | `§ Filosofía`, `§ Flujos principales`, `§ Offline` |
| Arquitectura técnica y decisiones de ingeniería (Transaction A/B, Offline, Event Store) | `FULLSITE-ENGINEERING-BIBLE.md` | `§ Transaction A/B`, `§ Offline`, `§ Agentes`, `§ Observabilidad` |
| Entidades del dominio restaurantero (menú, orden, turno, inventario) | `FULLSITE-DOMAIN-BIBLE.md` | Todas las secciones |
| Dashboard: 17 páginas, KPIs, alertas, experiencia del dueño | `FULLSITE-DASHBOARD-BIBLE.md` | `§ Flujos`, `§ Alertas` |
| Operación en campo: cutover, soporte, onboarding, visitas de campo | `FULLSITE-OPERATIONS-BIBLE.md` | `§ Cutover`, `§ Soporte`, `§ Product Discovery` |
| Síntesis y mapa de todas las Bibles | `FULLSITE-MASTER-BIBLE.md` | Todas las secciones |

### Principios de este documento y dónde se implementan

| Principio de visión | Dónde se implementa técnicamente | Dónde se experimenta en campo |
|---|---|---|
| Reliability > Features | `ENGINEERING-BIBLE § Observabilidad` | `OPERATIONS-BIBLE § Soporte` |
| Offline-first | `ENGINEERING-BIBLE § Offline` | `POS-BIBLE § Offline`, `OPERATIONS-BIBLE § Cutover` |
| Transaction A/B | `ENGINEERING-BIBLE § Transaction A/B` | `POS-BIBLE § Cobro` |
| Wansoft EXIT mindset | `POS-BIBLE § Análisis Wansoft vs Fullsite` | `OPERATIONS-BIBLE § Cutover` |
| Platform mindset (100 restaurantes) | `ENGINEERING-BIBLE § Multi-tenancy` | `OPERATIONS-BIBLE § Onboarding` |
| AI-native | `ENGINEERING-BIBLE § Agentes` | `DASHBOARD-BIBLE § Alertas` |
| Data Flywheel | `ENGINEERING-BIBLE § Event Store` | `DASHBOARD-BIBLE § Analytics` |

---

## Coda: El criterio de éxito que importa

`[HECHO — frase de COMPANY_BRAIN.md]` No es el número de restaurantes. No es el ARR. No es el deck de YC.

Es esto: **¿El gerente de AMALAY tomó alguna decisión diferente esta semana porque Fullsite existe?**

`[HECHO]` Si la respuesta es sí, aunque sea una sola vez, tenemos product-market fit en proceso.

`[INFERENCIA]` Si después de 30 días de operación la respuesta sigue siendo no, hay un problema de propuesta de valor que ninguna cantidad de features adicionales va a resolver.

El restaurante existe para servir comida extraordinaria a personas que la disfrutan. Fullsite existe para que el restaurante pueda hacer eso sin perder dinero en el proceso.

Todo lo demás es ruido.

---

> Última actualización: 2026-07-23
> Autor: Daniel Ramonfaur
> Próxima revisión: cuando haya evidencia operativa que justifique cambiar la visión, no antes.
>
> Regla de actualización: Este documento no se actualiza porque hay features nuevas o porque el código cambia. Se actualiza cuando cambia fundamentalmente la respuesta a "¿por qué existe Fullsite?" o cuando aparece evidencia que invalida un principio aquí escrito.
