# Lógica operativa por vertical — auditoría de los 8 presets

> 2026-08-29 · Compañera de [BIBLE-SQUARE.md](BIBLE-SQUARE.md): aquella define QUÉ configura
> cada preset; ésta define CÓMO debe PENSAR el POS en cada giro — ciclo de vida de la orden,
> KPIs con umbral de industria, defaults, errores típicos y su prevención.
> Fuentes internas: SETTINGS-BIBLE, WANSOFT-POS-BIBLE, knowledge/wansoft/BIBLE (§4/§5),
> FULLSITE-DOMAIN-BIBLE (invariantes), CONFIGURABILITY-BIBLE. Externas citadas por sección
> (Toast, Square, QSR Magazine, Backbar, 7shifts, Restaurant365, Intouch Insight).

## 3.1 `fast_food` (QSR / drive-thru)

**Orden.** Nace en mostrador/kiosko/drive-thru; **se cobra antes de prepararse** — esa
inversión (pago→producción) es LA regla del vertical. Vive como número (#47) en el KDS;
muere al entregarse. Una orden QSR con >8 min de vida es excepción operativa, no estado.

**Métricas.** Speed of service drive-thru: total ~5:35 industria, el mejor ~4:16 (QSR
Magazine/Intouch 2025); order accuracy ~87% industria — cada error es un remake que come
margen. Food cost 28–32%, labor 25–30%, **prime cost ≤60%** como techo universal.

**Defaults.** Sin propina en flujo; Turno + Z; sin split; dayparts como dimensión de menú
y reporte (hoy solo hay horario por platillo — elevar a daypart); ticket cliente + KDS,
sin comanda impresa.

**Errores→prevención.** Remakes no registrados → botón "remake" con motivo + merma.
Sobre/sub-staffing → tacómetro de labor por hora vs ventas. Cancelación post-cobro →
I9 (solo admin) + auditoría siempre on.

**BIEN:** speed screen, cobro-antes, combos, tacómetro. **FALTA:** SLA del KDS
configurable por daypart, order accuracy como métrica de primera clase, timer drive-thru.

## 3.2 `fast_casual`

**Orden.** Fila + pago primero, pero el producto se *construye* (base→proteína→toppings):
el builder es un modificador multinivel con `minSelections` (ya existe). Muere en
"entregar en mesa X" (localizador) — estado que falta en el KDS.

**Métricas.** Throughput de línea (órdenes/15 min en pico); mix digital: 57% de marcas ya
generan >25% de ventas digitales (Qu State of Digital); propina promedio counter 17.4%
(Toast). Food cost 28–32%, labor 25–30%.

**Defaults.** Tip screen sugerido (10/15/20% counter — el prompt digital sube propinas
+15–26%), nunca obligatoria; dayparts; KDS con "listo para entregar"; makeline digital
separada en volumen alto (patrón Chipotle).

**Errores→prevención.** Porcionado inconsistente → receta por selección de modificador.
Fila digital que satura cocina → **throttling** por capacidad (gap transversal).

## 3.3 `casual_dining` (línea base — AMALAY, validado)

**Orden.** Mesa con mesero; vive abierta 45–90 min; comanda por envío (batch); muere al
cobrar. El ciclo completo está probado en campo. Los demás presets se definen como diffs.

**Métricas.** Table turn 45–60 min lunch / 60–90 dinner; 3–5 vueltas por turno de cena;
3–5 mesas por mesero; **tiempo por etapa** (sentado→ordenó→comida→cuenta→pagó); propina
full service ~19.3% (Toast); labor 30–35%, food 30–35%. Personas por hora = oro
(Wansoft §4): el POS pregunta personas al cobrar.

**Defaults.** Propina sugerida en preticket (10/15/20 MX), tip-out configurable (AMALAY
5% al pool); corte de Mesero además de Turno/Z; estaciones cocina/barra; split y sillas.

**Errores→prevención.** Transferencias de platillos = vector de fraude → registrar quién
autorizó + reporte dedicado. Cortesías → catálogo con PIN y auditoría. Mesa olvidada →
alerta de inactividad >X min.

## 3.4 `fine_dining`

**Orden.** Nace muchas veces ANTES de la visita (reservación — con depósito: los depósitos
bajan no-shows ~50%, hasta un depósito de $5 los deja <3%; fees típicos $10-40/persona,
fine dining $50-100). Vive por **cursos**: los ítems van a cocina al *fire*, no al
capturarse; el asiento es la coordenada de servicio (servir sin preguntar, split por
persona). Muere lento: cuenta única, propina alta, sobremesa.

**Métricas.** Labor 35–40% (el servicio ES el producto); food cost 30–38% tolerable si el
ticket carga; la reina es **revenue por asiento por servicio** y el mix de vino (30–40%
del ticket; el maridaje sube el ticket ~22%). Covers > turns: aquí NO se optimiza rotación.

**Defaults.** Coursing **Required** (hold & fire con expo); seat numbers on; alergias/
término prominentes; propina % sobre subtotal + **auto-gratuity por mesas grandes**
(estándar Square — nos falta); cortesías solo con PIN gerente.

**Errores→prevención.** Fire desincronizado → KDS agrupa por curso y bloquea el N+1 si el
N no se sirvió. Vino sin control → inventario por onza/botella + paleo. No-shows →
depósito con el mecanismo auth-only de Clip (mismo motor que tabs).

**FALTA:** depósitos de reservación, auto-gratuity, programa de vinos (botella vs copa
como presentaciones del mismo inventario).

## 3.5 `bar_cantina`

**Orden.** Tab anclado a identidad (nombre o tarjeta tokenizada auth-only); vive horas;
muere al cierre con captura ≤ monto autorizado (la propina debe caber en la reserva).

**Métricas.** **Pour cost**: licor 18–20%, draft 21–25%, vino copa 28–32%; shrinkage
típico de barra 10–20% del inventario líquido/mes (¡75% causado por empleados!); ventas
por hora contra last call.

**Defaults.** `service_model: tabs`; propina alta sugerida (18–25%); **arqueo de barra**
(conteo/pesado) en el corte; cortesías con categoría y TOPE por turno; última ronda que
bloquea comandas de alcohol a la hora legal; IEPS automático al detectar alcohol.

**Errores→prevención.** Sobre-servido/regalado → receta por coctel en onzas + paleo
semanal + varianza esperada. Tab que se fuga → pre-auth para abrir. "Efectivo por fuera"
→ toda bebida pasa por comanda a barra, nunca se sirve sin capturar.

**FALTA:** tabs+onzas (diseñado), tope de cortesías por turno, y **varianza de pour cost
como agente IA** (el food-cost-variance líquido).

## 3.6 `cafeteria_panaderia`

**Orden.** Dos vidas: mostrador (<2 min, speed screen + barcode) y **producción**, que
nace la madrugada anterior — consume ingredientes y DA DE ALTA producto terminado (el
módulo más profundo de Wansoft y nuestro gap más honesto).

**Métricas.** 60–70% de la venta antes de la 1 pm (el daypart AM manda staffing y
producción); **merma de vitrina** objetivo 4–10% de ventas (con pars y markdowns, ~4%);
ticket chico → el margen vive en volumen y attach rate (bebida + pan; el pan y el café
tienen food cost 8–20%).

**Defaults.** Speed screen + barcode; propina jar/opcional; producción con plantillas
recurrentes y pronóstico por día de semana ("sábado = 40 croissants, no 20"); venta por
peso; corte temprano.

**Errores→prevención.** Producir por costumbre → pronóstico IA por daypart. Merma
invisible → **cierre de vitrina diario** (lo no vendido = merma con costo). Yield sin
control → tracking entrada MP vs salida real.

## 3.7 `hibrido_restaurante_tienda` (AMALAY — validado)

Dos ciclos de vida de orden (mesa vs escaneo-cobro) sobre UN inventario, con reportes que
separan (Market/Delivery fuera del ticket promedio — ya prevenido). La lección de diseño
más importante: **`service_model` debe poder ser POR TERMINAL**, no solo por tenant —
AMALAY es la prueba viviente (scope `terminal` ya existe en settings.ts).

## 3.8 `dark_kitchen_delivery`

**Orden.** Nace FUERA (Rappi/Uber/web), ya pagada; el "POS" es un inbox de canales que
normaliza al KDS; vive contra un **promise time**; muere en despacho.

**Métricas.** Comisión 15–30% por canal (DoorDash 15/25/30 oficial; costo efectivo con
promos/refunds llega a 30–40%) → **P&L por canal y por marca** es la métrica existencial;
rating por plataforma; prep time vs prometido; % rechazadas.

**Defaults.** **Marcas virtuales** de primera clase (N marcas, 1 cocina, 1 inventario —
Wansoft ya lo modela; nuestro preset no las menciona: omisión cara); disponibilidad
automática por stock (86 en TODAS las plataformas a la vez); throttling por capacidad;
**precios por canal** para absorber comisión.

**Errores→prevención.** Aceptar más de lo producible → throttling + pausa de canal. No
conciliar depósitos del agregador → agente de reconciliación. Mismo precio sala/app →
tipo de precio delivery por default.

---

## Decisiones de diseño transversales

| # | Decisión | Regla |
|---|---|---|
| 1 | `service_model` con scope **por terminal** | tables/counter/tabs/channels decide pantalla y ciclo de vida; un tenant mezcla modos (AMALAY) |
| 2 | **El momento del cobro define el vertical** | counter/channels: pago→producción; tables/tabs: producción→pago. Propina, split y corte cuelgan de esto |
| 3 | Invariantes jamás varían por preset | Audit on, deducción al enviar, Z consecutivo, I1–I12, client_id en todo |
| 4 | Propina = política por preset, mecanismo único | obligatoria/sugerida/jar/ninguna + tip-out % — mismo motor |
| 5 | Los 5 cortes existen en todos; el preset exige cuáles | X/Turno/Z/Global/Mesero; arqueo de barra = variante del de caja |
| 6 | Alertar, no bloquear (excepto dinero) | Sin stock → alerta; en pagos, centavo exacto o no cierra |
| 7 | KPI con umbral por vertical, mismo motor de agentes | prime ≤60% universal; labor/food/pour con umbral del preset |
| 8 | Auth-only tokenizado = un mecanismo, tres usos | tabs de bar, depósitos fine dining, garantías de eventos |
| 9 | Dayparts como dimensión nativa | menú, staffing, reportes y producción por daypart (hoy solo horario por platillo) |
| 10 | Capacidad de cocina gobierna canales digitales | throttling/pausa automática — falta en 3.1, 3.2 y 3.8 |
| 11 | Preset = punto de partida, jamás jaula | DEFAULTS ⊕ preset ⊕ plan ⊕ overrides |

**Veredicto sobre BIBLE-SQUARE §3:** estructura y diferenciadores correctos. Tres huecos
sistemáticos: (a) **los presets deben nacer con KPIs y umbrales precargados** (ningún
preset trae umbral hoy); (b) falta la familia "capacidad" (throttling, promise times,
SLA por daypart); (c) fine_dining sin depósitos y dark_kitchen sin marcas virtuales son
las omisiones puntuales más caras.
