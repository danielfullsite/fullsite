# Procedimiento de instalación en AMALAY — candidato Pedro/Caja

> Escrito el 2026-09-06 para la rama `lab/pin-real-desde-pantalla`. Este documento
> es el que faltaba: sin los pasos 4 y 5, el instalador **empeora** lo que Eduardo
> reportó en vez de arreglarlo. Nada de esta rama está instalado ni validado en
> campo. AMALAY sigue operando con Wansoft.

## Las cuatro máquinas

Tomado de [`docs/pos/PLAN-INSTALACION-AMALAY-JUEVES.md`](../pos/PLAN-INSTALACION-AMALAY-JUEVES.md),
del 2026-08-19. **Verificar en sitio antes de tocar nada**: han pasado semanas y
las versiones cambiaron.

| Terminal | Máquina · IP | Rol | Papel en la red |
|---|---|---|---|
| Caja | SERVER1 · `.71` | `server_pos` | La única que confirma. Genera el secreto de red. |
| Entrada | PDV3 · `.69` | `pos` | **Secundaria.** Le pregunta todo a Caja. |
| Escondite | PDV1 · `.68` | `pos` | **Secundaria.** Le pregunta todo a Caja. |
| Cocina | PDV2 · `.4` | `kds` | Pantalla de comandas, servida por su propio Pedro. |

**Dos de las cuatro son secundarias, y ése es el punto delicado de esta
instalación.** Con el candidato, una terminal secundaria sin el secreto de red no
queda a medias: queda muerta. No es que le falte una función, es que no tiene
punto de venta.

## Por qué el paso del secreto no se puede saltar

Esta versión cierra el servidor local a la red: hasta ahora cualquier equipo del
WiFi del restaurante podía abrir el cajón de dinero. El cierre funciona con un
secreto por instalación.

El problema es de dónde sale ese secreto. En `core/credencial-lan.js:145`, sólo
una terminal con rol `server_pos` lo genera. Una secundaria devuelve `null` y
arranca "sin emparejar" (`index.js:767`), y a partir de ahí **todo** responde
`401`: el mapa de mesas, el envío a cocina, la impresión, el cajón, el PIN.

El asistente de configuración no tiene ese campo. Lo comprobé:
`grep -c lan_secret electron-app/setup.html` devuelve **0**. O sea: hoy el
secreto se copia a mano, y no había ningún documento que lo dijera.

---

## Antes de ir

**1. Confirmar que la web y el instalador van juntos.** Con este candidato la
interfaz del punto de venta viaja **dentro** del ejecutable, no desde internet.
Publicar la web sin reinstalar deja las tres terminales sin poder entrar: piden
rutas que el servidor viejo no conoce. Y al revés, instalar sin publicar la web
deja el menú sin cargar. Se hacen el mismo día o no se hacen.

**2. Sacar copia de la carpeta de datos de Caja.** Es la vuelta atrás. En
Windows está en:

    C:\Users\<usuario>\AppData\Roaming\Fullsite POS\

Copiarla completa a una USB antes de instalar. Sin esa copia, la vuelta atrás
es una apuesta: el formato del registro de eventos cambió y el ejecutable
anterior ya no lo lee.

**3. Anotar qué versión hay hoy en cada máquina**, antes de tocarla. Si algo
sale mal, es la única forma de saber a qué volver.

**4. Decidir de dónde sale el instalador, porque el de CI NO trae la huella.**

Ésta es la trampa y hay que verla antes de salir. El instalador ya sabe empaquetar
el servicio de huella —`extraResources` copia `electron-app/fingerprint/` dentro
del paquete, y al arrancar se instala solo a `C:\fullsite\`— pero **los binarios
no están en el repositorio y no pueden estarlo**: `DPUruNet.dll` es del SDK
DigitalPersona U.are.U y es propietario.

O sea que el instalador que sale del workflow *Build Electron POS (Windows)* se
construye en un runner de GitHub, donde `electron-app/fingerprint/` sólo tiene el
`README.md` y el `.gitkeep`. **Ese instalador sale sin huella, siempre.**

Y falla de la peor manera: en la caja de AMALAY los binarios ya están en
`C:\fullsite\` de la instalación anterior, así que la huella va a funcionar y
nadie se entera. Se rompe en la SIGUIENTE caja — el primer cliente nuevo, o esta
misma si alguien formatea la máquina.

Hay dos caminos y hay que elegir uno ANTES de ir:

- **Construir en una máquina Windows que tenga el SDK.** Poner
  `fingerprint-service.exe` y `DPUruNet.dll` en `electron-app/fingerprint/` y
  correr `npm run build:win`. Si sólo se tiene el DLL, el `.exe` se compila con
  `print-bridge/build-fingerprint.bat`, que usa el `csc.exe` que ya trae Windows
  y no necesita Visual Studio. Es el único camino que produce un instalador
  clonable.
- **Usar el instalador de CI y aceptar que sólo sirve para AMALAY**, porque ahí
  los binarios ya están puestos. Entonces hay que anotarlo: ese `.exe` NO se le
  puede dar a otro cliente.

**5. Comprobar que los binarios siguen en la caja de AMALAY.** Si se va por el
segundo camino, esto deja de ser un detalle y pasa a ser el supuesto del que
depende toda la visita. Se ve sin tocar nada:

    dir C:\fullsite\fingerprint-service.exe
    dir C:\fullsite\DPUruNet.dll

O con el colector, que además levanta el resto del estado y no escribe nada:

    powershell -ExecutionPolicy Bypass -File scripts/campo/recoger-estado-terminal.ps1

Si no están, no hay visita hasta conseguir el SDK. Daniel lo dijo sin margen: la
huella es indispensable.

---

## En sitio, en este orden

### Paso 1 — Publicar la web

Sólo las rutas nuevas de menú y de acceso. El resto de la interfaz ya viaja en
el ejecutable.

### Paso 2 — Instalar en Caja (SERVER1)

Es la primera porque genera el secreto que las demás necesitan.

Al terminar, comprobar que respondió:

    curl http://127.0.0.1:7717/health

Debe contestar. Si no contesta, **parar aquí**: sin Caja no hay nada.

### Paso 3 — Leer el secreto de Caja

En SERVER1, abrir este archivo:

    C:\Users\<usuario>\AppData\Roaming\Fullsite POS\lan-secret

Son 64 caracteres. Cópialo. **No lo mandes por WhatsApp ni por correo**: es la
llave del cajón de dinero. USB, o tecleado en sitio.

### Paso 4 — Emparejar Entrada, Escondite y Cocina

En **cada una** de las tres, después de instalar, abrir su `config.json`:

    C:\Users\<usuario>\AppData\Roaming\Fullsite POS\config.json

y agregar el campo con el secreto que copiaste de Caja:

    "lan_secret": "<los 64 caracteres de Caja>"

Cuidado con el archivo: si se edita con el Bloc de notas de Windows puede
guardar una marca invisible al principio que rompe la lectura. Ya pasó antes en
Escondite. Usar un editor que guarde en UTF-8 sin marca, o el asistente.

Comprobar en cada terminal, desde su propia pantalla:

    curl http://127.0.0.1:7717/health

Buscar dos campos en la respuesta:

- **`"emparejada": true`** — el secreto quedó bien. Si dice `false`, el paso no
  funcionó: revisar que el campo esté escrito igual y sin marca invisible.
- **`"enlace"`** — sólo en Entrada y Escondite. Debe traer `"conectado": true`.
  Si trae `"conectado": false`, mirar `ultimo_motivo`: ahí dice si la Caja está
  apagada, si la IP está mal o si la red no las deja verse.

En Caja, `enlace` viene vacío y eso es correcto: la Caja no le pregunta a nadie,
ella es la autoridad.

No sirve comprobar con `/state`: esa ruta pide la credencial, así que un `curl`
simple responde `401` aunque todo esté bien. `/health` es la única que contesta
sin credencial, y por eso mismo nunca incluye el secreto.

### Paso 5 — Preparar el PIN de cada persona, en cada terminal

**Éste es el paso que se olvida y el que arruina el primer corte de internet.**

Con esta versión, quien valida el PIN es Caja. Sin internet, Caja sólo puede
autorizar a quien ya haya entrado **con internet** en **esa misma terminal**.
La preparación es por persona y por terminal: que el gerente entre en Caja no
sirve para que entre en Entrada.

Con internet, cada persona que vaya a trabajar teclea su PIN una vez en cada
terminal donde vaya a trabajar. Son cuatro pantallas.

La preparación dura **siete días**. Al octavo, quien no haya vuelto a entrar con
internet se queda fuera justo cuando no hay internet. Conviene que sea parte de
la rutina semanal.

### Paso 6 — Preparar el catálogo

Con internet, entrar con PIN en Caja. Eso descarga el menú, las opciones
obligatorias, las formas de pago y la configuración. Sin este paso, las
terminales se quedan sin menú cuando se caiga la red.

### Paso 7 — Comprobar antes de irse

Con el internet **desconectado**, y en este orden:

1. Entrar con PIN en las tres terminales.
2. Abrir turno en Caja.
3. Levantar una mesa en Entrada. Debe verse en Caja y en Escondite en menos de tres segundos.
4. Agregar una segunda ronda desde Escondite.
5. Mandar a cocina. Debe aparecer en la pantalla de cocina.
6. Cobrar en Entrada. La mesa debe liberarse en las otras dos.
7. Volver a abrir esa misma mesa recién cobrada. Debe estar limpia y usable.
8. Reiniciar Caja. Entrada debe recuperarse sola.
9. Apagar Caja. Las otras deben avisar que no está, no inventar.
10. Cerrar turno.

Si el paso 3 falla, es el secreto. Si falla el 1, es la preparación del PIN.

**Cronometrar los pasos 1 y 3 en Entrada y en Escondite.** Eduardo reportó
lentitud ahí y hoy no existe ningún número contra el cual comparar. Sin ese
número, la siguiente vez volveremos a discutir de memoria.

---

## Si algo sale mal

Reinstalar el ejecutable anterior y restaurar la carpeta de datos de la copia
del punto 2. Se pierde lo que haya pasado después de la copia. No hay una vuelta
atrás más suave: el registro de eventos cambió de formato y, una vez convertido,
la versión anterior ya no lo lee.

Por eso la copia del punto 2 no es opcional.

## Lo que este procedimiento no cubre

- **Nada de esto se ha ejecutado en Windows.** Toda la evidencia es de una Mac.
  Antes de la visita hay que probarlo en una máquina virtual con Windows y una
  copia de la carpeta de datos real.
- **La huella** quedó devuelta en código y probada por lógica, no con un dedo en
  un lector.
- **La velocidad** no se ha medido en el equipo real.
- **El alta de huellas** no verifica quién la hace: hoy cualquiera que entre al
  punto de venta puede registrar su dedo bajo el identificador de otra persona.
  Viene igual en la versión que corre hoy, no lo introduce este candidato, pero
  conviene saberlo antes de dejar la pantalla a la mano.

## Lo que habría que arreglar para no repetir esto

El paso 4 es un procedimiento manual sobre un archivo de configuración, y esa
clase de paso se hace mal tarde o temprano: ya pasó una vez con la marca
invisible del Bloc de notas. Lo correcto es que el asistente pida el secreto, o
mejor, que la terminal lo obtenga de Caja al darse de alta. No entra en esta
visita, pero debería entrar en la siguiente.
