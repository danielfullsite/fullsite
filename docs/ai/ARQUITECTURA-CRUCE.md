# Arquitectura del cruce — cómo Fullsite entiende un restaurante completo

> Escrito el 2026-08-26, con todo medido contra producción ese día.
>
> Construye **encima** de [`AI-ARCHITECTURE-DIRECTION.md`](AI-ARCHITECTURE-DIRECTION.md)
> (decidido el 19-ago: de enjambre ciego a un experto con herramientas). Aquel documento
> responde *quién habla*. Éste responde *qué sabe*.
>
> Nada de lo que sigue es aspiracional sin nota. Donde hay un número, se midió.

---

## Lo que cambió desde el 19 de agosto

Tres cosas que el documento anterior daba por ciertas y hoy sabemos que no lo son. Importan
porque cambian el plan.

**Los agentes NO usan LLM.** El documento decía *"saca datos → Groq/Claude → Telegram"*. Falso:
de 71 scripts, sólo 6 llaman a Groq, y **ninguno de los 6 es un agente** (son el briefing, el
router de Telegram, las alertas y consultas de Wansoft). Los doce agentes son Python
determinista.

Eso es **buena noticia**: la "Capa 1 — herramientas deterministas" del plan ya existe. No hay
que migrar detectores a código; ya están en código. Lo que falta es la capa de arriba.

**`agent_events` no estaba vacía por olvido: la tabla rechazaba los INSERT.** Un
`CHECK (agent_id IN (…5 valores…))` que sólo admitía los agentes del motor de TypeScript. Los
de Python usan otros siete. Y PostgREST devuelve 400, que no es excepción para `requests`, así
que `log_event()` fallaba **en silencio**. `antifraud-agent` y `fraud_watcher` llevaban meses
reportando al vacío. Corregido (#144).

**Ocho agentes no producían nada.** 283 corridas en `no_data` en 14 días, porque
`ops_daily_live` y `ops_daily_history` leían `ops_daily`, una tabla congelada. Corregido
(#134): ahora leen `pos_orders` vivo, conservando el histórico por UNION.

---

## El problema del cruce, medido

La pregunta era: *¿los agentes cruzan toda la información?* La respuesta es no, por tres razones
distintas que hay que atacar por separado.

### 1. Cada agente ve una rebanada

| Agente | Fuentes | Vivas | Muertas |
|---|---:|---:|---|
| `waste_detector` | 5 | 2 | food_cost (91d), shrinkage (vacía), suppliers (58d) |
| `antifraud_agent` | 4 | 2 | wansoft_data (37d), waiter_categories (58d) |
| `upselling` · `tips_analyzer` · `menu_engineering` | 3 | 1–2 | waiter_categories, food_cost |
| `staffing_optimizer` · `table_time` | 1 | 1 | — |
| `kitchen_quality` | 1 | **0** | `wansoft_kpis` (72d) |
| `stock_alert` | 1 | **0** | `wansoft_data` (37d) |

Dos agentes leen **únicamente** tablas congeladas. No pueden producir nada cierto.

### 2. Nadie cruza entre agentes

Cada agente escribe su hallazgo y ahí muere. Nada lee las salidas de todos para decir *"estas
tres alertas son el mismo problema"*. El `orquestador.py` no es un orquestador de inteligencia
— es un router de mensajes de Telegram, y está `disabled_manually`. Igual que Hermes.

### 3. Y el más incómodo: **los datos no contienen el fenómeno**

| Señal | `lab-resto` | `demo` | `boruca` | `coffee-shop` |
|---|---:|---:|---:|---:|
| Órdenes con descuento | 0 | 0 | 0 | 0 |
| Órdenes canceladas | 0 | 0 | 0 | 0 |
| Órdenes con line items | 3,411 | 16/551 | 240 | **0**/565 |

**Cero descuentos y cero cancelaciones en toda la base.** Son las dos señales con las que se
detecta fraude en un restaurante. No es que el agente no las cruce: no hay nada que cruzar.

Y peor, las dos mitades del cruce más valioso viven en restaurantes **distintos**:

- **`amalay`** tiene inventario, recetas y 2,568 movimientos frescos de hoy — y **cero ventas**
  en `pos_orders`, porque opera en Wansoft.
- **Los demás** tienen ventas y no tienen recetas ni inventario.

> **Ningún restaurante puede cruzar hoy consumo contra venta.** Ni uno. Ése es el hecho que
> ordena todo lo demás: la arquitectura no está bloqueada por código, está bloqueada porque
> ningún restaurante corre su operación completa sobre Fullsite.

---

## La arquitectura

Siete capas. La 0 es el suelo: que los números cierren. Las tres siguientes son el *cruce*;
las tres de arriba son el *juicio* que ya definió el documento del 19-ago.

```
  ┌──────────────────────────────────────────────────────────────┐
  │  6 · APRENDIZAJE      umbrales que se ajustan por restaurante │
  ├──────────────────────────────────────────────────────────────┤
  │  5 · MEDICIÓN         cada señal se califica contra la realidad│
  ├──────────────────────────────────────────────────────────────┤
  │  4 · SITUACIONES      correlación: 3 alertas = 1 problema      │
  ├──────────────────────────────────────────────────────────────┤
  │  3 · SEÑALES          detectores deterministas, falsificables  │
  ├──────────────────────────────────────────────────────────────┤
  │  2 · PERFIL           qué es "normal" PARA ESTE restaurante    │
  ├──────────────────────────────────────────────────────────────┤
  │  1 · CONTRATO         una sola forma de leer la operación      │
  ├──────────────────────────────────────────────────────────────┤
  │  0 · CUADRE           los números cierran, o nadie los usa     │
  └──────────────────────────────────────────────────────────────┘
```

> **La Capa 0 se agregó el 2026-08-26**, y en rigor es la primera: un agente que razona
> sobre números que no cuadran miente con confianza. Todo lo de arriba se apoya en que
> lo de abajo cierre.

### Capa 0 · Cuadre — *los números cierran, o nadie los usa*

**Regla: ningún agente lee un día que no cuadró. Y si lo lee, sabe que no cuadró.**

Es la capa que faltaba en el diseño original, y es la primera. Un detector de merma que
corre sobre un inventario que no cuadra no detecta merma: inventa una. Y un falso positivo
de robo cuesta más que no tener el detector — se acusa a una persona.

Cada día de cada restaurante se marca `cuadrado`, `descuadrado` o `parcial`. Los agentes
consumen sólo lo cuadrado, o lo dicen explícitamente.

#### El catálogo de invariantes

**Nivel 1 — dentro de una orden.** Aritmética pura.

| Invariante | Estado hoy |
|---|---|
| `Σ items = subtotal` | ✅ 0 violaciones en 3,043 órdenes / 30 días |
| `subtotal − descuento + IVA = total` | ✅ 0 violaciones |
| `Σ pagos = total` (cerradas) | ✅ 0 violaciones |
| Una orden cerrada tiene forma de pago | ⚠️ `boruca`: 200/200 sin el arreglo `pagos` |

El caso de `boruca` no rompe el corte —tiene `metodo_pago`, así que el efectivo cuadra—
pero **no puede representar un pago dividido**, y cualquier agente que lea `pagos` queda
ciego para ese restaurante. Es exactamente el tipo de hueco que esta capa existe para
nombrar, en vez de que un agente lo descubra sacando cero y reportando "sin datos".

**Nivel 2 — el turno.** El arqueo. La fórmula no la inventamos: está capturada de Wansoft
en [`docs/knowledge/wansoft/CAJA-SPEC.md`](../knowledge/wansoft/CAJA-SPEC.md) línea 523,
y es el estándar contra el que un restaurantero ya sabe medir.

```
Efectivo esperado = Fondo
                  + Ventas en efectivo
                  + Propinas en efectivo
                  + Depósitos
                  − Vales
                  − Propinas por tarjeta pagadas en efectivo
```

La diferencia entre eso y lo contado **es** el hallazgo. No hace falta un modelo para
interpretarla: un descuadre de caja es dinero, y el número lo da la resta.

**Nivel 3 — inventario contra venta.** El cruce que hoy no se puede hacer en ningún
restaurante.

```
Movimientos de salida = Σ(receta del platillo × cantidad vendida)  ±  merma declarada
```

Lo que sobra de esa resta es merma no declarada: producto que salió sin venderse. Es el
cruce más valioso del sistema y el que justifica todo el trabajo del laboratorio.

**Nivel 4 — el día contra sus partes.** `ops_daily_history.ventas_dia` debe ser la suma
de sus órdenes. Suena obvio, y es justo el tipo de cosa que se rompe cuando alguien
cambia una vista — como pasó hoy con `ops_daily`, congelada 13 días sin que nadie lo
notara.

**Nivel 5 — contra el mundo exterior.** Las órdenes de Rappi y Uber deben aparecer en
`pos_orders`, y sus liquidaciones deben conciliar contra `delivery_platform_payments`. Una
plataforma que cobra comisión distinta a la pactada sale de aquí.

#### Por qué el cuadre es el primer agente, no una utilería

Los descuadres **son** los hallazgos más valiosos del sistema, y son deterministas:

| Descuadre | Qué significa en el restaurante |
|---|---|
| Caja no cuadra | Faltante, error de cobro, o robo |
| Salidas de inventario > lo vendido | Merma no declarada o producto que se va |
| Orden cerrada sin pago | Se sirvió y no se cobró |
| Comisión de plataforma ≠ pactada | Te están cobrando de más |

Ninguno necesita un modelo. Los da una resta, y son exactos. **Es la mejor relación
valor/riesgo de todo el sistema**: cero falsos positivos por diseño, porque una identidad
aritmética no opina.

Por eso el orden del roadmap cambia: el cuadre va antes que cualquier detector
estadístico, no después.

---

### Capa 1 · Contrato de datos

**Regla: ningún agente lee una tabla cruda. Nunca.**

Hoy cada agente nombra sus tablas, y por eso la mitad quedó leyendo tablas muertas sin que nadie
se enterara — durante meses. Cuando la fuente cambia, hay que editar doce scripts y alguno se
olvida.

El contrato es un conjunto corto de vistas por tenant que responden preguntas de negocio, no de
esquema:

| Vista | Responde |
|---|---|
| `ops_daily_history` | ¿cómo cerró cada día? *(ya existe, viva desde #134)* |
| `ops_hourly` | ¿cómo va el día por hora? *(falta)* |
| `ops_consumo` | ¿qué ingredientes debieron consumirse según lo vendido? *(falta)* |
| `ops_personal` | ¿quién trabajó, cuándo, y qué vendió? *(falta)* |

Cambiar de Wansoft a POS propio, o agregar Rappi, se vuelve un cambio de vista — no doce
cambios de script. **Eso es lo que hace que la inteligencia sea clonable: el agente no sabe de
dónde vienen los datos.**

### Capa 2 · Perfil del restaurante — *la pieza que hace clonable la inteligencia*

Hoy el modelo de "un día normal" está hardcodeado, y el código lo confiesa:

```python
# agent_common.py
# % ACUMULADO ... (perfil desayuno/brunch tipo AMALAY, front-loaded).
# Default — debería venir del histórico del cliente cuando exista.

# close_predictor.py
# Typical hourly distribution ... adjusted for AMALAY brunch café
```

Una taquería con pico de cena recibe a las 3pm *"llevas el 86% de tu día"* — cuando apenas va a
empezar. Cada predicción, cada anomalía, cada "ventas abajo" se calcula contra el ritmo de un
café de brunch en San Pedro.

El perfil se **aprende** por restaurante: curva horaria, forma por día de la semana,
distribución de ticket, mezcla de categorías, tiempo de mesa, estacionalidad.

**El problema del arranque en frío es la decisión de producto más importante de esta capa.** Un
restaurante nuevo no tiene historia, y es justo cuando más necesita que la IA se vea útil. Tres
etapas:

| Días operando | De dónde sale el perfil |
|---|---|
| 0 – 14 | Default por **tipo de restaurante** (cafetería, taquería, fine dining…), no el de AMALAY |
| 15 – 60 | Mezcla ponderada: su historia pesa más cada día |
| 60+ | Perfil propio |

Con una regla que protege al cliente: **mientras el perfil no sea propio, la IA lo dice.** "Con
tu primera semana de datos, proyecto X" es honesto y útil. "Vas 20% abajo" sin decir contra qué,
cuando el contra-qué es otro restaurante, es mentir.

### Capa 3 · Señales falsificables

**Regla: un detector no emite prosa. Emite una afirmación que puede resultar falsa.**

Hoy los insights dicen *"las ventas van bajas"*. Eso no se puede equivocar, y **lo que no se
puede equivocar tampoco se puede acertar** — de ahí los 2,387 insights con `confidence` en NULL
y cero eventos calificados.

Una señal lleva: qué afirma, el valor predicho, cuándo se puede comprobar, y **con qué
tolerancia acepta ser juzgada**. La tolerancia va escrita junto a la predicción, no en el que
califica — si viviera del otro lado, se podría aflojar después de ver los resultados. Ya
implementado para `close-predictor` en #144.

### Capa 4 · Situaciones — el cruce de verdad

Aquí es donde el sistema deja de ser doce alertas y empieza a ser un diagnóstico.

Una **situación** agrupa señales que comparten causa. Ejemplo real que hoy saldría como tres
alertas sueltas y sin conexión:

```
  merma de res 18% arriba          (waste_detector)
+ 40% de las cancelaciones son     (antifraud)
  del mismo mesero
+ esas mesas cierran 12 min más    (table_time)
  rápido que el promedio
────────────────────────────────────────────────
= SITUACIÓN: producto saliendo sin cobrarse en el turno de la noche
  valor estimado: $X/semana · confianza: media · evidencia: 3 señales independientes
```

Tres señales débiles que **coinciden** valen más que una fuerte. Y al revés: una señal sola que
nadie corrobora se reporta con menos confianza, o no se reporta.

Eso es lo que hace un buen gerente, y es lo que hoy no existe.

### Capa 5 · Medición

Cada señal se califica contra lo que pasó. Ya construido en #144 para `close-predictor`:
predicción → realidad → `correct` / `false_positive`.

De ahí sale precisión **por agente y por restaurante**. Y con eso, la regla que protege la
confianza del operador:

> **Un detector por debajo de su umbral de precisión se calla solo.** No se le pide permiso a
> nadie. Un agente que se equivoca seguido no es un agente que hay que mejorar mientras sigue
> gritando: es ruido que hay que apagar hasta que mejore.

### Capa 6 · Aprendizaje

Los umbrales se ajustan por restaurante según la precisión medida. Un lugar con mucha variación
natural necesita umbrales más anchos; uno estable, más finos. Hoy son constantes iguales para
todos.

---

## Matriz de cruces — qué se puede hoy y qué falta

| Cruce | Valor | Datos vivos | Bloqueo |
|---|---|---|---|
| Venta × hora × mesero | Alto | ✅ `pos_orders` | ninguno — **se puede hoy** |
| Tiempo de mesa × ticket | Medio | ✅ `pos_orders` | ninguno — **se puede hoy** |
| Método de pago × propina × mesero | Alto (fraude) | ✅ `pos_orders` | ninguno — **se puede hoy** |
| **Consumo × venta** (merma real) | **El más alto** | ✅ ambos lados existen… | …**en tenants distintos** |
| Descuentos × mesero × turno | Alto (fraude) | ❌ | cero descuentos en toda la base |
| Cancelaciones × momento del cobro | Alto (fraude) | ❌ | cero cancelaciones en toda la base |
| Reservaciones × personal | Medio | parcial | `reservaciones` sólo AMALAY |
| Costo de receta × mezcla de venta | Alto | ❌ | `wansoft_food_cost` 91 días muerta |
| Clima/eventos × demanda | Medio | ✅ agente aparte | no se cruza con nada |

**Lectura:** tres cruces se pueden construir **hoy** con datos vivos. El más valioso está a un
paso — existen los dos lados, pero no en el mismo restaurante. Y cuatro están bloqueados porque
el fenómeno no ocurre en los datos.

---

## El desbloqueo: un restaurante completo

Nada de la Capa 4 se puede construir *ni validar* sin un restaurante donde pase todo. Hay dos
caminos y no son excluyentes:

**1. El demo como restaurante completo.** Sembrarle recetas e inventario a partir de sus 28
platillos, y mover el simulador al camino real del POS (`api/pos/save-order`) en vez de insertar
filas directo — hoy se salta justo la ruta que descuenta inventario. Eso da:

- el laboratorio para construir y **validar** los cruces, porque nosotros sabemos qué inyectamos;
- prueba continua de la ruta más crítica del POS, que hoy no se ejercita 24/7;
- un demo mucho más vendible: inventario bajando, food cost real, alertas de merma.

**2. El cutover de AMALAY.** Es la única forma de tener el loop completo con datos reales. Está
fuera del alcance de esta arquitectura, pero es lo que la hace valer.

---

## Reglas

Las cinco del documento del 19-ago siguen vigentes. Éstas se suman:

6. **Ningún agente lee una tabla cruda.** Sólo el contrato. Es lo que evita que la mitad de la
   flota vuelva a quedar leyendo tablas muertas sin que nadie lo note.
7. **Lo que es "normal" se aprende por restaurante.** Ningún umbral ni curva de un cliente puede
   ser el default de otro.
8. **Una señal que no puede resultar falsa no se emite.** Sin valor predicho y sin cuándo
   comprobarlo, es prosa.
9. **Una situación pesa más que una señal.** Tres coincidencias débiles > una fuerte sola.
10. **Fallar callado está prohibido.** Todo camino de error avisa. Es literalmente cómo dos
    agentes reportaron al vacío durante meses.
11. **La precisión se mide antes de prometerse.** Nadie dice un porcentaje sin denominador.

---

## Secuencia

| # | Qué | Depende de |
|---|---|---|
| **1** | **Cuadre nivel 1 y 4** (aritmética de orden, día vs sus partes) | nada — **listo para empezar** |
| 2 | Cruces posibles hoy (venta × hora × mesero, pago × propina, tiempo de mesa) | nada |
| 3 | Demo como restaurante completo (recetas, inventario, POS real) | decisión de Daniel |
| 4 | Cuadre nivel 2 — el arqueo, con la fórmula de Wansoft | 3 |
| 5 | Perfil por restaurante (Capa 2), con las tres etapas de arranque | 2 |
| 6 | Contrato de datos (Capa 1): `ops_hourly`, `ops_consumo`, `ops_personal` | 3 |
| 7 | Cuadre nivel 3 — inventario contra venta | 3, 6 |
| 8 | Situaciones (Capa 4) | 5, 7 |
| 9 | Auto-silenciado por precisión (Capa 5) | medición con datos, ~2 semanas de #144 |

**El cuadre va primero, y ése es el cambio de orden respecto al plan original.** Los descuadres
son hallazgos deterministas con cero falsos positivos por diseño: una identidad aritmética no
opina. Es la mejor relación valor/riesgo del sistema, y no depende de nada.

El paso 3 desbloquea la mitad de la tabla de cruces.

---

## Lo que este documento NO promete

- **No sube la precisión por sí solo.** Es la estructura para poder medirla y mejorarla. El
  primer número real de precisión sale de #144 y probablemente no va a gustar.
- **No arregla a AMALAY.** Su cutover es otro trabajo, y sin él su cruce más valioso sigue
  imposible.
- **No es un LLM razonando sobre el restaurante.** La matemática sigue en código determinista
  —regla 1 del documento del 19-ago— y el juicio contextual es la Capa 4, que se construye con
  reglas de correlación antes de meter un modelo.
