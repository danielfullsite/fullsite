# Copiloto de Rentabilidad — Control de Inventario Anti-Robo

> Documento de ideas (vision). El dolor #1 del dueño de restaurante es la **fuga de
> inventario**: robo hormiga, mermas, sobre-porción y compras infladas. El dueño no
> vive por reportes — vive por la **rentabilidad**. Fullsite debe ser el que le dice,
> con evidencia: *"te están fugando $X, aquí está dónde, y esto haces."*
>
> Regla de este doc: cada idea marca su tier de factibilidad —
> **🟢 con lo que ya tenemos** · **🟡 necesita hardware** · **🔵 moonshot** — y, donde
> aplica, en qué se apoya (`recordMovement`, `pos_recipes`/BOM, motor de food-cost,
> agentes `cost-variance`/`waste`/`stock-alert`). No es fantasía; es roadmap.

---

## 0. La tesis en una frase

El POS ya sabe **qué vendiste**. La receta (BOM) sabe **qué DEBISTE consumir**. El
inventario sabe **qué realmente se consumió**. La diferencia entre esos tres números es
**merma + robo + sobre-porción**, y hoy nadie en el restaurante la ve en tiempo real.
Fullsite la ve. Ese delta, con nombre y monto, es el producto.

---

## 1. El arma central: **costo teórico vs. costo real** (variance)

La feature que sola justifica el producto.

- **Cómo:** `ventas del POS × receta (pos_recipes)` = consumo TEÓRICO de cada insumo.
  Compáralo contra el consumo REAL (`inventario inicial + compras − inventario final`,
  vía `recordMovement`). El delta es la fuga.
- **El ejemplo que vende:**
  > *"Esta semana vendiste 84 arracheras → debiste usar **25.2 kg** de arrachera.
  > Compraste 32 kg, tu inventario bajó 30 kg. Te faltan **4.8 kg (~$1,900)** que no
  > explica ninguna venta. En 3 semanas van $5,700."*
- **Afinadísimo — cortar el variance por todos los ejes:**
  - por **insumo** (carne, licor, queso...) — el 80% de la fuga está en 5 insumos caros.
  - por **platillo** (qué receta se está sobre-sirviendo).
  - por **turno / día / mesero / cocinero** (¿la fuga sube en el turno de la noche?).
  - por **estación** (barra vs cocina).
- **El número que el dueño quiere ver arriba de todo:** *food cost real* vs *objetivo*,
  y **cuántos pesos** de eso son fuga inexplicada (no "food cost 31%", sino "$14,300 de
  fuga este mes, 60% carnes").

🟢 Base ya construida: `pos_recipes` (BOM = verdad ~27.6%), `recordMovement` (ledger
atómico + costo promedio ponderado), agente `cost-variance`. Falta cerrar el loop
teórico↔real y presentarlo como dinero, no como %.

---

## 2. Disciplina de conteo físico (el sistema te regaña)

El variance solo sirve si el **conteo físico** se hace. Los dueños se enfocan en
rentabilidad y el conteo se salta — ahí se esconde el robo.

- **Nag inteligente:** *"Llevas 6 días sin conteo físico de carnes. Sin él no puedo
  detectarte robo en tu insumo más caro. Toma 4 minutos."* Escalando: aviso → alerta →
  se lo dice al dueño directo.
- **Conteo ciego:** al contar, **NO** muestres el teórico. Si el empleado ve "deberían
  ser 30 kg", ajusta a 30 y tapa el robo. Conteo a ciegas = el número honesto.
- **Detección de conteos "maquillados":** si el conteo **siempre cuadra** sospechosamente,
  o siempre lo hace la misma persona, o siempre a la misma hora, o siempre se ajusta
  hacia el teórico → bandera. El que cuenta puede ser el que roba.
- **Conteo por foto/voz:** foto del anaquel → CV cuenta botellas/piezas; o dictar por
  voz mientras cuentas. Baja la fricción para que sí se haga.
- **Conteo por ciclos (cycle counting):** no contar TODO cada vez — el sistema te dice
  *"hoy cuenta solo estos 6 insumos de alto riesgo"* (rota los caros/volátiles más seguido).

🟢 Nag + conteo ciego + detección de patrones = software puro. 🟡 Foto/voz-CV = hardware/ML.

---

## 3. ¿En cada cuánto te avisa? — Cadencia de alertas

No un reporte semanal que nadie lee. **Capas** según la urgencia del dinero:

| Cadencia | Qué dispara | Ejemplo |
|---|---|---|
| **Tiempo real (al cerrar turno)** | Variance del turno > 2× lo normal | *"El turno de la noche tuvo fuga de carne 2.3× el promedio. Cocinero: Diego."* |
| **Diario (briefing 7am)** | Fuga del día por insumo top | *"Ayer: $1,100 de fuga, 70% en tequila."* |
| **Semanal (ejecutivo)** | Food cost real vs objetivo + tendencia | *"Food cost 34% (objetivo 28%). +6 pts = $22k/mes."* |
| **Event-driven (inmediato)** | Ajuste de inventario sospechoso, merma alta, conteo maquillado | *"Ajuste manual de −8 kg de arrachera sin motivo, a las 23:40, por Diego."* |

Regla: **el dinero grande = interrumpe** (push/WhatsApp). Lo chico = se acumula al
briefing. Nunca ruido.

🟢 Ya existe el patrón: agentes + `agent_events` + fraud watcher near-real-time.

---

## 4. Robo hormiga — detección activa

Aquí entran las ideas más fregonas (y la cámara que mencionaste).

- **🔵 Cámara + visión por computadora en almacén/barra:** detecta cuando alguien saca
  producto **sin registrar una salida**, cuenta botellas/cajas, ve el anaquel vacío antes
  de que el conteo lo diga. El video es la **evidencia** que hoy no existe ("¿cómo pruebo
  que se lo llevó?"). Empezar simple: una cámara barata + detección de movimiento en
  horarios raros + "¿esta salida coincide con un registro?".
- **🟡 Básculas inteligentes en insumos caros (carne, licor):** peso en tiempo real. La
  báscula de la carne baja 3 kg → ¿hubo venta que lo justifique? Si no, alerta con
  timestamp. El licor es el caso de oro (caro, líquido, fácil de robar).
- **🟢 Correlación POS ↔ inventario (sin hardware):**
  - **Barra / free-pour:** el tequila baja 20% más rápido que las ventas de margaritas
    → over-pour, cortesías no registradas, o trago desviado. *"Serviste 1.2× el licor
    que vendiste."*
  - **Bebida sin ticket:** el refresco/cerveza baja pero no hay venta → consumo del staff
    o cortesía no registrada.
  - **Cancelación después de preparar:** item cancelado tras mandarse a cocina = producto
    que SALIÓ pero no se cobró (se lo comieron o se lo llevaron). Cruzar cancelaciones con
    consumo de inventario.
- **🟢 Huella del ladrón:** el mismo insumo, el mismo turno, el mismo cocinero/mesero, la
  misma hora → la IA arma el patrón que el humano no ve en el ruido.

---

## 5. Sobre-porción y adherencia a la receta

El robo no siempre es llevarse producto — a veces es **servir de más** (y regalar tu margen).

- **🟢 Costo real por platillo vs. teórico:** si la arrachera "cuesta" más de lo recetado
  consistentemente, alguien sobre-sirve. Detecta al cocinero cuya estación tiene el food
  cost más alto.
- **🟡 Yield / rendimiento del corte:** una pieza de X kg debe rendir N porciones. Si
  rinde menos, hay merma en el corte o robo en el despiece. *"Tu rib eye rinde 6.2
  porciones/kg vs. 7.0 estándar — pierdes 11% en el corte."*
- **🟢 Recetas como contrato:** el POS ya conoce el BOM; cuando el real se desvía del
  teórico por platillo, es señal de porción fuera de control (no de robo de bodega).

---

## 6. Compras y proveedor — la fuga por el otro lado

- **🟢 Price creep:** *"Tu proveedor de carnes subió 8% este mes sin avisar. Cotiza con
  un 2º antes del próximo pedido."* (ya sembrado como idea en el demo).
- **🟡 Short delivery:** pediste 20 kg, facturaron 20, llegaron 18. Validar recepción
  contra la orden de compra (peso/conteo a la entrada). El proveedor "se equivoca"
  siempre a la baja.
- **🟢 Compras infladas:** alguien compra de más de lo que la demanda justifica y desvía
  el excedente. Cruzar compras vs. consumo teórico + ventas.
- **🟢 Costo por platillo se mueve con el precio de compra:** cuando sube un insumo, el
  sistema recalcula qué platillos ya no son rentables y sugiere subir precio o cambiar
  proveedor. (Menu engineering vivo.)

---

## 7. Correlaciones que **solo la IA** ve

El valor no es un dato — es el cruce que un dueño ocupado jamás haría a mano:

- Variance de merma **sube cuando trabaja** cierto cocinero/mesero.
- Fuga **concentrada en el turno de cierre** (menos supervisión).
- **Descuento alto + producto consumido** = posible venta desviada (cobró menos y se
  quedó la diferencia, o regaló a un conocido).
- **Cancelaciones + inventario + mismo empleado** = el trío que delata.
- **Días sin conteo ↔ picos de variance** cuando por fin se cuenta = el robo se acumuló
  en la ventana ciega.

---

## 8. El framing que vende: **Copiloto de Rentabilidad**

El dueño no quiere "un módulo de inventario". Quiere una respuesta:

> **"¿Cuánto me están robando y qué hago?"**

El sistema responde con las 4 cosas que un reporte nunca da:
1. **Monto** — "$14,300 de fuga este mes".
2. **Dónde** — "60% carnes (sobre-porción turno noche), 30% licor (barra), 10% merma".
3. **Quién (probable)** — el patrón: insumo + turno + persona.
4. **Acción** — conteo ciego hoy, aprobación para ajustes >X, rotar responsable de barra.

Un "estado de resultados vivo": cada peso de fuga cerrado cae **directo a la utilidad**.
Ese es el ROI que paga Fullsite 10 veces.

---

## Priorización (qué construir primero)

| Prioridad | Idea | Tier | Palanca |
|---|---|---|---|
| **P0** | Variance teórico vs real por insumo, en **pesos** | 🟢 | recordMovement + pos_recipes |
| **P0** | Nag de conteo físico no hecho + conteo ciego | 🟢 | agentes + agent_events |
| **P1** | Cadencia de alertas (turno / diario / semanal / evento) | 🟢 | fraud watcher pattern |
| **P1** | Correlaciones (variance ↔ turno/persona; cancelación ↔ inventario) | 🟢 | pos_orders + ledger |
| **P1** | Sobre-porción: food cost real por platillo/estación | 🟢 | food-cost engine |
| **P2** | Compras: price creep, short delivery, compras infladas | 🟢/🟡 | supplier data + OC |
| **P2** | Conteo por foto/voz (baja fricción) | 🟡 | ML/CV |
| **P3** | Básculas inteligentes (carne/licor) | 🟡 | IoT |
| **Moonshot** | Cámara + CV anti-robo-hormiga con evidencia en video | 🔵 | CV + edge |

**Lo honesto:** los P0/P1 son **casi todos software con datos que Fullsite ya captura** —
ahí está el 80% del valor y se puede vender ya. El hardware (básculas, cámara) es el
diferenciador "wow" para el pitch y para el enterprise, pero no es requisito para
empezar a cerrarle la fuga a un cliente. **Primero el copiloto de variance en pesos;
la cámara es el titular, no el cimiento.**

---

## Por qué esto es el moat de Fullsite

Un POS cualquiera te dice cuánto vendiste. Wansoft te da un reporte de food cost que
nadie lee. **Nadie te dice, con nombre y monto y en tiempo real, cuánto te están
robando y quién.** Eso solo lo puede hacer quien tiene el POS (ventas) + la receta (BOM)
+ el inventario (ledger) + la IA que cruza los tres. Fullsite tiene los tres. Este es
el producto que hace que "el experto de IA en tu restaurante" deje de ser slogan.
