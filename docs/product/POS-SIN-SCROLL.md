# En la caja no hay ratón — regla de diseño para pantallas de operación

> Establecida el 2026-09-12, después de que Daniel señalara la captura del modal
> de cobro: una columna larga dentro de un `overflow-auto`, con el encabezado
> fuera de vista. En la tablet de AMALAY no hay ratón; la barra de scroll es de
> pocos píxeles y el dedo tapa justo lo que se quiere leer.

## La regla

**Una decisión, una pantalla. Lo que no cabe se reparte en pestañas o pasos, no
en scroll.** Aplica a lo que se toca durante el servicio: editor de cuenta,
cobro, mapa de mesas, KDS, apertura y cierre de turno, corte, merma, inventario
físico. No aplica al dashboard ni a los reportes, que se usan con ratón.

Cuatro consecuencias prácticas:

1. **Sin scroll vertical en el camino normal.** Si el contenido no cabe, es señal
   de que hay más de una decisión en la misma pantalla. Se separan. Un scroll
   como último recurso (una lista de pendientes que puede crecer sin tope) se
   permite *dentro del panel*, nunca en la pantalla completa.
2. **Nada se esconde en silencio.** Al repartir en pestañas, cada pestaña lleva
   el número de lo que contiene, y la pestaña con dinero sin resolver se abre
   sola. Si el operador se cambia de pestaña, lo pendiente se anuncia en la que
   está viendo.
3. **Área de toque de 56px** en lo que se usa de pie y con prisa (pestañas,
   botones de acción, teclado numérico). 48px es el mínimo absoluto; 44px ya
   produce errores de toque medidos en campo.
4. **Deslizar de lado sí, de arriba abajo no.** Listas horizontales (cuentas
   compartidas, categorías del menú, páginas del catálogo) con botones grandes de
   avance, para que se pueda operar sin gesto fino.

## Lo que NO cambia al aplicar la regla

Repartir no es quitar. Cada dato y cada botón que existía sigue existiendo, en su
pestaña, con el mismo texto. Cuando una prueba de interfaz deja de encontrar algo
porque cambió de pestaña, la prueba se actualiza para navegar — nunca se borra la
comprobación. (Ver `cobro-sin-scroll.dom.test.ts`: su trabajo es exactamente
demostrar que no se perdió nada.)

## Estado

| Pantalla | Estado |
|---|---|
| Cobro de Caja (`CobroDeCaja`) | **hecho** 2026-09-12: resumen de una fila, cuentas en fila deslizable, cuatro pestañas (Efectivo · Tarjeta · Por confirmar · Cobrados) |
| Editor de cuenta (`/pos`) | parcial: barra de acciones fija abajo; el renglón ya no se parte (2026-09-11). Falta paginar el catálogo en vez de crecer |
| Cierre de caja (`CierreCajaWizard`) | ya es un asistente por pasos; falta revisar que cada paso quepa sin scroll en 1280×800 |
| Mapa de mesas | pendiente: la tarjeta corta el total y el mesero; revisar columnas por ancho |
| KDS (`kds-ui.html`, `/pos/cocina`) | pendiente de revisión en pantalla real de cocina |
| Corte X / turno | pendiente |

## Cómo se verifica

No hay forma automática de afirmar «no hay scroll»: depende del alto real del
dispositivo. Lo que sí se prueba es la estructura (el contenedor no lleva
`overflow-auto`) y, sobre todo, que al repartir no se perdió ningún control. La
comprobación final es física, en la tablet de AMALAY, con nombres de platillos
reales y el operador usándola de pie.
