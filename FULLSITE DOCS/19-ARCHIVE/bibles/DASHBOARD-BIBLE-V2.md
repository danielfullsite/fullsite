# Dashboard Bible V2 — Diseño de Producto

**Versión:** 2.1  
**Fecha:** 2026-07-23  
**Propósito:** No ser peores que Wansoft en ninguna capacidad importante. Ser claramente mejores en experiencia, velocidad e inteligencia.  
**Referencia técnica:** `FULLSITE-DASHBOARD-BIBLE.md` (arquitectura, código, flujos)

---

## Estatus del documento

Este documento es la **especificación funcional oficial del Dashboard de Fullsite**.

Cualquier cambio importante al dashboard debe reflejarse primero aquí antes de implementarse. Si el código y este documento divergen, el documento tiene razón — el código necesita corregirse, no al revés.

---

## Reglas de mantenimiento

### Regla 1 — El documento siempre refleja el estado actual

Cuando un recorrido responde una pregunta:
- Eliminar `[HIP]`
- Reemplazar por `[OBS-WANSOFT]`, `[EDU]`, `[AMALAY]` o la fuente correspondiente
- Actualizar la comparativa
- Actualizar la prioridad si cambia

No existen secciones de notas temporales ni anexos. El documento siempre queda consistente. Un `[HIP]` que sobrevive a un recorrido es un error de mantenimiento.

### Regla 2 — Todo hallazgo cambia el diseño

Si un recorrido demuestra que una decisión de diseño estaba equivocada, no solo documentar el hallazgo. Actualizar inmediatamente:
- GAP del conocimiento (cerrar o reformular)
- Comparativa (cambiar símbolo y fuente)
- Diseño del producto (ajustar si el problema que resuelve era diferente a lo asumido)
- Prioridad (P0/P1/P2/P3 puede cambiar con evidencia real)
- Decisión de implementar (puede revertirse si el uso real no justifica el esfuerzo)

El documento evoluciona. No acumula capas.

### Regla 3 — Changelog al final

Todo recorrido completado se registra en el changelog con: fecha, recorrido, qué se confirmó, qué se descartó, qué GAP nuevo apareció. El historial permite reconstruir cómo evolucionó el producto.

---

## Norte

El cliente migra de Wansoft a Fullsite. Si en algún momento siente que perdió una capacidad que tenía antes, eso es un defecto de producto — no de código, no de UX — de producto.

La migración es exitosa cuando el cliente ya no quiere regresar a Wansoft. Eso requiere dos condiciones: paridad en lo funcional, superioridad en todo lo demás.

---

## Proceso por módulo (siempre en este orden)

### Paso 1 — Reverse Engineering

Entender Wansoft antes de diseñar Fullsite.

- ¿Qué problema resuelve este módulo?
- ¿Qué información muestra exactamente?
- ¿Qué acciones permite ejecutar?
- ¿Qué decisión ayuda a tomar el gerente?

Sin inferencias. Si falta evidencia directa, marcar `PENDIENTE DE VALIDACIÓN` con la pregunta exacta que hay que responder.

### Paso 2 — Paridad funcional

Para cada capacidad de Wansoft responder: ¿Fullsite ya puede resolver exactamente ese mismo problema?

No importa si la UI es diferente. Lo que importa es que el cliente no pierda ninguna capacidad al migrar.

### Paso 3 — Diferenciación

Solo después de confirmar paridad:
- ¿Cómo hacemos que sea más rápido?
- ¿Cómo reducimos clics?
- ¿Qué contexto adicional podemos mostrar?
- ¿Qué se puede automatizar?
- ¿Qué puede resolver IA sin intervención del gerente?

### Paso 4 — Decisión de implementar

Para cada capacidad de Wansoft que Fullsite no tiene todavía, responder las tres preguntas:

1. ¿Los clientes realmente la usan?
2. ¿Resuelve un problema vigente?
3. ¿Si Fullsite no la tiene, el cliente sentiría que el sistema está incompleto?

Si las tres son sí → buscar paridad.  
Si alguna es no → documentar explícitamente por qué decidimos no implementarla.

---

## Leyenda de fuentes de verdad

Toda conclusión en este documento debe citar su fuente:

| Etiqueta | Fuente |
|---|---|
| `[OBS-WANSOFT]` | Evidencia observada directamente en Wansoft (captura, video, texto de pantalla) |
| `[EDU]` | Entrevista o sesión de trabajo con Eduardo de la Garza |
| `[AMALAY]` | Datos reales de operación en AMALAY |
| `[FULLSITE]` | Decisión de diseño de Fullsite (no observada en Wansoft) |
| `[HIP]` | Hipótesis pendiente de validar |

---

## Clasificación de prioridad

Toda capacidad identificada — ya sea de Wansoft o propia de Fullsite — debe clasificarse:

| Nivel | Nombre | Criterio |
|---|---|---|
| **P0** | Obligatoria | Si Fullsite no la tiene, un restaurante serio sentiría que el sistema está incompleto. Debe existir antes del rollout. |
| **P1** | Esperada | Muchos clientes la usan y aporta valor claro. Debe existir, pero no necesariamente en la primera versión. |
| **P2** | Diferenciador | No existe en Wansoft o Fullsite puede hacerlo significativamente mejor. Aquí va la mayor inversión de innovación. |
| **P3** | Legado / Baja prioridad | Existe en Wansoft pero con poco uso, fue creada por compatibilidad histórica, o no aporta valor para la mayoría de los clientes. No se implementa hasta que exista evidencia de necesidad real. |

La prioridad se asigna por capacidad, no por módulo. Un módulo puede tener capacidades P0, P1 y P3 al mismo tiempo.

---

## Leyenda de comparativa

| Símbolo | Significado |
|---|---|
| ✅ | Existe y funciona |
| 🚧 | En construcción o parcialmente implementado |
| ❌ | No existe |
| `—` | No aplica o decisión de no implementar (documentada) |

---

## Prioridad de clusters

| # | Cluster | Justificación |
|---|---|---|
| 1 | Reportes | Más usado diariamente. Más fragmentado en Fullsite. Mayor riesgo de que el cliente sienta regresión |
| 2 | Inventario + Recetas + Costeo | 4 páginas construidas sin evidencia del backoffice. Alta divergencia probable |
| 3 | Compras + Proveedores | Tablas propias sin validar contra Wansoft. Datos del home sugieren features desconocidos |
| 4 | Control de Efectivo + Egresos | Auditoría de caja es crítica para la confianza del dueño |
| 5 | Facturación | Dos módulos separados en Wansoft, uno en Fullsite. Posible gap |
| 6 | Administración | Desconocido completo — puede tener features bloqueantes |

---

## CLUSTER 1 — Reportes

### Paso 1 — Reverse Engineering de Wansoft

**Problema que resuelve:** El gerente necesita saber cómo fue el negocio — hoy, esta semana, este mes — sin tener que abrir el POS ni hablar con el cajero.

**Información que muestra** `[HIP — pendiente R1]`:

El módulo "Reportes" en Wansoft backoffice existe como categoría principal del menú. Se asume que tiene sub-reportes pero no tenemos evidencia de cuántos ni cómo se llaman.

Lo que sí sabemos de `wansoft_daily` (fuente scrapeada `[AMALAY]`):
- Ventas brutas y ventas netas (con descuentos separados)
- Total por método de pago (efectivo, tarjeta crédito, tarjeta débito, transferencia, Uber Eats)
- Tickets count, mesas atendidas, personas en restaurante
- Ticket promedio restaurante
- Propinas totales
- Ventas por mesero (jsonb: nombre + total)
- Platillos top (jsonb)
- Ventas por grupo de menú (jsonb)
- Cancelaciones implícitas en devoluciones

Lo que NO sabemos todavía `[HIP]`:
- Si el módulo Reportes tiene sub-reportes separados o una vista consolidada
- Qué columnas exactas muestra el reporte de meseros (¿solo total? ¿covers? ¿ticket promedio? ¿propinas? ¿cancelaciones?)
- Si existe comparativo automático vs. período anterior
- Si hay granularidad por hora (heatmap intraday)
- Si existe un reporte de cancelaciones con detalle (razón, mesero, hora)
- Si hay exportación a Excel/PDF integrada
- Si el reporte de "Ingresos" es lo mismo que métodos de pago o un concepto diferente

**Acciones que permite** `[HIP]`:
Probablemente: filtrar por fecha, ver detalle, exportar. No confirmado.

**Decisión que ayuda a tomar:**
- ¿Cómo vamos vs. la semana pasada?
- ¿Quién vendió más?
- ¿Qué platillos conviene quitar del menú?
- ¿Hay cancelaciones sospechosas?

**PENDIENTE DE VALIDACIÓN — Recorrido R1:**
```
Preguntas a cerrar:
1. ¿Cómo organiza Wansoft el módulo Reportes? ¿Sub-reportes o vista única?
2. Columnas exactas del reporte de meseros
3. ¿Existe comparativo automático vs. período anterior?
4. ¿Hay reporte intraday por hora?
5. ¿El reporte de cancelaciones incluye razón, mesero y hora?
6. ¿Hay exportación a Excel/PDF?
7. ¿"Ingresos" = métodos de pago o es algo diferente?
```

### Paso 2 — Paridad funcional

Fullsite tiene 7 páginas que cubren lo que probablemente es un solo módulo en Wansoft. La cobertura de datos es buena — el schema de `wansoft_daily` ya tiene todo. El riesgo es que la fragmentación haga que el gerente extrañe la navegación de Wansoft.

| Capacidad | Wansoft | Fullsite | Estado | Prioridad |
|---|---|---|---|---|
| Ver ventas del día / semana / mes | ✅ | ✅ `/ventas` | Paridad | P0 |
| Ver ventas por método de pago | ✅ | ✅ `/ventas` | Paridad | P0 |
| Ver ventas por grupo de menú | ✅ | ✅ `/ventas`, `/platillos` | Paridad | P0 |
| Ver ventas por mesero | ✅ | ✅ `/meseros` | Paridad | P0 |
| Ver ticket promedio y covers | ✅ | ✅ `/ventas` | Paridad | P0 |
| Ver propinas totales | ✅ | ✅ `/propinas` | Paridad | P1 |
| Ver propinas por mesero | ✅ | ✅ `/propinas` | Paridad | P1 |
| Ver cancelaciones con detalle (mesero, razón, hora) | ✅ | 🚧 `/cancelaciones` — limitado | Pendiente | P0 |
| Comparativo automático vs. período anterior | `[HIP]` | ✅ `/ventas` ya tiene delta | Por confirmar | P1 |
| Exportar a Excel/PDF | `[HIP]` | ❌ | Pendiente validar si Wansoft lo tiene | P1 |
| Ver reporte intraday por hora | `[HIP]` | ❌ | Pendiente validar si Wansoft lo tiene | P1 |
| Columnas detalladas por mesero (covers, TP, propinas, cancelaciones) | `[HIP]` | 🚧 Solo total vendido | Pendiente | P1 |
| Narrative automático semanal por IA | ❌ | 🚧 (agentes Telegram) | Diferenciador | P2 |
| Alertas proactivas de anomalías | ❌ | 🚧 (anomaly_detector.py) | Diferenciador | P2 |

### Paso 3 — Diferenciación

**¿Cómo ser más rápido?**
Wansoft tiene sync delay — el backoffice puede mostrar datos con horas de lag `[EDU]`. Fullsite mezcla `wansoft_daily` (histórico) con `pos_orders` en tiempo real. El gerente ve lo que pasó hace 5 minutos, no lo que Wansoft sincronizó hace 4 horas.

**¿Cómo reducir clics?**
El Home de Fullsite ya consolida los KPIs clave en una pantalla. El gerente no necesita navegar a 7 páginas separadas para ver el resumen del día. Las 7 páginas son para profundizar.

**¿Qué contexto adicional?**
- Correlaciones que Wansoft no hace: ¿el mesero con más ventas también tuvo más cancelaciones?
- Tendencia de 4 semanas en el mismo widget, no solo el día.
- Comparativo DOW (day-of-week) — el martes de esta semana vs. el promedio de martes. Ya implementado en `/ventas`.

**¿Qué puede automatizar IA?**
- Narrative semanal automático en Telegram: "Esta semana vendiste $87,400 (+12%). El martes fue tu mejor día. Gabriela tuvo el ticket promedio más alto ($284). Las cancelaciones bajaron a 4."
- Alerta proactiva: "Las ventas de 2-4pm llevan 3 días consecutivos bajo el promedio histórico."
- Detección de platillo en caída: "Las Enchiladas Suizas no aparecen en el top-10 esta semana. Verificar disponibilidad."

### Paso 4 — Decisión de implementar

| Capacidad | ¿Se usa? | ¿Problema vigente? | ¿Sentiría su ausencia? | Decisión |
|---|---|---|---|---|
| Exportar a Excel | `[HIP]` | Sí — Andy lo pide | Sí | Implementar si confirmamos que Wansoft lo tiene |
| Reporte intraday | `[HIP]` | Sí — staffing | Probablemente no a corto plazo | Evaluar post-validación |
| Cancelaciones con razón + mesero | Sí `[AMALAY]` | Sí — anti-fraude | Sí | Implementar — prioridad |
| Columnas completas mesero (covers, TP, propinas, cancelaciones) | `[HIP]` | Sí — evaluación de desempeño | Sí | Implementar post-R1 |

---

## CLUSTER 2 — Inventario + Recetas + Costeo

### Paso 1 — Reverse Engineering de Wansoft

**Problema que resuelve:** El gerente / almacenista necesita saber qué hay en stock, cuánto cuesta producir cada platillo, y si el consumo real de ingredientes coincide con lo que deberían haber consumido según las ventas.

**Información que muestra:**

Lo que sí sabemos `[OBS-WANSOFT]` (de la pantalla de home):
- "Puntos de reorden": hay ingredientes bajo el punto mínimo
- "Productos por caducar: 4928.2977" — existe un módulo de fechas de caducidad (unidad desconocida)

Lo que sabemos de Eduardo `[EDU]`:
- Wansoft tiene sub-recetas (una receta puede contener otra receta)
- Existe un "factor de rendimiento" — un ajuste por merma o proceso de preparación
- Los precios de ingredientes fluctúan y se capturan en las OCs

Lo que NO sabemos `[HIP]`:
- Pantalla principal de inventario — columnas exactas
- Si la deducción de ingredientes es automática (al vender) o manual (batch al final del día)
- Cómo funciona el flujo de "Cierre de inventario" — ¿es una toma física vs. teórico?
- Si existe reporte de varianza (teórico vs. consumo real)
- Si los costos del inventario se actualizan automáticamente al registrar una OC
- Qué significa "4928.2977" en "Productos por caducar" — kilos, piezas, valor monetario

**Acciones que permite** `[HIP]`:
- Ver existencia por ingrediente
- Ajustar stock manualmente
- Registrar merma
- Ver o editar recetas
- Hacer cierre de inventario (toma física)

**Decisión que ayuda a tomar:**
- ¿Tengo suficiente para operar hoy?
- ¿Qué necesito comprar esta semana?
- ¿Hay merma inusual?
- ¿El costo de mis platillos refleja los precios actuales de ingredientes?

**PENDIENTE DE VALIDACIÓN — Recorrido R2:**
```
Preguntas a cerrar:
1. Pantalla principal de inventario — columnas exactas
2. ¿La deducción de ingredientes es automática o manual en Wansoft?
3. ¿Cómo funciona "Cierre de inventario" exactamente?
4. ¿Existe reporte de varianza (teórico vs. real)?
5. ¿Cómo funciona "factor de rendimiento" — % de merma o % de aprovechamiento?
6. ¿Sub-recetas — cómo se crean? ¿Qué aspecto tiene la pantalla?
7. "4928.2977 productos por caducar" — ¿qué unidad? ¿Qué muestra al hacer click?
```

### Paso 2 — Paridad funcional

| Capacidad | Wansoft | Fullsite | Estado | Prioridad |
|---|---|---|---|---|
| Ver existencia actual por ingrediente | ✅ | ✅ `/inventario` | Paridad | P0 |
| Ver punto de reorden | ✅ `[OBS-WANSOFT]` | ✅ `/inventario` | Paridad | P0 |
| Registrar entrada de inventario (proveedor, precio, cantidad) | ✅ `[HIP]` | ✅ `/inventario-real/entradas` | Paridad | P0 |
| Registrar merma | ✅ `[HIP]` | ✅ | Paridad | P0 |
| Ver y editar recetas con ingredientes | ✅ `[EDU]` | ✅ `/recetas` | Paridad | P0 |
| Sub-recetas (receta dentro de receta) | ✅ `[EDU]` | ❌ | GAP — implementar | P0 |
| Factor de rendimiento por ingrediente | ✅ `[EDU]` | ❌ | GAP — implementar | P0 |
| Cierre de inventario (toma física vs. teórico) | ✅ `[HIP]` | 🚧 `/cierre-inventario` — parcial | Pendiente validar flujo | P0 |
| Reporte de varianza (teórico vs. real consumido) | `[HIP]` | ❌ | Pendiente validar | P1 |
| Alerta de productos por caducar | ✅ `[OBS-WANSOFT]` | ❌ | GAP — evaluar | P1 |
| Costo promedio ponderado por ingrediente | `[HIP]` | ✅ | Paridad probable | P0 |
| Deducción automática de ingredientes al vender | `[HIP]` | 🚧 Fase 2 pendiente | GAP activo | P0 |
| OC auto-generada por inventario + proyección ventas | ❌ | ❌ | Diferenciador | P2 |
| Alerta de varianza semanal por IA | ❌ | ❌ | Diferenciador | P2 |
| Auto-86 cuando stock = 0 | ❌ | ❌ | Diferenciador | P2 |

### Paso 3 — Diferenciación

**Deducción en tiempo real:** Wansoft probablemente hace batch al final del día o no lo hace automáticamente `[HIP]`. Fullsite puede deducir ingredientes al cerrar cada orden — la arquitectura ya está (Fase 2: `computeIngredientDeductions()`).

**Semáforo proactivo en lugar de tabla reactiva:** En vez de que el gerente entre a revisar el inventario, Fullsite puede enviar alerta cuando un ingrediente esté a menos de 2 días de cobertura basado en el ritmo de ventas actual.

**Food cost dinámico:** Cuando llega una OC con precio diferente al histórico, el food cost de cada platillo que usa ese ingrediente se recalcula automáticamente. El gerente ve inmediatamente qué platillos cambiaron de margen.

**¿Qué puede resolver IA?**
- Generar la OC semanal completa: "Basado en tu inventario actual y las ventas del viernes-sábado, necesitas pedir: 4kg de arrachera a Carnes Select, 20L de aceite a SYSCO, 2 cajas de aguacate a Plaza Duendes."
- Alerta de varianza: "Esta semana consumiste 18% más aceite de lo teórico. Posible merma en el turno de la tarde o error en receta."
- Alerta de margen: "El aguacate subió $30/kg. El guacamole cuesta ahora $42 producirlo — margen bajó de 58% a 53%."

### Paso 4 — Decisión de implementar

| Capacidad | ¿Se usa? | ¿Problema vigente? | ¿Sentiría su ausencia? | Decisión |
|---|---|---|---|---|
| Sub-recetas | Sí `[EDU]` | Sí — precisión de costeo | Sí | Implementar — prioridad |
| Factor de rendimiento | Sí `[EDU]` | Sí — food cost incorrecto sin él | Sí | Implementar junto a sub-recetas |
| Reporte de varianza | `[HIP]` | Sí — detectar merma y fraude | Sí | Implementar post-R2 |
| Alertas de caducidad | `[HIP]` | Sí — merma preventiva | Sí | Evaluar post-R2 |
| Deducción automática al vender | `[HIP]` | Sí — inventario en tiempo real | Sí | Arquitectura lista, Fase 2 pendiente |

---

## CLUSTER 3 — Compras + Proveedores

### Paso 1 — Reverse Engineering de Wansoft

**Problema que resuelve:** El gerente / almacenista necesita gestionar qué se pide, a quién, a qué precio, y si lo que llegó coincide con lo que se pidió.

**Información que muestra:**

Lo que sí sabemos `[OBS-WANSOFT]` (de la pantalla de home de Wansoft):
- "Compras por proveedor" — existe un reporte de gasto por proveedor
- "Compras por producto" — existe un reporte de compra por ingrediente
- "Facturas por pagar: $24,360,489.62" — existe un módulo de CxP (o el número es acumulado histórico)
- "Devoluciones: 379" — existe un flujo de devolución (de compra o de venta — no confirmado)

Lo que sabemos de Eduardo `[EDU]`:
- Los precios de ingredientes se capturan en las OCs
- Hay fluctuación de precios relevante para el food cost

Lo que NO sabemos `[HIP]`:
- Cuántos estados tiene una OC (pendiente, enviada, recibida, cancelada)
- Si al "recibir" una OC el inventario se actualiza automáticamente o es un paso separado
- Si los $24,360,489 en "Facturas por pagar" son deuda activa real o acumulado histórico
- Si "Devoluciones: 379" son devoluciones de compra (regresar mercancía) o de venta (clientes)
- Si "Plaza Duendes" como proveedor de $1.49M es el local rentado o un proveedor de alimentos
- Si existe historial de precio por proveedor e ingrediente
- Si se puede crear una OC desde la vista de inventario (cuando un item está bajo)

**Decisión que ayuda a tomar:**
- ¿A qué proveedor llamo hoy y qué le pido?
- ¿Me cobró lo que acordamos o me cambiaron el precio?
- ¿Cuánto estoy gastando en cada proveedor este mes?

**PENDIENTE DE VALIDACIÓN — Recorrido R3:**
```
Preguntas a cerrar:
1. Estados de una OC y flujo completo
2. ¿Recibir OC actualiza inventario automáticamente?
3. ¿Los $24M en "Facturas por pagar" son activos o histórico?
4. ¿Las "Devoluciones: 379" son de compra o de venta?
5. Plaza Duendes — ¿qué es como proveedor?
6. ¿Existe historial de precio por proveedor + ingrediente?
```

### Paso 2 — Paridad funcional

| Capacidad | Wansoft | Fullsite | Estado | Prioridad |
|---|---|---|---|---|
| Crear OC con proveedor, items y cantidades | ✅ `[HIP]` | ✅ `/compras` | Paridad probable | P0 |
| Ver OCs activas con status | ✅ `[HIP]` | ✅ `/compras` | Paridad probable | P0 |
| Marcar OC como recibida | ✅ `[HIP]` | 🚧 Parcial | Pendiente confirmar | P0 |
| Al recibir OC: actualizar inventario automáticamente | ✅ `[HIP]` | 🚧 Parcial | Pendiente confirmar | P0 |
| Ver gasto por proveedor (reporte mensual) | ✅ `[OBS-WANSOFT]` | ❌ | GAP | P1 |
| Ver gasto por producto/ingrediente (reporte) | ✅ `[OBS-WANSOFT]` | ❌ | GAP | P1 |
| CxP (facturas por pagar con vencimiento) | ✅ `[OBS-WANSOFT]` | ❌ | Evaluar post-R3 | `[HIP]` |
| Devoluciones a proveedor | ✅ `[OBS-WANSOFT]` | ❌ | Evaluar post-R3 | `[HIP]` |
| Historial de precio por ingrediente y proveedor | `[HIP]` | ❌ | Pendiente validar | P1 |
| OC auto-generada por IA | ❌ | ❌ | Diferenciador | P2 |
| Alerta de discrepancia de precio al recibir OC | ❌ | ❌ | Diferenciador | P2 |

### Paso 3 — Diferenciación

**OC auto-generada:** Wansoft es manual — el gerente sabe que necesita algo y crea la OC. Fullsite puede proponer la OC completa basada en inventario actual + proyección de ventas del fin de semana + lead time del proveedor.

**Alerta de precio:** Cuando llega una OC a precio diferente al histórico, Fullsite alerta antes de registrarla: "El pollo viene a $92/kg. El precio histórico es $74/kg. ¿Confirmar o reclamar?"

**WhatsApp del proveedor en la OC:** El número de contacto del proveedor accesible directamente desde la OC para hacer el pedido.

**¿Qué puede resolver IA?**
- Generar el pedido semanal completo con sugerencias de cantidad por proveedor.
- Detectar proveedor poco confiable: "Lácteos Monterrey ha entregado tarde 3 semanas consecutivas."
- Comparar precio recibido vs. precio histórico y marcar discrepancias.

### Paso 4 — Decisión de implementar

| Capacidad | ¿Se usa? | ¿Problema vigente? | ¿Sentiría su ausencia? | Decisión |
|---|---|---|---|---|
| Gasto por proveedor (reporte) | Sí `[OBS-WANSOFT]` | Sí — Andy y el dueño lo usan | Sí | Implementar post-R3 |
| Gasto por producto (reporte) | Sí `[OBS-WANSOFT]` | Sí — food cost y negociación | Sí | Implementar post-R3 |
| CxP con vencimiento | `[HIP]` | Depende de si AMALAY lo gestiona en Wansoft o en CONTPAQi | Evaluar con Eduardo | Pendiente R3 |
| Devoluciones a proveedor | `[HIP]` | `[HIP]` | `[HIP]` | Pendiente R3 |

---

## CLUSTER 4 — Control de Efectivo + Egresos

### Paso 1 — Reverse Engineering de Wansoft

**Problema que resuelve:** El dueño o gerente necesita saber si el efectivo en la caja cuadra con lo que debería haber, y si las salidas de efectivo están justificadas.

**Información que muestra:**

Lo que sí sabemos desde el POS Bible `[OBS-WANSOFT]` (§17):
- Desde el POS local existe la operación "Retiro de caja" — el cajero retira efectivo y lo registra con monto y concepto
- El corte de caja en el POS muestra: ventas efectivo, retiros, fondo inicial, diferencia

Lo que NO sabemos `[HIP]`:
- Si el módulo "Egresos" en el backoffice web es distinto a los retiros de caja del POS
- Si existe un arqueo de caja en el backoffice (no solo en el POS)
- Qué categorías de egreso maneja Wansoft — ¿fijas o configurables?
- Si los retiros del POS aparecen automáticamente en el backoffice como egresos
- Si existe historial de aperturas/cierres de caja por fecha y turno en el backoffice

**Decisión que ayuda a tomar:**
- ¿El cajero está cuadrado al cierre del turno?
- ¿Hay faltante? ¿Quién es responsable?
- ¿Las salidas de efectivo están justificadas y autorizadas?

**PENDIENTE DE VALIDACIÓN — Recorrido R4:**
```
Preguntas a cerrar:
1. ¿Existe módulo "Egresos" separado en el backoffice?
2. ¿Los retiros del POS aparecen en el backoffice automáticamente?
3. ¿Existe arqueo de caja en el backoffice?
4. ¿Qué categorías de egreso existen?
5. ¿Hay historial de cortes por fecha y turno en el backoffice?
```

### Paso 2 — Paridad funcional

| Capacidad | Wansoft | Fullsite | Estado | Prioridad |
|---|---|---|---|---|
| Retiro de efectivo desde POS | ✅ `[OBS-WANSOFT]` | ✅ (registrado en POS) | Paridad | P0 |
| Corte de caja con diferencia (esperado vs. real) | ✅ `[OBS-WANSOFT]` | ✅ `/cortes` | Paridad | P0 |
| Ver egresos en backoffice web | ✅ `[HIP]` | ✅ `/egresos` | Paridad probable | P0 |
| Arqueo de caja en backoffice (sin ir al restaurante) | `[HIP]` | 🚧 `/control-efectivo` | Pendiente validar | P1 |
| Historial de cortes por fecha/turno | `[HIP]` | ✅ `/cortes` | Paridad probable | P1 |
| Categorías de egreso configurables | `[HIP]` | `[HIP]` | Pendiente R4 | `[HIP]` |
| Foto de comprobante en egreso | ❌ | ❌ | Diferenciador | P2 |
| Alerta al dueño si hay diferencia de caja | ❌ | ❌ | Diferenciador | P2 |

### Paso 3 — Diferenciación

**Auditoría en tiempo real:** El gerente puede ver desde su teléfono si la caja está cuadrada — sin tener que estar en el restaurante. Wansoft requiere que alguien esté en el POS.

**Evidencia fotográfica:** Cada egreso puede tener foto del comprobante/ticket. Wansoft casi con certeza no tiene esto.

**Alerta de diferencia:** Si el cajero registra un faltante, el dueño recibe notificación inmediata en lugar de enterarse al día siguiente.

**¿Qué puede resolver IA?**
- Patrón de faltantes: "Los viernes en el turno tarde hay faltante promedio de $340 — llevan 4 semanas consecutivas."
- Auto-categorizar egresos: "Compra de cloro → Limpieza. Propina en efectivo → Nómina."

### Paso 4 — Decisión de implementar

| Capacidad | ¿Se usa? | ¿Problema vigente? | ¿Sentiría su ausencia? | Decisión |
|---|---|---|---|---|
| Arqueo de caja en backoffice | `[HIP]` | Sí — dueño quiere ver sin ir al restaurante `[AMALAY]` | Sí | Implementar post-R4 |
| Fotos de comprobantes en egresos | Wansoft no tiene | Sí — trazabilidad | Sí | Diferenciador — implementar |
| Alertas de diferencia de caja | Wansoft no tiene | Sí — control | Sí | Diferenciador — implementar |

---

## CLUSTER 5 — Facturación

### Paso 1 — Reverse Engineering de Wansoft

**Problema que resuelve:** El restaurante emite CFDIs a clientes que lo solicitan (empresas, clientes con RFC). El gerente necesita saber qué facturas se emitieron, cuáles tienen problemas, y tener el total mensual para Andy.

**Información que muestra:**

Lo que sí sabemos `[OBS-WANSOFT]` (del menú de Wansoft backoffice):
- Existen DOS módulos separados: "Facturación" y "Facturas Wansoft"
- Son módulos distintos en el menú — su diferencia es desconocida `[HIP]`

Hipótesis `[HIP]`:
- "Facturación" = CFDIs del restaurante para sus clientes
- "Facturas Wansoft" = facturas de la suscripción que AMALAY le paga a Wansoft

Lo que sabemos de operación `[AMALAY]`:
- AMALAY emite 400-430 CFDIs/mes via Facturama (~$215/mes)
- SAT registrado como FTE260611P18 `[AMALAY]`
- CSD vence 2026-08-03 — P0-3 pendiente

**PENDIENTE DE VALIDACIÓN — Recorrido R5:**
```
Preguntas a cerrar:
1. ¿Qué hace "Facturación" — es CFDI del restaurante?
2. ¿Qué hace "Facturas Wansoft" — es la factura de la suscripción?
3. ¿Wansoft emite CFDIs internamente o usa un tercero?
4. ¿Cómo se vincula una factura a un ticket de venta en Wansoft?
5. ¿Existe módulo de conciliación bancaria en Wansoft?
```

### Paso 2 — Paridad funcional

| Capacidad | Wansoft | Fullsite | Estado | Prioridad |
|---|---|---|---|---|
| Emitir CFDI para cliente (RFC, concepto, monto) | ✅ `[HIP]` | ✅ `/factura` via Facturama | Paridad | P0 |
| Ver lista de CFDIs emitidos con status | ✅ `[HIP]` | ✅ `/facturas` | Paridad | P0 |
| Cancelar CFDI | ✅ `[HIP]` | ✅ | Paridad | P0 |
| Notas de crédito | ✅ `[HIP]` | ✅ `/notas-credito` | Paridad | P1 |
| Reenviar CFDI por email | `[HIP]` | 🚧 | Pendiente | P1 |
| Reporte fiscal mensual para Andy | `[HIP]` | ✅ `/reporte-fiscal` | Paridad probable | P1 |
| Conciliación bancaria | `[HIP]` | 🚧 `/conciliacion` — manual | Pendiente confirmar si Wansoft lo tiene | `[HIP]` |
| Vincular factura a ticket de venta | `[HIP]` | `[HIP]` | Pendiente R5 | P0 |
| Factura en un click desde ticket cerrado | ❌ | ❌ | Diferenciador | P2 |
| Alerta de CFDI rechazado por PAC | ❌ | ❌ | Diferenciador | P2 |

### Paso 3 — Diferenciación

**Factura en 30 segundos:** El POS ya tiene el RFC del cliente si lo dio al pagar. La factura debería generarse con un click desde el ticket cerrado — sin formulario adicional.

**Alerta de fallo en timbrado:** Si Facturama rechaza un CFDI, notificación inmediata. Hoy el gerente puede enterarse días después.

**Validación de RFC antes de intentar timbrar:** Wansoft probablemente no valida el RFC formato antes de enviarlo al PAC.

---

## CLUSTER 6 — Administración

### Paso 1 — Reverse Engineering de Wansoft

**Módulo completamente desconocido** `[HIP]`.

El menú de Wansoft incluye "Administración" como categoría. El contenido es desconocido. Hipótesis de lo que podría contener: usuarios y permisos, sucursales, configuración de impresoras, tablas de IVA, horarios del sistema, configuración de categorías de menú.

**PENDIENTE DE VALIDACIÓN — Recorrido R6:**
```
Preguntas a cerrar:
1. ¿Qué sub-módulos tiene "Administración" en Wansoft?
2. ¿Cómo se gestionan usuarios y permisos?
3. ¿Multi-sucursal está configurado para AMALAY?
4. ¿La configuración de impresoras está aquí?
5. ¿Qué es el módulo "Liberaciones"?
```

### Paso 2 — Paridad funcional

No es posible evaluar paridad hasta completar R6.

### Diseño tentativo por lo que sabemos de Fullsite

| Capacidad | Wansoft | Fullsite | Estado | Prioridad |
|---|---|---|---|---|
| Gestión de usuarios con roles | ✅ `[HIP]` | ✅ `client_users` + `roles.ts` | Paridad probable | P0 |
| Configuración de impresoras | ✅ `[OBS-WANSOFT]` §21 | ✅ (POS local) | Paridad | P0 |
| Multi-sucursal | ✅ `[HIP]` | 🚧 Arquitectura lista, sin UI | No prioritario hasta segundo cliente | P3 |
| Configuración de menú (grupos, platillos) | ✅ `[HIP]` | ✅ Dashboard sección "POS Restaurante" | Paridad probable | P0 |
| Onboarding de usuario en < 2 min (sin técnico presencial) | ❌ | ❌ | Diferenciador | P2 |

---

## Módulos de baja prioridad

### `/nomina` — REDISEÑAR

**Estado actual:** INFERIDO INCORRECTO. Usa ventas y propinas de `wansoft_daily` y los llama "nómina". No es nómina.

**Decisión:** Renombrar a "Propinas y Desempeño por Mesero". La nómina real (RH, IMSS, SAT) la maneja Andy en CONTPAQi. Fullsite no debe intentar reemplazar CONTPAQi.

**PENDIENTE DE VALIDACIÓN:** ¿Wansoft tiene algún módulo de comisiones o nómina? `[HIP]`

---

### Ecommerce (no implementado)

**Estado:** Módulo confirmado en menú de Wansoft `[OBS-WANSOFT]`. Sin evidencia de que AMALAY lo use.

**Decisión de implementar:** Primero confirmar con Eduardo si AMALAY activa este módulo. Si no, no es un gap activo.

---

### Encuesta (no implementado)

**Estado:** El QR del preticket lleva a una encuesta. El módulo "Encuesta" en Wansoft backoffice existe `[OBS-WANSOFT]`.

**Decisión de implementar:** Confirmar si AMALAY activa y revisa las encuestas. Si hay respuestas históricas, es un gap. Si no, no es prioritario.

---

### Liberaciones (no implementado)

**Estado:** Módulo en menú de Wansoft. Hipótesis: autorización de operaciones bloqueadas (descuentos fuera de límite, ventas en cero, reapertura de órdenes). No verificado `[HIP]`.

**Decisión de implementar:** Pendiente hasta R6. Si es autorización de descuentos especiales, puede ser relevante para control de fraude.

---

### `/lealtad`, `/crm`, `/clientes`

**Estado:** Fullsite original — no requiere validación con Wansoft. Feature diferenciadora.

**Wansoft:** Probablemente solo captura RFC para facturas. CRM real no confirmado.

**Decisión:** Mantener como diferenciadores. No buscar paridad con Wansoft aquí — este es territorio de Fullsite.

---

### `/sucursales`

**Estado:** INFERIDO. AMALAY tiene una sola sucursal.

**Decisión:** Congelar hasta tener el segundo cliente. La arquitectura multi-tenant ya existe — no hay que implementar UI para algo que nadie está usando.

---

## Estado de recorridos

| Recorrido | Cluster | Status | Fecha | Cierra preguntas |
|---|---|---|---|---|
| R1 | Reportes | PENDIENTE | — | 7 preguntas |
| R2 | Inventario + Recetas + Costeo | PENDIENTE | — | 7 preguntas |
| R3 | Compras + Proveedores | PENDIENTE | — | 6 preguntas |
| R4 | Control de Efectivo + Egresos | PENDIENTE | — | 5 preguntas |
| R5 | Facturación | PENDIENTE | — | 5 preguntas |
| R6 | Administración | PENDIENTE | — | 5 preguntas |

---

## Cinco preguntas de cierre de recorrido

Todo recorrido en Wansoft debe terminar respondiendo estas cinco preguntas. Si alguna no tiene respuesta, el recorrido no está completo.

1. **¿Qué problema resuelve este módulo?** — No qué pantallas tiene, sino qué situación operativa resuelve para el gerente.
2. **¿Qué decisiones permite tomar?** — Cuáles son las decisiones concretas que el gerente puede tomar gracias a este módulo que no podría tomar sin él.
3. **¿Qué capacidades son obligatorias para alcanzar paridad?** — Las P0 que Fullsite no tiene todavía y que bloquean la migración.
4. **¿Qué podemos eliminar sin afectar al cliente?** — Las P3 documentadas con la razón por la que no se implementan.
5. **¿Qué podemos hacer significativamente mejor que Wansoft?** — Los P2 — los diferenciadores donde Fullsite invierte su energía de innovación.

---

## Regla de cierre de recorridos

Un recorrido está cerrado cuando:

1. Las cinco preguntas de cierre tienen respuesta.
2. La tabla de comparativa competitiva tiene todas las filas con `[OBS-WANSOFT]` o `[EDU]` — no `[HIP]`.
3. Cada capacidad tiene su clasificación P0/P1/P2/P3 asignada.
4. La decisión de implementar para cada capacidad está tomada y documentada.
5. Este documento se actualiza con los hallazgos marcados `[OBS-WANSOFT]` o `[DESCARTADO: razón]`.

No existe "recorrido parcial". Si el recorrido no cerró las cinco preguntas, el recorrido no fue suficiente.

---

## Métrica de éxito del Dashboard V2

No medimos el éxito por cuántas pantallas copiamos de Wansoft.

Lo medimos por cuántas decisiones importantes del gerente podemos resolver mejor que Wansoft sin perder ninguna capacidad crítica.

Un gerente que migra de Wansoft a Fullsite debe poder responder todas sus preguntas operativas desde Fullsite, más rápido, con mejor contexto, y con ayuda de IA donde antes tenía que hacer el análisis manual. Si hay una sola pregunta importante que en Wansoft podía responder y en Fullsite no puede, ese es un defecto de producto.

---

## Changelog

### 2026-07-23
- Framework V2 creado con proceso de 4 pasos por módulo (Reverse Engineering → Paridad → Diferenciación → Decisión de implementar).
- Leyenda de fuentes de verdad establecida: `[OBS-WANSOFT]`, `[EDU]`, `[AMALAY]`, `[FULLSITE]`, `[HIP]`.
- Clasificación P0/P1/P2/P3 definida y aplicada a los 6 clusters iniciales.
- Cinco preguntas de cierre de recorrido establecidas.
- 6 recorridos pendientes identificados (R1–R6).
- GAPs P0 activos identificados sin recorrido: sub-recetas, factor de rendimiento, deducción automática de ingredientes, cierre de inventario, OC → actualización de inventario.
- P3 declaradas: multi-sucursal (sin segundo cliente), nómina real (fuera de scope — CONTPAQi).
- Reglas de mantenimiento del documento establecidas.
