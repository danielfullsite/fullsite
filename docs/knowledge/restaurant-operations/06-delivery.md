# 06 — Delivery

> Patrones de integración de plataformas de delivery con el POS y el KDS.  
> IDs: DL-001 a DL-005  
> Nota: DL-006 (delivery en stream KDS de Cocina) fue absorbido en CB-013 y CB-014 — ver 03-cocina-barra.md.

---

## DL-001 — Rappi/Uber como método de pago en Wansoft — fuera del KDS

```
ID:             DL-001
Nombre:         Rappi/Uber como método de pago en Wansoft — fuera del KDS
Categoría:      Delivery / Wansoft
Clasificación:  WANSOFT-ONLY
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones
```

**Problema operacional:** Los restaurantes reciben órdenes de Rappi y UberEats que deben registrarse en el sistema, pero Wansoft no tiene integración nativa con las plataformas.

**Por qué existe:** Wansoft trata Rappi/Uber como métodos de pago (equivalente a "efectivo Rappi" o "pago UberEats"), no como canales de entrada de órdenes. El operador captura manualmente la orden en Wansoft y selecciona el método de pago correspondiente.

**Cuándo aplica:** Cuando llega una orden de delivery a AMALAY. El personal de caja o mostrador abre una orden en Wansoft, la teclea manualmente, y cobra con el método de pago de la plataforma.

**Comportamiento observado:**
- KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones confirma que Rappi/Uber son métodos de pago en Wansoft, no canales separados.
- En AMALAY, esto se confirma en `wansoft_daily.pago_metodos` que incluye "Ubereats" (CLAUDE.md §pago_metodos).
- La orden de delivery no llega automáticamente al KDS de Cocina desde Wansoft — requiere captura manual o un sistema externo.
- CLAUDE.md §meseros-activos menciona que Uber/Rappi entra como "E-COMMERCE" (ver AM-006).

**Impacto operativo:** La captura manual de órdenes de delivery en Wansoft es lenta y propensa a errores de tipeo. Si hay alta demanda de delivery, puede haber colas en caja y retrasos en la cocina.

**Limitaciones conocidas:**
- No hay webhook ni integración automática en Wansoft.
- El tiempo de captura manual no está medido.

**Preguntas abiertas:** UNK-048 (¿Cuántas órdenes de UberEats/Rappi recibe AMALAY al día en promedio? ¿Cuánto tarda el capturista en ingresar una orden?).

---

## DL-002 — Fullsite: delivery integrado al KDS como canal

```
ID:             DL-002
Nombre:         Fullsite: delivery integrado al KDS como canal
Categoría:      Delivery / Fullsite
Clasificación:  SURPASS
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones
```

**Problema operacional:** Las órdenes de delivery deben llegar a la cocina de inmediato, sin captura manual, para no perder tiempo de preparación.

**Por qué existe:** Fullsite integra las órdenes de delivery directamente al flujo del KDS. La orden llega vía webhook, se inyecta en el stream de Cocina y de Barra (CB-013, CB-014), y la cocina la ve igual que una orden de mesa.

**Cuándo aplica:** Cuando una plataforma de delivery (Rappi, UberEats) envía una orden al webhook de Fullsite.

**Comportamiento observado:**
- KDS-WANSOFT-GAP-ANALYSIS.md §Estaciones confirma que Fullsite inyecta órdenes de delivery en el KDS.
- Las órdenes de delivery aparecen en Cocina y en Barra con su propio label de canal (CB-013, CB-014).
- El flujo elimina la captura manual que Wansoft requiere.

**Impacto operativo:** Reducción del tiempo desde orden en plataforma hasta inicio de preparación. Elimina errores de tipeo en captura manual. La cocina no necesita consultar un tablet separado de la plataforma.

**Limitaciones conocidas:**
- No hay documentación de cuántas plataformas están activas en AMALAY vs. cuántas soporta Fullsite.
- Si el webhook falla, la orden no llega al KDS — no hay fallback de captura manual documentado.

**Preguntas abiertas:** UNK-049 (¿Cuántas plataformas de delivery están configuradas en el webhook de AMALAY? ¿Hay fallback si el webhook falla?).

---

## DL-003 — Estados delivery: nueva→preparando→lista→en_ruta→entregada

```
ID:             DL-003
Nombre:         Estados delivery: nueva→preparando→lista→en_ruta→entregada
Categoría:      Delivery / Estados
Clasificación:  UNKNOWN
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         FULLSITE-OPERATIONS-BIBLE.md §delivery
```

**Problema operacional:** Una orden de delivery tiene un ciclo de vida más largo que una orden de mesa — incluye fases de logística que ocurren fuera del restaurante.

**Por qué existe:** El restaurante necesita saber en qué estado está cada orden de delivery para coordinar preparación, empaque, y entrega al repartidor. Las fases posteriores (en_ruta, entregada) son responsabilidad de la plataforma, no del restaurante.

**Cuándo aplica:** Para toda orden de delivery desde que entra al sistema hasta que el cliente la recibe.

**Comportamiento observado:**
- FULLSITE-OPERATIONS-BIBLE.md §delivery documenta la secuencia completa: nueva→preparando→lista→en_ruta→entregada.
- Los primeros 3 estados (nueva, preparando, lista) son manejados por Fullsite.
- Los últimos 2 estados (en_ruta, entregada) son manejados por la plataforma de delivery (DL-004).
- La transición lista→en_ruta ocurre cuando el repartidor recoge la orden.

**Impacto operativo:** Fullsite puede reportar el estado de preparación pero no tiene visibilidad del estado logístico post-restaurante sin integración adicional con la plataforma.

**Limitaciones conocidas:**
- No hay documentación de notificación al cocina/barra cuando la orden pasa a en_ruta.
- El estado "entregada" nunca regresa a Fullsite directamente.

**Preguntas abiertas:** UNK-050 (¿Fullsite recibe confirmación de entrega desde la plataforma? ¿Cierra el ciclo automáticamente o queda en "lista" indefinidamente?).

---

## DL-004 — Platform maneja en_ruta y entregada

```
ID:             DL-004
Nombre:         Platform maneja en_ruta y entregada
Categoría:      Delivery / Responsabilidades
Clasificación:  UNKNOWN
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         FULLSITE-OPERATIONS-BIBLE.md §delivery
```

**Problema operacional:** Una vez que el repartidor toma la orden, el restaurante pierde control del proceso. La plataforma (Rappi/UberEats) toma la responsabilidad del estado logístico.

**Por qué existe:** La división de responsabilidades es la norma en delivery de terceros: el restaurante es responsable hasta "lista para recoger", y la plataforma es responsable desde "repartidor asignado".

**Cuándo aplica:** Cuando la orden alcanza el estado "lista" en el KDS de Fullsite y el repartidor aparece en el restaurante.

**Comportamiento observado:**
- FULLSITE-OPERATIONS-BIBLE.md §delivery documenta explícitamente que "en_ruta" y "entregada" son manejados por la plataforma.
- Fullsite no recibe actualizaciones de estado post-entrega en la arquitectura documentada.

**Impacto operativo:**
- El gerente de AMALAY no puede ver desde Fullsite si una orden fue entregada correctamente.
- En caso de queja del cliente, el gerente debe consultar la app de la plataforma, no el POS.

**Limitaciones conocidas:** Sin integración bidireccional con Rappi/UberEats, no hay visibilidad completa del ciclo de vida en un solo sistema.

**Preguntas abiertas:** UNK-051 (¿Existe roadmap en Fullsite para recibir estados post-restaurante de las plataformas? ¿Requeriría cuenta de partner con Rappi/UberEats?).

---

## DL-005 — Webhook como canal de entrada de órdenes

```
ID:             DL-005
Nombre:         Webhook como canal de entrada de órdenes
Categoría:      Delivery / Arquitectura
Clasificación:  UNKNOWN
Estado ficha:   DOCUMENTED
Evidencia:      INFERRED
Fuente:         FULLSITE-OPERATIONS-BIBLE.md §delivery (el mecanismo de inyección al KDS
                implica un canal de entrada; webhook inferido como el más probable)
```

**Problema operacional:** Las plataformas de delivery (Rappi, UberEats) necesitan notificar al restaurante en tiempo real cuando llega una nueva orden.

**Por qué existe:** El webhook es el mecanismo estándar de integración push en estas plataformas — la plataforma hace un POST al endpoint del restaurante cuando se confirma una orden, sin necesidad de polling.

**Cuándo aplica:** Cuando una orden es confirmada en la plataforma y el restaurante tiene un endpoint registrado.

**Comportamiento observado:**
- FULLSITE-OPERATIONS-BIBLE.md §delivery describe que las órdenes "entran" al KDS.
- El mecanismo de entrada es inferido como webhook (push) dado que CB-013/CB-014 documentan inyección directa al stream del KDS.
- No hay documentación explícita del endpoint, autenticación, o validación del webhook en Fullsite.

**Impacto operativo:** Sin webhook registrado o si el endpoint no está disponible, las órdenes de la plataforma no llegan al KDS.

**Limitaciones conocidas:**
- Evidencia INFERRED — no hay código o documentación explícita del endpoint de webhook.
- No se sabe si hay validación de autenticidad (HMAC signature) en los webhooks entrantes.

**Preguntas abiertas:** UNK-052 (¿Cuál es el endpoint exacto del webhook de delivery en Fullsite? ¿Tiene validación de firma HMAC? ¿Está documentado en la API?).
