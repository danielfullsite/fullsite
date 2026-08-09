# 04 — Inventario y Compras

> Dominio: Control de stock, recetas, cardex, compras sugeridas, transferencias, subproductos, variación de costos  
> Patrones: IN-001 a IN-010  
> Fuentes primarias:  
> - `FULLSITE DOCS/15-AMALAY/wansoft/DATA-MODEL.md` — 822 SPs, 23 dominios  
> - `agents/wansoft/wansoft_recetas.json` — recetas AMALAY en Wansoft  
> - `agents/wansoft/wansoft_existencias.json` — existencias AMALAY  
> - `agents/wansoft/wansoft_compras_sugeridas.json` — compras sugeridas  
> - `agents/wansoft/wansoft_cardex_summary.json` — cardex de movimientos  
> - `agents/wansoft/wansoft_transferencias.json` — transferencias entre almacenes  
> - `agents/wansoft/wansoft_subproductos.json` — subproductos  
> - `agents/wansoft/wansoft_variacion_costos.json` — variación de costos  
> - `docs/archive/bibles/FULLSITE-OPERATIONS-BIBLE.md` — reglas de inventario Fullsite  
>
> **Sobre las fuentes JSON de este archivo:**
>
> | Archivo | Tipo de dato | Scope | Contexto de extracción |
> |---|---|---|---|
> | `wansoft_recetas.json` | Catálogo de recetas | AMALAY-específico | Exportación via scraper, fecha exacta no registrada |
> | `wansoft_existencias.json` | Snapshot de existencias | AMALAY-específico, punto en el tiempo | No representa estado continuo |
> | `wansoft_existencias_detalle.json` | Detalle de existencias por almacén | AMALAY-específico, snapshot | — |
> | `wansoft_compras_sugeridas.json` | Reporte generado por el sistema | AMALAY-específico | Calculado a partir del ROP configurado |
> | `wansoft_reorder_points.json` | Configuración de puntos de reorden | AMALAY-específico | Configuración, no transacciones |
> | `wansoft_cardex_summary.json` | Resumen de movimientos | AMALAY-específico | Agregado, no el detalle transaccional completo |
> | `wansoft_transferencias.json` | Registro de transferencias | AMALAY-específico | Transaccional |
> | `wansoft_subproductos.json` | Catálogo de subproductos | AMALAY-específico | Configuración/catálogo |
> | `wansoft_produccion_plantillas.json` | Plantillas de producción | AMALAY-específico | Configuración |
> | `wansoft_variacion_costos.json` | Reporte de variación | AMALAY-específico | Reporte generado, punto en el tiempo |
> | `wansoft_costo_vs_venta.json` | Relación costo-venta por platillo | AMALAY-específico | Calculado |
> | `wansoft_costos.json` | Costos por ingrediente/receta | AMALAY-específico | Puede estar stale — ver CONTRA-002 |
>
> **Advertencia:** Ningún dato de estos JSON debe generalizarse como comportamiento universal de Wansoft o de cualquier restaurante. Son datos de AMALAY en un momento específico. Los recuentos (ej. cantidad de recetas, de almacenes) son atribuidos a la exportación y deben verificarse independientemente antes de citarse como hechos.
>
> Referencias cruzadas: → CJ-001 (IVA en costos), → MS-001 (PIN staff), → EC-004 (sync silencioso)

---

## IN-001 — Stock no bloquea venta — operación continúa con stock negativo

```
ID:                IN-001
Nombre:            Stock no bloquea venta — operación continúa con stock negativo
Categoría:         Inventario y Compras
Clasificación:     MATCH
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md §reglas-inventario; WANSOFT-BIBLE.md §confiabilidad-operativa
```

**Evidencia:**  
FULLSITE-OPERATIONS-BIBLE.md documenta como regla explícita: el stock no bloquea la venta. Si un ingrediente llega a cero, el sistema permite seguir vendiendo el platillo — el stock pasa a negativo.

WANSOFT-BIBLE.md §confiabilidad-operativa confirma el mismo comportamiento en Wansoft: "stock sin bloqueo" listado entre los 4 ítems de confiabilidad operativa.

**Problema operacional:**  
Si el sistema bloqueara la venta al llegar a stock cero, el mesero no podría tomar la orden — aunque físicamente sí haya ingrediente (el sistema puede estar desactualizado). El restaurante perdería la venta.

**Por qué existe:**  
Dos razones:
1. Los sistemas de inventario en restaurantes tienen latencia — la BD puede mostrar 0 cuando físicamente aún hay 2 porciones.
2. El cocinero conoce el stock real mejor que el sistema. Un bloqueo automático le quitaría autonomía.

**Cuándo aplica:**  
Siempre. No hay switch para activar bloqueo por stock en ninguno de los dos sistemas.

**Comportamiento observado:**  
En Wansoft: el sistema permite la venta y registra stock negativo. El gerente revisa el cardex para identificar inconsistencias.  
En Fullsite: misma regla documentada en FULLSITE-OPERATIONS-BIBLE.md.

**Impacto operativo:**  
Stock negativo en el cardex es una señal de que: (a) el inventario inicial estaba mal, (b) hubo un movimiento sin registrar, o (c) las recetas tienen el factor de rendimiento incorrecto.

**Limitaciones conocidas:**  
Sin alertas automáticas al gerente cuando el stock de un ingrediente llega a cero o negativo durante el turno. La revisión es post-hecho.

**Preguntas abiertas:**  
- ¿Cuándo fue la última vez que AMALAY tuvo stock negativo? ¿Se revisó la causa?
- → Ver → UNK-028

---

## IN-002 — Recetas como fuente de verdad para costo de platillo

```
ID:                IN-002
Nombre:            Recetas como fuente de verdad para costo de platillo
Categoría:         Inventario y Compras
Clasificación:     MATCH
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md §recetas; agents/wansoft/wansoft_recetas.json
```

**Evidencia:**  
`agents/wansoft/wansoft_recetas.json` contiene las recetas exportadas de Wansoft-AMALAY. Cada receta tiene: nombre del platillo, ingredientes, cantidades, unidad de medida, y costo unitario calculado.

FULLSITE-OPERATIONS-BIBLE.md documenta que `pos_recipes` (equivalente en Fullsite) es la fuente de verdad para costos.

**Problema operacional:**  
Sin recetas formalizadas, el costo de un platillo es una estimación. Cuando el proveedor cambia el precio de un ingrediente, no hay forma automática de recalcular el costo de todos los platillos que lo usan.

**Por qué existe:**  
Control de food cost: el dueño necesita saber si cada platillo es rentable. La receta vincula ingrediente → platillo → costo → margen.

**Cuándo aplica:**  
Cuando cambia el precio de un ingrediente (actualizar en el sistema recalcula todos los costos). Cuando se agrega un platillo nuevo al menú.

**Comportamiento observado:**  
En Wansoft: 574 recetas documentadas para AMALAY (dato de `wansoft_recetas.json` — este número es el de las recetas en el sistema). Cada receta lista los ingredientes con cantidades exactas.  
En Fullsite: `pos_recipes` con estructura equivalente. La fuente activa para AMALAY es una exportación de Excel (`pos_recipes` en BD).

**Impacto operativo:**  
Si las recetas están mal (cantidades incorrectas, rendimiento sin aplicar), el costo calculado es incorrecto — el dueño toma decisiones de precio sobre datos falsos.

**Limitaciones conocidas:**  
Contradicción entre fuentes detectada: FULLSITE-OPERATIONS-BIBLE.md menciona que `wansoft_food_cost` está stale mientras `pos_recipes` es la fuente activa. Esto implica que el costo en Wansoft y en Fullsite pueden diferir. Ver → CONTRA-002.

**Preguntas abiertas:**  
- ¿Están sincronizadas las recetas de `wansoft_recetas.json` con `pos_recipes` en Fullsite?
- → Ver → UNK-029

---

## IN-003 — Factor de rendimiento (yield) por ingrediente

```
ID:                IN-003
Nombre:            Factor de rendimiento (yield) por ingrediente
Categoría:         Inventario y Compras
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            FULLSITE DOCS/15-AMALAY/wansoft/DATA-MODEL.md §inventario
```

**Evidencia:**  
FULLSITE DOCS/15-AMALAY/wansoft/DATA-MODEL.md documenta el dominio de inventario en Wansoft con campo de factor de rendimiento por ingrediente. El factor de rendimiento ajusta la cantidad real usada vs. la cantidad comprada (ej: 1 kg de jitomate tiene 80% de rendimiento tras limpieza → 800g efectivos).

**Problema operacional:**  
Sin factor de rendimiento, el costo calculado de un platillo no incluye las mermas del proceso. 1 kg de jitomate comprado a $30 tiene costo efectivo de $37.5/kg una vez aplicada la merma del 20%.

**Por qué existe:**  
La merma es una realidad de la cocina industrial: limpieza, cocción, evaporación. Un sistema sin yield produce costos subestimados — el margen real es menor al calculado.

**Cuándo aplica:**  
En el cálculo de costo de recetas. El yield se aplica a cada ingrediente al determinar cuánto se necesita comprar para producir una cantidad dada del platillo.

**Comportamiento observado:**  
Wansoft tiene el campo — verificado en DATA-MODEL.md. No hay evidencia de si AMALAY tiene los yields correctamente configurados en sus 574 recetas.  
En Fullsite: sin evidencia explícita de implementación del campo yield en `pos_recipes`.

**Clasificación UNKNOWN:**  
No hay evidencia suficiente de si el yield está correctamente implementado y configurado en AMALAY en ninguno de los dos sistemas.

**Impacto operativo:**  
Si los yields no están configurados, los costos están subestimados. En AMALAY, con costo real documentado en ~27.6% (→ IN-010), la diferencia por yields incorrectos puede ser de 2-5 puntos porcentuales.

**Limitaciones conocidas:**  
No hay datos de cuántos de los 574 ingredientes en Wansoft tienen yield configurado vs. yield = 100% (sin merma).

**Preguntas abiertas:**  
- ¿Cuántos ingredientes de AMALAY tienen yield < 100% en Wansoft?
- ¿Fullsite implementa el campo yield en pos_recipes?
- → Ver → UNK-030

---

## IN-004 — Recetas y almacenes en AMALAY (Wansoft)

```
ID:                IN-004
Nombre:            Recetas y almacenes en AMALAY (Wansoft): conteo atribuido a exportación
Categoría:         Inventario y Compras
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED / UNVERIFIED COUNT
Fuente:            agents/wansoft/wansoft_recetas.json (recuento sin verificación independiente);
                   agents/wansoft/wansoft_existencias_detalle.json (múltiples almacenes observados)
Método de verificación pendiente: contar filas en wansoft_recetas.json + wansoft_existencias_detalle.json;
                   contrastar con el sistema Wansoft en AMALAY via TeamViewer o acceso directo → UNK-031
```

**Evidencia atribuida (no verificada independientemente):**  
- `wansoft_recetas.json`: exportación de recetas de Wansoft-AMALAY. La cifra de 574 recetas proviene de la memoria del proyecto y documentación interna — no ha sido reproducida contando filas del archivo en este KB. No usar como cifra exacta sin verificación.
- `wansoft_existencias_detalle.json`: contiene existencias desglosadas. Se observan múltiples almacenes; el número 6 es atribuido a documentación interna y memoria del proyecto. Puede incluir almacenes inactivos o de prueba.

**Aclaración sobre el tipo de dato:**  
- Las recetas pueden incluir sub-preparaciones, bases y salsas — no es 1:1 con platillos del menú
- Los almacenes pueden incluir almacenes históricos o inactivos que aparecen en el sistema
- Ambos números son de AMALAY en Wansoft, en el momento de la extracción — no representan un estándar de la industria

**Nota importante:**  
El número 574 es el recuento de recetas en la exportación del sistema Wansoft — no necesariamente equivale a 574 platillos únicos del menú. Wansoft puede tener recetas para sub-preparaciones, bases, salsas, y presentaciones distintas del mismo platillo.

**Problema operacional:**  
Con 574 recetas y 6 almacenes, la gestión manual de inventario es impracticable. El sistema debe calcular automáticamente qué se consume, qué se transfiere entre almacenes, y qué se debe comprar.

**Por qué existe:**  
AMALAY es un restaurante con operación compleja: múltiples secciones (cocina caliente, panadería, barra, mercado). Cada sección puede tener su propio almacén con productos distintos.

**Cuándo aplica:**  
En el cierre diario cuando el sistema descuenta del inventario lo vendido según las recetas. En la apertura cuando se hace el conteo físico de inventario.

**Comportamiento observado:**  
En Wansoft: cada almacén tiene sus propias existencias. Las ventas descuentan automáticamente los ingredientes del almacén correspondiente según la receta. Las transferencias entre almacenes se registran explícitamente.  
En Fullsite: estructura de datos para inventario existe, pero el nivel de operación comparado con los 6 almacenes de Wansoft no está documentado.

**Clasificación UNKNOWN:**  
El dato de 574 recetas y 6 almacenes es de Wansoft-AMALAY. No hay datos equivalentes confirmados para Fullsite.

**Impacto operativo:**  
Una receta incorrecta en un almacén equivocado → el descuento ocurre en el lugar incorrecto → el inventario de un almacén queda negativo mientras el otro tiene exceso.

**Limitaciones conocidas:**  
No hay evidencia de si Fullsite implementa multi-almacén (6 almacenes) o usa un almacén único.

**Preguntas abiertas:**  
- ¿Fullsite implementa múltiples almacenes equivalentes a los 6 de Wansoft-AMALAY?
- → Ver → UNK-031

---

## IN-005 — Cardex: movimientos de inventario con fecha y motivo

```
ID:                IN-005
Nombre:            Cardex: movimientos de inventario con fecha, motivo y responsable
Categoría:         Inventario y Compras
Clasificación:     MATCH
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            agents/wansoft/wansoft_cardex_summary.json
```

**Evidencia:**  
`agents/wansoft/wansoft_cardex_summary.json` contiene el resumen del cardex exportado de Wansoft-AMALAY. El cardex registra cada movimiento de inventario: entrada (compra), salida (venta/consumo), transferencia, ajuste, y merma — con fecha, cantidad, y motivo.

**Problema operacional:**  
Sin cardex, el gerente no puede saber cuándo ni por qué el inventario de un ingrediente llegó a un nivel crítico. No puede distinguir entre ventas legítimas, merma, robo, o error de captura.

**Por qué existe:**  
El cardex es el registro histórico del inventario — equivalente al estado de cuenta bancario para el dinero. Permite auditar cada movimiento y rastrear discrepancias.

**Cuándo aplica:**  
Continuamente. Cada transacción que afecta el inventario genera un movimiento en el cardex.

**Comportamiento observado:**  
En Wansoft: el cardex registra: tipo de movimiento (entrada/salida/transferencia/ajuste), fecha, hora, cantidad, unidad, almacén, costo unitario al momento del movimiento, y el usuario que lo registró.

El resumen en `wansoft_cardex_summary.json` muestra el estado consolidado — el detalle de cada movimiento está en el sistema Wansoft.

**Impacto operativo:**  
Con el cardex, el dueño puede identificar: (a) mermas no registradas (discrepancia entre salidas por venta y conteo físico), (b) ingredientes con consumo anormal, (c) tendencias de costo por ingrediente.

**Limitaciones conocidas:**  
El cardex de Wansoft está en el sistema local (SQL Server). El acceso para análisis requiere exportación manual o acceso al servidor. Fullsite tiene acceso via los JSON exportados — pero estos son snapshots, no datos en tiempo real.

**Preguntas abiertas:**  
- ¿Fullsite tiene un equivalente al cardex integrado en el dashboard?
- → Ver → UNK-032

---

## IN-006 — Compras sugeridas: punto de reorden calculado automáticamente

```
ID:                IN-006
Nombre:            Compras sugeridas: punto de reorden calculado automáticamente
Categoría:         Inventario y Compras
Clasificación:     MATCH
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            agents/wansoft/wansoft_compras_sugeridas.json; agents/wansoft/wansoft_reorder_points.json
```

**Evidencia:**  
`agents/wansoft/wansoft_compras_sugeridas.json` contiene las compras sugeridas por el sistema Wansoft-AMALAY. El sistema calcula cuándo y cuánto pedir de cada ingrediente basado en el punto de reorden.

`agents/wansoft/wansoft_reorder_points.json` contiene los puntos de reorden configurados por ingrediente.

**Problema operacional:**  
Sin compras sugeridas automáticas, el gerente decide manualmente qué comprar basándose en su experiencia. Puede olvidar un ingrediente crítico o sobrecomprar uno de baja rotación — generando desabasto o desperdicio.

**Por qué existe:**  
El punto de reorden (ROP) es el nivel de stock donde se debe hacer la siguiente orden de compra para que el ingrediente llegue antes de agotarse. Con 574 ingredientes, el cálculo manual es imposible.

**Cuándo aplica:**  
Al final del día o al inicio del siguiente turno, el gerente revisa las compras sugeridas y hace los pedidos a proveedores.

**Comportamiento observado:**  
En Wansoft: cuando el stock de un ingrediente llega al punto de reorden, aparece en la lista de "compras sugeridas" con la cantidad recomendada. El gerente puede ajustar la cantidad antes de generar la orden de compra.

El punto de reorden en `wansoft_reorder_points.json` es configurable por ingrediente — no es calculado dinámicamente sino establecido manualmente por el gerente.

**Impacto operativo:**  
Si el punto de reorden está mal calibrado: muy alto → sobrestock, capital inmovilizado, desperdicio. Muy bajo → desabasto, platillos no disponibles.

**Limitaciones conocidas:**  
El punto de reorden en Wansoft es estático — no considera estacionalidad, días de la semana con mayor demanda, o tendencias de consumo. Un restaurante con demanda variable puede tener ROPs desactualizados.

**Preguntas abiertas:**  
- ¿AMALAY tiene los puntos de reorden correctamente calibrados? ¿Con qué frecuencia los revisan?
- ¿Fullsite usa los datos de ventas históricas para sugerir puntos de reorden dinámicos?
- → Ver → UNK-033

---

## IN-007 — Transferencias entre almacenes con autorización

```
ID:                IN-007
Nombre:            Transferencias entre almacenes con autorización
Categoría:         Inventario y Compras
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            agents/wansoft/wansoft_transferencias.json
```

**Evidencia:**  
`agents/wansoft/wansoft_transferencias.json` contiene el registro de transferencias entre almacenes en Wansoft-AMALAY. Las transferencias mueven inventario de un almacén a otro sin registrarse como compra ni como venta.

**Problema operacional:**  
En un restaurante con múltiples almacenes, es común que el almacén de cocina caliente pida azúcar al almacén de panadería. Sin registro formal, esta transferencia no aparece en el cardex y el inventario queda descuadrado.

**Por qué existe:**  
Las transferencias son un movimiento interno — no generan costo adicional (el ingrediente ya fue comprado) pero sí afectan el inventario de cada almacén. El registro permite saber dónde está cada ingrediente en todo momento.

**Cuándo aplica:**  
Cuando una estación necesita ingredientes de otra estación, en lugar de hacer una compra externa.

**Comportamiento observado:**  
En Wansoft: las transferencias requieren autorización (no está documentado el nivel de autorización — puede ser el gerente o cualquier empleado con acceso). El sistema registra: almacén origen, almacén destino, ingrediente, cantidad, fecha, y usuario que autorizó.

El contenido de `wansoft_transferencias.json` muestra el historial de transferencias — volumen y frecuencia no documentados en esta ficha.

**Clasificación UNKNOWN:**  
No hay evidencia de si Fullsite implementa transferencias entre almacenes (si Fullsite tiene multi-almacén).

**Impacto operativo:**  
Sin registro de transferencias, el inventario del almacén origen aparece correcto pero el del almacén destino está inflado — el conteo físico no cuadra con el sistema.

**Limitaciones conocidas:**  
La frecuencia de transferencias en AMALAY no está cuantificada en las fuentes disponibles.

**Preguntas abiertas:**  
- ¿Con qué frecuencia ocurren transferencias entre almacenes en AMALAY?
- ¿Fullsite tiene módulo de transferencias entre almacenes?
- → Ver → UNK-034

---

## IN-008 — Subproductos: producción genera inventario

```
ID:                IN-008
Nombre:            Subproductos: resultados de producción que generan nuevo inventario
Categoría:         Inventario y Compras
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            agents/wansoft/wansoft_subproductos.json; agents/wansoft/wansoft_produccion_plantillas.json
```

**Evidencia:**  
`agents/wansoft/wansoft_subproductos.json` y `wansoft_produccion_plantillas.json` documentan el módulo de producción de Wansoft. Un subproducto es un resultado de un proceso de producción que genera inventario utilizable (ej: hacer masa para croissants produce un lote que se convierte en un ingrediente del inventario de panadería).

**Problema operacional:**  
En AMALAY con panadería propia, la producción interna genera ingredientes (masa, bases, salsas). Sin registro de subproductos, el inventario no refleja lo producido internamente — solo lo comprado.

**Por qué existe:**  
Los restaurantes con producción interna (panadería, charcutería, salsas caseras) tienen dos tipos de inventario: (a) comprado a proveedor, (b) producido internamente. Ambos se consumen en recetas — el sistema debe rastrear ambos.

**Cuándo aplica:**  
Cuando la cocina hace producción por lotes: preparar 20 litros de mole, hornear 30 croissants, hacer bases de pizza.

**Comportamiento observado:**  
En Wansoft: un proceso de producción consume ingredientes (entrada) y genera subproductos (salida que va al inventario). La plantilla de producción define qué entra y qué sale.

El módulo de producción de AMALAY en Wansoft está documentado en `wansoft_produccion_plantillas.json` — el contenido específico no está detallado en esta ficha.

**Clasificación UNKNOWN:**  
No hay evidencia de si Fullsite implementa módulo de producción/subproductos.

**Impacto operativo:**  
Sin módulo de producción, la panadería de AMALAY no puede rastrear sus costos de producción interna — el food cost calculado es incompleto.

**Limitaciones conocidas:**  
La panadería de AMALAY depende de producción interna diaria. Sin este módulo, el inventario de ingredientes de panadería está systemáticamente incorrecto.

**Preguntas abiertas:**  
- ¿Tiene Fullsite módulo de producción equivalente al de subproductos de Wansoft?
- ¿Cuántas plantillas de producción tiene AMALAY activas en Wansoft?
- → Ver → UNK-035

---

## IN-009 — Variación de costos: real vs. costo teórico

```
ID:                IN-009
Nombre:            Variación de costos: consumo real vs. costo teórico por ventas
Categoría:         Inventario y Compras
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            agents/wansoft/wansoft_variacion_costos.json; agents/wansoft/wansoft_costo_vs_venta.json
```

**Evidencia:**  
`agents/wansoft/wansoft_variacion_costos.json` documenta el reporte de variación de costos de Wansoft-AMALAY. Compara el consumo teórico (calculado a partir de ventas × receta) con el consumo real (calculado a partir de conteos de inventario).

`agents/wansoft/wansoft_costo_vs_venta.json` documenta la relación costo-venta por platillo.

**Problema operacional:**  
La diferencia entre consumo teórico y real revela: merma no registrada, porciones incorrectas, robo de ingredientes, o recetas desactualizadas. Sin esta comparación, el gerente no sabe si el food cost alto se debe a precios de proveedor o a problemas operativos internos.

**Por qué existe:**  
El reporte de variación de costos es el principal instrumento de control de calidad del inventario. Una variación alta indica que algo está mal — el gerente investiga qué.

**Cuándo aplica:**  
Típicamente semanal o mensual. Requiere conteo físico de inventario para comparar contra el teórico.

**Comportamiento observado:**  
En Wansoft: el sistema calcula el consumo teórico automáticamente (ventas del período × cantidad de ingrediente por receta). El gerente ingresa el conteo físico, y el sistema calcula la variación por ingrediente y por platillo.

La variación puede ser positiva (se consumió más de lo esperado) o negativa (se consumió menos — puede indicar que platillos no se vendieron o que las porciones son menores a la receta).

**Clasificación UNKNOWN:**  
No hay evidencia de si Fullsite implementa el reporte de variación de costos.

**Impacto operativo:**  
Sin variación de costos, el gerente no puede distinguir entre food cost alto por precios de proveedores vs. por merma interna. Ambos tienen soluciones distintas.

**Limitaciones conocidas:**  
El reporte de variación requiere conteos físicos periódicos — disciplina operacional, no solo tecnología. Si AMALAY no hace conteos regulares, el reporte pierde utilidad.

**Preguntas abiertas:**  
- ¿Con qué frecuencia hace AMALAY el conteo físico de inventario?
- ¿Qué ingredientes muestran mayor variación en el sistema Wansoft de AMALAY?
- → Ver → UNK-036

---

## IN-010 — Costo real AMALAY ~27.6% (pos_recipes)

```
ID:                IN-010
Nombre:            Costo real AMALAY ~27.6% — fuente pos_recipes (Excel)
Categoría:         Inventario y Compras
Clasificación:     UNKNOWN
Estado ficha:      DOCUMENTED
Evidencia:         DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md §food-cost (documenta pos_recipes como fuente activa)
```

**Evidencia:**  
FULLSITE-OPERATIONS-BIBLE.md §food-cost documenta:
- Costo real AMALAY: ~27.6%
- Fuente: `pos_recipes` (exportación de Excel, cargada en la BD de Fullsite)
- `wansoft_food_cost` está stale — no debe usarse como referencia activa

**Nota sobre inferencia:**  
El ~27.6% proviene de documentación interna del proyecto (FULLSITE-OPERATIONS-BIBLE.md). No está verificado por conteo físico independiente — es el cálculo del sistema basado en las recetas cargadas.

**Problema operacional:**  
Sin conocer el food cost real, el dueño no puede establecer precios correctos ni identificar platillos que venden pero no generan margen.

**Por qué existe:**  
El food cost promedio del 27.6% es el punto de referencia para comparar platillos individuales. Un platillo con food cost de 40% es una "vaca" que drena margen — candidato a rediseño de receta o aumento de precio.

**Cuándo aplica:**  
En decisiones de pricing. En la revisión mensual de rentabilidad por platillo.

**Comportamiento observado:**  
El 27.6% es un promedio — los platillos individuales varían significativamente. La categoría BAKERY puede tener food cost < 15%; un platillo proteico puede superar el 35%.

La fuente activa es `pos_recipes` (Excel → BD de Fullsite). `wansoft_food_cost` es stale — puede no reflejar los precios actuales de ingredientes.

**Clasificación UNKNOWN:**  
Se clasifica UNKNOWN porque:
1. El 27.6% no está verificado por auditoría física independiente
2. No queda claro si el dato incluye yields correctos (→ IN-003)
3. La diferencia entre `pos_recipes` y `wansoft_food_cost` no está cuantificada

**Impacto operativo:**  
Si el food cost real es 32% (no 27.6%), los precios actuales de AMALAY pueden estar generando menos margen del esperado. Una diferencia de 5 puntos porcentuales en food cost en un restaurante con $100K MXN/mes en ventas = $5K MXN/mes de margen no capturado.

**Limitaciones conocidas:**  
Contradicción entre `pos_recipes` y `wansoft_food_cost` no resuelta. Ver → CONTRA-002.

**Preguntas abiertas:**  
- ¿Cuándo fue la última vez que se actualizaron los precios de ingredientes en `pos_recipes`?
- ¿Se ha hecho una auditoría física para validar el 27.6%?
- → Ver → UNK-037

---

## Contradicción detectada en este archivo

**CONTRA-002**: `pos_recipes` (Fullsite) y `wansoft_food_cost` (Wansoft) coexisten como fuentes de costo para AMALAY. FULLSITE-OPERATIONS-BIBLE.md establece que `wansoft_food_cost` está stale y `pos_recipes` es la fuente activa — pero no documenta cuánto difieren ambas ni por qué divergieron. Hasta que se cuantifique la diferencia, el food cost del 27.6% debe tratarse como aproximación, no como hecho verificado.

Fuente A: FULLSITE-OPERATIONS-BIBLE.md §food-cost  
Fuente B: agents/wansoft/wansoft_costos.json (costos en sistema Wansoft)  
Resuelve con: comparación directa de costo por platillo entre `pos_recipes` y `wansoft_costos.json` + auditoría física.
