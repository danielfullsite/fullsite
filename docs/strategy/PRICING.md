# Pricing Fullsite — canónico

> **Decidido 2026-08-19. Cuña ajustada a $1,999 el 2026-08-27.** Escalera de 3 paquetes por PRODUCTO (cuña → premium), IA incluida en
> todos. Reemplaza el esquema viejo de "$1,999 único" (julio) y cualquier tier intermedio.
> Este doc es la fuente de verdad; debe coincidir con `dashboard-app/src/lib/plans.ts`, el deck y la landing.
> Pendiente: recalcular `UNIT-ECONOMICS-DEEP.md` sobre estos números (hoy asume el esquema viejo de
> julio: un precio único de $1,999 todo incluido, que ya no existe).

---

## La regla que gobierna todo el pricing

**No vendemos otro POS. Vendemos un experto de IA que además maneja tu punto de venta.**
Por eso: (1) **la IA va en TODOS los paquetes** — es la razón, no el upsell; (2) **no existe un
paquete "POS sin IA"** — eso sería competir como commodity contra Wansoft, justo lo que evitamos;
(3) nunca competimos por precio de POS — competimos por inteligencia.

---

## Los 3 paquetes (escalera cuña → premium)

| Paquete | Precio | Qué es | Rol GTM |
|---|---|---|---|
| **Fullsite Inteligencia** | **$1,999 MXN/mes** · $19,999/año | Solo la capa de IA, encima del POS que **ya tienen** (Wansoft/otro). Sin cambiar su sistema. | 🎣 **La cuña** — la venta fácil, el "sí" de entrada |
| **Fullsite Software** | **$4,999 MXN/mes** · $49,999/año | POS completo + KDS + inventario + 30 agentes IA + dashboard. Sin hardware (BYOD). | 📈 **El expandir** |
| **Fullsite Completo** | **$4,999 MXN/mes + $45,000 hardware** (una vez) | Todo lo anterior + kit de hardware llave en mano. | 🏆 **El premium** — llave en mano |

- **Terminal adicional:** +$499 MXN/mes (Fullsite Software/Completo).
- **Hardware BYOD** en Software: el restaurante compra su tablet/impresoras (~$8-12K en Amazon) o sube a Completo.
- **Sin contrato** en todos. **Precio fundador** (primeros 10 en Fullsite) se respeta de por vida.

---

## Conectividad — módem celular incluido (bala + chaleco)

Incluido en la **activación** + datos dentro de la **mensualidad**: un **módem celular dedicado**,
permanente, aislado del internet del local. No es respaldo que entra cuando falla la fibra — es una
línea independiente para el POS. Una caja consume datos mínimos (solo texto).

**La diferencia con quien vende "solo módem" (MaxIA):** ellos son *conectividad-primero* — si el
celular falla, su POS muere. Fullsite es **local-first**: opera con **cero señal** (fibra Y celular
caídos), y el módem es el complemento para el 99.9% de uptime. **Garantizamos operación, no solo conexión.**
Ver `knowledge/competitive/MAXIA.md`.

## Por qué esta estructura (la lógica)

1. **La cuña resuelve la primera venta sin traction.** Vender $4,999 en frío, sin cliente arm's-length,
   es dificilísimo (distribución 3/10). **Fullsite Inteligencia $1,999** no les pide cambiar de POS y
   entra **liderando con la IA** (el diferenciador). Aterrizas barato → subes a Fullsite cuando confían.

   **La cuña es ADITIVA, y eso cambia la aritmética de la venta** (corregido 2026-08-27). El cliente
   NO deja de pagarle a Wansoft: le suma Fullsite encima. Su costo real queda así:

   | | Le paga a Wansoft | Le paga a Fullsite | **Total/mes** |
   |---|---|---|---|
   | Fullsite Inteligencia | $1,500 | $1,999 | **$3,499** |
   | Fullsite Software | $0 (lo cancela) | $4,999 | **$4,999** |

   Por eso la brecha real entre cuña y producto completo **no es 3.3x — es 1.4x**. El discurso de venta
   es: *"dos mil encima de lo que ya pagas, o cinco mil y cancelas Wansoft"*. Por $1,500 más se lleva el
   POS completo y se quita un proveedor. **El $1,999 existe para apretar esa brecha, no para abaratar.**
   Un tier intermedio de POS (~$2,500-3,000) destruiría justo este movimiento: nadie paga $4,999 si por
   la mitad tiene POS y chat. Es el $1,999 único de julio con otro nombre.
2. **Coherente con la tesis.** El **"$1,999 único" de julio** competía como "Wansoft más barato" —
   commodity, carrera al fondo, contradice "experto de IA". La escalera vende inteligencia, no un cajón
   registrador.

   > **⚠️ No confundir los dos $1,999.** Son el mismo número y productos opuestos:
   > el **de julio (descartado)** era **TODO incluido** — POS, KDS, inventario, IA — por $1,999. Ése sí
   > anclaba el POS abajo y regalaba el producto completo.
   > El **de hoy (vigente)** es **SOLO la capa de IA**, encima del POS que el cliente ya paga. No compite
   > contra el precio de un POS; se suma a él. Por eso no reproduce el problema del anterior.

3. **Mejor unit economics.** Con el "$1,999 único" el break-even con equipo era ~43 restaurantes; con la
   escalera (ARPU mezclado más alto) baja hacia ~17-20, porque el destino es Fullsite $4,999, no la cuña.

**Movimiento de venta:** ofrecer **Fullsite Inteligencia $1,999** como entrada al Cliente #2 (Eduardo/jueves).
Fullsite $4,999 queda como el premium al que se sube.

---

## Unit economics (estimado — recalcular en UNIT-ECONOMICS-DEEP)

| Métrica | Inteligencia $1,999 | Fullsite Software $4,999 |
|---|---|---|
| Precio/mes | $1,999 | $4,999 |
| Costo API (Claude) | -$200 | -$200 |
| Comisión implementación (~10%) | — (sin instalación) | -$500 |
| **Margen aprox/mes** | **~$1,800 (90%)** | **~$4,300 (86%)** |

> Nota: cifras aproximadas. La escalera mejora el ARPU mezclado vs el "$1,999 único" de julio; el
> break-even real con equipo debe recalcularse en `UNIT-ECONOMICS-DEEP.md`, que sigue asumiendo aquel
> esquema y por eso está ~2.5x equivocado.

---

## Fullsite vs Wansoft (el pitch)

Basado en cotización real de Wansoft para AMALAY: **$154,580 primer año** ($130K hardware + $1,500/mes + anualidad).

- **Inteligencia:** la IA que Wansoft **no tiene**, encima del POS que ya pagas — sin tocar tu sistema.
- **Fullsite:** todo lo que Wansoft te cobra $155K el primer año, con IA incluida, sin instalación, sin contrato.

---

## Reglas de pricing

1. **La IA va en todos.** No existe paquete sin IA (salvo trato *custom* con una cadena grande — nunca tier público).
2. **Nunca negociar el mensual.** Si quieren descuento, das meses gratis, no precio menor.
3. **Precio fundador se respeta** — los primeros 10 de Fullsite nunca suben.
4. **Sin contrato** es el diferenciador #1.
5. **Inteligencia es la cuña, no el destino** — el objetivo es subirlos a Fullsite.

---

## Endgame (post-200 restaurantes)

Procesamiento de pagos propio (modelo Toast): software casi gratis, cobras 2.5-3% por transacción.
Cambia toda la ecuación. Ver plan maestro (jugada de pagos).
