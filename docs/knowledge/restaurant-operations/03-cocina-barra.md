# 03 — Cocina y Barra

> Dominio: KDS, routing de órdenes, estados, alertas, delivery en estaciones, reimpresión  
> Patrones: CB-001 a CB-020  
> Fuente principal: `docs/certifications/KDS-WANSOFT-GAP-ANALYSIS.md` (2026-07-31)  
> Referencias cruzadas: → PR-001 (bridge), → DL-001 (delivery), → EC-005 (cancelaciones en KDS)
>
> **Nota de evidencia (corrección Lote 3):** Todos los patrones CB-001 a CB-020 derivados de KDS-WANSOFT-GAP-ANALYSIS.md tienen nivel de evidencia DOCUMENTED — el gap analysis es un documento de análisis, no código fuente directamente. Solo serían CODE VERIFIED si la fuente citara file:line del código. Los patrones que mencionan nombres de función específicos (resolveItemStation, useBridgeClient, reprintByStation) lo hacen a través del gap analysis, no de lectura directa del código.

---

## CB-001 — KDS polling 2s + push events del bridge

```
ID:                CB-001
Nombre:            KDS polling 2s + push events del bridge
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Operación-continua (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Operación-continua documenta:
- Fullsite: 2s poll (Cocina/Barra), 1.5s poll (KDS), + push events del bridge `ORDER_SENT`, `ORDER_UPSERTED`, `KDS_ITEM_STATUS`
- Wansoft: poll SQL Server cada 15s

El gap analysis cierra G-06 (2026-07-31): Barra ahora tiene `useBridgeClient` con los mismos push events que Cocina.

**Problema operacional:**  
Con polling de 15s (Wansoft), una orden enviada puede tardar hasta 15 segundos en aparecer en la pantalla de cocina. En hora pico, esto genera retrasos visibles en el servicio y el cocinero no sabe qué preparar.

**Por qué existe:**  
Wansoft está limitado por su arquitectura: SQL Server local como única fuente de verdad, sin mecanismo de eventos. El bridge de Fullsite opera en la misma LAN del restaurante y puede emitir eventos casi inmediatamente.

**Cuándo aplica:**  
Cada vez que el mesero envía una orden desde el POS. El push event llega a Cocina/Barra en milisegundos (LAN). El poll de 2s es el fallback si el evento no llega.

**Comportamiento observado:**  
- Latencia típica = evento inmediato (push) + poll cada 2s como confirmación
- Durante outage de Supabase: el bridge LAN sigue emitiendo eventos (Barra usa `useBridgeClient` — CLOSED G-06)
- Wansoft: no tiene push events — solo polling

**Impacto operativo:**  
Cocina recibe órdenes casi en tiempo real. En un turno de 200 tickets, la diferencia entre 15s y 2s (×13s) puede ser visible en los tiempos de preparación.

**Limitaciones conocidas:**  
Los push events del bridge dependen de que el bridge esté corriendo. El bridge no tiene autostart (NSSM pendiente — ver → PR-010).

**Preguntas abiertas:**  
- ¿Qué pasa si el bridge cae y se reinicia? ¿Los eventos perdidos durante la caída se recuperan con el poll siguiente?

---

## CB-002 — Routing por estación: resolveItemStation()

```
ID:                CB-002
Nombre:            Routing por estación: resolveItemStation()
Categoría:         Cocina y Barra
Clasificación:     MATCH
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Routing (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Routing:
- Fullsite: `resolveItemStation()` — campo `station` del ítem o heurística por nombre
- Wansoft: `ImpresoraGrupo` en BD — cada grupo de platillo mapea a impresora/estación vía SP
- Veredicto: "Match funcional"

**Problema operacional:**  
Sin routing correcto, un café puede llegar a la pantalla de cocina caliente en vez de a la barra — la cocina no sabe qué hacer con él y la barra no lo ve.

**Por qué existe:**  
Los restaurantes tienen estaciones físicas especializadas (fríos, caliente, barra). Cada ítem del menú debe ir a la estación que puede prepararlo.

**Cuándo aplica:**  
En cada envío de orden al KDS. El routing ocurre antes de que la orden llegue a la pantalla de la estación.

**Comportamiento observado:**  
- Fullsite: heurística por nombre de ítem (keywords) + campo explícito `station` si está definido
- Wansoft: mapeo en BD via `ImpresoraGrupo` — más granular, configurable por operador
- Ambos logran el mismo resultado funcional en la configuración actual de AMALAY

**Impacto operativo:**  
Un ítem mal ruteado no llega a la estación correcta. En AMALAY no se han reportado errores de routing — la heurística de keywords funciona para el menú actual.

**Limitaciones conocidas:**  
El routing en Fullsite depende de que los nombres de ítems sigan la convención de keywords. Si se agrega un ítem con nombre ambiguo o en otro idioma, el routing puede fallar silenciosamente.

**Preguntas abiertas:**  
- → Ver CB-003 (routing configurable) y → UNK-019

---

## CB-003 — Routing Wansoft: ImpresoraGrupo configurable desde admin

```
ID:                CB-003
Nombre:            Routing Wansoft: ImpresoraGrupo configurable desde admin sin deploy
Categoría:         Cocina y Barra
Clasificación:     WANSOFT-ONLY
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Routing — GAP G-01 (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Routing documenta gap G-01 (P2):
- "Sin UI de configuración de routing por platillo — requiere deploy para reasignar"
- Wansoft: "Config por operador desde admin UI — reasignar un platillo sin deploy"

**Problema operacional:**  
Cuando AMALAY agrega un nuevo platillo al menú, alguien de Fullsite debe modificar el código o la BD para que el ítem llegue a la estación correcta. Wansoft lo hace el dueño del restaurante desde la UI de administración.

**Por qué existe:**  
Wansoft invierte 20+ años en su UI de configuración. Fullsite priorizó la funcionalidad base sobre la configurabilidad granular en las primeras versiones.

**Cuándo aplica:**  
Cuando se agrega o renombra un ítem del menú que necesita ser ruteado a una estación específica.

**Comportamiento observado:**  
Este gap está registrado como G-01 (P2) — no bloqueante para el primer cliente, pero relevante para el segundo cliente en adelante.

**Impacto operativo:**  
Cada cambio de menú que afecte routing requiere intervención técnica de Fullsite. Para AMALAY, con un menú estable, esto no ha sido problema. Para un cliente nuevo con rotación de menú frecuente, puede ser un cuello de botella.

**Limitaciones conocidas:**  
Sin UI de configuración de routing hasta que se implemente la tabla `pos_station_routing` mencionada en el gap analysis.

**Preguntas abiertas:**  
- ¿Está `pos_station_routing` en el roadmap activo? → Ver → UNK-019

---

## CB-004 — Estados KDS: enviada → preparando → lista → entregada

```
ID:                CB-004
Nombre:            Estados KDS: enviada → preparando → lista → entregada
Categoría:         Cocina y Barra
Clasificación:     MATCH
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Estados (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Estados:
- Fullsite: 4 estados (`enviada → preparando → lista → entregada`)
- Wansoft: 4 estados (`Abierta → Comandada → Impresa → Cobrada`)
- Veredicto: "Match"

**Problema operacional:**  
Sin estados claros, la cocina no sabe en qué punto está cada orden — si ya empezó a prepararse, si está lista para ser recogida, o si ya salió a la mesa.

**Por qué existe:**  
Los 4 estados mapean el ciclo de vida de una orden desde que entra a cocina hasta que llega al cliente. Los nombres difieren entre sistemas pero la semántica es equivalente.

**Cuándo aplica:**  
Desde que el mesero envía la orden hasta que el runner la entrega a la mesa.

**Comportamiento observado:**  
- `enviada`: orden recibida en KDS, pendiente de inicio
- `preparando`: cocinero inició la preparación
- `lista`: platillo listo en la ventana de entrega
- `entregada`: runner llevó el platillo a la mesa

En Wansoft: la transición de estados está ligada a eventos específicos del sistema (impresión de comanda = "Impresa"). En Fullsite: el cocinero avanza los estados manualmente desde la pantalla KDS.

**Impacto operativo:**  
El estado `lista` es crítico para operaciones con runner — el runner necesita saber cuándo recoger sin preguntarle al cocinero.

**Limitaciones conocidas:**  
El estado `entregada` en Fullsite requiere que el mesero o runner lo marque manualmente. No hay sensor ni confirmación automática.

**Preguntas abiertas:**  
- ¿Fullsite mide el tiempo entre `lista` y `entregada` (tiempo de espera del platillo en ventana)?

---

## CB-005 — Forward-only: no retrocede estado en KDS

```
ID:                CB-005
Nombre:            Forward-only: no retrocede estado en KDS
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Estados — "Fullsite supera (más explícito)" (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Estados:
- Fullsite: "In-memory rank comparison antes de avanzar"
- Wansoft: "Enforced via SP en SQL Server"
- Veredicto: "Fullsite supera (más explícito)"

**Problema operacional:**  
Si un cocinero puede retroceder el estado de "lista" a "preparando", la pantalla del runner muestra que el platillo no está listo cuando sí lo está — generando confusión y tiempo muerto.

**Por qué existe:**  
El ciclo de vida de un platillo es unidireccional en la realidad: no se "decocina" un platillo. El guard previene errores de tap accidental en la pantalla táctil.

**Cuándo aplica:**  
En cualquier intento de avanzar un estado que no sea la transición siguiente esperada.

**Comportamiento observado:**  
Fullsite implementa la validación en memoria (comparación de rank de estados). Wansoft lo hace via Stored Procedure en SQL Server. El resultado operacional es idéntico: no se puede retroceder.

La diferencia que el gap analysis califica como "más explícito": Fullsite valida antes de enviar a la BD, con mensaje de error visible. Wansoft rechaza en BD — el error puede ser silencioso para el usuario.

**Impacto operativo:**  
Bajo en operación normal — el cocinero no intenta retroceder estados. Alto en caso de error de tap: sin el guard, un tap accidental revertiría el estado y el runner esperaría indefinidamente.

**Limitaciones conocidas:**  
Sin evidencia de casos de borde: ¿qué pasa si dos cocineros avanzan el mismo ítem simultáneamente?

**Preguntas abiertas:**  
- ¿El guard aplica también a nivel de ítem (CB-006) o solo a nivel de orden?

---

## CB-006 — Tracking por ítem en Cocina: click individual

```
ID:                CB-006
Nombre:            Tracking por ítem en Cocina: click individual por ítem
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Estados (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Estados:
- Fullsite Cocina: "click por ítem → `preparando`/`listo` en localStorage; auto-avanza la orden al completar todos los ítems"
- Wansoft: "No observado"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
Sin tracking por ítem, cuando una orden tiene 3 platillos, el cocinero solo puede marcar la orden completa como lista — aunque dos platillos estén listos y uno lleve 10 minutos más. Esto retrasa el servicio de los platillos que ya están listos.

**Por qué existe:**  
Las órdenes de múltiples platillos tienen tiempos de preparación distintos (una ensalada es rápida, un filete tarda). El tracking por ítem permite al cocinero coordinar mejor la entrega.

**Cuándo aplica:**  
En Cocina, cuando una orden tiene más de un ítem con tiempos de preparación distintos.

**Comportamiento observado:**  
- El cocinero hace click en cada ítem individualmente para marcarlo como preparando/listo
- El estado de la orden avanza automáticamente a "lista" cuando todos sus ítems están marcados como listos
- El estado de cada ítem se guarda en localStorage (no en Supabase) — es local a la pantalla de Cocina

**Impacto operativo:**  
Mejora la coordinación en cocinas con múltiples cocineros. El runner puede recoger ítems listos parcialmente en lugar de esperar a que toda la orden esté completa (si el restaurante opera así).

**Limitaciones conocidas:**  
El estado de ítem está en localStorage — si se recarga la pantalla de Cocina, el estado de ítems individuales se pierde (la orden vuelve a estado de orden completa).

**Preguntas abiertas:**  
- ¿Cuándo se limpia el localStorage de estados de ítem? ¿Al archivar la orden? ¿Al cerrar el día?

---

## CB-007 — Barra: tracking solo a nivel de orden (gap G-03)

```
ID:                CB-007
Nombre:            Barra: tracking solo a nivel de orden — sin tracking por ítem
Categoría:         Cocina y Barra
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Estados — GAP G-03 (P3) (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Estados documenta gap G-03 (P3):
- "Barra: solo advance a nivel de orden. Sin tracking individual de ítems."
- Acción sugerida: "Llevar el patrón item-click de Cocina a Barra"

**Problema operacional:**  
Cuando una orden de barra tiene varios ítems (ej. café americano + jugo de naranja + smoothie), el barista solo puede marcar la orden completa — no puede indicar que el café está listo mientras termina el smoothie.

**Por qué existe:**  
El gap G-03 está clasificado P3 (no bloqueante). La implementación en Barra es más simple que en Cocina — se priorizó funcionalidad base sobre granularidad.

**Cuándo aplica:**  
En barra, órdenes con múltiples ítems de distintos tiempos de preparación.

**Comportamiento observado:**  
El barista usa el botón de avance a nivel de orden completa. No hay click individual por ítem.

**Clasificación UNKNOWN:**  
No se puede clasificar como SURPASS (Fullsite no supera a Wansoft aquí) ni como MATCH (Wansoft tampoco tiene tracking por ítem documentado). Es un gap interno de Fullsite entre Cocina y Barra.

**Impacto operativo:**  
Bajo en barras con pocos ítems por orden. Aumenta si las órdenes de barra son complejas (múltiples bebidas con tiempos distintos).

**Limitaciones conocidas:**  
Sin plan de implementación activo — es P3.

**Preguntas abiertas:**  
- ¿Las órdenes de barra en AMALAY típicamente tienen más de 2 ítems?

---

## CB-008 — Auto-archive de órdenes > 4h

```
ID:                CB-008
Nombre:            Auto-archive de órdenes > 4h en ambas superficies
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación — "Fullsite supera" (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación:
- Fullsite: "Ambas superficies auto-archivan >4h"
- Wansoft: "N/A"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
Sin auto-archive, las pantallas de KDS acumulan órdenes antiguas que ya fueron servidas. En un turno de 8 horas, la pantalla se llena de órdenes completadas que dificultan ver las nuevas.

**Por qué existe:**  
Mantener la pantalla de KDS limpia y enfocada en órdenes activas. Las órdenes > 4h con alta probabilidad están completadas o son del día anterior.

**Cuándo aplica:**  
Continuamente. El archive es automático — no requiere acción del cocinero.

**Comportamiento observado:**  
Órdenes con más de 4 horas desde su creación se archivan automáticamente y desaparecen del KDS. Pueden consultarse en el historial.

**Impacto operativo:**  
Pantalla de KDS siempre legible. Sin acumulación de "basura visual". El umbral de 4h es un balance: suficientemente largo para cubrir un turno, suficientemente corto para no acumular.

**Limitaciones conocidas:**  
El umbral de 4h está hardcodeado — no es configurable por el operador. Para restaurantes que operan turnos de más de 4h continuas (ej. madrugada), esto podría archivar prematuramente.

**Preguntas abiertas:**  
- ¿El umbral de 4h es configurable? Si no, ¿debería ser igual al umbral del turno?

---

## CB-009 — Alerta de audio en Cocina: 880+1100Hz

```
ID:                CB-009
Nombre:            Alerta de audio en Cocina: 880+1100Hz al recibir órdenes nuevas
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Alertas — "Fullsite supera" (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Alertas:
- Fullsite Cocina: "880+1100Hz al recibir órdenes nuevas"
- Wansoft: "N/A"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
En cocinas ruidosas (ventiladores, extractor, música), el cocinero no siempre ve la pantalla KDS cuando llega una orden nueva. Sin alerta sonora, las órdenes pueden pasar desapercibidas.

**Por qué existe:**  
La cocina es un ambiente de alta actividad donde el cocinero no está mirando la pantalla constantemente. La alerta sonora es el mecanismo de atención primario.

**Cuándo aplica:**  
Cada vez que llega una orden nueva a la pantalla de Cocina.

**Comportamiento observado:**  
El sistema emite 880Hz + 1100Hz (dos tonos distintos) al recibir una nueva orden. La frecuencia de 880Hz es aguda y penetrante — audible sobre el ruido de fondo típico de cocina.

**Impacto operativo:**  
Reduce el tiempo entre la llegada de la orden y el inicio de preparación. En hora pico, cada segundo cuenta.

**Limitaciones conocidas:**  
Si el dispositivo tiene el volumen bajo o está en silencio, la alerta no suena. Sin mecanismo de fallback visual adicional documentado.

**Preguntas abiertas:**  
- ¿Se puede configurar el volumen de la alerta desde la UI? ¿O solo desde el volumen del dispositivo?

---

## CB-010 — Alerta de audio en Barra: 660Hz

```
ID:                CB-010
Nombre:            Alerta de audio en Barra: 660Hz
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Alertas — "Fullsite supera" (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Alertas:
- Fullsite Barra: "660Hz"
- Wansoft: "N/A"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
Mismo que CB-009 pero para la estación de barra. El barista necesita saber cuándo llega una orden de bebidas.

**Por qué existe:**  
La diferencia de frecuencia (660Hz en Barra vs 880+1100Hz en Cocina) permite distinguir audiblemente a cuál estación llegó una orden — útil si el cocinero y el barista están cerca.

**Cuándo aplica:**  
Cada vez que llega una orden nueva a la pantalla de Barra.

**Comportamiento observado:**  
660Hz es un tono más grave que el de Cocina. En ambientes de barra (música de fondo), un tono grave es más perceptible que uno agudo.

**Impacto operativo:**  
Mismos que CB-009 aplicados a barra.

**Limitaciones conocidas:**  
Sin mecanismo de configuración de frecuencia por el operador.

**Preguntas abiertas:**  
- ¿La elección de frecuencias fue calibrada para los ambientes reales de AMALAY o es un valor estándar?

---

## CB-011 — Umbral de urgencia en Cocina: configurable

```
ID:                CB-011
Nombre:            Umbral urgencia Cocina: configurable desde Settings modal (localStorage)
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Alertas (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Alertas:
- Fullsite Cocina: "configurable desde Settings modal (localStorage, default 10 min)"
- Wansoft: "N/A"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
Sin umbral de urgencia configurable, el indicador de "orden urgente" (ícono de llama + minutos) aparece con el mismo umbral para cualquier tipo de restaurante. Un restaurante de comida rápida considera urgente a los 5 minutos; uno de fine dining a los 20 minutos.

**Por qué existe:**  
Los estándares de tiempo de preparación varían por tipo de restaurante y por tipo de platillo. El gerente debe poder ajustar el umbral al comportamiento de su cocina.

**Cuándo aplica:**  
En la configuración de la pantalla de Cocina. El valor default es 10 minutos — para AMALAY este valor funciona correctamente (sin evidencia de ajuste).

**Comportamiento observado:**  
El gerente accede al Settings modal desde la pantalla de Cocina, cambia el umbral, y el nuevo valor se guarda en localStorage. La siguiente vez que cargue la pantalla, usa el valor guardado.

**Impacto operativo:**  
Si el umbral está mal calibrado, el indicador de llama pierde utilidad — el cocinero lo ignora porque siempre aparece o nunca aparece.

**Limitaciones conocidas:**  
El valor está en localStorage — si se borra el cache del navegador, vuelve al default de 10 min. No está sincronizado entre múltiples pantallas de Cocina.

**Preguntas abiertas:**  
- Si AMALAY tiene 2 pantallas de Cocina, ¿tienen el mismo umbral? ¿O cada una puede tener un valor distinto?

---

## CB-012 — Umbral de urgencia en Barra: hardcoded (gap G-05)

```
ID:                CB-012
Nombre:            Umbral urgencia Barra: hardcoded 10 min — gap G-05
Categoría:         Cocina y Barra
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Alertas — GAP G-05 / KDS-GAP-04 (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Alertas:
- "Barra: hardcoded 10 min"
- Registrado como GAP G-05 (P3) = KDS-GAP-04

**Problema operacional:**  
El umbral de 10 minutos en Barra puede ser incorrecto para el ritmo real de preparación de bebidas (típicamente más rápido que cocina caliente). El indicador de urgencia puede dispararse en órdenes que están a tiempo para el barista.

**Por qué existe:**  
Mismo que CB-011 (la Barra no recibió la misma implementación configurable que Cocina).

**Cuándo aplica:**  
Siempre que una orden lleva más de 10 minutos en la pantalla de Barra.

**Clasificación UNKNOWN:**  
No hay suficiente evidencia para saber si 10 minutos es correcto o incorrecto para AMALAY específicamente. Es un gap documentado (P3) pero su impacto real no está medido.

**Impacto operativo:**  
Si el barista normalmente completa bebidas en 3-5 min, el indicador de 10 min casi nunca aparece — lo que puede ser correcto (pocos urgentes) o incorrecto (el sistema no alerta sobre verdaderos problemas).

**Limitaciones conocidas:**  
Hardcodeado — sin configuración para el operador hasta que se corrija gap G-05.

**Preguntas abiertas:**  
- ¿Cuál es el tiempo promedio de preparación de una orden de Barra en AMALAY? → Ver → UNK-026

---

## CB-013 — Delivery orders en Cocina KDS

```
ID:                CB-013
Nombre:            Delivery orders en Cocina KDS: delivery_orders inyectadas en el stream
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones:
- Fullsite Cocina: "fetches `delivery_orders` e inyecta en el stream de KDS"
- Wansoft: "No integrado — Uber/Rappi como método de pago, no entra al KDS"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
En Wansoft, cuando llega un pedido de Rappi/Uber, cocina no lo ve en la pantalla KDS — el gerente tiene que tomarlo del tablet de la plataforma y comunicarlo verbalmente. Sin integración, las órdenes de delivery compiten con las de mesa por atención verbal.

**Por qué existe:**  
La integración en Fullsite unifica el flujo: independientemente de si la orden viene del POS (mesa) o de Rappi/Uber, la cocina la ve en el mismo lugar y con el mismo formato.

**Cuándo aplica:**  
Cuando llega una orden de delivery (Rappi o Uber Eats) durante el turno.

**Comportamiento observado:**  
Las `delivery_orders` se inyectan en el stream de KDS — aparecen en la pantalla de Cocina mezcladas con las órdenes de mesa. Están visualmente distinguidas por su origen (delivery vs. mesa).

**Impacto operativo:**  
La cocina procesa todas las órdenes desde una sola pantalla. Reduce errores de comunicación verbal. Permite medir tiempos de preparación de delivery igual que de mesa.

**Limitaciones conocidas:**  
El flujo de delivery depende del webhook entrante de la plataforma. Si el webhook falla, la orden no llega al KDS — sin mecanismo de fallback documentado.

**Preguntas abiertas:**  
- ¿Qué pasa si el webhook de Rappi falla? ¿Hay retry?

---

## CB-014 — Delivery orders en Barra KDS (CLOSED G-02)

```
ID:                CB-014
Nombre:            Delivery orders en Barra KDS — implementado 2026-07-31
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones — CLOSED G-02 (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones:
- "Barra ahora fetches `delivery_orders` igual que Cocina — inyecta en el stream de KDS — CLOSED G-02"
- Implementado en `barra/page.tsx` (2026-07-31)

**Problema operacional:**  
Mismo que CB-013 para la estación de Barra. Antes del 2026-07-31, las órdenes de delivery no llegaban a la pantalla de Barra — el barista no sabía que había bebidas de delivery pendientes.

**Por qué existe:**  
El gap G-02 fue cerrado al implementar el mismo fetch de `delivery_orders` que ya tenía Cocina.

**Cuándo aplica:**  
En órdenes de delivery que incluyen bebidas (ítems ruteados a Barra).

**Comportamiento observado:**  
Barra ahora es funcionalmente idéntica a Cocina en el manejo de delivery (según el gap analysis, 2026-07-31).

**Impacto operativo:**  
Las órdenes de delivery con bebidas ahora aparecen en Barra automáticamente.

**Limitaciones conocidas:**  
Sin evidencia de prueba de campo post-implementación. El gap analysis confirma la implementación en código — verificación física pendiente.

**Preguntas abiertas:**  
- ¿Se ha probado en campo que las órdenes de delivery de bebidas llegan a la pantalla de Barra?

---

## CB-015 — Reimpresión desde KDS: reprintByStation()

```
ID:                CB-015
Nombre:            Reimpresión desde KDS: botón "Reimprimir" con reprintByStation()
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Impresión — "Fullsite supera" (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Impresión:
- Fullsite: "Botón 'Reimprimir' en Cocina y Barra → `reprintByStation()`"
- Wansoft: "No observado"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
Si la impresora de cocina no imprimió la comanda (sin papel, apagada, papel atorado), el cocinero necesita volver a imprimirla sin tener que pedirle al cajero que reenvíe la orden.

**Por qué existe:**  
La impresión de comanda es la forma tradicional en que cocina recibe órdenes (antes del KDS digital). Incluso con KDS, muchos restaurantes también imprimen la comanda como backup físico.

**Cuándo aplica:**  
Cuando el cocinero necesita una copia impresa de la orden — ya sea porque la impresora falló en el print inicial o porque necesita una copia adicional.

**Comportamiento observado:**  
El botón "Reimprimir" está disponible en la pantalla de Cocina y Barra. Al hacer click, se llama `reprintByStation()` que envía la comanda al bridge para imprimir.

**Impacto operativo:**  
El cocinero tiene autonomía para reimprimir sin depender del cajero. Reduce la carga operacional del cajero en momentos de alta demanda.

**Limitaciones conocidas:**  
`reprintByStation()` no tiene retry queue — ver → CB-016.

**Preguntas abiertas:**  
- ¿Hay logs de cuántas reimpresiones ocurren por turno? ¿Es un indicador de problemas con la impresora?

---

## CB-016 — reprintByStation sin retry — fallo silencioso (gap G-04)

```
ID:                CB-016
Nombre:            reprintByStation sin retry queue — fallo es silencioso
Categoría:         Cocina y Barra
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Impresión — GAP G-04 (P3) (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Impresión:
- "`reprintByStation` (botón KDS) no tiene retry queue. Un fallo es silencioso."
- "Print inicial sí tiene retry."
- GAP G-04 (P3)

**Problema operacional:**  
El cocinero presiona "Reimprimir", la impresora falla (sin papel, desconectada), y no aparece ningún mensaje de error. El cocinero asume que se imprimió. La comanda nunca llega en papel.

**Por qué existe:**  
El retry queue del print inicial (→ PR-005) no fue extendido al flujo de reimpresión — probablemente por prioridad de desarrollo.

**Cuándo aplica:**  
Cuando el cocinero usa el botón "Reimprimir" y la impresora está fuera de línea.

**Comportamiento observado:**  
El botón de reimprimir llama `reprintByStation()` directamente. Si el bridge no responde o la impresora falla, la función no tiene mecanismo de retry ni notificación de fallo al usuario.

**Clasificación UNKNOWN:**  
Wansoft tampoco tiene reimpresión desde KDS documentada ("no observado"). No se puede clasificar como SURPASS/MATCH respecto a Wansoft — es un gap interno de Fullsite.

**Impacto operativo:**  
Bajo en condiciones normales (el print inicial sí tiene retry). Alto si el cocinero confía en la reimpresión como mecanismo principal de recepción de órdenes.

**Limitaciones conocidas:**  
GAP G-04 registrado como P3 — sin fix planificado activo.

**Preguntas abiertas:**  
- ¿Con qué frecuencia usan el botón de reimprimir en AMALAY?

---

## CB-017 — Tab panadería en Cocina — filtro sub-categoría

```
ID:                CB-017
Nombre:            Tab panadería en Cocina: filtro de sub-categoría
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones — "Fullsite supera" (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones:
- Fullsite: "Cocina tiene tab de panadería"
- Wansoft: "No observado"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
En AMALAY, la sección de panadería (pasteles, croissants, panes) tiene tiempos y procesos distintos al resto de la cocina caliente. Sin filtro, la pantalla de cocina mezcla órdenes de platillos calientes con órdenes de panadería — confunde a qué estación le corresponde qué.

**Por qué existe:**  
AMALAY tiene una sección de panadería diferenciada dentro de su operación. El tab de panadería permite a la persona a cargo de esa sección ver solo sus órdenes.

**Cuándo aplica:**  
Específico de AMALAY. Puede no ser relevante para restaurantes sin sección de panadería.

**Comportamiento observado:**  
La pantalla de Cocina tiene un tab que filtra y muestra solo los ítems de la categoría "BAKERY" (según las categorías de menú de AMALAY).

**Impacto operativo:**  
La panadería ve solo sus órdenes. No hay contaminación visual de órdenes de otras secciones.

**Limitaciones conocidas:**  
La categoría "BAKERY" está hardcodeada para el tab — si AMALAY renombra la categoría, el filtro dejaría de funcionar. No hay configuración de qué categorías van al tab de panadería.

**Preguntas abiertas:**  
- ¿El tab de panadería es configurable por cliente o está hardcodeado para AMALAY?

---

## CB-018 — KDS no notifica al mesero en cancelación de ítem

```
ID:                CB-018
Nombre:            KDS no notifica al mesero cuando se cancela un ítem
Categoría:         Cocina y Barra
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            BREAK-THE-RESTAURANT.md §Trust-Issue-5 (2026-07-04)
```

**Evidencia:**  
BREAK-THE-RESTAURANT.md §Trust-Issue-5 documenta: el KDS no envía notificación al mesero cuando un ítem es cancelado desde cocina.

**Problema operacional:**  
Si el cocinero cancela un ítem (sin ingrediente, error del mesero), el mesero no sabe que ese platillo no va a salir. El mesero espera indefinidamente o le dice al cliente "ya viene" cuando el platillo fue cancelado.

**Por qué existe:**  
No está implementado el canal de comunicación en la dirección Cocina → Mesero para eventos de cancelación. La comunicación actual es unidireccional: POS → KDS.

**Cuándo aplica:**  
Cuando cocina cancela un ítem de una orden activa.

**Comportamiento observado:**  
La cancelación se registra en el sistema pero no hay notificación al dispositivo del mesero ni en la pantalla del POS.

**Clasificación UNKNOWN:**  
No se sabe si Wansoft tiene esta funcionalidad — BREAK-THE-RESTAURANT.md no hace la comparación.

**Impacto operativo:**  
Alto en términos de experiencia del cliente — el cliente espera un platillo que no va a llegar. El mesero queda mal sin saberlo.

**Limitaciones conocidas:**  
La comunicación KDS → POS no está documentada en ninguna fuente como implementada.

**Preguntas abiertas:**  
- ¿Tiene Wansoft notificación al mesero por cancelación de ítem desde cocina?
- → Ver → UNK-027

---

## CB-019 — Sidebar de conteo por platillo en Cocina

```
ID:                CB-019
Nombre:            Sidebar de conteo por platillo en Cocina: ordenado por demanda
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Alertas — "Fullsite supera" (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Alertas:
- Fullsite Cocina: "sidebar con conteo por platillo ordenado por demanda"
- Wansoft: "N/A"
- Veredicto: "Fullsite supera"

**Problema operacional:**  
El chef o jefe de cocina necesita saber cuántas unidades de cada platillo tienen pendientes para planificar la producción. Sin este resumen, tiene que contar manualmente mirando todas las tarjetas del KDS.

**Por qué existe:**  
Vista de producción agregada: en vez de ver 30 tarjetas individuales, el cocinero ve "12 chilaquiles rojos, 8 huevos benedictinos, 5 smoothies" — puede anticipar qué necesita preparar en batch.

**Cuándo aplica:**  
En momentos de alta demanda (hora pico). Útil para producción anticipada.

**Comportamiento observado:**  
Un sidebar en la pantalla de Cocina muestra cada platillo con su conteo de unidades pendientes, ordenado de mayor a menor demanda. Se actualiza en tiempo real con cada orden nueva.

**Impacto operativo:**  
Permite al chef identificar inmediatamente cuál es el cuello de botella. Si hay 12 chilaquiles pendientes y solo pueden prepararse 4 a la vez, puede comunicar a los meseros que hay demora.

**Limitaciones conocidas:**  
El sidebar no diferencia entre ítems "enviada" (pendiente de inicio) vs "preparando" (en proceso) — mezcla todos los pendientes.

**Preguntas abiertas:**  
- ¿El conteo incluye solo los ítems no completados, o también los que están en "preparando"?

---

## CB-020 — Barra: push events via useBridgeClient (CLOSED G-06)

```
ID:                CB-020
Nombre:            Barra: push events via useBridgeClient — CLOSED G-06
Categoría:         Cocina y Barra
Clasificación:     SURPASS
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación y §Operación-continua (2026-07-31)
```

**Evidencia:**  
KDS-WANSOFT-GAP-ANALYSIS.md §Operación-continua:
- "Barra tiene `useBridgeClient` — push events `ORDER_SENT`, `ORDER_UPSERTED`, `KDS_ITEM_STATUS`"
- "Latencia = evento inmediato + poll cada 2s"
- CLOSED G-06, implementado en `barra/page.tsx` (2026-07-31)

KDS-WANSOFT-GAP-ANALYSIS.md §Recuperación:
- "Barra ahora tiene `useBridgeClient` — recibe push events durante outage de Supabase"
- CLOSED G-06

**Problema operacional:**  
Antes de CLOSED G-06, Barra solo tenía polling. Durante un outage de Supabase, Barra perdía la sincronización — no recibía órdenes nuevas aunque el bridge LAN siguiera funcionando.

**Por qué existe:**  
El bridge opera en la LAN del restaurante independientemente de Supabase. Al agregar `useBridgeClient` a Barra, la estación recibe eventos via LAN incluso sin internet — igual que Cocina.

**Cuándo aplica:**  
En toda operación normal (reduce latencia) y especialmente durante outages de Supabase (mantiene operación).

**Comportamiento observado:**  
Barra ahora es funcionalmente equivalente a Cocina en resiliencia: tiene poll cada 2s + push events del bridge. Durante outage de Supabase, ambas superficies siguen recibiendo órdenes.

**Impacto operativo:**  
La barra ya no es el eslabón más frágil de la cadena de KDS. Antes de este fix, un outage de Supabase detenía la barra — la cocina seguía recibiendo pero la barra no.

**Limitaciones conocidas:**  
Depende de que el bridge esté corriendo. El bridge no tiene autostart (NSSM pendiente — → PR-010).

**Preguntas abiertas:**  
- ¿Se ha probado en campo que Barra recibe órdenes durante un outage simulado de Supabase?
