# FULLSITE Dashboard — Operational Bible
**Versión:** 1.0 — 2026-07-25  
**Propósito:** Referencia oficial para la evolución del centro de operaciones Fullsite  
**Alcance:** Dashboard web + agentes IA + APIs de reportes

---

## Principios de Producto

**D1 — El dashboard produce decisiones, no reportes.**  
Un reporte dice qué pasó. Una decisión cambia qué pasa mañana. Cada módulo debe responder: ¿qué acción específica habilita este dato?

**D2 — La pregunta de negocio es el punto de partida.**  
Antes de diseñar una pantalla, definir: ¿quién hace esta pregunta? ¿con qué frecuencia? ¿qué hace con la respuesta? Si nadie pregunta eso en el restaurante, no se construye.

**D3 — El contexto viaja con los datos.**  
Un export debe preservar el reporte que lo generó: filtros aplicados, periodo, agrupación, fecha de generación, usuario. Un número sin contexto no sirve en una junta.

**D4 — La IA complementa, no reemplaza la decisión del humano.**  
Los agentes detectan, alertan y sugieren. El gerente confirma y actúa. La IA no tiene autoridad operativa — tiene voz.

**D5 — Silencio es peor que una alerta falsa.**  
Un sistema que no avisa cuando algo sale mal no es confiable. Fullsite debe tener un sesgo hacia alertas. Mejor un falso positivo que un silencio que deja pasar fraude.

**D6 — El inventario es un loop cerrado o no existe.**  
Registrar una merma sin descontar del stock es peor que no registrar nada: da la ilusión de control sin el beneficio. Cada movimiento de inventario debe cerrar el loop.

**D7 — Configurar en donde el restaurantero vive; no donde vive el sistema.**  
El menú está en el sistema, pero la razón de una merma la sabe el chef. Los puntos de reorden los conoce el almacenista. El dashboard debe capturar ese conocimiento donde ocurre.

**D8 — Multi-tenant es la arquitectura; mono-restaurante es la UX.**  
Cada restaurante ve solo sus datos, con sus nombres, sus meseros, su menú. El hecho de que el sistema sirva a 100 restaurantes debe ser invisible.

**D9 — Lo que se puede inferir, no se pregunta.**  
RFC del restaurante, labor real, reorder points desde histórico, IVA acreditable desde facturas de compra: estos no son "configuraciones". Son cálculos. El dashboard los debe hacer automáticamente.

**D10 — La paridad con Wansoft es el piso, no el techo.**  
Replicar Wansoft es necesario para el cutover. Superarlo es el moat. Donde Wansoft tiene un reporte, Fullsite tiene una decisión. Donde Wansoft tiene un toggle, Fullsite tiene una regla automática.

---

## El Día Operativo — Narrativa Completa

El dashboard es una herramienta de diferentes personas en diferentes momentos del día. Esta narrativa describe cómo debería fluir.

### 7:00 AM — El Gerente Abre el Día

El gerente llega antes del servicio. Lo primero que ve es el Coach: tres observaciones de ayer, ordenadas por prioridad. No un reporte de 200 filas — tres cosas con las que puede hacer algo hoy.

El Coach de ayer puede decir: "El martes fue 18% abajo vs. la semana pasada. Julio es histórica mente tu peor mes. Hoy es miércoles — los miércoles son +12% vs. martes."

Eso no es un dato. Es una orientación.

Desde el home ejecutivo, el gerente ve el cierre de ayer: ventas netas, tickets, personas, ticket promedio, y cómo se compara con el promedio de los últimos 30 días. Si hubo cancelaciones fuera del rango normal, aparece una alerta roja.

Si quiere ir más profundo, va a `/cortes` y abre el detalle del día anterior. La heatmap de calendario le muestra en un vistazo los últimos 90 días: cuáles días fueron buenos (verde), cuáles fueron malos (rojo). Eso no es un número — es un patrón.

### 10:00 AM — El Almacenista Recibe

El almacenista recibe una entrega. Va a `/inventario-real/entradas`, selecciona al proveedor, escanea o busca los productos, ingresa cantidades y costos. El sistema hace dos cosas: actualiza el stock y actualiza el costo promedio del ingrediente. No son dos pasos — son uno.

Si la entrega viene con factura XML (CFDI), va a `/inventario-real/entradas-factura`, arrastra el XML, y el sistema auto-mapea los conceptos a ingredientes por RFC del proveedor y fuzzy match de nombres. El almacenista confirma o corrige el mapeo. Un solo XML puede registrar 30 ingredientes en dos minutos.

### 12:00 PM — El Servicio

Durante el servicio, el gerente no está en el dashboard. Está en el piso. El dashboard es para antes y después.

Pero el sistema trabaja solo. A las 2pm, 4pm, y 6pm, el agente de **Predicción de Cierre** calcula cuánto falta para llegar a la meta de ventas del día y qué categorías de producto tienen brecha vs. el promedio histórico. El agente de **Upselling** detecta si algún mesero está vendiendo menos bebidas por persona que el promedio y lo anota.

El gerente puede abrir `/agentes/prediccion` en su celular y ver: "Proyección: $28,400. Meta: $32,000. Brecha: $3,600. Oportunidad: postres (+40% vs. martes promedio)."

Si quiere preguntarle algo al sistema, abre el Chat IA: "¿Cuánto llevamos hoy?" o "¿Quién va puntero?" y obtiene la respuesta en lenguaje natural.

### 4:00 PM — El Corte del Turno

Al final del turno de comida, el cajero hace el corte. El dashboard registra el corte automáticamente desde el POS. En `/cortes`, el gerente puede ver el detalle: efectivo en caja, tarjeta, retiros, saldo final.

Si hay discrepancia entre lo que dice el POS y lo que hay en caja, el sistema la muestra. No la resuelve — la muestra. El gerente decide si es un error, un robo, o un problema de registro.

### 7:00 PM — El Cierre del Día

El gerente revisa `/ventas`: ventas de hoy vs. ayer, vs. hace 7 días, vs. el mismo día de semana el mes pasado. Ve el breakdown por categoría y por método de pago. Si hubo cancelaciones inusuales (>5 en un día normal de 3), aparece la sección de anti-fraude con el detalle.

Si quiere saber qué mesero tuvo el mejor día, abre `/meseros`. Si quiere saber si los descuentos de hoy fueron normales, abre `/cancelaciones`.

### Lunes — La Semana

Cada lunes, dos agentes generan reportes automáticos:

**Menu Engineering** clasifica los platillos del menú en la matriz BCG: Estrellas (alta popularidad + alto margen), Caballos (alta popularidad + bajo margen), Puzzles (baja popularidad + alto margen), Perros (baja popularidad + bajo margen). No como un ejercicio académico — como una lista de acciones: "Sube el precio del Tostado de Aguacate (Puzzle), descontinúa el Waffle de Nutella (Perro), ponle push a los Smoothies (Estrella subexplotada)."

**Staffing** cruza las ventas históricas por día de semana con el número de meseros por turno. Si los jueves hay 30% más ventas que los martes pero el mismo número de meseros, lo detecta.

### Semana 1 del Mes — El Inventario

El almacenista hace la **toma física**: va por cada almacén con su teléfono o tablet, ingresa los conteos reales. El sistema los compara con el sistema y calcula las varianzas. Al final, el gerente ve: "Faltan 3.2 KG de carne molida (valor: $280). Hay 1.5 cajas de aguacate de más (valor: $120)."

Si la varianza en un producto supera el umbral (configurable), es un flag automático para investigar: ¿merma no registrada? ¿robo? ¿error de entrada?

### Primer Día Hábil del Mes — El Reporte Fiscal

El contador abre `/reporte-fiscal`, selecciona el mes que cerró, y genera el reporte. Obtiene: total facturado, total de compras con CFDI, IVA trasladado, IVA acreditable, IVA neto a pagar. Con un click, descarga el CSV para su sistema contable.

En `/contabilidad`, puede generar las pólizas diarias de todo el mes y exportarlas en formato CONTPAQi XML. No necesita pedirle nada al restaurante — los datos ya están en el sistema.

---

## Dominio por Dominio — Formato de Auditoría

Para cada dominio se responden las 9 preguntas del marco de producto:

```
1. Qué hace
2. Problema operativo que resuelve
3. Quién lo usa y con qué frecuencia
4. Cómo Wansoft lo hace (o no lo hace)
5. Cómo Fullsite lo hace (o debería hacer)
6. Veredicto
7. Principios que aplican
8. Cuando falla
9. Oportunidades
```

---

### A — HOME EJECUTIVO Y ANALYTICS

**Qué hace:** Muestra el estado actual del restaurante: ventas de hoy, comparación vs. promedio, KPIs, tendencias. Es el lugar donde el gerente empieza su día.

**Problema operativo:** El gerente no puede revisar 6 reportes distintos cada mañana. Necesita una sola pantalla que le diga si el restaurante va bien o mal en 30 segundos.

**Quién y cuándo:** Gerente general y dueño, diariamente. Es el reporte más visto del sistema.

**Cómo Wansoft:** Pantalla de inicio con cifras básicas del día. No configurable, no interactivo, no compara períodos.

**Cómo Fullsite:** 13 widgets configurables. KPIs con sparklines 7 días. Selector de periodo. Comparación vs. promedio histórico. Tendencias visuales (heatmap, area charts). Auto-refresh.

**Veredicto: MEJOR.** La brecha principal es que Wansoft requiere abrir múltiples reportes para obtener la misma visión que Fullsite da en una pantalla. Fullsite está a la par del mejor dashboard de industria (Toast, Square).

**Principios:** D1 (decisiones no reportes), D8 (mono-restaurante UX).

**Cuando falla:** Si el scraper de Wansoft no actualizó en >24h, los datos del home se vuelven datos del día anterior. El badge de "datos de ayer" existe pero es fácil pasarlo por alto. El agente `wansoft-staleness` debe hacer esta alerta más prominente en el home.

**Oportunidades:**
- Widget de "tareas del día" (reservaciones del día, facturas pendientes, reorden de inventario)
- Alerta de propinas anómalas directa en home
- Botón de acceso rápido a Coach desde home

---

### B — VENTAS Y ANÁLISIS DE INGRESOS

**Qué hace:** Desglosa las ventas por periodo, categoría, método de pago, y tipo de orden. Incluye detección de patrones anti-fraude (cancelaciones, cortesías, descuentos).

**Problema operativo:** El gerente necesita entender no solo cuánto vendió sino por qué. Un día malo puede ser por demanda baja, por fraude, por falta de stock, o por mal servicio. La pantalla de ventas debe diferenciarlos.

**Quién y cuándo:** Gerente, diariamente al cierre. También contador (mensualmente para CFDI).

**Cómo Wansoft:** Reporte de ventas diario (corte Z) + reporte de cancelaciones separado. No están en la misma pantalla. No hay detección de patrones.

**Cómo Fullsite:** Una pantalla con ventas + anti-fraude integrado. Cancelaciones, anulaciones y cortesías aparecen en la misma vista que las ventas. El umbral de "alerta" (>1.5% de ventas en descuentos) está visible.

**Veredicto: MEJOR.** La integración de anti-fraude con el reporte de ventas es una decisión de diseño correcta. Wansoft separa estos reportes, lo que hace que el fraude sea más fácil de no ver.

**Principios:** D1, D5 (silencio peor que alerta falsa).

**Cuando falla:** El análisis de anti-fraude depende de que Wansoft scrapeé correctamente los campos de cancelaciones. Si Wansoft cambia su estructura de datos, la sección anti-fraude puede quedar vacía sin advertencia.

**Oportunidades:**
- Comparativo mismo día semana anterior (¿este martes fue mejor o peor que el martes pasado?)
- Alerta automática si cancelaciones >N en un turno específico (por mesero o por terminal)
- Export CSV de cancelaciones con mesero y motivo

---

### C — CORTES Y CAJA

**Qué hace:** Registra y visualiza los cierres de caja: efectivo, tarjeta, retiros, depósitos. Permite la conciliación con estado de cuenta bancario.

**Problema operativo:** El restaurante tiene dinero físico que entra y sale de la caja todos los días. Sin control de efectivo, el faltante se detecta semanas después. La conciliación con el banco toma horas si se hace manualmente.

**Quién y cuándo:** Cajero (por turno), gerente (diario), contador (mensual).

**Cómo Wansoft:** Cortes Z, X, Y, por mesero, mensual. Son reportes de impresión, no interactivos. La conciliación bancaria no existe en Wansoft.

**Cómo Fullsite:**
- `/cortes` — heatmap de 90 días + tabla de cierres
- `/control-efectivo` — flujo cronológico de caja con depósitos bancarios
- `/conciliacion` — upload de estado de cuenta CSV + matching automático de ventas tarjeta vs. depósitos

**Veredicto: MEJOR** en conciliación (no existe en Wansoft). EQUIVALENTE en cortes básicos. **INFERIOR** en Corte X (parcial del turno — no implementado).

**Principios:** D1 (la conciliación habilita la decisión de cuándo depositar y detecta comisiones excesivas de terminal).

**Cuando falla:** El matching de conciliación depende de que los depósitos del banco coincidan con la fecha de las ventas (hay desfase de 1-2 días hábiles en procesadoras). El algoritmo actual no tiene tolerancia de fecha.

**Oportunidades:**
- Corte X (cierre parcial por turno) — brecha real vs. Wansoft
- Tolerancia de ±2 días hábiles en conciliación
- Alerta automática si comisión de terminal >3% (fraude de procesadora)
- Reimpresión de corte desde dashboard (actualmente solo desde POS)

---

### D — INVENTARIO

**Qué hace:** Gestiona el ciclo completo de inventario: entradas, merma, toma física, transferencias, reorden, producción interna.

**Problema operativo:** El restaurante puede perder 10-15% de food cost por merma no registrada, sobrestock, y robos no detectados. Sin inventario real, el food cost es una estimación. Con inventario real, es un número.

**Quién y cuándo:** Almacenista (diario para entradas/merma), chef (producción), gerente (revisión semanal), contador (toma física mensual).

**Cómo Wansoft:** Módulo de inventario con entradas y merma básicas. Sin subproductos, sin producción interna, sin CFDI XML, sin barcode.

**Cómo Fullsite:** 15 sub-módulos con ciclo de vida completo. La capacidad técnica existe. **El problema es que el loop no está cerrado**: barcode, transferencias, y devoluciones registran eventos pero no actualizan `pos_inventory_products.stock`. Esto significa que el inventario en pantalla puede diferir del inventario real incluso después de registrar movimientos.

**Veredicto: EQUIVALENTE** (paridad de features) pero con una **brecha crítica de integridad de datos** (P0).

**Principios:** D6 (el inventario es un loop cerrado o no existe), D5 (ilusión de control es peor que no tener control).

**Cuando falla:** El escenario más peligroso: el almacenista registra una transferencia de Cocina a Barra. Ve el registro en `/movimientos`. Pero el stock de Cocina no bajó y el de Barra no subió. Si hace una toma física esa misma tarde, los números no cuadran y no sabe por qué.

**Oportunidades (post P0-fix):**
- Alertas de stock mínimo en tiempo real (cuando pos_inventory.stock < reorder_point)
- Dashboard de "estado del almacén" al inicio de cada turno
- Historial de costo por ingrediente (para detectar inflación de proveedores)
- Integration con toma física por barcode
- OC pre-llenada automáticamente desde reorder alerts

---

### E — FOOD COST Y RECETAS

**Qué hace:** Calcula el costo real de cada platillo a partir de sus ingredientes, los compara con el precio de venta, y detecta márgenes preocupantes.

**Problema operativo:** Un restaurante puede vender mucho y perder dinero si el food cost está mal. El food cost se calcula una vez y se olvida. Con ingredientes cuyo precio cambia mensualmente, el margen real puede diferir del margen estimado en 20-30 puntos.

**Quién y cuándo:** Gerente/dueño (mensual), chef (cuando cambia receta), contador (para P&L real).

**Cómo Wansoft:** Costeo básico. En AMALAY, Eduardo tiene una hoja de Excel de costeo que es la fuente de verdad.

**Cómo Fullsite:** 
- `/recetas` — CRUD de recetas con ingredientes y costos
- `/recetas/sub-recetas` — insumos intermedios (masas, salsas)
- `/food-cost` — análisis de margen por platillo con fuzzy matching Wansoft→Fullsite
- `/api/food-cost/calculate` — cálculo dinámico desde costo actual de ingredientes

El matching fuzzy (60% overlap de palabras) puede producir falsos positivos. La fuente de datos ideal es que todos los platillos tengan receta en Fullsite con los ingredientes y costos actualizados.

**Veredicto: EQUIVALENTE** (con caveats). El análisis de food cost existe y funciona. La brecha es que depende de que las recetas estén ingresadas y los costos de ingredientes actualizados. Ni el ingreso de recetas ni la actualización de costos es un flujo guiado en el sistema.

**Principios:** D2 (la pregunta de negocio: "¿cuánto me cuesta este platillo hoy, con los precios de esta semana?"), D9 (el costo no se configura — se calcula).

**Cuando falla:** Si un ingrediente sube de precio y el almacenista no actualiza el costo en la entrada, el food cost calculado es incorrecto. El sistema no tiene forma de saber que el precio está desactualizado.

**Oportunidades:**
- Alerta cuando el costo de un ingrediente sube >10% vs. la última entrada
- Simulador de precio: "Si el aguacate sube a $X, ¿cuántos platillos pierden margen?"
- Timeline de margen por platillo (historial mensual)
- Flag automático de platillos con margen <20% en el home ejecutivo

---

### F — MESEROS Y PERSONAL

**Qué hace:** Analiza la performance de cada mesero: ventas, tickets, propinas, rotación de mesas, cumplimiento de categorías.

**Problema operativo:** El restaurante tiene 10-12 meseros y no todos performan igual. Sin datos por mesero, la evaluación es subjetiva. Con datos, el gerente puede retroalimentar con hechos: "Tu ticket promedio fue $180 vs. el promedio de $210. Los martes vendes 40% menos bebidas que Omar."

**Quién y cuándo:** Gerente (semanal), dueño (mensual para bono/evaluación).

**Cómo Wansoft:** Ventas por mesero en el corte. Sin desglose por categoría, sin comparación entre meseros, sin propinas.

**Cómo Fullsite:** `/meseros` con radar chart, rankings, y desglose por categoría. El agente de Upselling cruza mesero × categoría y detecta brechas. El agente de Staffing cruza ventas × número de meseros por día de semana.

**Veredicto: MEJOR.**

**Cuando falla:** Si los datos de Wansoft (`wansoft_waiter_categories`) no están disponibles, el análisis por categoría no existe. La paridad de features depende de la profundidad del scraper.

**Oportunidades:**
- Leaderboard en tiempo real durante el servicio (accesible desde tablets)
- Propinas reales por mesero (depende de depth scraper — P1)
- Evaluación mensual exportable por mesero (PDF)
- Correlación: ¿los meseros con más tickets venden más bebidas o más postres?

---

### G — IA Y AGENTES

**Qué hace:** Red de 47 agentes autónomos que monitorean, detectan, predicen y sugieren en nombre del restaurante. Sin intervención humana.

**Problema operativo:** El gerente no puede analizar todos los datos del restaurante todos los días. Los agentes sí. El valor está en que el gerente recibe solo lo que requiere acción, no el flujo completo de datos.

**Quién y cuándo:** El sistema corre solo. El gerente recibe alertas en Telegram y puede abrir el dashboard para el detalle.

**Cómo Wansoft:** No existe. Wansoft es un sistema de registro, no de inteligencia.

**Cómo Fullsite:** 14 agentes con páginas dedicadas en `/agentes/`, orquestados por GitHub Actions, con log en `agent_runs` y `agent_results`. Chat IA en `/chat` para consultas ad-hoc. Voz en `/voice` para el piso. Coach en `/coach` para el briefing diario. Mission Control en `/mission-control` para monitoreo del sistema.

**Veredicto: MEJOR** (diferente por diseño — Wansoft no tiene comparación posible aquí).

**Principios:** D4 (IA complementa, no reemplaza), D5 (silencio peor que alerta).

**Cuando falla:** Si el scraper de Wansoft no corre, los agentes que leen de `wansoft_daily` generan alertas con datos incompletos. El agente `wansoft-staleness` y `hermes` monitorean esto. La cadena de dependencias debe ser visible en Mission Control.

**Oportunidades:**
- Agente de **alertas de inventario**: cuando stock < reorder_point, enviar WhatsApp/Telegram
- Agente de **satisfacción de cliente**: analizar encuestas y Google Reviews semanalmente
- Agente de **estado de cuenta**: detectar si la terminal cobró más comisión de lo normal
- **Auto-86**: si el stock de un ingrediente llega a 0, sugerir desactivar el platillo en el menú

---

### H — CFDI Y FACTURACIÓN

**Qué hace:** Gestiona el ciclo de facturas: solicitudes de clientes via QR, emisión via Facturama, descarga PDF/XML, pólizas contables, reporte de IVA mensual.

**Problema operativo:** Los clientes piden factura después de pagar. Si el proceso es manual (dar ticket, esperar email), la experiencia es mala y el error de datos es alto. El sistema debe capturar los datos fiscales correctamente desde el primer contacto.

**Quién y cuándo:** Cajero (en el momento del pago o post-pago), contador (mensual para cierres fiscales).

**Cómo Wansoft:** Emisión manual de CFDI desde el POS. Sin automatización, sin portal de cliente, sin reporte de IVA integrado.

**Cómo Fullsite:**
- `/factura` — form público via QR del ticket para que el cliente ingrese sus datos
- `/facturas` — dashboard del cajero con solicitudes pendientes y emisión
- `/api/factura/timbrar` — estampado vía Facturama
- `/reporte-fiscal` — IVA mensual
- `/contabilidad` — pólizas CONTPAQi

**Brecha crítica:** El flujo QR→solicitud→emisión no es automático. El cliente llena el form, la solicitud queda "pendiente", y alguien tiene que ir a `/facturas` a timbrarla manualmente. Esto no escala.

**Veredicto: INFERIOR** en el flujo de emisión automática. MEJOR en reporte de IVA, pólizas, y portal de cliente (Wansoft no tiene ninguno de estos últimos).

**Principios:** D9 (lo que se puede inferir no se pregunta: el RFC del restaurante debe estar en config, no hardcodeado), D1 (la decisión que habilita: cuánto IVA debo este mes).

**Cuando falla:** Facturama rechaza un CFDI por datos inválidos del receptor (RFC mal escrito, régimen incorrecto). El sistema marca error pero no guía al cajero cómo corregirlo. El resultado: el cliente no recibe su factura y no sabe por qué.

**Oportunidades (P0/P1):**
- Timbrado automático inmediato al recibir la solicitud (no esperar intervención manual)
- Validación de RFC contra SAT antes de guardar la solicitud
- Notificación automática al cliente (email/WhatsApp) cuando la factura está lista
- Dashboard de CFDI pendientes en el home ejecutivo (número visible siempre)
- Complemento de pago con UI (P1)

---

### I — CRM Y LEALTAD

**Qué hace:** Gestiona la relación con clientes frecuentes: historial de visitas, preferencias, tags, y (en el futuro) programa de puntos.

**Problema operativo:** Un restaurante con 200 clientes frecuentes que no los reconoce pierde la oportunidad de fidelizarlos. El gerente no puede recordar quién es quién — el sistema sí.

**Quién y cuándo:** Gerente de relaciones/anfitrión (al momento de recibir al cliente), gerente (para campañas y decisiones de menú).

**Cómo Wansoft:** Base de clientes básica. Sin historial por cliente, sin tags, sin programa de lealtad integrado con el POS.

**Cómo Fullsite:**
- `/clientes` — CRUD básico
- `/crm` — perfiles completos con tags, historial, birthday
- `/lealtad` — configurador de puntos (solo localStorage, no funcional)
- `/encuestas` — NPS y encuestas de satisfacción con QR

**Brecha sistémica:** Los clientes no se asocian automáticamente a las órdenes del POS. La base de datos de clientes existe pero está desconectada del flujo de ventas. Un cliente puede visitar 50 veces y el sistema no lo sabe si nadie lo registra manualmente.

**Veredicto: EQUIVALENTE** en CRM básico. INFERIOR en lealtad (localStorage no cuenta). MEJOR en encuestas (Wansoft no tiene).

**Principios:** D2 (la pregunta: "¿quiénes son mis 20 mejores clientes y cuándo fue la última vez que vinieron?"), D9 (la asignación de cliente a orden no debe ser manual — debe inferirse por teléfono).

**Cuando falla:** El CRM tiene datos porque alguien los ingresó manualmente. Si nadie los ingresa, el CRM está vacío y es invisible. La capacidad existe pero el flujo de captura no.

**Oportunidades:**
- Captura de teléfono al pagar en POS → asocia automáticamente la orden al cliente si existe en el CRM
- Import de Reservy (12.2K clientes) como seed del CRM
- Auto-tag: "frecuente" si visitas >4 en 30 días, "VIP" si gasto >$X
- Lealtad: migrar de localStorage a Supabase (P1) + integrar con checkout POS (P2)
- Alertas de "cumpleaños esta semana" en el home ejecutivo

---

### J — ADMINISTRACIÓN Y CONFIGURACIÓN

**Qué hace:** Gestión del menú, modificadores, formas de pago, usuarios, importación masiva, onboarding de nuevos clientes.

**Problema operativo:** Un restaurante actualiza el menú 2-4 veces por año, agrega meseros, cambia precios. Sin una interfaz de administración clara, estos cambios requieren intervención técnica.

**Quién y cuándo:** Dueño o gerente general (cambios de menú), admin de Fullsite (onboarding), contador (exportaciones).

**Cómo Wansoft:** Admin de menú en sistema local. Requiere acceso al servidor. Sin wizard de onboarding, sin importación masiva.

**Cómo Fullsite:** 13 páginas de admin completamente funcionales, todas con CRUD via Supabase REST. El wizard de onboarding puede levantar un restaurante en 30 minutos.

**Veredicto: MEJOR** (ventaja absoluta en UX de administración). El onboarding wizard no tiene equivalente en Wansoft.

**Brecha única crítica:** El vault de credenciales usa cifrado XOR+Base64 con key hardcodeada en el código cliente. Esto no es seguridad — es ofuscación. Debe migrarse a AES-256 server-side (P0).

**Principios:** D8 (la UX de configuración debe parecer de un solo restaurante, aunque el sistema sirva a 100).

**Oportunidades:**
- Picker de item/categoría en promotions UI (actualmente requiere ingresar IDs)
- Sucursales fetcheadas desde DB (no hardcodeadas)
- Rollback transaccional en carga masiva
- Bóveda con AES-256 + audit log de quién accedió cuándo

---

### K — PERSONAL EXTENDIDO (Nómina, Asistencia)

**Qué hace:** Pre-nómina con horas trabajadas, tarifas horarias y deducciones. Checador de asistencia por PIN.

**Problema operativo:** El gerente quiere saber cuánto le costará la nómina antes de pagarla. Y quiere saber quién llegó tarde.

**Quién y cuándo:** Gerente (quincenal para pre-nómina), cajero o mesero (diario para checada).

**Cómo Wansoft:** Nómina no existe. Asistencia básica.

**Cómo Fullsite:** 
- `/nomina` — cálculo de pre-nómina con tarifas editables
- `/pos/asistencia` — checador PIN con secuencia entrada/salida
- `/pos/auditoria` — log inmutable de acciones

**Veredicto:** EQUIVALENTE en asistencia. DIFERENTE POR DISEÑO en nómina (Wansoft tiene módulo completo, Fullsite tiene pre-nómina, decisión correcta por ahora).

**Oportunidades:**
- Biométrico (estructura existe en código pero no implementado)
- Link entre asistencia y nómina (calcular horas automáticamente)
- Alerta si empleado no ha checado entrada y el turno empezó hace 30 minutos

---

## Exports — Estándar de Producto

Toda función de export en Fullsite debe cumplir:

| Dimensión | Estándar |
|---|---|
| Formato | CSV (default, Excel-compatible con BOM UTF-8) + PDF para reportes de presentación |
| Filtros en export | Los filtros aplicados en pantalla viajan al CSV (rango de fechas, agrupación, búsqueda) |
| Columnas | Exportar exactamente lo que está en pantalla + columnas de contexto (periodo, generado por, fecha de generación) |
| Agrupación | Si el reporte está agrupado (por sucursal, por categoría), el CSV mantiene la estructura |
| Metadatos | Primera fila: nombre del reporte, periodo, usuario, fecha/hora de generación |
| Permisos | Log de quién exportó qué y cuándo, especialmente datos sensibles (nómina, clientes) |
| Reportes programados | Los reportes de uso frecuente (fiscal mensual, cortes semanales) deben poder configurarse para enviarse automáticamente |

**Estado actual:** 3 módulos tienen export (Reportes, Reporte Fiscal, Encuestas). Ninguno cumple el estándar completo (todos son exports "planos" sin metadatos ni filtros aplicados). Este es un gap transversal de P2.

---

## Configurabilidad — Decisiones de Arquitectura

| Elemento | Actualmente | Debe ser |
|---|---|---|
| Tarifa horaria de nómina | Hardcodeada ($62.50) | Config por empleado + config default por restaurante |
| Labor cost % para P&L | Hardcodeado (25%) | Calculado desde wansoft_labor (automático) |
| RFC de empresa en pólizas | Hardcodeado (XXXXXXXXXXXX) | Config de restaurante en tabla `clients` |
| Tiers de precio en retail | Hardcodeados ($0-49, $50-99…) | Configurables por restaurante |
| Razones de merma | Lista fija en código | Configurable por restaurante |
| Sucursales disponibles | Hardcodeadas (3) | Fetcheadas de tabla `sucursales` |
| Thresholds anti-fraude | Hardcodeados (>1.5% descuentos) | Configurables, con IA aprendiendo el umbral real del restaurante |
| Puntos de reorden | Config en snapshot (desconectado) | Almacenados en `pos_ingredients` en tiempo real |
| Order-type config modificadores | Solo en memoria (no persiste) | Columna en `pos_modifiers` |
| Vault encryption key | En código fuente | Server-side, nunca en cliente |

---

## Apéndice A — Páginas y Estado Resumido

| Ruta | Dominio | Status | Veredicto vs. Wansoft |
|---|---|---|---|
| / | Home | OPERATIVA | MEJOR |
| /ventas | Analytics | OPERATIVA | MEJOR |
| /ingresos | Analytics | OPERATIVA | MEJOR |
| /cortes | Analytics | OPERATIVA | EQUIVALENTE |
| /caja | Analytics | OPERATIVA | EQUIVALENTE |
| /tendencias | Analytics | OPERATIVA | MEJOR |
| /estado-resultados | Analytics | PARCIAL | INFERIOR |
| /platillos | Analytics | OPERATIVA | MEJOR |
| /cancelaciones | Analytics | OPERATIVA | MEJOR |
| /propinas | Analytics | PARCIAL | INFERIOR |
| /reporte-fiscal | CFDI | OPERATIVA | EQUIVALENTE |
| /contabilidad | CFDI | OPERATIVA | MEJOR |
| /facturas | CFDI | OPERATIVA | MEJOR |
| /factura | CFDI | INFRAESTRUCTURA | INFERIOR |
| /notas-credito | CFDI | INFRAESTRUCTURA | INFERIOR |
| /cuentas-por-cobrar | CFDI | OPERATIVA | EQUIVALENTE |
| /control-efectivo | Caja | OPERATIVA | MEJOR |
| /conciliacion | Caja | OPERATIVA | MEJOR |
| /reportes | Reportes | OPERATIVA | EQUIVALENTE |
| /reportes/ingresos | Reportes | OPERATIVA | MEJOR |
| /inventario-real | Inventario | OPERATIVA | EQUIVALENTE |
| /inventario-real/entradas | Inventario | OPERATIVA | MEJOR |
| /inventario-real/entradas-factura | Inventario | OPERATIVA | MEJOR |
| /inventario-real/merma | Inventario | OPERATIVA | MEJOR |
| /inventario-real/movimientos | Inventario | OPERATIVA | MEJOR |
| /inventario-real/toma-fisica | Inventario | OPERATIVA | EQUIVALENTE |
| /inventario-real/orden-compra | Inventario | PARCIAL | INFERIOR |
| /inventario-real/reorden | Inventario | PARCIAL | INFERIOR |
| /inventario-real/produccion | Inventario | OPERATIVA | MEJOR |
| /inventario-real/subproductos | Inventario | OPERATIVA | MEJOR |
| /inventario-real/transferencias | Inventario | OPERATIVA | EQUIVALENTE |
| /inventario-real/barcode | Inventario | OPERATIVA | MEJOR |
| /inventario-real/devoluciones | Inventario | OPERATIVA | EQUIVALENTE |
| /inventario-real/costos | Inventario | OPERATIVA | EQUIVALENTE |
| /inventario-real/presentaciones | Inventario | OPERATIVA | MEJOR |
| /inventario-real/conversiones | Inventario | OPERATIVA | MEJOR |
| /recetas | Food Cost | OPERATIVA | EQUIVALENTE |
| /recetas/sub-recetas | Food Cost | OPERATIVA | MEJOR |
| /food-cost | Food Cost | OPERATIVA | EQUIVALENTE |
| /compras | Inventario | OPERATIVA | EQUIVALENTE |
| /proveedores | Inventario | OPERATIVA | EQUIVALENTE |
| /inventario | Inventario | OPERATIVA | EQUIVALENTE |
| /agentes | IA | OPERATIVA | MEJOR |
| /agentes/anomalias | IA | OPERATIVA | MEJOR |
| /agentes/antifraude | IA | OPERATIVA | MEJOR |
| /agentes/clima | IA | OPERATIVA | MEJOR |
| /agentes/cocina | IA | OPERATIVA | MEJOR |
| /agentes/desperdicio | IA | OPERATIVA | MEJOR |
| /agentes/hermes | IA | OPERATIVA | MEJOR |
| /agentes/menu | IA | OPERATIVA | MEJOR |
| /agentes/prediccion | IA | OPERATIVA | MEJOR |
| /agentes/propinas-agente | IA | OPERATIVA | MEJOR |
| /agentes/proveedores-agente | IA | OPERATIVA | MEJOR |
| /agentes/staffing | IA | OPERATIVA | MEJOR |
| /agentes/tiempo-mesa | IA | OPERATIVA | MEJOR |
| /agentes/upselling | IA | OPERATIVA | MEJOR |
| /chat | IA | OPERATIVA | DIFERENTE POR DISEÑO |
| /voice | IA | OPERATIVA | DIFERENTE POR DISEÑO |
| /coach | IA | OPERATIVA | DIFERENTE POR DISEÑO |
| /mission-control | IA | OPERATIVA | DIFERENTE POR DISEÑO |
| /meseros | Personal | OPERATIVA | MEJOR |
| /nomina | Personal | OPERATIVA | DIFERENTE POR DISEÑO |
| /pos/asistencia | Personal | OPERATIVA | EQUIVALENTE |
| /pos/auditoria | Personal | OPERATIVA | MEJOR |
| /pos/staff | Personal | INFRAESTRUCTURA | INFERIOR |
| /pos/staff-analytics | Personal | INFRAESTRUCTURA | INFERIOR |
| /admin/menu | Admin | OPERATIVA | EQUIVALENTE |
| /admin/grupos | Admin | OPERATIVA | EQUIVALENTE |
| /admin/modificadores | Admin | OPERATIVA | EQUIVALENTE |
| /admin/tamaños | Admin | OPERATIVA | EQUIVALENTE |
| /admin/formas-pago | Admin | OPERATIVA | EQUIVALENTE |
| /admin/promociones | Admin | OPERATIVA | MEJOR |
| /admin/horarios | Admin | OPERATIVA | EQUIVALENTE |
| /admin/usuarios | Admin | OPERATIVA | EQUIVALENTE |
| /admin/carga-masiva | Admin | OPERATIVA | MEJOR |
| /admin/exportar | Admin | OPERATIVA | EQUIVALENTE |
| /admin/onboarding | Admin | OPERATIVA | MEJOR |
| /admin/vault | Admin | OPERATIVA ⚠️ | MEJOR (con riesgo) |
| /admin/domicilio | Admin | OPERATIVA | MEJOR |
| /sucursales | Admin | OPERATIVA | EQUIVALENTE |
| /seguridad | Admin | OPERATIVA | MEJOR |
| /configuracion/cuentas | Admin | OPERATIVA | MEJOR |
| /clientes | CRM | OPERATIVA | EQUIVALENTE |
| /crm | CRM | OPERATIVA | MEJOR |
| /lealtad | CRM | INFRAESTRUCTURA | INFERIOR |
| /encuestas | CRM | OPERATIVA | MEJOR |
| /encuesta/[id] | CRM | OPERATIVA | MEJOR |
| /delivery | Delivery | PARCIAL | EQUIVALENTE |
| /ecommerce | Delivery | PARCIAL | EQUIVALENTE |
| /admin/tienda/articulos | Retail | OPERATIVA | DIFERENTE POR DISEÑO |
| /admin/tienda/grupos | Retail | INFRAESTRUCTURA | DIFERENTE POR DISEÑO |
| /admin/tienda/precios | Retail | OPERATIVA | DIFERENTE POR DISEÑO |
| /admin/tienda/promociones | Retail | INFRAESTRUCTURA | DIFERENTE POR DISEÑO |

---

## Apéndice B — Consolidado de Veredictos

| Veredicto | Total | Páginas representativas |
|---|---|---|
| MEJOR | 38 | Analytics, IA, Inventario avanzado, Admin |
| EQUIVALENTE | 24 | Configuración básica, CRUD estándar, reportes base |
| INFERIOR | 8 | P&L, CFDI flujo, propinas, staff CRUD |
| DIFERENTE POR DISEÑO | 8 | Chat/voz, retail, pre-nómina, mission control |
| INFRAESTRUCTURA | 9 | Vault, factura QR, notas crédito, lealtad, staff |

---

*Documento de referencia oficial para la evolución del Dashboard Fullsite. 2026-07-25.*  
*Complementa: FULLSITE-DASHBOARD-CAPABILITY-AUDIT.md y FULLSITE-DASHBOARD-GAP-ANALYSIS.md*
