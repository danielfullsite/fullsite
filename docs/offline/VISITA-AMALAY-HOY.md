# Visita a AMALAY — hoja de campo

> Para la visita del 2026-09-06. **No se instala nada.** El candidato no se ha
> ejecutado nunca en Windows y queda un defecto vivo que congela mesas sin
> internet. Esta visita es para traer cinco datos que sólo se consiguen estando
> ahí, y que hoy tienen detenido el trabajo.

## Lo que NO hay que hacer hoy

- No instalar la versión nueva en ninguna máquina.
- No publicar la web nueva. Si se publica sin reinstalar, las terminales dejan
  de poder entrar. Van juntas o no van.
- No cambiar ningún `config.json`.

Si algo de esto ya pasó por accidente, avísame antes de seguir.

## Lo que sí, y en este orden

### 1. Correr el recolector en las cuatro máquinas (10 minutos)

El archivo es [`scripts/campo/recoger-estado-terminal.ps1`](../../scripts/campo/recoger-estado-terminal.ps1).
Llévalo en una USB. En cada máquina: clic derecho, «Ejecutar con PowerShell».

Sólo lee. No instala, no cambia, no reinicia. Deja un archivo en el Escritorio
llamado `fullsite-estado-<NOMBRE>.txt`. Mándame los cuatro.

Si Windows lo bloquea, abrir PowerShell y pegar:

    powershell -ExecutionPolicy Bypass -File .\recoger-estado-terminal.ps1

Con eso confirmo de un golpe: qué versión hay en cada una, quién es la Caja,
quién le pregunta a quién, si el lector de huella responde, y qué tan grande es
el registro de eventos. Todo eso hoy lo tengo de un documento de hace 18 días.

### 2. Copiar la carpeta de datos de Caja y de una secundaria (5 minutos)

En SERVER1 y en una de las otras, copiar completa a la USB:

    C:\Users\<usuario>\AppData\Roaming\Fullsite POS\

Es lo que más falta me hace. Con eso puedo probar en mi máquina si la versión
nueva logra leer el historial real sin romperlo, que hoy es una apuesta a
ciegas, y puedo ensayar la vuelta atrás antes de que sea de verdad.

Esa carpeta trae operación del restaurante. Que no salga de la USB.

### 3. Cronometrar la lentitud (5 minutos)

Eduardo reportó que Entrada y Escondite van lentas. **No existe ni un solo
número.** Sin eso no podemos saber si algo mejoró.

Con el cronómetro del celular, tres veces cada una, en Entrada y en Escondite:

| Qué medir | Desde | Hasta |
|---|---|---|
| Entrar | tocar «Entrar» tras el PIN | que aparezca el mapa de mesas |
| Abrir mesa | tocar una mesa | que se vean los productos |
| Tocar producto | tocar un platillo | que aparezca en la cuenta |

Anota los segundos. Si puedes, repite con el internet desconectado: ahí es donde
Eduardo dijo que se sentía peor.

### 4. Ver la cocina con tus ojos (5 minutos)

Dos preguntas que ya contestaste, y que conviene confirmar viendo:

- ¿La cocina **marca** las comandas conforme salen, o se van acumulando?
- Cuando se cobra una mesa, ¿la comanda desaparece sola de la pantalla, o se
  queda hasta que alguien la marca?

De esto depende que el arreglo de «platillos en órdenes cerradas» funcione o
que Eduardo lo vuelva a reportar igual.

### 5. Probar la huella en las tres (5 minutos)

Que alguien entre con el dedo en Caja, en Entrada y en Escondite. Anota en cuál
funciona y en cuál no. Es el estado de partida: hoy funciona, y necesito saber
en cuáles antes de tocarlo.

## Si quieres aprovechar y probar la lentitud a fondo

Con el internet desconectado desde el módem (no apagando el switch, que las
terminales se tienen que seguir viendo entre ellas):

1. Levanta una mesa en Entrada. ¿Aparece en Caja? ¿En cuántos segundos?
2. Agrega algo desde Escondite a la misma mesa. ¿Se ve en las otras dos?
3. Cobra. ¿Se libera en todas?

Eso reproduce exactamente lo que Eduardo reportó el 2 de septiembre. Si vuelve a
fallar igual, tengo la confirmación de que lo que arreglé apunta al lugar
correcto. Si falla distinto, mejor saberlo ahora.

## Qué hago yo mientras

Sigo con la versión visible en pantalla, que es lo que permite que cuando
reportes algo sepamos con qué versión pasó. Luego la ronda que congela la mesa,
y después el instalador para probarlo en Windows.

Cuando me mandes los cuatro archivos del punto 1 y la carpeta del punto 2,
desbloqueo dos cosas que hoy están detenidas: el ensayo de la vuelta atrás y la
prueba en Windows con datos reales.
