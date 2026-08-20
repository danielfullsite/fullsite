# Pricing Fullsite — canónico

> **Decidido 2026-08-19.** Escalera de 3 paquetes por PRODUCTO (cuña → premium), IA incluida en
> todos. Reemplaza el esquema viejo de "$1,999 único" (julio) y cualquier tier intermedio.
> Este doc es la fuente de verdad; debe coincidir con `dashboard-app/src/lib/plans.ts`, el deck y la landing.
> Pendiente: recalcular `UNIT-ECONOMICS-DEEP.md` sobre estos números (hoy está sobre $1,999).

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
| **Reporteador IA** | **$1,499 MXN/mes** · $14,999/año | Solo la capa de IA, encima del POS que **ya tienen** (Wansoft/otro). Sin cambiar su sistema. | 🎣 **La cuña** — la venta fácil, el "sí" de entrada |
| **Fullsite Software** | **$4,999 MXN/mes** · $49,999/año | POS completo + KDS + inventario + 30 agentes IA + dashboard. Sin hardware (BYOD). | 📈 **El expandir** |
| **Fullsite Completo** | **$4,999 MXN/mes + $45,000 hardware** (una vez) | Todo lo anterior + kit de hardware llave en mano. | 🏆 **El premium** — llave en mano |

- **Terminal adicional:** +$499 MXN/mes (Fullsite Software/Completo).
- **Hardware BYOD** en Software: el restaurante compra su tablet/impresoras (~$8-12K en Amazon) o sube a Completo.
- **Sin contrato** en todos. **Precio fundador** (primeros 10 en Fullsite) se respeta de por vida.

---

## Por qué esta estructura (la lógica)

1. **La cuña resuelve la primera venta sin traction.** Vender $4,999 en frío, sin cliente arm's-length,
   es dificilísimo (distribución 3/10). El **Reporteador $1,499** matchea lo que ya pagan de Wansoft
   (~$1,500), no les pide cambiar de POS, y entra **liderando con la IA** (el diferenciador). Aterrizas
   barato → subes a Fullsite cuando ya confían.
2. **Coherente con la tesis.** El $1,999 único competía como "Wansoft más barato" — commodity, carrera
   al fondo, contradice "experto de IA". La escalera vende inteligencia, no un cajón registrador.
3. **Mejor unit economics.** A $1,999 el break-even con equipo era ~43 restaurantes; con la escalera
   (ARPU mezclado más alto) baja hacia ~17-20. El $1,999 además anclaba bajo para siempre.

**Movimiento de venta:** ofrecer el **Reporteador $1,499** como entrada al Cliente #2 (Eduardo/jueves).
Fullsite $4,999 queda como el premium al que se sube.

---

## Unit economics (estimado — recalcular en UNIT-ECONOMICS-DEEP)

| Métrica | Reporteador $1,499 | Fullsite Software $4,999 |
|---|---|---|
| Precio/mes | $1,499 | $4,999 |
| Costo API (Claude) | -$200 | -$200 |
| Comisión implementación (~10%) | — (sin instalación) | -$500 |
| **Margen aprox/mes** | **~$1,300 (87%)** | **~$4,300 (86%)** |

> Nota: cifras aproximadas. La escalera mejora el ARPU mezclado vs el $1,999 único; el break-even real
> con equipo debe recalcularse en `UNIT-ECONOMICS-DEEP.md` (hoy asume $1,999, ~2.5x equivocado).

---

## Fullsite vs Wansoft (el pitch)

Basado en cotización real de Wansoft para AMALAY: **$154,580 primer año** ($130K hardware + $1,500/mes + anualidad).

- **Reporteador:** la IA que Wansoft **no tiene**, encima del POS que ya pagas — por ~lo mismo que su renta.
- **Fullsite:** todo lo que Wansoft te cobra $155K el primer año, con IA incluida, sin instalación, sin contrato.

---

## Reglas de pricing

1. **La IA va en todos.** No existe paquete sin IA (salvo trato *custom* con una cadena grande — nunca tier público).
2. **Nunca negociar el mensual.** Si quieren descuento, das meses gratis, no precio menor.
3. **Precio fundador se respeta** — los primeros 10 de Fullsite nunca suben.
4. **Sin contrato** es el diferenciador #1.
5. **Reporteador es la cuña, no el destino** — el objetivo es subirlos a Fullsite.

---

## Endgame (post-200 restaurantes)

Procesamiento de pagos propio (modelo Toast): software casi gratis, cobras 2.5-3% por transacción.
Cambia toda la ecuación. Ver plan maestro (jugada de pagos).
