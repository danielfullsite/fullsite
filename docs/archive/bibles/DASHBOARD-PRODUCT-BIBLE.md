# Dashboard Product Bible

> Extracción sistemática de conocimiento para el Dashboard de Fullsite.
> Fuente primaria: `docs/strategy/WANSOFT-BIBLE.md` (211 pantallas del portal, análisis módulo x módulo).
> Fuente secundaria: `docs/reference/wansoft/BACKOFFICE-KNOWLEDGE.md`, operación real de AMALAY.
>
> Este documento NO es un inventario de pantallas.
> Define qué problema resuelve cada módulo del dashboard, para quién, con qué frecuencia,
> y cómo la arquitectura de Fullsite puede superarlo — aprovechando datos en tiempo real e IA.
>
> Filosofía central: el Dashboard no es una colección de reportes.
> Es el lugar donde el dueño administra todo el negocio sin necesitar ir al restaurante.
>
> Compañero: `POS-PRODUCT-BIBLE.md` — filosofía del POS.
> Compañero: `CONFIGURABILITY-BIBLE.md` — todo lo que el cliente configura.
>
> Fecha: 2026-07-25

---

## Convenciones

**Usuario principal:**
- **Dueño** — visión de negocio, rentabilidad, tendencias. Usa desde casa o en movimiento.
- **Gerente** — supervisión operativa, decisiones en tiempo real, dentro del restaurante.
- **Contador** — exportaciones, P&L, egresos, facturación. Acceso limitado y específico.
- **Staff** — no usa el dashboard. Solo el POS.

**Frecuencia:** Universal / Común / Situacional / Raro (ver POS Bible para definiciones).

**Veredicto:**
- **Fullsite Mejor** — resolvemos el problema de forma superior
- **Equivalente** — solución comparable
- **Gap** — Wansoft lo resuelve y Fullsite no, o lo resuelve peor
- **Territorio propio** — Fullsite tiene esto y Wansoft no

**Principio de dashboard:** una regla que guía la decisión de diseño. Se consolidan al final.

---

## Los 3 problemas que el Dashboard NO debe tener

**Problema 1 — El dashboard de reportes.**
Un dashboard que obliga al usuario a navegar a 12 secciones distintas para encontrar el dato que necesita es un catálogo de pantallas, no un sistema de gestión. El dueño abre el dashboard queriendo saber "¿cómo estoy?" — y debería salir de la pantalla de inicio con esa respuesta.

**Problema 2 — La información que llega tarde.**
Wansoft: el dueño necesita esperar la sincronización, abrir el portal, navegar 4 clicks, y exportar Excel. Para entonces el turno ya terminó. El dashboard de Fullsite debe mostrar el dato en el momento en que ocurre el evento, no horas después.

**Problema 3 — El dashboard que solo informa.**
Un reporte dice qué pasó. Un sistema de gestión dice qué pasa, por qué, y qué hacer. El dashboard de Fullsite debe pasar de "te muestro el número" a "te digo qué significa y qué puedes hacer con él ahora."

---

## 01 ESCRITORIO (HOME)

> El home del dashboard es la primera respuesta a la pregunta "¿cómo estoy?" El dueño no debe tener que entrar a ninguna otra sección para entender el estado general del negocio.

---

#### 01.1 KPIs en tiempo real

**Quién lo usa:** Dueño, Gerente | **Frecuencia:** Universal

**Qué problema resuelve:** El dueño que quiere saber "¿cuánto llevamos hoy?" tiene que llamar al cajero, o esperar el corte, o entrar al POS. Ninguna de estas opciones está disponible desde el teléfono a las 8pm.

**Wansoft:** 4 KPIs en el escritorio: estatus de licencia (irrelevante para el dueño), órdenes abiertas + total MXN, última sincronización (rojo si >48h — el dato más ansioso del portal), y última venta recibida. El gráfico de utilidad marginal es mensual. No hay nada en tiempo real.

**Fullsite hoy:** Dashboard con ventas del día, ticket promedio, mesas, propinas, personas. Datos en tiempo real desde `wansoft_kpis` (o desde Supabase POS para clientes Fullsite). KPIs actualizados continuamente.

**Veredicto:** Fullsite Mejor — datos en tiempo real sin sincronización. El "última sincronización rojo" de Wansoft es el síntoma más claro de su arquitectura local.

**Simplificación:** El home debe responder en una pantalla: ventas hoy, comparativo vs ayer/misma fecha semana pasada, órdenes abiertas, estado de caja (¿abierta?), y una alerta si hay algo que requiere atención. Nada más en el primer nivel.

**IA puede:** Calcular el cierre proyectado del día en tiempo real basado en el ritmo actual y el historial de la misma hora de días similares. "A este ritmo, cerrarás con $23,400 — 8% arriba del martes pasado."

**Configurable:** Qué KPIs aparecen en el home. Qué comparativo muestra (ayer / semana pasada / meta del mes). Cuántas sucursales se consolidan.

**Exportaciones/filtros/acciones de valor:** Snapshot del día exportable en 1 click (PDF). Selector de sucursal en el header, persistente por sesión.

**Principio:** _El home responde "¿cómo estoy?" sin que el dueño tenga que navegar a ninguna otra pantalla._

---

#### 01.2 Widgets configurables

**Quién lo usa:** Dueño | **Frecuencia:** Configuración inicial + ajustes ocasionales

**Qué problema resuelve:** El dueño de un restaurante de desayunos tiene prioridades distintas al dueño de un bar: uno quiere ver ticket promedio por persona y ventas de chilaquiles; el otro quiere ver consumo de licor y paleo de barra. Un home fijo no sirve para ambos.

**Wansoft:** Home fijo. Los 4 KPIs y el gráfico de utilidad son iguales para todos. No hay personalización.

**Fullsite hoy:** Home con widgets fijos. No hay drag & drop ni personalización.

**Veredicto:** Gap — la personalización del home es la diferencia entre un dashboard que el dueño visita cada día y uno que deja de visitar a la semana.

**Simplificación:** El conjunto de widgets disponibles debe ser limitado a ~12 bloques significativos — no 50 opciones que nadie configura. El sistema propone un layout inicial basado en el tipo de restaurante (desayuno, bar, evento) y el dueño ajusta.

**IA puede:** Sugerir el layout de home basado en qué reportes el dueño visita con más frecuencia. Si abre "Meseros" cada mañana, sugerir un widget de "Top mesero del día."

**Configurable:** Qué widgets aparecen, en qué orden, en qué tamaño. Guardado por usuario, no por sucursal.

**Principio:** _El home es del dueño, no del sistema. El sistema propone; el dueño decide._

---

#### 01.3 Estado de alertas activas

**Quién lo usa:** Dueño, Gerente | **Frecuencia:** Universal

**Qué problema resuelve:** El dueño no tiene que recorrer el dashboard buscando anomalías. Si hay algo que requiere atención, debe estar visible desde el home.

**Wansoft:** No existe. El portal es 100% pull — el dueño busca el problema.

**Fullsite hoy:** Los agentes IA detectan anomalías, pero la visibilidad de esas alertas en el home del dashboard no está integrada de forma centralizada.

**Veredicto:** Gap — la conexión entre los agentes IA y el home del dashboard es el puente que falta.

**Simplificación:** Un panel de "Atención requerida" en el home con máximo 3-5 alertas activas. No un feed infinito. Las alertas ya resueltas desaparecen. Sin número, no hay panel. Cuando el panel está vacío, el dueño sabe que todo está bien.

**IA puede:** Priorizar las alertas por impacto económico estimado. "Cancelaciones fuera de patrón — riesgo estimado $1,200."

**Principio:** _El panel de alertas vacío es una respuesta. Significa que el sistema revisó y todo está dentro del rango normal._

---

## 02 VENTAS

> El reporte de ventas es la conversación más frecuente del dueño con el sistema. Debe ser rápido, claro, y contestar las preguntas que el dueño hace antes de que tenga que hacerlas.

---

#### 02.1 Reporte de ventas por período

**Quién lo usa:** Dueño, Gerente, Contador | **Frecuencia:** Universal

**Qué problema resuelve:** ¿Cuánto vendí? Desglosado por período (día, semana, mes), por forma de pago, por tipo de orden, con comparativo contra un período de referencia.

**Wansoft:** "Ventas por sucursal" — Excel con 9 hojas: resumen, ventas, cortesías, descuentos, cancelaciones, anulaciones, ocupación, "reporte contador," y datos adicionales. El Excel es exhaustivo pero opaco: el dueño necesita abrirlo, orientarse, y encontrar el número que busca.

**Fullsite hoy:** Dashboard de ventas con gráficas interactivas, desglose por forma de pago, ventas brutas/netas/descuentos. Comparativo vs período anterior.

**Veredicto:** Fullsite Mejor — dashboard interactivo supera Excel estático en accesibilidad. La "hoja para el contador" de Wansoft es un insight brillante que debería replicarse: el mismo reporte con vista diferente por rol.

**Simplificación:** El reporte de ventas tiene 3 vistas:
1. **Vista Dueño** — $$$, comparativo, y 3 KPIs (ticket promedio, personas, hora pico)
2. **Vista Gerente** — desglose por mesero, cancellaciones, forma de pago
3. **Vista Contador** — bruto, descuentos, IVA, neto, por forma de pago con fecha

Mismos datos, tres lecturas. El usuario selecciona su vista al inicio; el sistema la recuerda.

**IA puede:** Narrativa automática: "Esta semana vendiste $148K — 12% menos que la misma semana del año pasado. El martes fue el día más bajo (llovió). El sábado compensó con el mejor ticket promedio del mes: $312 por persona."

**Configurable:** Período default (hoy / semana / mes). Comparativo default. Qué métricas aparecen en la vista resumen.

**Exportaciones/filtros/acciones de valor:** Export CSV/Excel/PDF. Filtros: fecha, sucursal, tipo de orden, mesero, forma de pago. Acción: "Enviarme este reporte cada lunes a las 8am."

**Principio:** _El reporte de ventas tiene tres audiencias. No tres reportes separados — la misma información con tres filtros de relevancia._

---

#### 02.2 Ventas por hora (ocupación)

**Quién lo usa:** Gerente, Dueño | **Frecuencia:** Común

**Qué problema resuelve:** ¿A qué hora tengo más clientes? ¿A qué hora necesito más staff? ¿A qué hora mi cocina está bajo más presión?

**Wansoft:** `PersonsByHour`, `PersonsByDay`, `PersonsByDayName` — tres reportes dedicados solo a contar personas. Wansoft entendió que el número de personas es más valioso que el número de ventas para decisiones de operación.

**Fullsite hoy:** Heatmap de horas en el dashboard. `personas_restaurant` como KPI diario, pero sin desglose por hora dentro de `wansoft_kpis`.

**Veredicto:** Gap — necesitamos personas por hora, no solo personas del día.

**Simplificación:** Heatmap de 7 días × 24 horas donde el color indica intensidad de ventas o personas. De un vistazo: el gerente sabe cuándo el restaurante necesita más personal.

**IA puede:** "Basado en el patrón de los últimos 90 días, mañana (jueves) el pico será entre 1:30pm y 2:30pm con ~35 personas. Considera tener a 4 meseros disponibles en ese rango."

**Principio:** _La ocupación por hora es más valiosa que las ventas por hora para decisiones operativas. Los dos números no son el mismo._

---

#### 02.3 Ventas por platillo y categoría

**Quién lo usa:** Dueño, Gerente | **Frecuencia:** Común

**Qué problema resuelve:** ¿Qué platillos venden más? ¿Cuáles tienen mejor margen? ¿Cuáles nadie pide? ¿Qué categoría del menú es la más rentable?

**Wansoft:** Reportes SalesBySaucer (ventas por platillo) y SalesByGroup (ventas por categoría). Separados, estáticos, en Excel.

**Fullsite hoy:** Platillos top en `wansoft_daily.platillos_top`. Ventas por grupo en `ventas_por_grupo`. Gráficas en el dashboard de platillos.

**Veredicto:** Equivalente — con oportunidad en la cruce con food cost para calcular el margen real por platillo (no solo ventas sino rentabilidad).

**IA puede (Menu Engineering automático):** Clasificar automáticamente cada platillo en la matriz de Boston:
- **Estrella** — mucho se vende, alto margen → promover activamente
- **Vaca** — mucho se vende, bajo margen → revisar precio o receta
- **Interrogación** — poco se vende, alto margen → cambiar posición en el menú
- **Perro** — poco se vende, bajo margen → eliminar o reformular

**Configurable:** Período de análisis. Umbral de "alto/bajo" para la clasificación (customizable por restaurante).

**Exportaciones/filtros/acciones de valor:** Export con columnas: platillo, categoría, unidades vendidas, ingreso, food cost estimado, margen. Acción: "Enviarme el reporte de engineering del menú cada mes."

**Principio:** _Vender mucho no es lo mismo que ganar mucho. El reporte de platillos que no cruza con el food cost informa a medias._

---

## 03 MESEROS Y PROPINAS

> El módulo de meseros es el único reporte que afecta directamente al staff. Lo que muestre debe ser justo, preciso, y no susceptible de manipulación.

---

#### 03.1 Rendimiento por mesero

**Quién lo usa:** Gerente, Dueño | **Frecuencia:** Común

**Qué problema resuelve:** ¿Cuál es mi mejor mesero? ¿Quién cancela más? ¿Quién aplica más descuentos? ¿Quién tiene el ticket promedio más alto?

**Wansoft:** `SalesByWaiter` — ventas totales por mesero por período. También: descuentos por mesero, cortesías por mesero, cancelaciones por mesero (cuatro reportes separados).

**Fullsite hoy:** Ranking de meseros con ventas y propinas. Comparativo disponible.

**Veredicto:** Equivalente — con gap en la vista consolidada. El dueño necesita ver en una sola tabla: ventas, ticket promedio, descuentos, cancelaciones, propinas, y un "score" de rendimiento por mesero.

**Simplificación:** Una tabla con 7 columnas por mesero: ventas, mesas, ticket promedio, descuentos (%), cancelaciones (vs promedio del equipo), propinas, y tendencia (↑↓). Sin separar en 4 reportes.

**IA puede:** Detectar anomalías por mesero vs el promedio del equipo en tiempo real. "Omar tiene 5 cancelaciones este turno — el promedio del equipo es 1.2. ¿Revisar?"

**Configurable:** Qué métricas incluir en el ranking. Período de comparación. Quién puede ver el rendimiento individual de otros meseros.

**Principio:** _El mesero debe poder ver su propio rendimiento. El gerente debe poder ver el equipo. El dueño debe ver las anomalías._

---

#### 03.2 Módulo de propinas

**Quién lo usa:** Gerente, Meseros | **Frecuencia:** Universal (post-turno)

**Qué problema resuelve:** La distribución de propinas es la fuente de conflicto más frecuente en el equipo. Sin un sistema, el cálculo es manual, opaco, y susceptible de error o favoritismo.

**Wansoft:** Módulo completo con fondos de propina (pool) y reporte por mesero. AMALAY: 5% sobre ventas de cada mesero al pool + propinas directas. El módulo calcula el neto por mesero automáticamente.

**Fullsite hoy:** Módulo de propinas implementado. El cálculo del 5% pool + distribución de propinas directas.

**Veredicto:** Equivalente.

**Simplificación:** La pantalla de propinas al cierre del turno debe mostrar: propinas directas captadas por mesero, contribución al pool, distribución del pool, y neto a pagar a cada uno. Sin que el gerente tenga que calcular nada.

**IA puede:** Detectar si las propinas de un mesero están sistemáticamente por debajo del promedio del equipo — señal de que puede necesitar entrenamiento en experiencia al cliente.

**Principio:** _La distribución de propinas debe ser transparente para quien la recibe. El sistema la calcula; el gerente solo confirma._

---

## 04 CANCELACIONES Y DESCUENTOS (AUDITORÍA)

> Las cancelaciones y los descuentos son los dos vectores de pérdida más comunes en un restaurante. El módulo de auditoría no es un reporte — es el sistema de prevención.

---

#### 04.1 Cancelaciones con análisis de patrones

**Quién lo usa:** Gerente, Dueño | **Frecuencia:** Común

**Qué problema resuelve:** ¿Quién cancela más? ¿Con qué razón? ¿A qué hora? ¿El patrón es normal o sospechoso? Sin análisis de patrones, el dueño solo ve el total de cancelaciones — no puede distinguir entre un día con mucha demanda (más cancelaciones por ajuste) y un mesero que está usando cancelaciones para extraer efectivo.

**Wansoft:** `CancelSalesDetail` — lista de cancelaciones con timestamp, usuario, platillo, y razón. Disponible como Excel descargable. Sin análisis de patrones ni comparativos por mesero.

**Fullsite hoy:** Módulo de cancelaciones con filtros por fecha y mesero. El agente anti-fraude analiza patrones semanalmente.

**Veredicto:** Fullsite Mejor (potencial) — el agente anti-fraude es el diferencial, pero su análisis llega una vez por semana. La vista en tiempo real del patrón de cancelaciones por mesero (vs el promedio del equipo) es el paso que falta.

**Simplificación:** Dos vistas:
1. **Lista** — log completo de cancelaciones (quién, qué, cuándo, razón, inventario afectado)
2. **Patrón** — distribución de cancellaciones por mesero vs promedio del equipo, tendencia semanal, y razones más frecuentes

**IA puede:** Calcular un "índice de anomalía" por mesero: si las cancelaciones de Omar están 2σ por encima del promedio del equipo esta semana, el sistema activa una alerta.

**Principio:** _Una cancelación en una lista es un evento. Un patrón de cancelaciones es una señal._

---

#### 04.2 Descuentos y cortesías

**Quién lo usa:** Dueño, Gerente | **Frecuencia:** Común

**Qué problema resuelve:** ¿Cuánto dinero está saliendo del restaurante por descuentos? ¿Quién los aplica? ¿A quién? ¿El volumen es consistente con la política de descuentos que el dueño autorizó?

**Wansoft:** `SalesByDiscount` — total de descuentos por período y por tipo. `SalesByCourtesy` — cortesías. Cuatro reportes separados (ventas, cortesías, descuentos, anulaciones).

**Fullsite hoy:** Vista de descuentos y cortesías en el dashboard.

**Veredicto:** Equivalente — con oportunidad en el cruce: si el descuento promedio de un mesero es 3x el promedio del equipo, eso debería ser una alerta, no un número que el dueño tiene que calcular manualmente.

**IA puede:** Calcular el "leakage rate" por mesero: porcentaje de ventas que se va en descuentos y cortesías. Benchmark contra el equipo. Alerta si supera el umbral configurable.

**Principio:** _Los descuentos son una herramienta de negocio. El análisis de descuentos por mesero es una herramienta de control._

---

## 05 FOOD COST Y COSTOS

> El food cost es el KPI más importante del restaurante después de las ventas brutas. Y es el que más restaurantes calculan mal, con meses de retraso, o no calculan del todo.

---

#### 05.1 Monitor de food cost en tiempo real

**Quién lo usa:** Dueño, Gerente | **Frecuencia:** Universal

**Qué problema resuelve:** El food cost que el contador entrega a fin de mes no sirve para tomar decisiones este martes. El monitor en tiempo real permite ajustar precios, recetas, o proveedores antes de que el margen se erosione.

**Wansoft:** `CostAndMargin` — reporte por artículo, grupo, tipo, y resumen. Excel descargable. Sin monitor en tiempo real — el dato está en el portal pero nadie lo consulta porque está enterrado en 3 niveles de navegación.

**Fullsite hoy:** Monitor de food cost con alertas de recetas sospechosas. Deducción al enviar a cocina (no al cobrar, a diferencia de Wansoft).

**Veredicto:** Fullsite Mejor — la deducción al enviar (no al cobrar) hace el food cost más preciso. El monitor en tiempo real es el diferencial vs el Excel de Wansoft.

**Simplificación:** El monitor de food cost tiene una vista simple: food cost % del período, comparativo vs período anterior, y los 5 platillos con mayor desviación vs su costo teórico. Sin entrar a la tabla de 200 ingredientes.

**IA puede:** "El food cost de la última semana es 34.2% — 4 puntos arriba de tu objetivo del 30%. Los principales contribuyentes son el aguacate (+12% vs precio de receta) y el salmón (+8%). Tu proveedor actual tiene precios desactualizados."

**Configurable:** Objetivo de food cost por categoría de menú. Umbral de alerta (ej: alerta si food cost supera 35%). Período de cálculo (diario / semanal / mensual).

**Principio:** _El food cost que llega cuando ya nada se puede hacer no sirve para tomar decisiones. El food cost en tiempo real sirve para administrar._

---

#### 05.2 Costo por platillo vs precio de venta

**Quién lo usa:** Dueño | **Frecuencia:** Situacional (al revisar el menú)

**Qué problema resuelve:** ¿Estoy vendiendo este platillo por encima de su costo? ¿Mi precio de menú cubre el food cost + gastos operativos + margen deseado?

**Wansoft:** `CostBySaucer` — costo por platillo vs ventas. `CostByGroup` — por categoría. Excel con columnas: platillo, costo, precio venta, margen.

**Fullsite hoy:** Dashboard de costos con desglose por platillo.

**Veredicto:** Equivalente.

**Simplificación:** La tabla de costo por platillo debe mostrar: costo receta, precio menú, margen bruto ($), margen bruto (%), y una alerta visual si el margen está por debajo del objetivo. Un semáforo: verde/amarillo/rojo.

**IA puede:** Simular el impacto de un ajuste de precio. "Si subes los Chilaquiles de $85 a $95, el margen pasa de 34% a 41%. En las últimas 4 semanas vendiste 340 porciones — el impacto anual sería +$16,320."

**Principio:** _La decisión de precio de un platillo no debe ser intuitiva. Debe ser calculada._

---

## 06 INVENTARIO Y COMPRAS

> El inventario es el 35-45% del gasto del restaurante. Es el módulo que Wansoft nunca resolvió bien. Es donde Fullsite tiene la ventaja más grande.

---

#### 06.1 Estado del inventario

**Quién lo usa:** Gerente, Dueño | **Frecuencia:** Común

**Qué problema resuelve:** ¿Qué hay en el almacén? ¿Qué está por acabarse? ¿Qué necesito comprar hoy?

**Wansoft:** Reporte de existencias + punto de reorden como tabla estática. "Por inventariar" como widget en el home (el único elemento operativo del escritorio). Sin alertas automáticas — el dueño tiene que abrir el reporte.

**Fullsite hoy:** Inventario real con conteo físico, movimientos, reorden, y predicción. Alertas de reorden al deducir.

**Veredicto:** Fullsite Mejor — la alerta proactiva al deducir (vs el reporte pasivo que nadie abre) es la diferencia operativa.

**Simplificación:** El home del inventario debe responder tres preguntas:
1. ¿Hay algo en rojo (bajo punto de reorden)?
2. ¿Hay algo próximo a caducar?
3. ¿La última toma física fue reciente?

Tres números. El dueño sabe en 10 segundos si necesita preocuparse.

**IA puede:** "Basado en tus ventas del viernes pasado y el pronóstico de este viernes (+20% por evento en la zona), necesitas pedir mañana: 8kg de pollo adicionales, 20 aguacates, y 4 bolsas de café. ¿Genero la OC?"

**Configurable:** Punto de reorden por ingrediente. Proveedor preferido por ingrediente. Umbral para "próximo a caducar."

**Principio:** _El dueño no debe tener que ir a buscar qué se está acabando. El sistema debe decírselo cuando aún hay tiempo para actuar._

---

#### 06.2 Compras y proveedores

**Quién lo usa:** Dueño, Gerente | **Frecuencia:** Común

**Qué problema resuelve:** ¿Cuánto gasté en compras este mes? ¿A qué proveedores? ¿Están mis precios actualizados? ¿La OC que envié ya llegó?

**Wansoft:** Solo tiene `ShopBySupplier` / `ShopByProduct` como reportes. El ciclo completo de compras (OC → envío → recepción → factura) no existe en Wansoft. Es el gap más grande del sistema.

**Fullsite hoy:** Módulo completo de compras: OC, recepción con 6 motivos de discrepancia, facturas, variación de costos. Matching inteligente entre factura y OC.

**Veredicto:** Territorio propio — Wansoft no tiene compras reales. Es nuestra ventaja más grande en backoffice.

**Simplificación:** El flujo de compras debe ser: necesidad detectada automáticamente → OC generada (sugerida por IA o creada manual) → enviada al proveedor (WhatsApp o email) → recepción que compara con OC → factura vinculada → inventario actualizado → costo actualizado.

**IA puede:** Generar la OC semanal automáticamente basándose en el inventario actual, el punto de reorden, y las ventas proyectadas. El dueño solo aprueba o ajusta. No crea.

**Principio:** _El 40% del costo del restaurante se gestiona con un WhatsApp al proveedor. Fullsite debe estructurar ese proceso sin quitarle la flexibilidad._

---

#### 06.3 Variación de costos

**Quién lo usa:** Dueño | **Frecuencia:** Situacional

**Qué problema resuelve:** ¿El proveedor subió el precio sin avisarme? ¿Mi costo real es diferente al costo de la receta que definí?

**Wansoft:** `CostVariation` — reporte que compara el costo actual de cada ingrediente vs el costo al momento en que se configuró. Sin alertas automáticas.

**Fullsite hoy:** Agente de variación de costos. Monitor de food cost con alertas.

**Veredicto:** Fullsite Mejor — el agente detecta variaciones y alerta proactivamente.

**IA puede:** "El precio del aguacate Hass subió 23% en las últimas 3 semanas. Tu receta de Huevos Benedic con aguacate tiene un costo de $38.40 (antes $31.20). El precio de venta actual ($95) da un margen de 60% — pero si quieres mantener el 65%, el precio debería ser $110."

**Principio:** _La variación de costo de un ingrediente es una decisión de precio pendiente. El sistema debe conectar los dos._

---

## 07 ESTADO DE RESULTADOS (P&L)

> El P&L automatizado es el módulo de mayor impacto percibido para el dueño. La mayoría de los dueños de restaurantes no saben cuánto ganan realmente hasta que el contador entrega el estado financiero — 2 meses después del período.

---

#### 07.1 P&L automático

**Quién lo usa:** Dueño, Contador | **Frecuencia:** Situacional (mensual/trimestral)

**Qué problema resuelve:** ¿Gané o perdí dinero este mes? ¿Cuánto? ¿Por qué? El dueño de AMALAY hace esta pregunta mental cada noche y no puede contestarla con certeza hasta que el contador la procesa.

**Wansoft:** `GetIncomeStatementByMonthInYear` — P&L mensual automático con: ingresos (ventas netas), egresos (compras + nómina + vales + facturas), costo (deducción de inventario), y utilidad. Es uno de los reportes más valiosos del portal — y casi nadie sabe que existe.

**Fullsite hoy:** Dashboard con ventas y costos, pero sin P&L consolidado automático que integre egresos registrados + food cost real + nómina.

**Veredicto:** Gap — el P&L automático es alta prioridad. Los datos para calcularlo ya existen en Supabase: ventas de `wansoft_daily`, egresos de `gastos`, food cost de las recetas y ventas. Solo falta la consolidación.

**Simplificación:** El P&L de Fullsite tiene una vista: mes en curso con barra de progreso, y los últimos 12 meses como comparativo. Una sola pantalla que responde "¿cuánto gané este mes?" con el desglose que el contador necesita.

**IA puede:** "Octubre fue tu mejor mes del año con $180K de ingreso neto — pero tu margen cayó al 18% porque los egresos subieron 22% (nómina extra por temporada alta). Noviembre tiene el potencial de ser similar si controlas la nómina al mismo nivel de septiembre."

**Configurable:** Categorías de egresos que incluir (solo operativos, o también gastos fijos). Método de costeo (last price vs promedio ponderado). Visualización (mensual / trimestral / anual).

**Exportaciones/filtros/acciones de valor:** Export PDF para el contador con el formato estándar (ingresos, costo de ventas, margen bruto, egresos operativos, EBITDA). Acción: "Enviarme el P&L del mes anterior el día 3 de cada mes."

**Principio:** _El P&L que llega en 2 meses es historia. El P&L en tiempo real es gestión._

---

## 08 FACTURACIÓN CFDI

> La facturación no es una feature de diferenciación — es una obligación fiscal. Pero el cómo se implementa puede ser la diferencia entre 30 minutos de trabajo manual por día o cero intervención humana.

---

#### 08.1 Autofacturación y CFDI individual

**Quién lo usa:** Cajero, Contador | **Frecuencia:** Común

**Qué problema resuelve:** El cliente que pide factura necesita su CFDI el mismo día, sin que el cajero tenga que hacer un proceso de 8 pasos en el portal.

**Wansoft:** CFDI individual desde el portal (cajero busca la venta → captura RFC → emite → envía email). El cliente necesita llamar, esperar, o ir al portal él mismo. 5-10 minutos por factura. Si el 30% de los clientes piden factura en una zona corporativa, eso es 1-4 horas de trabajo diario.

**Fullsite hoy:** Autofacturación por QR en el ticket. Portal mobile-first. RFC con validación SAT en tiempo real. 3 pasos en 60 segundos.

**Veredicto:** Fullsite Mejor — la autofacturación self-service elimina el trabajo manual del cajero.

**Simplificación:** El módulo de facturación en el dashboard tiene dos vistas:
1. **Operativa** — facturas emitidas hoy, pendientes de timbrar, rechazadas
2. **Contable** — conciliación del mes (ventas vs facturas emitidas, globales pendientes)

**IA puede:** Detectar automáticamente si un cliente que ha facturado antes llega de nuevo y preparar sus datos fiscales pre-llenados.

**Configurable:** Series por sucursal. Política de factura global (diaria / semanal). RFC de cada método de pago para la factura global.

**Principio:** _La factura que el cliente obtiene en 60 segundos desde su teléfono es la que no genera fricción para él ni trabajo para el cajero._

---

#### 08.2 Conciliación de facturación

**Quién lo usa:** Contador, Dueño | **Frecuencia:** Situacional (mensual)

**Qué problema resuelve:** ¿Cuánto vendí vs cuánto facturé? ¿Hay ventas que quedaron sin facturar? ¿La factura global cubre el saldo correcto?

**Wansoft:** `ReportConciliation` — ventas vs facturas emitidas por período. Manual, en portal.

**Fullsite hoy:** Módulo de conciliación implementado.

**Veredicto:** Equivalente.

**Principio:** _La conciliación no es un reporte mensual — es un proceso semanal. El dinero que no está facturado es un riesgo fiscal, no un olvido._

---

## 09 DELIVERY Y ECOMMERCE

> Las plataformas de delivery representan 15-30% del ingreso de un restaurante urbano. Sin gestión centralizada, el restaurante opera con 3 tablets, re-captura manual, y errores constantes.

---

#### 09.1 Gestión de órdenes de delivery

**Quién lo usa:** Gerente, POS | **Frecuencia:** Universal (en restaurantes con delivery activo)

**Qué problema resuelve:** Las órdenes de Rappi y UberEats llegan a tablets separadas. El cajero re-captura en el POS. Si hay dos plataformas activas, el cajero tiene 3 pantallas y comete errores.

**Wansoft:** Integración con Rappi y UberEats vía middleware propietario. Órdenes llegan al POS directamente. "Top Offenders" — platillos que más frecuentemente fallan en delivery (reporte más valioso del módulo).

**Fullsite hoy:** Módulo de delivery con webhook de UberEats. Órdenes integradas en el flujo de POS.

**Veredicto:** Equivalente en recepción de órdenes. Gap en el "Top Offenders" report (análisis de qué falla más en delivery).

**IA puede:** Detectar si un platillo tiene tasa de cancelación alta en delivery y sugerir ajustes: "Las Enchiladas Verdes tienen 18% de rechazo en UberEats — el tiempo de preparación excede el estimado. Considera aumentar el tiempo declarado a la plataforma o simplificar la presentación para delivery."

**Principio:** _Las métricas de delivery son diferentes a las del restaurante. El ticket promedio, el tiempo de preparación, y la tasa de error son los KPIs del canal delivery — no las ventas brutas._

---

#### 09.2 Disponibilidad de platillos por plataforma

**Quién lo usa:** Gerente | **Frecuencia:** Situacional

**Qué problema resuelve:** Si se acabó el aguacate, los platillos que lo llevan deben desactivarse automáticamente en UberEats — no esperar a que 10 clientes pidan algo que no puedes preparar y luego cancelar sus órdenes.

**Wansoft:** Disponibilidad por plataforma como configuración manual. El gerente entra al portal y activa/desactiva platillos por plataforma.

**Fullsite hoy:** Auto-86 basado en existencias reales. Si el stock de un ingrediente llega a cero, los platillos que lo contienen se marcan como no disponibles.

**Veredicto:** Fullsite Mejor — la desactivación automática por stock es diferencial. Wansoft requiere que alguien lo haga manualmente.

**Principio:** _Un restaurante que acepta órdenes que no puede cumplir paga dos veces: en reembolso y en reseña negativa._

---

## 10 CRM Y LEALTAD

> Wansoft no tiene CRM real. Tiene un catálogo de clientes para facturación y tarjetas de regalo físicas. La oportunidad de Fullsite en CRM es construir lo que nadie en el sector ha construido.

---

#### 10.1 Base de clientes

**Quién lo usa:** Dueño | **Frecuencia:** Situacional

**Qué problema resuelve:** ¿Cuántos clientes únicos tengo? ¿Cuánto gasta cada uno? ¿Cuáles son mis clientes más valiosos? ¿Cuáles no han vuelto en semanas?

**Wansoft:** `ClientsFE` — catálogo de clientes para facturación. No hay historial de visitas, ni frecuencia, ni valor acumulado. MegaPoints existe pero casi nadie lo usa.

**Fullsite hoy:** CRM con historial de visitas, tags, frecuencia. 12,200 clientes importados de reservaciones.

**Veredicto:** Territorio propio — Wansoft no tiene CRM real.

**IA puede:** Segmentación automática: "Tienes 450 clientes que vinieron al menos una vez en los últimos 90 días. 82 no han vuelto en más de 3 semanas (patrón de churn). ¿Envío un mensaje personalizado a ese segmento?"

**Configurable:** Criterios de segmentación. Frecuencia de actualización del score de churn. Canal de recontacto (WhatsApp / email).

**Principio:** _El cliente que no vuelve no se queja — desaparece. El sistema de churn prediction es el que puede actuar antes de que sea tarde._

---

#### 10.2 Encuestas de satisfacción

**Quién lo usa:** Dueño | **Frecuencia:** Situacional

**Qué problema resuelve:** ¿Los clientes están satisfechos? ¿Qué aspecto de la experiencia genera más insatisfacción?

**Wansoft:** Módulo de encuestas con configuración de preguntas (opción múltiple + calificación) y reporte. La configuración es compleja para el resultado que genera. AMALAY no lo usa activamente.

**Fullsite hoy:** QR en ticket → encuesta simple. Reporte de respuestas.

**Veredicto:** Fullsite Mejor — menos fricción para el cliente (QR en ticket) genera más respuestas que un sistema de encuesta separado.

**Simplificación:** Una pregunta. "¿Lo recomendarías?" 0-10. Los comentarios opcionales. El NPS calculado automáticamente. El análisis de qué platillos o meseros aparecen más en comentarios negativos.

**IA puede:** Análisis semántico de comentarios libres para detectar patrones: "El 60% de las menciones negativas este mes mencionan 'tiempo de espera.' El martes entre 1pm y 3pm es el período con más quejas."

**Principio:** _Una sola pregunta bien ejecutada genera más insight que 15 preguntas que nadie completa._

---

## 11 AGENTES IA

> Los agentes no son una sección del dashboard — son la inteligencia que corre por debajo de todo el sistema. Pero necesitan una interfaz donde el dueño pueda saber qué encontraron, qué decidieron, y qué hicieron.

---

#### 11.1 Hub de agentes

**Quién lo usa:** Dueño | **Frecuencia:** Común

**Qué problema resuelve:** El dueño tiene 30 agentes corriendo. Sin una interfaz centralizada, no sabe qué están encontrando, qué alertas generaron, ni si hay algo que requiere su atención.

**Wansoft:** No existe.

**Fullsite hoy:** Páginas individuales por agente. Sin hub centralizado que muestre el estado de todos los agentes y sus hallazgos recientes.

**Veredicto:** Gap — el hub de agentes es la interfaz que convierte 30 páginas de agentes en un sistema de inteligencia unificado.

**Simplificación:** El hub tiene tres secciones:
1. **Activo ahora** — qué agentes corrieron hoy, qué encontraron, qué alertas generaron
2. **Hallazgos de la semana** — los insights más importantes de la semana, por impacto económico estimado
3. **Configuración** — qué agentes están activos, con qué frecuencia corren, a quién alertan

**Principio:** _30 agentes sin una interfaz centralizada son 30 páginas que nadie visita. El hub convierte la inteligencia en visibilidad._

---

#### 11.2 Chat con el restaurante

**Quién lo usa:** Dueño, Gerente | **Frecuencia:** Común

**Qué problema resuelve:** "¿Cuánto vendimos el martes de la semana pasada?" es una pregunta que en Wansoft requiere navegar a Reportes → Ingresos → Ventas por día → seleccionar fecha → descargar Excel. En Fullsite, el dueño escribe la pregunta y obtiene la respuesta en 3 segundos.

**Wansoft:** No existe. Todo es navegación manual por el portal.

**Fullsite hoy:** Chat IA con Groq → Claude fallback. Acceso a `wansoft_daily` y `wansoft_kpis`. Responde preguntas en español.

**Veredicto:** Territorio propio — ningún competidor en LATAM tiene esto.

**Principio:** _El chat no reemplaza el dashboard — lo complementa. Para la pregunta ad-hoc que no tiene un reporte dedicado, el chat es la respuesta más rápida._

---

## 12 REPORTES PROGRAMADOS

> Un reporte que el dueño tiene que ir a buscar es un reporte que muchos días no se consulta. Los reportes programados convierten la información en un hábito, no en una tarea.

---

#### 12.1 Reporte programado

**Quién lo usa:** Dueño | **Frecuencia:** Configuración inicial

**Qué problema resuelve:** El dueño quiere recibir el resumen de ventas de la semana cada lunes a las 8am, sin tener que entrar al dashboard.

**Wansoft:** Email de corte disponible (OFF en AMALAY). PDF adjunto no optimizado para móvil.

**Fullsite hoy:** Briefing matutino vía Telegram (infraestructura de agentes). Reportes programados dentro del dashboard: no implementados.

**Veredicto:** Gap — los reportes programados dentro de la app (con push notification cuando están listos) son el siguiente paso después de los briefings de Telegram.

**Catálogo de reportes programables:**

| Reporte | Frecuencia sugerida | Destinatario |
|---|---|---|
| Ventas del día | Diario (cierre de turno) | Dueño |
| Rendimiento de meseros | Semanal (lunes) | Gerente |
| Food cost semanal | Semanal (lunes) | Dueño |
| P&L del mes anterior | Mensual (día 3) | Dueño + Contador |
| Análisis de menú (engineering) | Mensual | Dueño |
| Resumen de compras | Semanal (lunes) | Dueño |
| Alertas anti-fraude | Semanal (viernes) | Dueño |
| Estado de inventario | Diario (apertura) | Gerente |

**Configurable:** Qué reportes, con qué frecuencia, a qué hora, a quién. Canal de entrega: dentro de la app (push) o descarga directa.

**Principio:** _Un reporte programado convierte la información en un hábito. El dueño que recibe el P&L el día 3 de cada mes toma decisiones el día 3. El que tiene que ir a buscarlo, a veces no las toma._

---

## 13 VISTAS POR SUCURSAL Y MULTI-TENANT

**Quién lo usa:** Dueño (multi-sucursal) | **Frecuencia:** Universal para cadenas

**Qué problema resuelve:** El dueño con 3 sucursales necesita ver cada una por separado y las tres consolidadas. No quiere 3 logins distintos.

**Wansoft:** Selector de sucursal en el header del portal (dropdown). Cada sucursal es una instancia separada de Netsilver sincronizando al mismo portal.

**Fullsite hoy:** Multi-tenant implementado. Selector de sucursal en el dashboard.

**Veredicto:** Equivalente en funcionalidad básica. Gap en la vista de consolidado multi-sucursal: el dueño con 3 sucursales debería poder ver "sucursales" como una sola fila de KPIs consolidados.

**Simplificación:** Header del dashboard con:
- Dropdown para ver una sucursal específica
- Opción "Todas" que consolida con comparativo entre sucursales
- Indicador visual si alguna sucursal tiene una alerta activa

**Principio:** _El dueño con 3 sucursales quiere saber primero si todas van bien. Después, cuál va mejor. El drill-down es secundario._

---

## Síntesis: Principios de Producto del Dashboard

### El dashboard como sistema de gestión
1. _El home responde "¿cómo estoy?" sin que el dueño navegue a ninguna otra pantalla._
2. _El panel de alertas vacío es una respuesta. Significa que el sistema revisó y todo está dentro del rango normal._
3. _El dashboard es del dueño, no del sistema. El sistema propone el layout; el dueño decide._

### Información con contexto
4. _El reporte de ventas tiene tres audiencias. No tres reportes separados — la misma información con tres filtros de relevancia._
5. _Vender mucho no es lo mismo que ganar mucho. El reporte de platillos que no cruza con el food cost informa a medias._
6. _La ocupación por hora es más valiosa que las ventas por hora para decisiones operativas._
7. _El P&L que llega en 2 meses es historia. El P&L en tiempo real es gestión._

### Control y prevención
8. _Una cancelación en una lista es un evento. Un patrón de cancelaciones es una señal._
9. _El food cost que llega cuando ya nada se puede hacer no sirve. El food cost en tiempo real sirve para administrar._
10. _La variación de costo de un ingrediente es una decisión de precio pendiente. El sistema debe conectar los dos._
11. _El dueño no debe tener que ir a buscar qué se está acabando. El sistema debe decírselo cuando hay tiempo para actuar._

### Automatización e IA
12. _El sistema propone la OC. El dueño aprueba o ajusta. No crea desde cero._
13. _Una sola pregunta de encuesta bien ejecutada genera más insight que 15 preguntas que nadie completa._
14. _30 agentes sin una interfaz centralizada son 30 páginas que nadie visita._
15. _Un reporte programado convierte la información en un hábito. El que el dueño busca, a veces no lo encuentra._

### Comunicación
16. _La factura que el cliente obtiene en 60 segundos no genera fricción para él ni trabajo para el cajero._
17. _El cliente que no vuelve no se queja — desaparece. El churn prediction actúa antes de que sea tarde._

---

## Veredicto consolidado

| Módulo | Veredicto | Estado |
|---|---|---|
| Home / Escritorio | Fullsite Mejor | KPIs en tiempo real vs sincronización pendiente |
| Widgets configurables | Gap | Layout fijo en Fullsite; Wansoft tampoco tiene — oportunidad |
| Ventas por período | Fullsite Mejor | Dashboard interactivo vs Excel. Gap: vista por rol |
| Ventas por hora (personas) | Gap | Wansoft tiene 3 reportes dedicados; Fullsite tiene dato diario sin desglose horario |
| Ventas por platillo | Equivalente | Gap: cruce con food cost para margen real |
| Meseros | Equivalente | Gap: vista consolidada en una sola tabla |
| Propinas | Equivalente | — |
| Cancelaciones | Fullsite Mejor (potencial) | Agente anti-fraude semanal; falta vista en tiempo real |
| Food cost | Fullsite Mejor | Monitor real-time vs Excel de Wansoft |
| Inventario | Fullsite Mejor | Alertas proactivas vs reporte pasivo |
| Compras | Territorio propio | Wansoft no tiene compras reales |
| P&L | Gap | Wansoft tiene P&L automático; Fullsite solo ventas/costos parciales |
| Facturación | Fullsite Mejor | Autofacturación QR vs proceso manual |
| Delivery | Equivalente | Gap en "Top Offenders" report |
| CRM | Territorio propio | Wansoft no tiene CRM real |
| Agentes IA | Territorio propio | Hub centralizado pendiente |
| Reportes programados | Gap | Infraestructura existe (Telegram); falta integración en app |

**Fullsite Mejor o Territorio Propio en 9 módulos, Equivalente en 3, Gap en 5.**

Los gaps de mayor prioridad:
1. **P&L automático** — los datos existen, falta consolidación (esfuerzo: 1 semana)
2. **Ventas por hora** — necesario para decisiones de staffing (esfuerzo: 3 días)
3. **Vista por rol en reporte de ventas** — reduce tiempo del dueño y del contador (esfuerzo: 2 días)
4. **Hub de agentes** — convierte 30 páginas en un sistema de inteligencia (esfuerzo: 2 semanas)
5. **Widgets configurables** — diferencial de experiencia para el dueño (esfuerzo: 2 semanas)

---

> **Fase de diseño conceptual del Dashboard: cerrada.**
> El siguiente paso es implementar los gaps priorizados y validarlos con el dueño en operación real.
> La evolución posterior debe venir de cómo los dueños realmente usan el dashboard — no de seguir analizando el portal de Wansoft.
>
> Compañero: `POS-PRODUCT-BIBLE.md` — filosofía del POS.
> Compañero: `CONFIGURABILITY-BIBLE.md` — todo lo que el cliente configura.
> Settings Bible: `docs/bibles/FULLSITE-SETTINGS-BIBLE.md`
>
> Última actualización: 2026-07-25 — Daniel Ramonfaur + Claude Code (Fullsite)
