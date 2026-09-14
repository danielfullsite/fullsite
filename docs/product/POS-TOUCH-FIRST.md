# POS táctil — plan y estado

> Trabajo abierto el 2026-09-12 sobre `claude/pos-touch-first`, desde el HEAD del
> PR #395 (`16ec3697`). Continúa lo que empezó `POS-SIN-SCROLL.md`, que resolvió
> el modal de cobro. Esto es el resto de las pantallas.

**Alcance: todos los POS Fullsite, no una variante de AMALAY.** AMALAY aporta
la tableta y la verificación física, pero el producto no debe asumir mouse ni
teclado en ninguna instalación. Tocar un campo abre un teclado o pad en pantalla;
aceptar, cancelar, borrar y cerrar siempre tienen controles visibles.

**No es un cambio de marca.** La identidad se queda: los tokens de `globals.css`
(`--surface #0c1012`, `--panel #131a1d`, `--accent #10b981`, `--ok/--warn/--crit/--info`)
y la tipografía canónica del proyecto. Lo que cambia es **dónde cae cada cosa en
una pantalla de caja sin ratón**. Las operaciones de negocio conservan sus
contratos; las rutas de autenticación sí se endurecen para que la huella pueda
emitir la misma autoridad verificable que el PIN.

## 1. El «antes», medido

Las cuatro medidas son las de las cajas y tabletas de piso: 1600×900, 1366×768,
1280×800 y 1024×768. El peor caso es 1024×768.

Se retrataron las siete pantallas en las cuatro medidas — 28 capturas — con un
restaurante de tamaño creíble: 13 categorías, 240 platillos, 16 mesas, una
comanda de 10 renglones. El recorrido está en
[`electron-app/lab/recorrido-capturas-ui.js`](../../electron-app/lab/recorrido-capturas-ui.js)
y se lanza así:

```bash
FULLSITE_LAB_CATALOGO_DEMO=1 FULLSITE_LAB_RECORRIDO=./recorrido-capturas-ui \
FULLSITE_LAB_ETIQUETA=antes CI=1 FULLSITE_LAB_OPERATIONAL=1 \
node lab/laboratorio-ui-multiterminal.cjs
```

Junto a cada PNG queda `medidas.json` con el alto del documento contra el de la
ventana y los contenedores internos que desbordan. Esto es lo que salió:

| Pantalla | 1600×900 | 1366×768 | 1280×800 | 1024×768 |
|---|---|---|---|---|
| Mesas | cabe | cabe | cabe | cabe |
| **Comanda** | lista 724px en **408** | 724 en **311** | 724 en **343** | 724 en **297** |
| Catálogo | (igual, detrás del modal) | | | |
| Cobro | (igual) | | | |
| **Turno** | cabe | **doc 1184 / ventana 768** | **1184 / 800** | **1184 / 768** |
| **Corte** | cabe | cabe | cabe | **doc 774 / ventana 768** |
| KDS | cabe | cabe | cabe | cabe |

**La lista de renglones de la comanda muestra el 41% de la cuenta en 1024×768**
—tres renglones y medio de diez— y es la pantalla donde vive el mesero. Ése es
el peor problema del sistema, por encima del scroll de Turno.

### Lo que además se ve en las capturas

1. **El editor tiene seis botones del mismo peso** abajo: Guardar · Verificar ·
   Enviar · Cuenta · Split · Cobrar, todos de 52px, en dos filas. Ninguno dice
   «éste es el que sigue».
2. **La rejilla de categorías se estira a lo alto**: 13 categorías en tres filas
   separadas por ~180px de vacío, con «Vinos» sola en la última. La mitad derecha
   —55% del ancho— muestra 13 botones en 632px de alto.
3. **El modal de categoría no cierra con Escape**: sólo el telón o una «×» de
   40px, por debajo del mínimo táctil.
4. **El mapa de mesas repite información**: el encabezado dice «MESA(S): 1 · 2
   personas» y debajo dos tarjetas KPI dicen lo mismo, ocupando ~90px.
5. **Las tarjetas de mesa están casi vacías**: el número arriba, «4 lug.» abajo y
   un hueco en medio; quince insignias «Disponible» idénticas que el color ya
   decía.
6. **Turno de Caja es un formulario web**, no una pantalla de caja: márgenes
   enormes, un campo por pantallazo, y «Retiro o depósito» cortado abajo.
7. **El encabezado del POS ocupa ~160px** (21% de 768) en dos barras antes de
   cualquier contenido.

## 2. Las cinco reglas

1. **Altura útil = 632px** en el peor caso (1024×768 menos encabezado y barra
   fija). Lo que no quepa se reparte en páginas o pestañas, no en scroll.
2. **56px mínimo** para todo lo que toca un dedo.
3. **La acción principal vive abajo, fija y sola.** Las secundarias pesan menos.
4. **Nada depende de hover.** Los `hover:` que hay sólo cambian color y ninguno
   esconde información: se conservan y se les añade `active:`.
5. **Densidad de registradora, no de dashboard.** El número que decide (total,
   saldo, minutos de mesa) es lo más grande de su tarjeta.

## 3. El patrón que se repite

**«Rejilla paginada + barra fija».** Una rejilla que sabe cuántas filas caben,
un par de controles grandes a los costados y un indicador `3 / 7` en mono. Es el
mismo gesto en mesas, catálogo y KDS. `PageUp`/`PageDown` y flechas quedan como
apoyo de accesibilidad, con foco visible y `aria-current` en la página activa.
**La operación no depende de teclado ni mouse:** esos atajos nunca sustituyen
los botones táctiles visibles.

## 4. Orden de trabajo

### 1. Mapa de mesas y navegación operativa — **hecho**

| Qué | Por qué |
|---|---|
| Fuera las dos tarjetas KPI; el `% de aforo` sube al encabezado | repetían «ocupadas» y «personas» que el encabezado ya decía, y costaban ~62px de los 632 útiles |
| Los nueve controles del encabezado pasan de 30-44px a **56px**, con `active:` | se tocan con el dedo |
| Rejilla, cuentas por nombre y reservaciones dejan de estar apiladas: **pestañas con su cuenta** | era el único scroll de la pantalla; las dos de abajo no existían para quien no arrastra el dedo |
| `RejillaPaginada` mide el hueco, calcula las filas que caben y pagina | y si todo cabe **no pinta ningún control**: una pantalla de doce mesas se ve como siempre |
| Las filas crecen hasta llenar el alto (`minmax(alto, 1fr)`) | con celdas de alto fijo, en 1600×900 quedaba casi media pantalla en negro |
| Número de mesa a `text-4xl`, total a `text-lg`, minutos a `text-sm` | son los tres datos que se leen a dos metros |
| Las quince insignias «Disponible» idénticas salen de la vista, **el estado entra en el `aria-label`** | el color del riel ya lo decía; el dato no se perdió |

Una trampa que costó encontrar: `GridView` estaba declarado **dentro** del
render, así que React le daba un tipo nuevo en cada repintado y lo remontaba. Con
una rejilla sin estado eso sólo costaba trabajo; con una paginada habría
reiniciado a la página 1 cada vez que el salón refresca.

Prueba: `rejilla-paginada.dom.test.ts` — no protege el aspecto, recorre **todas**
las páginas y exige que el conjunto pintado sea exactamente el de entrada.
Verificada A/B: con un `-1` en el corte de página, 3 de sus 5 casos fallan.

Capturas: `despues-1024x768-mesas.png` y `despues-1366x768-mesas.png`. El «antes»
comparable es el de 1366×768 (ver §6).

### 2. Editor de cuenta/comanda — **hecho**

El peor número del sistema: la lista de renglones mostraba **297px de 724** en
1024×768 — tres renglones y medio de diez. La recuperación no estaba en achicar
los renglones sino en el cromo, que pesaba más que el contenido.

| Qué | Recupera |
|---|---|
| La comanda tenía **su propia cabecera** repitiendo «Mesa N · Np · mesero», lo mismo que la barra de arriba. Se funden: el dinero sube a la barra de mesa | ~59px |
| El saldo de Caja tenía renglón propio; va pegado al total, que es contra lo que se compara | ~28px |
| Las dos filas de herramientas (8 botones de 48px) pasan a la hoja **«Funciones»** | ~48px |
| Barra de acciones: cuatro secundarias a 52px arriba; **Enviar y Cobrar solas a 64px** abajo | jerarquía |

**Resultado medido** (`despues-comanda2/medidas.json`), de 724px de cuenta:

| | antes | después |
|---|---|---|
| 1600×900 | 408px (56%) | **535px (74%)** |
| 1366×768 | 311px (43%) | **440px (61%)** |
| 1280×800 | 343px (47%) | **472px (65%)** |
| 1024×768 | 297px (41%) | **426px (59%)** |

**Lo que apareció al mover la tira.** Cinco de esos ocho botones eran iconos
cuyo significado sólo vivía en un `title` — o sea, en hover. En una caja táctil
no hay hover: el mesero veía ⇄ y ⛨ sin manera de saber que eran «Transferir
mesa» y «Anular orden». Ahora se llaman por su nombre, a 64px.

**Y un defecto real, no visual.** La cabecera duplicada traía un **segundo campo
de mesa sin la guarda antifraude** del de la barra: hacía `setMesa(v)` pelado.
Es el defecto de `CIERRE-DEFECTOS-2026-09-06` —escribir otro número reparenta en
silencio los renglones sin enviar— corregido en un campo y no en su copia. Al
fundir las cabeceras desaparece. Guardián: `un-solo-campo-de-mesa.test.ts`,
verificado A/B contra el árbol anterior (2 campos, 1 con guarda → 1 con guarda).

**Lo que NO se logró.** Una cuenta de diez renglones **sigue sin caber** en
1024×768: 426px de 724. Llegar a cero exigiría paginar la lista, y paginar una
lista que crece mientras el mesero captura tiene su propio costo (agregas un
platillo y se va a otra página). Queda planteado, no hecho.

### 3. Catálogo y categorías — **hecho**

El catálogo confundía «ocupar la pantalla» con «ser fácil de tocar». Con 13
categorías, `gridAutoRows: 1fr` repartía los 632px disponibles entre sólo tres
filas: cada botón crecía hasta ~180px y «Vinos» quedaba sola en una franja. El
modal repetía el defecto: una categoría de un platillo convertía una tarjeta en
un bloque de más de 250px; una grande exigía scroll.

| Qué | Resultado |
|---|---|
| Categorías en filas fijas de **88px**, alineadas arriba | las 13 ocupan tres filas densas en 1024×768; ninguna depende del scroll |
| Platillos en filas fijas de **96px** dentro de `RejillaPaginada` | 20 platillos se ven completos a la vez en 1024×768; un catálogo mayor obtiene Anterior / Siguiente |
| Búsqueda global paginada en renglones de 68px | una búsqueda larga ya no crece fuera de la pantalla |
| Botón visible «Cerrar» de 56px + tecla `Escape` | el modal ya no exige acertarle a una «×» de 40px ni tocar el telón |
| `PageUp` / `PageDown` y flechas en la rejilla | teclado y accesibilidad usan la misma paginación que el dedo |

`RejillaPaginada` conserva su comportamiento anterior por defecto: las mesas
sí expanden sus filas para llenar el salón. Catálogo pide explícitamente filas
compactas, de modo que este bloque no cambia proporciones del mapa.

**Defecto funcional encontrado.** El buscador interno se limpiaba al tocar el
telón o la «×», pero no al elegir un platillo. Al abrir después otra categoría,
el filtro invisible anterior podía ocultar todos sus productos. Todas las salidas
del modal pasan ahora por una sola operación que limpia categoría y búsqueda.

Evidencia: `rejilla-paginada.dom.test.ts` (7 casos), laboratorio Caja **24/24**
(incluye cierre real con Escape), laboratorio legacy **21/21** y 32 capturas del
catálogo demo (13 categorías, 240 platillos) en cuatro resoluciones. Catálogo y
categorías no aparecen entre los contenedores con scroll; los pendientes medidos
siguen siendo Turno y, en dos resoluciones, Corte.

Capturas de la medida crítica: [`despues-1024x768-categorias.png`](capturas/pos-touch-first/despues-1024x768-categorias.png)
y [`despues-1024x768-catalogo.png`](capturas/pos-touch-first/despues-1024x768-catalogo.png).

### 4. Cobro de Caja — **hecho y medido**

El PR #395 ya había convertido la columna larga en cuatro pestañas. La revisión
de este bloque recorrió también los estados internos, no sólo la portada:
Efectivo, Tarjeta, Por confirmar y Cobrados.

| Estado a 1024×768 | Alto del panel | Scroll del panel | Controles menores de 56px |
|---|---:|---:|---:|
| Portada | 304px | no | 0 |
| Efectivo | 544px | no | 0 |
| Tarjeta | 660px | no | 0 |
| Por confirmar | 428px | no | 0 |
| Cobrados vacío | 416px | no | 0 |

**Defecto visual global encontrado.** Las clases `min-h-[56px]` no medían 56px
en el navegador: la regla no estratificada `.pos-kiosk button` ganaba sobre las
utilidades de Tailwind y las dejaba en 48–50px. El piso general del POS ahora
vive en la capa `base` con `:where(.pos-kiosk)`, así que los controles ordinarios
conservan 48px y los marcados como táctiles sí suben a 56px. El laboratorio lo
comprueba con cajas delimitadoras reales en las cuatro pestañas; la prueba DOM
además protege que cada control del componente conserve su clase táctil.

Imprimir recibo, pedir apertura de cajón y los campos auxiliares recibieron el
mismo mínimo. No se cambió ninguna operación financiera, autoridad ni regla de
idempotencia. Verificación final: web **3,783/3,783**, DOM **300/300**,
TypeScript limpio, laboratorio Caja/papel/cajón **25/25** y recorrido legacy con
PIN táctil **26/26**.

### Teclado en pantalla para todo el POS — **hecho en el shell POS**

`inputMode` era sólo una sugerencia al sistema operativo. En Electron no había
garantía de que apareciera teclado y el laboratorio escribía con `.fill()`, así
que tampoco probaba la promesa táctil. `TecladoTactilGlobal` se monta una vez en
el layout y escucha el toque real sobre cualquier `input` o `textarea` del POS:

- importes, cantidades y PIN abren pad numérico/decimal;
- búsqueda, notas, motivos y referencias abren teclado de texto;
- `Cancelar` restaura el valor anterior; `Listo`, `Limpiar`, espacio y borrar
  siempre están visibles;
- todos los blancos miden al menos 56px y el PIN nunca se refleja en el panel;
- sólo se abre por `pointerdown`: enfoque programático, lectores y pruebas no
  quedan bloqueados;
- el campo se vuelve `readOnly` antes del foco para no apilar el teclado de
  Windows/iPadOS debajo del teclado de Fullsite.

En 1024×768, tanto letras como decimales ocupan **376px**, no aumentan el alto
del documento y no contienen controles menores de 56px. El recorrido Caja
introduce ahora fondo, cobros, motivos, PINs, transferencia, anulación, cajón,
retiros y cierre pulsando esas teclas: **25/25**.

El KDS instalado no comparte este layout. Su superficie se verificó por separado
en Electron: preparación y entrega se hacen por toque y sin PIN; el KDS sólo
recibe autoridad para `KITCHEN_SET`. No puede cambiar el contenido o mesa,
cancelar, cobrar, abrir cajón ni afectar saldos. La credencial LAN sigue siendo compartida por instalación, por
lo que una futura inscripción individual de terminales permitirá revocarlas por
separado; no se presenta la cabecera de una pantalla como identidad segura.

### Huella como alternativa al PIN — **base segura hecha; barrido en curso**

La opción «Autorizar con huella» permanece visible junto al PIN. Si la terminal
no tiene lector, no es Caja o todavía conserva el servicio anterior, el botón se
desactiva y explica el motivo; no desaparece ni aparenta haber autorizado. KDS
queda fuera por diseño: cocina no pide PIN ni identifica a una persona.

En Caja, el navegador ya no entrega `staffId`, rol ni `fingerprint_id`. Pedro
activa el DigitalPersona por loopback, toma de ahí la identidad y emite el mismo
`actor_token` firmado que usa el PIN. El canal local usa un secreto de 32 bytes
protegido por ACL y autenticación mutua HMAC con nonce, tiempo, método, ruta y
cuerpo; Pedro rechaza tanto respuestas alteradas como un proceso impostor que
ocupe el puerto 7718. Con WAN, la cuenta y el rol se revalidan antes de firmar;
sin WAN sólo entra una persona y terminal preparadas, dentro de su vigencia.

Ya usan el selector común: entrada del POS, movimiento y reporte de Caja,
apertura manual, verificación de papel/cajón y recuperación durable de esas dos
colas. Siguen pendientes las superficies legacy y dos modales grandes del editor
(transferencia y anulación) para poder afirmar literalmente «todo PIN tiene
huella».

El rollout es intencionalmente fail-closed. El `fingerprint-service.exe` nuevo
debe compilarse en Windows con `DPUruNet.dll`, detener el proceso anterior,
reemplazarlo y reiniciarlo. Un servicio viejo o sin autenticación mutua deja la
huella deshabilitada y conserva el PIN como salida; nunca cae al protocolo
inseguro.

### 5. Turno y Corte Z — **hecho y medido**

Turno ahora es una sola pantalla de 768px con cuatro pestañas de 56px: Turno,
Retiro / Depósito, Último cierre y Verificaciones. Los paneles permanecen
montados al cambiar de pestaña para no perder borradores. Un cierre confirmado
abre Último cierre y Corte conserva sus guardas fail-closed.

A 1024×768, el turno abierto, movimientos, verificaciones vacías y Corte X
tienen **cero scroll de página** y **cero controles visibles menores de 56px**.
La conservación y navegación de Último cierre están cubiertas por DOM y por el
recorrido operacional; todavía falta su captura dimensional con un cierre real.

### 6. KDS — **hecho y medido**

Vista, ajustes, renglones y acciones miden al menos 56px. Una comanda extensa
desplaza únicamente su lista interna para mantener siempre visible la acción
principal; la página no hace scroll. Los interruptores de ajustes son controles
semánticos. Cocina no requiere identidad de empleado ni teclado: la Caja acepta
sólo cambios de estado de preparación autenticados por la instalación.

Recorrido operacional Electron: **20/20**. Capturas a 1024×768: **16 pantallas,
cero scroll de página y cero fallos de navegación**; el capturador registra
dimensiones para revisión y todavía no actúa como gate. Suites locales: web **3,784/3,784**, DOM
**315/315**, Electron **665/665** y TypeScript limpio. La única prueba web fuera
de esa corrida es el archivo live del analista, dependiente de un proveedor
externo que respondió con límite de cuota.

## 5. Lo que NO se hace

- Convertirlo en dashboard SaaS.
- Cambiar tipografía, acento o iconografía.
- Tocar `saveOrder` ni su caída a `OFFLINE_QUEUED`. La única excepción de
  autoridad es explícita: el KDS autenticado por la instalación puede ejecutar
  sólo `KITCHEN_SET`, porque cocina no usa PIN de empleado.
- Tocar los archivos que lleva Codex: `api/pos/pin/**`, `api/pos/staff-cache/**`,
  `shift-token.ts`, `api-auth.ts`, `pos-db-policy.ts`, `manager-approval.ts`,
  `adjust-market`, `recipe-sync`, `cancel-item`, migraciones y
  `app/pos/layout.tsx`.

## 6. Límites de esta evidencia

- Las capturas salen de Electron con Next en modo desarrollo, no del instalador.
- El salón del laboratorio tiene 16 mesas; un restaurante con 40 no se ha
  retratado todavía.
- **Del mapa de mesas se guarda el retrato de 1366×768, no el de 1024×768.** En
  las dos últimas medidas la pantalla se bloqueó sola por inactividad —el
  recorrido tarda minutos entre pantalla y pantalla— y lo que salió fue el
  teclado de PIN. El recorrido ya teclea el PIN para recuperarse
  (`despertar()`), pero la corrida que lo estrenaba no llegó a arrancar Next.
  Las medidas de mesas sí están en las cuatro: cabe en todas.
- La verificación final es física, en la tableta de AMALAY. Nada de lo de aquí
  está validado en campo.
