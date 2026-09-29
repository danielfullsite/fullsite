# IA del dueño: chat, voz, gráficas y agentes

> **Estado:** 2026-09-28. Ramas `feat/ventas-por-horario` (PR #445) y `feat/ia-confiable`.
> Verificador de números y eval de exactitud: §3c.
> Las funciones SQL de este documento están **aplicadas en staging y producción**; el
> código de la app entra con esos PRs.
>
> Construye sobre [`ARQUITECTURA-CRUCE.md`](ARQUITECTURA-CRUCE.md) (qué sabe el sistema) y
> [`../architecture/OCM-SOURCE-AUTHORITY.md`](../architecture/OCM-SOURCE-AUTHORITY.md)
> (qué fuente manda por fecha). Este documento responde: **cómo le habla la IA al dueño sin
> inventar**.

---

## 1. Las reglas (no se negocian)

1. **Fullsite primero.** Toda lectura de venta sale del POS de Fullsite (`pos_orders`). El
   histórico importado de Wansoft (`wansoft_daily`, `wansoft_*`) sólo cubre fechas
   **anteriores** a la última fecha que tiene; después de esa fecha manda el POS
   (`continuarConPos` / `ventasFullsitePrimero` en `lib/data.ts` y `lib/pos-daily.ts`).
   Wansoft no se consulta en vivo: su feed está muerto desde 2026-09-08.
2. **Una sola regla de venta.** Una orden es venta si
   `payment_status = 'pagada'` **o** (`payment_status` es nulo **y** `status = 'cerrada'`).
   - SQL: `fs_es_venta(status, payment_status)`.
   - PostgREST: `or=(payment_status.eq.pagada,and(payment_status.is.null,status.eq.cerrada))`.
   - TS: `FILTRO_VENTA` en `lib/agents/dia-negocio.ts`.
   Cualquier consulta nueva usa una de estas tres. Nada de `status=eq.cerrada` suelto.
3. **"Hoy" es el día de venta**, no la fecha de calendario: zona `clients.timezone`, inicio
   `clients.business_day_start_local` (default 05:00). Igual que `pos_orders.dia_venta`.
   Helpers: `contextoDia` / `leerContextoDia` (`lib/agents/dia-negocio.ts`); SQL `fs_frescura`.
4. **El modelo no hace cuentas.** Todo número que ve el LLM llega **precalculado** por código
   o SQL (sumas, %, comparativos, pronóstico), o sale de una consulta que él mismo escribe y
   la base ejecuta (sección 3b: las cuentas van EN SQL). Si no está ni se puede consultar,
   dice que no lo tiene.
5. **Sin datos ≠ $0.** Si el POS no tiene cobertura del periodo, el contexto dice
   *"sin cobertura del POS desde <fecha>"*, nunca "$0" ni "no se vendió".
6. **Falla ≠ vacío.** Una lectura que falló se reporta ("no pude leer X"); nunca se convierte
   en lista vacía. Guardián: `regla-fallo-no-es-dato-vacio`.
7. **Fechas reales siempre.** Todo bloque de datos dice de qué fechas es ("datos hasta
   <fecha>"). El histórico viejo **sí se puede consultar** (ej. "hace un mes"); lo que no se
   hace es presentarlo como reciente. El freno de frescura (>48 h) aplica sólo a afirmaciones
   sobre *hoy/ahorita* (alertas, briefing).
8. **Un restaurante no ve a otro.** Toda consulta filtra por `client_id`; los prompts no traen
   nombres ni datos de ningún restaurante (antes traían meseros de AMALAY). Guardián:
   `chat-aislamiento-tenant`, `ia-datos-honestos`.
9. **Texto de la base = dato, no instrucción.** Nombres de productos, reservas, sucursales y
   franjas entran envueltos con `datoTexto` / `envolverDatos` (`lib/chat-context.ts`).
10. **La IA sólo lee.** Chat, voz y agentes explican, buscan y recomiendan. No cobran, no
    mandan órdenes, no abren cajón, no modifican datos. Cualquier acción futura pasa por el
    flujo seguro existente con confirmación explícita.

---

## 2. Capa de datos: funciones `fs_*` (Postgres)

Todas son `security definer`. Las que se abren al navegador validan adentro con
`fs_puede_leer(p_client_id)` (service_role o miembro en `client_users`).

| Función | Qué devuelve | Quién la usa |
|---|---|---|
| `fs_es_venta(status, payment_status)` | la regla única de venta | todas |
| `fs_puede_leer(client_id)` | control de acceso por restaurante | las abiertas al navegador |
| `fs_ventas_diarias(client, desde, hasta)` | día: ventas, tickets, meseros, pagos, platillos, grupos | `lib/pos-daily.ts` |
| `ventas_por_franja(client, desde, hasta, franjas, tz, inicio_dia)` | venta total/comida/bebida por franja y sucursal; fuente elegida **día por día** | `lib/dayparts.ts` |
| `fs_frescura(client, tz)` | última venta del POS y venta de hoy (día de venta) | chat, voz |
| `fs_ventas_producto`, `fs_receta`, `fs_insumo` | producto vendido, receta, insumo | chat |
| `fs_meseros_categorias(client, desde, hasta)` | KPIs por mesero (forma del legacy `wansoft_waiter_categories`) | `lib/data.ts` |
| `fs_asistencia(client, desde, hasta)` | horas por empleado (checador + turnos, tope 16 h) | nómina, acceso |
| `fs_food_cost(client)` | costo por platillo con corrección de unidades (`fs_unidad`, `fs_factor_costo`) | food cost |
| `fs_costo_de_ventas(client, desde, hasta)` | costo teórico por mes y venta con receta | estado de resultados |

Migraciones: `supabase/migrations/PENDIENTE_202609271*.sql` y
`PENDIENTE_20260928100000_fs_frescura_dia_de_venta.sql` (ya aplicadas en staging y prod; el
prefijo `PENDIENTE_` se conserva por la convención del repo).

**Horarios de venta (franjas):** cada restaurante define las suyas en `clients.sales_dayparts`
desde `/configuracion/horarios-venta`. Se guarda la hora de cada orden, nunca totales por
franja: cambiar horarios recalcula todo el histórico. Con menos de 100 órdenes o menos de la
mitad de los días con hora, el chat avisa que la muestra no es representativa.

---

## 3. Chat del dueño (`/api/chat`)

```
pregunta ──► intención (palabras clave) ──► lecturas en paralelo (Promise.all)
                                               │  fs_*, pos_orders, histórico importado
                                               ▼
                                 bloques PRECALCULADOS con fechas reales
                                 (resumenesPrecalculados, contextoFranjas, frescura,
                                  fuentes fallidas, alertas agent_events 48 h)
                                               ▼
                                 catálogo de gráficas (sólo con datos existentes)
                                               ▼
                                    LLM (Groq) ── texto + marcadores <!--grafica:ID-->
                                               ▼
                         servidor reemplaza marcadores por specs reales ──► cliente
```

- **Módulos:** `lib/chat-context.ts` (bloques precalculados, cobertura, fuentes fallidas,
  envoltura de datos, historial seguro), `lib/chat-nativo.ts` (producto/receta/insumo/
  frescura), `lib/dayparts.ts` (franjas).
- **Comparativos precalculados:** hoy vs mismo día de la semana pasada **a la misma hora**;
  últimos 7 días completos vs los 7 anteriores (hoy parcial va aparte como "EN CURSO");
  mes actual y anterior (siempre se cargan); pronóstico; por hora.
- **Historial:** sólo roles `user`/`assistant`; las gráficas se compactan a su marcador.
- **Alertas:** si preguntan "¿qué alertas tengo?", lee `agent_events` del restaurante (48 h).
- **Ruta rápida + consulta libre:** los bloques precalculados siguen siendo la ruta rápida;
  lo que no cubren (cruces entre secciones, tablas sin bloque propio, periodos a la medida)
  lo resuelve la IA consultando la base por su cuenta — ver sección 3b.

---

## 3b. Lectura universal (`ia_mapa` / `ia_consulta`)

**Objetivo:** la IA entiende y cruza TODOS los datos del restaurante —incluidas secciones
que se agreguen mañana— sin escribir código por sección en `/api/chat`.

```
lote paralelo de lecturas ──► rpc ia_mapa(p_client_id)   (misma espera que las demás)
                                   ▼
               "MAPA DE DATOS" en el prompt (dentro de envolverDatos)
               tabla (N filas, col_fecha desde–hasta): col:tipo, …
                                   ▼
LLM (Groq, tool calling) ──► consultar_datos({sql, para_que}) ──► rpc ia_consulta(p_client_id, p_sql)
      ▲                                                                   │
      └──────────── resultado JSON (≤6k chars, n, truncado, grafica?) ◄───┘
             máx. 4 consultas · ~20 s · error de la base = texto para corregir
```

- **Módulos:** `lib/ia-lectura.ts` (credenciales, mapa, bloque del prompt, pistas, ejecución
  de consultas, ciclo de herramientas), `lib/groq.ts` → `groqConHerramientas` (una vuelta,
  sin reintentos), `lib/graficas-chat.ts` → `graficaDeConsulta`.
- **Mapa:** `ia_mapa` devuelve sólo tablas con datos de ese restaurante: nombre, filas
  (topado a `100000+`), columna de fecha con su rango, columnas seguras con tipo y
  comentario de la tabla. En el prompt va una línea por tabla con tipos cortos (`txt`,
  `int`, `num`, `ts`, `date`, `json`, `bool`, `arr`), tope ~7k caracteres: si no cabe, se
  ordena por relevancia a la pregunta (nombre/columnas/comentario, con sinónimos genéricos
  español → nombres de tablas) y luego por filas, y se dice "(+K tablas más)". Las tablas
  `wansoft_*` / `ops_*` se marcan **[histórico importado]**. Pistas de dominio sólo de tablas
  presentes (p. ej. `pos_orders`: `items` json, `es_venta(status, payment_status)`,
  `dia_venta`). Nada de nombres de un restaurante.
- **Falla ≠ vacío:** si `ia_mapa` falla, el contexto dice "NO PUDE LEER el mapa" y la fuente
  entra a "FUENTES QUE NO SE PUDIERON LEER"; el chat contesta con los precalculados (sin
  herramienta). Mapa vacío = "todavía no tiene tablas con datos".
- **Ciclo** (`responderConHerramientas`): máx. 4 ejecuciones de `consultar_datos` por
  respuesta (errores y argumentos inválidos cuentan); no abre otra ronda si quedan <5 s del
  presupuesto de 20 s; al agotarse fuerza la respuesta con `tool_choice: 'none'`. Si la
  llamada con herramientas falla (429, 5xx, timeout), contesta por `groqChat` (con su
  respaldo de Anthropic) llevando en el system los resultados ya obtenidos.
- **Reglas del prompt:** ruta rápida primero; todo número sale de un bloque precalculado o
  de un resultado de consulta; sumas/promedios/% EN SQL; decir el rango de fechas y si es
  histórico importado; si no hay datos, decirlo (fuera del rango del mapa = sin cobertura,
  no $0). No mostrar SQL ni nombres de tablas salvo que lo pidan; en voz, nunca.
- **Gráficas:** si el resultado N tiene forma graficable, el resultado que ve el modelo trae
  `"grafica": "<!--grafica:consulta-N-->"`. El servidor arma el spec (`id: consulta`) con
  las filas reales sólo si hay UNA columna etiqueta (fecha/mes/hora/texto, sin repetidos)
  + 1–3 numéricas de la misma unidad y 2–60 filas: fecha con >12 puntos → línea; si no,
  barras; texto → ranking de mayor a menor. Título = `para_que`; pie "Fuente: consulta a
  tus datos · <rango si se detecta>". Pasa por `aplicarGraficas` como las demás: un bloque
  escrito por el modelo nunca se dibuja. Si pidieron gráfica y el modelo no marcó, se anexa
  la de la última consulta graficable. En voz no hay gráficas.
- **Observabilidad:** una línea por petición `[chat] lectura universal {auth, mapa,
  consultas, ms_consultas, llamadas_modelo, agotado, respaldo, errores}`. Nunca filas ni
  SQL (el repo no tiene nivel debug). `errores` lleva sólo `consulta N: <SQLSTATE>
  <categoría>` (categorías fijas: `permiso`, `sintaxis`, `columna`, `costo`, `timeout`,
  `otro`) y `modelo: <HTTP>`: **nunca el texto de Postgres**, que puede citar valores de filas
  (`invalid input syntax …: "<dato>"`). El modelo sí recibe el mensaje completo (son datos del
  propio restaurante y lo necesita para corregir la consulta).
- **Consulta demasiado pesada:** si la base la rechaza por costo (SQLSTATE `54000`), el
  modelo recibe primero la pista "la consulta es demasiado pesada: filtra por fechas, agrega
  con GROUP BY o usa LIMIT" y puede reintentar (cuenta para el tope de 4).

**Garantías**

| Garantía | Dónde vive |
|---|---|
| Filtro por restaurante (validador) | `ia_consulta` envuelve cada tabla citada como CTE filtrada por `p_client_id`. El `p_client_id` lo pone el servidor desde `requireTenant` — nunca del cuerpo, del usuario ni del modelo. |
| Filtro por restaurante (**en la base, aunque el validador se salte**) | `ia_consulta` ejecuta la consulta como el rol dedicado **`ia_lector`**: `SELECT` **por columna** sólo sobre columnas seguras de tablas **con RLS** y `client_id` de texto; la política RLS `ia_lector_por_restaurante` deja ver sólo filas cuyo `client_id` es el tenant registrado por `ia._fijar_tenant` en la tabla `ia._sesion`, que `ia_lector` **no puede escribir** (no se falsifica con `set_config`). Se limpian `request.jwt.claims`. Vistas y tablas sin RLS ya no son legibles. Los permisos se resincronizan solos cuando cambia la firma del esquema. Verificado en staging: con el validador de texto brincado y settings falsificados, otro tenant devuelve 0 filas; escrituras, otras tablas y funciones internas, denegadas. |
| JWT del usuario | Sesión de Supabase (dashboard) → las dos RPC van con el token del usuario (`apikey` anon + `Bearer <jwt>`): nunca ve más que él por RLS, y aplica el `statement_timeout` de su rol (`authenticated`). Token de turno del POS (no es JWT de Supabase) → service key (las funciones filtran igual). |
| Sólo lectura | Transacción **read-only** en la base + validador: una sentencia SELECT/WITH; se bloquean `;`, comentarios, `$`, comillas dobles, nombres con esquema, `pg_*`, `set_config`, recursión, DML/DDL. Máx. 200 filas. |
| Tope de costo | `EXPLAIN` antes de ejecutar: costo total > 1,000,000 → error `54000` ("consulta demasiado pesada … acota fechas o agrupa"); el modelo recibe la pista para acotar. |
| Funciones permitidas | agregados, fecha/hora, texto, jsonb, ventanas y `es_venta`. Cualquier otra → "función no permitida: x". |
| Columnas sensibles | Nunca aparecen en el mapa ni en las consultas (pins, tokens, emails, teléfonos, direcciones, RFC…). |
| Secciones nuevas | Auto-descubrimiento: toda tabla pública con columna `client_id` de **texto** aparece sola (caché de 30 min en la base). |

**Límite conocido:** con el JWT del usuario aplica el `statement_timeout` del rol
`authenticated`; por el camino del token de turno del POS / service key **no hay
`statement_timeout`**: la protección contra consultas caras es el tope de costo del `EXPLAIN`
(una estimación del planeador, no un tiempo).

**Cómo hacer visible (o no) una sección**

- Tabla **sin** `client_id` → **no es visible** para la IA. Para que una sección nueva se
  vea, dale una columna `client_id text`, **RLS habilitado** (sin RLS `ia_lector` no la lee)
  y datos.
- Para **excluir** una tabla completa: agrégala a `ia._excluida`. Para excluir una
  columna: `ia._columna_sensible`. (Cambios de SQL en migraciones, no aquí.)
- **Excluidas hoy (2026-09-28, prod y staging):** secretos y colas técnicas (`credentials_vault`,
  `client_users`, `push_subscriptions`, `pos_terminals`, `platform_*`, `integration_*`, …),
  **biométricos** (cualquier tabla con `fingerprint|huella|biometr`), **respaldos**
  (`*_respaldo*`, `*_backup*`) y **`wansoft_data`** (guarda cuentas bancarias y otros blobs).
  Columnas nunca visibles: PINs, tokens, hashes, correos, teléfonos, direcciones (incluidas
  `calle`, `colonia`, `no_interior/exterior`), RFC, CURP, CLABE, tarjetas y cualquier
  `*payload*` (p. ej. `delivery_orders.raw_payload`). En prod quedaron 82 tablas legibles.
- **Antes de agregar una tabla con datos personales**, revisa que sus columnas sensibles
  caigan en `ia._columna_sensible`; si no, agrégalas ahí en la misma migración.
- Para que la IA entienda mejor una tabla: ponle `comment on table` — llega como
  descripción en el mapa (se trata como dato, no como instrucción).

**Límites**

- 4 consultas y ~20 s por respuesta (+ la respuesta final, hasta ~24 s en el peor caso;
  `maxDuration = 60` en la ruta). Máx. 200 filas por consulta; al modelo le llegan ≤6k
  caracteres (se quitan filas y se le avisa).
- Cada ronda es una petición más a Groq: una pregunta con 4 consultas gasta hasta 6 del
  tope gratuito (30/min). Las preguntas que resuelven los precalculados siguen costando 1.

---

## 3c. Verificador de números y evaluación de exactitud

Dos piezas distintas, con promesas distintas:

| | Qué promete | Dónde |
|---|---|---|
| **Verificador de números** (producción) | **Garantía:** ningún número que no se pueda rastrear a los datos llega al dueño, en texto ni en voz. | `lib/verificador-numeros.ts`, al final de `/api/chat` |
| **Eval de exactitud** (CI / local) | **Medición:** qué tan seguido la respuesta es la correcta en preguntas con verdad conocida. La exactitud se **mide, no se garantiza**. | `evals/ia/*`, `npm run eval:ia`, `.github/workflows/eval-ia.yml` |

El verificador impide que un número inventado llegue; no impide que el modelo elija un
número real pero equivocado (p. ej. el de otro periodo). Eso es lo que mide la eval.

### Verificador de números (`garantizarNumeros`)

```
texto del modelo ──► extraer cifras ──► ¿cada una está en la EVIDENCIA? ──sí──► gráficas ► cliente
                                              │ no
                                              ▼
                          UNA reparación (el modelo recibe su respuesta + la lista;
                          con consulta libre puede consultar: máx. 2 consultas, ~12 s)
                                              ▼
                          re-verificar ── lo que siga sin rastro → "[sin verificar]"
                          + nota "Algunos números no se pudieron verificar contra tus datos."
```

- **Evidencia** (sólo valores literales): el bloque de datos del prompt (los precalculados —
  las reglas del prompt NO cuentan), TODAS las celdas de los resultados de `consultar_datos`
  (y su `n`), la pregunta del usuario y sus mensajes anteriores. Las respuestas previas del
  asistente que manda el cliente en `history` **no** cuentan (se podrían falsificar).
- **Clases de evidencia** (una cifra sólo se rastrea con evidencia de su clase):
  - **"$" / pesos / `12.5k` sin unidad de conteo** → sólo **montos**: números escritos con
    "$" en el contexto, o celdas de columnas de dinero (`total`, `venta`, `monto`, `importe`,
    `precio`, `costo`, `propina`, `subtotal`, `descuento`, `pago`, `ticket`, `ingreso`,
    `gasto`, `efectivo`, `tarjeta`…, `RE_COLUMNA_MONTO`).
  - **"%"** → sólo **porcentajes**: números escritos con "%" en el contexto, o celdas de
    columnas `pct`/`porcentaje`/`tasa`/`ratio`/`margen`/`proporción` (tal cual y ×100, por si
    son proporción). Una celda cualquiera `0.14` **no** respalda "14%".
  - **Conteos y números sin unidad** → cualquier número de la evidencia.
  - Lo que escribió **el usuario** (pregunta, historial) sólo respalda **conteos**: su
    "$15,000" o su "20%" nunca respaldan un monto o un % de la respuesta.
- **Sin derivados:** una suma, resta, promedio o % que el modelo calculó no tiene rastro → se
  repara (y en la reparación se le pide calcularlo EN SQL). Es la regla 4 de §1 hecha código.
- **Tolerancia** (sólo de presentación): redondeo a la precisión mostrada (`12,534.49` →
  `$12,534`, `12.5k`, `$12.5 mil`, `13 mil`), truncado de decimales, porcentaje ↔ proporción
  sólo desde columnas de porcentaje (`pct = 0.148` ↔ `14.8%`) y signo (`bajó 3%` = `-3%`).
- **Formatos** (es-MX): `$12,534.50`, `1,214`, `14.8%`, `14,8 %`, `12.5k`, `$1.3M`,
  `2.4 millones de pesos`, `13 mil`, `mdp`, y **números en palabras** ("doce mil quinientos
  treinta y tres pesos", "catorce punto ocho por ciento").
- **No son afirmaciones** (no se verifican): fechas y sus partes (`2026-08-15`, `15 de
  agosto`, `del 1 al 18`, `lunes 5`, `28/09`), años (1990–2100 sin separador ni unidad),
  horas (`14:00`, `2 pm`, `a las 3`, `de 13 a 15 h`), duraciones (`últimos 7 días`), marcadores
  de lista (`1.`), `top 3`, `#1`, ordinales, números pegados a letras (`2x1`, `600ml`,
  `AMA-5096`), marcadores/bloques de gráfica (`<!--…-->`) y destinos de links. En palabras,
  además, los números ≤ 10 que no son monto ni % ("los dos meseros") y los artículos.
- **Voz:** el prompt de voz pide las cifras **con dígitos** (`$12,500`, `32%`); el cliente
  las verbaliza (`lib/voz/texto-hablado.ts`) y así el servidor las verifica igual que en
  texto. Si el modelo aun así escribe palabras, se leen y se verifican.
- **Gráficas:** se verifica el texto ANTES de insertar los specs (que arma el servidor con
  filas reales); un bloque escrito por el modelo nunca se dibuja (§4).
- **Observabilidad:** `[chat] verificador {afirmaciones, sin_rastro, reparado, marcados,
  ms_reparacion, voz}` — conteos, nunca valores.
- **Costo:** una respuesta con cifras sin rastro gasta 1 llamada más al modelo (hasta 3 si
  la reparación consulta) y hasta ~12 s.

### Eval de exactitud (`evals/ia`)

- `preguntas.ts`: 57 preguntas en español — 16 simples, 23 cruces (mesero × franja × día,
  platillo top desayuno vs cena, % de categoría por mesero, ticket fin de semana vs entre
  semana, hora pico por día, pareja de platillos más frecuente, bebida + acompañante, semana
  contra semana por categoría, sucursales, cancelaciones por mesero, % por método de pago…),
  12 trampas (mes sin datos, año anterior, teléfonos/correos/PIN, otro restaurante, tabla
  que no existe, mesero y platillo inexistentes, pronóstico lejano, "hoy" sin ventas ≠ $0) y
  6 de fechas relativas (ayer, anteayer, últimos 7 días, mes pasado, mismo día de la semana
  pasada, mesero top de ayer).
- **Verdad en SQL** por `rpc ia_consulta` (el mismo filtro por restaurante que el chat); las
  cifras esperadas no están escritas: salen de la base en cada corrida. `parametrosSql` elige
  valores del tenant (mesero top, categoría top…); si no aplica, la pregunta se **omite** (no
  cuenta). Una trampa cuya `validezSql` encuentra datos también se omite.
- **Chat en proceso:** `correr.eval.ts` importa `POST` de `app/api/chat/route.ts` y simula
  `requireTenant` con `vi.mock` (sesión por service key del tenant de la eval). **No hay
  ningún "modo eval" en el código de producción.** Las escrituras del chat (`chat_logs`,
  `agent_runs`) se interceptan: la eval no escribe en la base.
- **Reloj fijado:** por defecto `EVAL_IA_AHORA` = 1º del mes siguiente al evaluado, 12:00
  −06:00 (para `2026-08`: `2026-09-01T12:00:00-06:00`, así "ayer" = 31 de agosto y agosto está
  completo). El `now()` de Postgres sigue siendo el real: si el modelo escribe `current_date`
  en su SQL en vez de la fecha del prompt, falla la pregunta de fechas — y es una señal real
  (en producción `current_date` es UTC, no el día de venta). `EVAL_IA_AHORA=real` lo desactiva.
- **Puntaje** (`puntaje.ts`, determinista): número = alguna cifra de la respuesta a ±0.5% del
  esperado o su redondeo a la precisión mostrada; entidad = nombre (sin acentos, ≥60% de sus
  palabras), fecha (`15 de agosto`, `2026-08-15`, `15/08`), hora (`14:00`, `2 pm`, `de 14 a
  15`) o día de la semana; trampa = dice que no hay datos / no se puede, sin `[sin
  verificar]` y sin patrones prohibidos (teléfonos, correos, PIN, "$0"). Se registra además
  latencia, consultas, llamadas al modelo y si el verificador reparó o marcó.
- **Salida:** `evals/ia/resultados/<fecha>.{md,json}` (no se versionan) y la exactitud en
  consola. **Sin datos del restaurante:** por pregunta sólo id, categoría, aprobada/fallida/
  omitida, motivo fijo + clase de error (`permiso`, `sintaxis`, `columna`, `costo`,
  `timeout`, `otro`, `infraestructura`), números esperado vs obtenido (sólo números; las
  entidades sólo ok/no), latencia, consultas y lo que hizo el verificador. Nunca el texto de
  la pregunta (lleva nombres), la respuesta, las filas o el SQL de la verdad, ni mensajes de
  la base. Para depurar en local: `EVAL_IA_DETALLE_LOCAL=1` escribe además
  `<fecha>.detalle-local.json` con preguntas, respuestas y verdad — **nunca en CI** (se ignora
  si existe `CI`) y no se comparte. **Exit 1** si la exactitud < `EVAL_IA_UMBRAL` (0.9), si **cualquier trampa falla**
  (= dato inventado) o si >10% de las preguntas no tuvo respuesta del chat (infraestructura).

**Correr local** (desde `dashboard-app/`; necesita salida a `api.groq.com` y a staging):

```bash
EVAL_IA_SUPABASE_URL=https://<staging>.supabase.co \
EVAL_IA_SUPABASE_SERVICE_KEY=<service_role de staging> \
GROQ_API_KEY=<key> \
npm run eval:ia
# opcionales: EVAL_IA_TENANT (chickin-demo) · EVAL_IA_MES (2026-08) · EVAL_IA_TZ (America/Monterrey)
#             EVAL_IA_AHORA (ISO o 'real') · EVAL_IA_UMBRAL (0.9) · EVAL_IA_PAUSA_MS (3000)
#             EVAL_IA_SOLO=trampa,c05 (categorías o prefijos de id) · EVAL_IA_DIR · GROQ_MODEL
#             EVAL_IA_DETALLE_LOCAL=1 (detalle con datos, sólo local)
```

Las variables son `EVAL_IA_*` a propósito: la eval nunca toma `SUPABASE_URL` /
`SUPABASE_SERVICE_KEY` sueltas (en una máquina de desarrollo suelen ser de producción).
Tarda ~10–20 min (57 preguntas, una a la vez, 3 s de pausa por el tope de Groq por minuto).

**CI:** `.github/workflows/eval-ia.yml` corre **sólo a mano** (`workflow_dispatch`, con
`solo`, `umbral`, `tenant`). **No** corre en `pull_request`: un PR podría cambiar el código
que se ejecuta con la service key de staging. El job usa el environment **`eval-staging`**
(Settings → Environments) con **revisores requeridos**: cada corrida espera aprobación antes
de recibir los secrets. **Por configurar:** crear el environment `eval-staging` con
revisores y, como secrets del environment, `SUPABASE_URL_STAGING` y
`SUPABASE_SERVICE_KEY_STAGING` (los `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` del repo son de
producción y no se usan); `GROQ_API_KEY` puede ser el del repo. Sube el reporte (sin datos)
como artifact por **7 días** y lo pega en el resumen del job (`$GITHUB_STEP_SUMMARY`). Correrla
antes de fusionar un cambio al chat es un paso manual de revisión.

**Pruebas sin red:** `src/__tests__/verificador-numeros.test.ts`,
`src/__tests__/chat-verificador-numeros.test.ts` (ruta completa: texto, voz, reparación con y
sin consulta, gráficas), `evals/ia/puntaje.test.ts` y `evals/ia/correr.test.ts` (config,
reloj, bloqueo de escrituras, corrida con mocks y reglas del SQL del banco). Corren en la
suite normal.

**JEV:** no se usa en la eval. Su único caso cerrado de contradicciones
(`contradiction_check`) tiene un esquema fijo de *reporte de entrega de software*
(`claimed_status` ∈ implemented/tested_locally/…, conteos de pruebas y limitaciones); meter
ahí `{numeric_match, entity_match, trap, said_no_data, verifier_repairs}` sería forzar su
semántica, y un caso nuevo exige subir `JEV_CONTRACT_VERSION`. El puntaje determinista basta.

---

## 4. Gráficas del chat

**El modelo nunca escribe datos de una gráfica.** Sólo elige.

1. `lib/graficas-chat.ts` construye el **catálogo** con datos que la ruta ya leyó. Sólo entra
   una gráfica si su dato existe para ese restaurante:
   `ventas_diarias_30d`, `ventas_por_mes`, `hoy_vs_semana_pasada`, `semana_vs_anterior`,
   `franjas`, `top_platillos`, `meseros`, `metodos_pago`, `ventas_por_hora`; y
   `consulta-N` (resultado de una consulta libre de esta respuesta, sección 3b).
2. El prompt lista los ids disponibles; el modelo escribe `<!--grafica:ID-->` (máx. 2).
3. El servidor (`aplicarGraficas`): convierte marcadores válidos en *placeholders* con un
   código aleatorio por respuesta, **borra todo comentario `<!--…-->` escrito por el modelo**
   hasta punto fijo (incluidos bloques anidados, partidos o sin cerrar), y al final inserta
   los bloques del servidor. Un bloque escrito por el modelo nunca llega al cliente.
4. Si el usuario pidió gráfica y el modelo no marcó ninguna, el servidor elige la mejor
   (`elegirGraficaPorPregunta`).
5. El cliente (`components/chat/GraficaChat.tsx`, recharts) sólo dibuja specs v2 válidas
   (`lib/grafica-spec.ts`). Días sin dato = hueco, no cero; día/mes en curso = barra tenue con
   etiqueta; un solo eje Y; tooltip; "Ver tabla"; `role="img"` con resumen.
6. Paleta `--viz-1..5` y `--viz-ctx` en `globals.css`, validada contra daltonismo en claro y
   oscuro.
7. En modo voz no hay gráficas.

---

## 5. Voz (gratis)

Dos botones en el compositor del chat (`components/chat/ComposerChat.tsx`):

| Botón | Qué hace | Piezas |
|---|---|---|
| **Micrófono** (voice note) | graba → transcribe → el texto queda en la caja para revisar y enviar | `hooks/useGrabadora.ts`, `/api/transcribe` |
| **Ondas** (Habla con tu restaurante) | conversación por turnos: escucha → detecta fin de frase → `/api/chat` con `modo:'voz'` → habla la respuesta → vuelve a escuchar | `hooks/useModoVoz.ts`, `components/chat/ModoVozPanel.tsx` |

- **Transcripción:** `/api/transcribe` → Groq Whisper (`STT_MODEL`, default
  `whisper-large-v3-turbo`, `language=es`). Auth `requireTenant`; máx. 4 MB; 20/min dictado,
  30/min modo voz; 429 de Groq → "Límite gratuito alcanzado". No se guardan audios ni
  transcripciones en logs.
- **Cerebro:** el mismo `/api/chat` (no el viejo `/api/voice`). `modo:'voz'` agrega la
  instrucción de respuesta hablada (2–4 frases, sin tablas ni links, cifras con dígitos: el
  cliente las dice en palabras con `textoParaHablar`, y el servidor las verifica — §3c).
- **Voz de salida:** `speechSynthesis` del navegador (es-MX preferida). Calidad según
  dispositivo: buena en iPhone/Mac, robótica en algunos Android/Windows.
- **Detección de voz:** `lib/voz/vad.ts` (piso de ruido adaptable, 1.2 s de silencio cierra
  el turno, mínimo 0.6 s de voz real). Si un comedor ruidoso dispara de más, ajustar
  `umbralMin`/`factorRuido`.
- **iOS:** el micrófono se suelta mientras habla (si no, WebKit manda el audio al auricular) y
  se reabre al escuchar. Pendiente probar en iPhone real.
- **Cambio futuro a voz en tiempo real:** la UI sólo habla con `transcribir()` / `hablar()`
  en `lib/voz/proveedores.ts`. Un proveedor de pago (p. ej. OpenAI Realtime) se registra ahí y
  se elige con `NEXT_PUBLIC_VOZ_PROVEEDOR`. Diseño acordado para ese momento: token temporal
  creado por el servidor, **una sola tool de lectura** `consultar_restaurante(pregunta)` que
  llama a `/api/chat` (para heredar todas las reglas de la sección 1), tope de minutos por
  restaurante. Hoy **no** hay proveedor de pago: decisión de costo cero.

---

## 6. Agentes del dashboard (`lib/agents/*`, `/api/agents/cron`)

| Agente | Detecta | Notas |
|---|---|---|
| `finance` | venta de hoy vs mismo día **a la misma hora** | crítica sólo con ≥3 semanas comparables y ≥3 h de día |
| `operations` | mesas esperando cobro, cancelaciones, carga | ticket promedio del propio restaurante (no fijo) |
| `staff` | desempeño e inactividad en hora pico | cruza con checador (`pos_attendance`) |
| `fraud` | concentración de cancelaciones/descuentos | paginado; mesero faltante = alerta de calidad, no persona |
| `inventory` | sin stock / bajo mínimo | falso crítico si el restaurante aún cobra fuera del POS |
| `learning` | ajusta confianza con veredictos del dueño | — |

- `dia-negocio.ts`: día de venta, regla de venta, lector paginado.
- `engine.ts`: dedupe por **tipo + sujeto** (la 2ª alerta de otro mesero ya no se pierde);
  críticas quedan marcadas `evidence.notificar.pendiente = true`.
- **Cron:** `.github/workflows/agentes-dashboard-cron.yml` llama `/api/agents/cron` cada
  30 min; recorre todos los `clients.active = true`. Requiere `CRON_SECRET` igual en Vercel
  y GitHub (si no, 503).
- **Pendiente:** el envío de notificaciones (push) no existe todavía; sólo se marcan.

---

## 7. Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `GROQ_API_KEY` (o `GROQ`) | Vercel | chat, voz, transcripción |
| `STT_MODEL` | Vercel (opcional) | modelo de transcripción |
| `CRON_SECRET` | Vercel + GitHub | cron de agentes |
| `NEXT_PUBLIC_VOZ_PROVEEDOR` | Vercel (opcional) | proveedor de voz futuro |
| `AI_GATEWAY_API_KEY`, `JEV_SHADOW_ENABLED=1` | Vercel | JEV (hoy apagado) |
| `EVAL_IA_SUPABASE_URL`, `EVAL_IA_SUPABASE_SERVICE_KEY`, `GROQ_API_KEY` (+ `EVAL_IA_*` opcionales) | local / CI | eval de exactitud (§3c) |
| `SUPABASE_URL_STAGING`, `SUPABASE_SERVICE_KEY_STAGING` | GitHub, secrets del environment `eval-staging` (con revisores; **por configurar**) | `eval-ia.yml` |

---

## 8. JEV

Capa de evaluación en modo sombra (`lib/jev/*`, `/platform/jev`). Contesta **sólo preguntas
cerradas** (elegir opción, puntaje, sí/no) sobre estados de enumeraciones; no ve código, datos
ni texto libre; nunca ejecuta. Sirve para priorizar alertas de telemetría y detectar
contradicciones en reportes de agentes. **No** sirve para revisar el producto ni para
inteligencia de restaurante. Apagado hasta configurar sus variables.

---

## 9. Lo que NO está hecho (para que no haya sorpresas)

- **AMALAY todavía cobra en Wansoft.** Hasta el cambio de caja, sus números nuevos no existen
  en Fullsite; el % por horario y el food cost completo dependen de ese cambio.
  `wansoft_order_times` está vacía: no hay hora de tickets históricos de AMALAY.
- **Agentes de Python (`.github/scripts`)** — asignados a otra línea de trabajo (Codex): apagar
  scrapers de Wansoft, regla única de venta, falla ≠ vacío, workflows sin `CLIENT_ID`,
  proyección de cierre circular, orquestador sin `client_id`. Hallazgos detallados en la
  auditoría del 2026-09-28.
- **Notificaciones push** de alertas críticas: marcadas, no enviadas.
- **Preguntas que todavía no contesta:** "¿dónde pierdo dinero?" (no hay P&L completo con
  gastos y nómina), "¿qué platillo quito?" (falta matriz popularidad × margen precalculada),
  "¿quién necesita capacitación?" (faltan métricas por mesero desde el POS).
- **Food cost** sólo cubre la venta con ficha técnica (~66% en AMALAY, sep 2026).
- **Reservaciones web** (`amalay_reservaciones`): sin entradas desde 2026-04-22; el flujo
  n8n/Make murió. Sin revisar.
- **Voz en iPhone real** y umbrales de ruido en comedor: sin probar en dispositivo.
- **Lectura universal (3b), pendiente:**
  - Correr la eval (§3c) contra staging con Groq real: todavía **no se ha corrido** (este
    entorno no llega a `api.groq.com` ni a staging); falta agregar los secrets de staging.
    La primera corrida dirá la exactitud real y qué preguntas del banco hay que afinar.
  - Voz usa el mismo presupuesto de 20 s: con varias consultas la respuesta hablada puede
    tardar; evaluar un presupuesto menor para `modo:'voz'`.
  - Sesiones con token de turno del POS consultan con service key (el filtro por
    restaurante lo pone la base, pero no hay RLS del usuario).
  - El respaldo de Anthropic no tiene herramientas: si Groq falla, contesta con lo
    precalculado + lo ya consultado.
  - Gráficas de consulta: no hay dona, apiladas ni etiquetas numéricas (usar `to_char`);
    en el historial se compactan y no se vuelven a dibujar en el turno siguiente.
  - La relevancia del mapa es heurística (palabras + sinónimos genéricos); con cientos de
    tablas, las menos relevantes llegan sólo por nombre.
  - Tablas nuevas tardan hasta 30 min en aparecer (caché de `ia_mapa`).
- **Verificador de números (3c), límites conocidos:**
  - Garantiza *rastro*, no *pertinencia*: un número real de otro periodo pasa. Eso lo mide la eval.
  - Enteros chicos (conteos 1–31, etc.) casi siempre tienen rastro por coincidencia (hay
    muchos en los datos): su verificación es débil. Montos y % sí son específicos.
  - Lo que se trata como fecha/hora/duración no se verifica ("3 horas", "las 3 mesas"); un
    año escrito como conteo sin unidad ("2026") tampoco.
  - El seguimiento de una respuesta anterior ("¿y eso vs julio?") no puede citar cifras
    viejas del asistente sin volver a consultarlas: puede costar una reparación.
- **Eval (3c), límites conocidos:** preguntas con definiciones ambiguas (qué es "venta"
  —`total` de la orden vs importe de platillos— o "bebida") pueden fallar por
  interpretación y no por error; las verdades usan `total` de la orden para ventas y el
  importe de `items` para platillos/categorías, y lo dicen en la pregunta cuando importa. El
  banco depende de columnas del esquema (`items` json con `nombre/cantidad/precio/subtotal`,
  `pos_menu_items.name`/`category_id`): si cambian, las verdades fallan y la pregunta se omite
  (aparece en el reporte, no pasa en silencio).
