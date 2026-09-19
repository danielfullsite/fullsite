# POS Skeleton — rediseño del punto de venta

> **Qué es esto:** el diseño propuesto para el POS de AMALAY, y la comparación contra
> el que está en producción hoy. Incluye un demo funcional.
>
> **Fecha:** 2026-09-14 · **Estado:** 📐 diseño + demo funcional. No tocado en producción.
> **Demo:** `dashboard-app/public/pos-skeleton.html` → se sirve como `/pos-skeleton.html`.

---

## El problema, con números

La pregunta que originó esto fue: *«¿cómo lo harías para que no fuera de scroll? Porque no
hay mouse ni teclado en los puntos de venta.»*

Lo primero fue medir por qué hay scroll. No es un descuido de maquetación: es aritmética.

| Medición | Valor | Fuente |
|---|---|---|
| Categorías en el menú de AMALAY | **58** | `pos_menu_categories` where `client_id='amalay'` |
| …de ésas, **vacías** (0 productos) | **17** | misma consulta, `count(items)=0` |
| Productos con precio > 0 | **~554** | `pos_menu_items` |
| Categoría más grande | **31** productos | `Market: Regalos & Detalles` |
| Nombre de producto más largo | **54 caracteres** | `Market: Suplementos A-L` |
| Nombre de categoría más largo | **27 caracteres** | `Market: Marca Propia AMALAY` |
| Puntos de scroll en `pos/page.tsx` | **16** | `grep -c "overflow-y-auto\|overflow-auto"` sobre `origin/main` |
| Tamaño del archivo del POS | **7,003 líneas** | `origin/main:dashboard-app/src/app/pos/page.tsx` |

Consultado 2026-09-14 vía MCP `supabase-amalay` (read-only) y `git show origin/main`.

**58 categorías no caben en ningún rail.** 31 productos no caben en ninguna retícula fija.
Un nombre de 54 caracteres no cabe en un chip. De ahí salen los 16 scrolls: no son una
decisión de diseño, son la consecuencia de no haber decidido nada.

---

## Lo que se ve en producción hoy

De la captura de la terminal `caja` (Electron, 2026-09-14) y de la lectura del código:

1. **El modal de cobrar tiene scroll.** El «Cambio a dar $302.80» y el botón de confirmar
   quedan bajo el fold. Es el momento de mayor presión del turno —hay un cliente
   esperando— y es donde la interfaz obliga a arrastrar el dedo para encontrar el botón.
2. **El aviso de error se encima con el título del modal.** «Esta orden fue modificada por
   otro usuario» aparece sobre «Cerrar cuenta», tapándolo.
3. **Hay campos de texto.** El monto recibido es un `<input>`; la mesa es
   `<input type="number">` (`pos/page.tsx:4790` en `origin/main`). En una máquina sin
   teclado, cada input invoca el teclado en pantalla, que tapa media interfaz.
4. **Los nombres se truncan:** `Market: Amaran…`, `…: Salud M…`, `ta`, `/ …`.
5. **Información que desaparece por breakpoint.** El header usa `hidden sm:flex` y
   `hidden lg:inline`: en una pantalla angosta el reloj, el nombre del mesero y el estado
   de comandas simplemente dejan de existir. El operador no sabe que están.
6. **Las categorías van en `overflow-x-auto`.** Encontrar una de 58 cuesta entre 0 y 10
   swipes según dónde esté. No hay memoria muscular posible.

---

## El principio del rediseño

> **La pantalla no se lee, se recuerda.**

En una terminal sin mouse ni teclado, el scroll es el enemigo por cuatro razones concretas:

- **Destruye la posición.** Un botón que estaba «a la mitad» ya no lo está.
- **El dedo tapa lo que busca.** El pulgar cubre el 20% de una tablet de 10".
- **Se dispara solo.** Un roce lateral durante el rush mueve la lista y pierde el lugar.
- **No hay memoria muscular.** Y la memoria muscular es todo: un mesero bueno no lee la
  pantalla, la toca. Si el botón se mueve, vuelve a leer, y leer cuesta segundos que en
  hora pico no existen.

Lo que sustituye al scroll no es «menos contenido». Es **paginación con posición estable**.

---

## Las seis sustituciones

| Hoy | Skeleton | Por qué |
|---|---|---|
| 58 categorías en rail con scroll horizontal | **8 familias fijas** + categoría dentro | Las 8 nunca cambian de lugar. El caso raro cuesta 3 taps *predecibles*, no 0–10 swipes impredecibles |
| Buscar el producto entre 554 | Primera familia = **Top**, los ~20 más vendidos | El caso común baja a **1 tap** |
| Retícula variable con scroll vertical | **Retícula auto-calculada + paginador** | El producto siempre está en la misma celda de la misma página |
| Cuenta con scroll libre | **Densidad adaptativa**: se comprime antes de pedir scroll | Una cuenta de 14 renglones cabe entera; una de 40 no, y ahí el scroll sí está justificado |
| Modal de cobro que se corta | **Hoja de tres zonas de alto fijo** | El cambio y el botón de cobrar nunca salen de la pantalla |
| `<input>` para mesa y para efectivo | **Malla de mesas** y **teclado de 60px** | Cero teclado en pantalla |

---

## La decisión central: la pantalla elige la retícula

No sabíamos la resolución exacta de las terminales —y varía entre la caja y los meseros.
La respuesta correcta no fue elegir una: fue que **no importe**.

`measure()` mide el contenedor y calcula cuántas columnas y filas caben con celdas de
≥152px de ancho (lo que necesita un nombre de 54 caracteres en tres renglones legibles) y
≥92px de alto. Después pagina exactamente ese número.

Resultado medido sobre el demo:

| Pantalla | Retícula | Por página | Páginas para la categoría más grande (31) |
|---|---|---|---|
| Tablet 10" horizontal (1280×800) | 4 × 5 | 20 | 2 |
| Tablet 10" vertical (800×1280) | 4 × 6 | 24 | 2 |
| Monitor de caja 15" (1366×768) | 5 × 5 | 25 | 2 |
| Full HD (1920×1080) | 7 × 6 | 42 | **1** |
| Tablet 8" (1024×768) | 3 × 5 | 15 | 3 |
| Monitor 4:3 viejo (1024×600) | 3 × 3 | 9 | 4 |

Y un refinamiento: **si toda la categoría cabe en una página, se usan sólo las filas
necesarias y los tiles crecen.** Si hay varias páginas, la retícula queda fija — para que
un producto no cambie de tamaño al pasar de página y rompa la memoria muscular.

---

## Verificación

Ejecutado sobre el demo servido en `localhost:8099`, midiendo el DOM (no a ojo):

| Prueba | Resultado |
|---|---|
| Desbordamiento horizontal del documento | `false` |
| Desbordamiento vertical del documento | `false` |
| Retícula con huecos fantasma (20 items) | `0` |
| Hoja de cobro: ¿se corta? | `cardDesborda: false`, `bodyDesborda: false` |
| Cambio a dar visible sin scroll | `true` |
| Botón «Cobrar e imprimir» visible sin scroll | `true` |
| Aritmética: $292 + $25 + $35 = $352 × 2 | `$704.00` ✓ |
| Con IVA 16% | `$816.64` ✓ |
| Propina 15% sobre $872.32 | `$1,003.17` ✓ |
| Pago insuficiente ($1,000 de $1,003.17) | Muestra **«Falta $3.17»**, no un cambio negativo |
| Cerrar con dinero faltante | Bloqueado: «Falta dinero. No se puede cerrar.» |
| Modificar un renglón ya enviado a cocina | Bloqueado: «Ya se envió a cocina. Se cancela con autorización.» |

### Tres defectos encontrados y corregidos durante la construcción

1. **Desbordamiento por `1fr`.** Las 9 familias estiraban el contenedor: el `gridwrap`
   medía 893px dentro de un viewport de 423px. `grid-auto-columns:1fr` no impide que el
   contenido mínimo expanda la columna — hace falta `minmax(0,1fr)`. **Esto habría roto el
   layout en cualquier terminal angosta**, incluida una tablet en vertical.
2. **Filas recorridas por `display:none`.** Al ocultar la fila de categorías cuando sólo
   hay una, ese hijo dejaba de ocupar fila en el grid y **todo se recorría**: el paginador
   se quedaba con el `1fr` y la retícula con el `auto` — 155px de alto en vez de 538. Se
   corrigió fijando `grid-row` explícito en cada banda.
3. **Encoding.** Faltaba `<meta charset>`: `Café` se veía `CafÃ©`.

---

## Hallazgo colateral: precios duplicados en el menú

Buscando datos para poblar el demo aparecieron productos repetidos **con precios
distintos**. No es un tema de diseño; es dinero:

| Producto | Precio A | Precio B | Diferencia |
|---|---|---|---|
| Pizza pepperoni | `PIZZA PEPERONI` $285.00 | `Pizza Pepperoni` $245.00 | **$40.00** |
| Pasta boloñesa | `Pasta Bolognese` $232.00 | `PASTA BOLOGESE` $220.00 | **$12.00** |
| Egg and pancake combo | `Egg and Pancake Combo` $277.00 | `EGG AND PANCAKE COMBO` $250.00 | **$27.00** |

El mismo platillo se cobra distinto según qué botón toque el mesero. Además hay **17
categorías vacías** ocupando lugar en el rail. Ambas cosas se arreglan en datos, no en
código, y conviene hacerlo antes de cualquier rediseño: una interfaz mejor sobre un
catálogo sucio sólo hace más rápido el error.

---

## Qué NO se tocó

- **Nada de producción.** El demo vive en `public/`, aislado. `pos/page.tsx` no se modificó.
- **Nada de offline.** El demo no toca `pos-offline-db`, el bridge ni Pedro. Las reglas
  duras de `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md §4` siguen intactas.
- **El demo no es el POS.** Es el lenguaje visual y la mecánica de navegación, con datos
  reales, para poder tocarlo y decidir. Portarlo al POS real es un trabajo aparte y por
  fases.

---

## Siguiente paso

1. Abrir el demo **en la tablet de AMALAY** (`/pos-skeleton.html`) y que Eduardo lo toque.
   Es la única prueba que vale: §16 — no se sustituye una prueba física con razonamiento.
2. Limpiar el catálogo (duplicados + categorías vacías).
3. Si pasa, portar por fases empezando por la **hoja de cobro**, que es donde el POS actual
   falla de verdad y donde el riesgo es más alto.

---

## Referencias

- Sistema base existente: `dashboard-app/src/components/pos/ui/PosKit.tsx` y `/pos/ui-kit`
- Tokens: `dashboard-app/src/app/globals.css` (`--accent`, `--surface-*`, `--text-*`)
- Tipografía canónica: Public Sans + IBM Plex Mono
- POS en producción: `origin/main:dashboard-app/src/app/pos/page.tsx`
