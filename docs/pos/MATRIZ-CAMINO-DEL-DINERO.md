# Matriz del camino del dinero — AMALAY

> **Qué es:** el guion para ejercitar por primera vez cobrar, mover efectivo y cortar
> caja en Fullsite POS.
>
> **Por qué existe:** porque nunca ha pasado. No es una figura retórica — es lo que
> dice la base de datos.
>
> **Creado:** 2026-08-25. Contra `main` en `25179e3f`.

---

## El hecho que motiva todo esto

Consulta de sólo lectura sobre la base de AMALAY, 2026-08-25:

| Tabla | Filas para `amalay` |
|---|---|
| `pos_menu_items` | 687 |
| `pos_staff` | 40 |
| `pos_print_jobs` | 338 |
| `pos_save_operations` | 326 |
| **`pos_cash_movements`** | **0** |
| **`pos_facturas`** | **0** |
| **`pos_orders`** | **0** |

El catálogo está completo y anoche sí se comandó e imprimió: 5 comandas a cocina
entre las 23:23 y las 00:58. Lo que **nunca** ha ocurrido es la otra mitad —
**cobrar, mover efectivo y cerrar el turno**.

Esa mitad es la que toca el dinero.

---

## Lo que se arregló y todavía nadie ha visto funcionar

Dos correcciones entraron a producción hoy (2026-08-25) y **ninguna se ha ejercido
en campo**:

**`#61` — el 403 de negocio que deslogueaba al cajero.**
El shift token lleva el rol del staff **logueado**, no el del gerente que teclea su
PIN para autorizar. Entonces una caja abierta como *cajero* recibía `403 manager
required` en **cada retiro, cada depósito y cada corte**. El replay lo confundía con
"sesión expirada" y hacía dos daños: abortaba el drenado completo —todo lo encolado
después nunca subía— y deslogueaba al operador; al re-teclear el PIN volvía a chocar
con el mismo 403, en bucle cada ~20 segundos.

**`#63` — los modificadores obligatorios offline.**
El Service Worker resuelve las rutas caídas con `503`, y `fetch` no lanza, así que el
catch nunca corría: el platillo perdía sus grupos **obligatorios** y la comanda salía
a cocina sin el término de la carne, en silencio.

> Ambos están *implementados* y *probados localmente*. No están *validados en campo*.
> Esta matriz es lo que los mueve a esa categoría.

---

## Antes de empezar

| | |
|---|---|
| Fuera de horario de servicio | ☐ |
| Mesa designada para pruebas | **`___`** |
| Caja abierta con un usuario **CAJERO** (no gerente) | ☐ ← indispensable para el bloque C |
| Gerente presente para autorizar con su PIN | ☐ |
| SERVER1 encendida (Pedro en `192.168.1.71:7717`) | ☐ |
| Cola de sincronización en **0** | ☐ |
| Fondo de caja contado y anotado | **`$______`** |

**Por qué la caja tiene que estar abierta como cajero:** el bug de `#61` sólo aparece
cuando el rol del shift token no alcanza para la escritura. Si se prueba logueado
como gerente, **no se reproduce nada** y la prueba no vale.

---

## Bloque A — Cobrar en efectivo *(nunca se ha hecho)*

| # | Paso | Qué anotar |
|---|---|---|
| A1 | Abrir la mesa designada. Agregar 2 platillos, uno con modificador obligatorio. | ¿Pidió el modificador? ← valida `#63` |
| A2 | Enviar a cocina. | ¿Imprimió? ¿Llegó al KDS con el modificador? |
| A3 | Cobrar en **efectivo**, con un monto mayor al total. | ¿Calculó bien el cambio? |
| A4 | Revisar el ticket impreso. | ¿Total, IVA y forma de pago correctos? |
| A5 | Mirar el mapa de mesas. | ¿La mesa quedó libre? |

**PARAR si:** no imprime el ticket, el cambio está mal, o la mesa sigue ocupada.

---

## Bloque B — Cobrar con tarjeta y con propina

| # | Paso | Qué anotar |
|---|---|---|
| B1 | Abrir la mesa. Agregar 1 platillo. | |
| B2 | Cobrar con **tarjeta**, agregando **15% de propina**. | ¿El total incluyó la propina? |
| B3 | Repetir con **pago mixto**: una parte efectivo, otra tarjeta. | ¿Cuadró el restante? |

---

## Bloque C — Movimientos de caja *(el que valida `#61`)*

Este es **el bloque más importante de la matriz**. Es donde el bug vivía.

| # | Paso | Qué anotar |
|---|---|---|
| C1 | Confirmar en pantalla con qué usuario está abierta la caja. | Nombre y **rol** |
| C2 | Registrar un **retiro de $50**. El gerente autoriza con su PIN. | ¿Lo aceptó? |
| C3 | **Esperar 60 segundos sin tocar nada.** | ¿Se deslogueó solo? ¿Pidió PIN otra vez? |
| C4 | Abrir el diagnóstico de sincronización. | ¿Cuántos pendientes? ¿Algún error? |
| C5 | Registrar un **depósito de $100**. | ¿Lo aceptó? |
| C6 | Esperar otros 60 segundos. | ¿Se deslogueó? |
| C7 | Repetir C3 una tercera vez. | ¿Se deslogueó? |

> **Cómo se lee este bloque.** Antes de `#61`, C3 deslogueaba al cajero y volvía a
> hacerlo cada ~20 segundos. Si ahora **no** se desloguea en C3, C6 ni C7, y la cola
> queda en 0, el arreglo funciona en campo.
>
> Si **sí** se desloguea: **PARAR**, no re-teclear el PIN repetidamente, y capturar la
> consola del navegador. Esa evidencia vale más que terminar la matriz.

---

## Bloque D — El corte

| # | Paso | Qué anotar |
|---|---|---|
| D1 | Entrar a Corte de Caja (pide PIN de gerente). | ¿Entró? |
| D2 | Revisar **Ventas totales** contra lo cobrado en A y B. | ¿Cuadra? |
| D3 | Revisar la sección **Movimientos de caja**. | ¿Aparecen el retiro de $50 y el depósito de $100? |
| D4 | Capturar el **efectivo declarado** (contarlo físicamente). | Declarado vs esperado: ¿diferencia? |
| D5 | Revisar **Ventas por mesero** y las propinas. | ¿Cuadra con B2? |
| D6 | Imprimir el corte. | ¿Salió completo? ¿Se lee? |
| D7 | Cerrar el turno. | ¿Cerró? ¿Pidió algo más? |

**PARAR si:** el arqueo no cuadra, faltan los movimientos de C, o el corte no imprime.

---

## Bloque E — La prueba que de verdad importa: offline + dinero

Se hace **después** de que A–D pasen limpios.

| # | Paso | Qué anotar |
|---|---|---|
| E1 | Apagar **sólo el internet** (WAN). Dejar LAN y Pedro vivos. | |
| E2 | Abrir la mesa, agregar el platillo con modificador obligatorio. | ¿Pidió el modificador **estando offline**? ← el corazón de `#63` |
| E3 | Enviar a cocina. | ¿Imprimió? ¿La comanda trae el modificador? |
| E4 | **Cobrar en efectivo, offline.** | ¿Imprimió el ticket? |
| E5 | Registrar un **retiro de $20, offline**, con PIN de gerente. | ¿Lo aceptó? |
| E6 | Esperar 60 segundos. | ¿Se deslogueó? ← `#61` bajo offline |
| E7 | Prender el internet. Esperar **90 segundos sin tocar nada**. | |
| E8 | Diagnóstico de sincronización. | ¿Llegó a 0? ¿Errores? |
| E9 | Revisar el mapa de mesas y la impresora. | ¿Órdenes duplicadas? ¿Reimprimió sola? |
| E10 | Volver al corte. | ¿El cobro y el retiro de offline ya aparecen? |

**PARAR si:** aparece una orden que nadie creó, algo se reimprime solo, o hay
pendientes con error. Congelar la escena y avisar.

---

## Al terminar — qué verificar en la base

Después de la sesión, estas tablas **tienen que dejar de estar en cero**:

| Tabla | Antes | Después debería |
|---|---|---|
| `pos_cash_movements` | 0 | ≥ 3 (retiro $50, depósito $100, retiro offline $20) |
| `pos_orders` cerradas | 0 | ≥ 4 |
| `pos_cierres` | 4 | 5 |

Si una orden se cobró en la terminal pero **no aparece en la base**, ese es el
hallazgo más importante de toda la sesión: significa que el dinero se cobró y no
subió.

---

## Lo que esta matriz NO cubre

Arranque en frío sin internet, reinicio del Local Server durante un cobro, corte de
luz con la cola llena, dos cajas cobrando a la vez, y facturación CFDI (`pos_facturas`
sigue en 0 y no se toca aquí).

Tampoco cubre el riesgo de seguridad que salió del mismo barrido: **los 40 PINs de
AMALAY son de 4 dígitos y están en texto plano** en `pos_staff.pin`, sin hash. Ese
PIN autoriza descuentos, cancelaciones, anulaciones y estos mismos movimientos de
caja. Es un pendiente aparte, no de esta matriz.

**Completar A–E no certifica el camino del dinero.** Lo mueve de *implementado* a
*validado en campo*, que es un escalón real — y hoy no lo tenemos.
