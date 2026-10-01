# Plan de cierre del sistema — Fullsite en AMALAY

Escrito el 2026-09-14 después de la sesión de campo documentada en
[`HALLAZGOS-CAMPO-2026-09-13.md`](HALLAZGOS-CAMPO-2026-09-13.md).

## Qué significa «cerrado»

Hoy la palabra no tiene definición escrita, y por eso se usa para cosas distintas. Aquí
queda fija. Una capacidad está **cerrada** cuando cumple las cinco:

1. Rama alineada con `main`, sin trabajo colgando en ramas laterales.
2. Suites completas en verde.
3. Matriz funcional aprobada, caso por caso, con evidencia.
4. **Validación física sobre el mismo commit, el mismo instalador y el mismo hardware.**
5. Revisión adversarial: alguien o algo distinto del autor intentó romperlo.

Vocabulario, para no confundir estados:

| Estado | Qué exige |
|---|---|
| implementado | existe el código |
| probado localmente | suites verdes |
| desplegado | está en el entorno indicado |
| **validado en campo** | se ejecutó físicamente, una vez |
| certificado | matriz completa con evidencia |
| **cerrado** | las cinco condiciones de arriba |

> Lo de la noche del 13 al 14 —huella, impresión y cobro— está **validado en campo**.
> No está cerrado. La diferencia es la que separa «funcionó una vez» de «aguanta un
> viernes lleno».

## Las cinco capas del offline

Offline no es una función, es un sistema apilado. Si una capa falla, el restaurante se
detiene aunque las otras cuatro estén sanas. Los tres defectos de la noche fueron
exactamente eso: una capa rota a la vez.

| # | Capa | Dónde vive | Cómo se rompió esta semana |
|---|---|---|---|
| 1 | Paquete de interfaz | `ui-bundle` dentro del instalador | congelado en una versión sin el arreglo del cobro |
| 2 | Estado del salón | `events.ndjson` de Pedro | basura de pruebas viejas dejaba toda cuenta «incierta» |
| 3 | Credenciales de personal | almacén de Pedro | 1 de 40 personas preparada |
| 4 | Cola de impresión | navegador + Pedro | secundaria sin estaciones: comandas detenidas en silencio |
| 5 | Cola de sincronización | Pedro | 119 operaciones que nunca subieron |

**Toda prueba de cierre tiene que tocar las cinco.** Probar sólo la 1 y la 2 es lo que
nos tuvo declarando cosas listas que no lo estaban.

---

## Fase 0 — Desbloquear las pruebas

No tiene sentido correr la matriz mientras existan defectos que invalidan sus
resultados. Tres, y hay que cerrarlos antes de medir nada.

### 0.1 · Las secundarias no imprimen, y no avisan

Una terminal secundaria reenvía `/print` a la Caja
(`electron-app/local-server/index.js:534-549`), pero su `/health` reporta **sus propias**
estaciones (`index.js:667`) — que están vacías. El navegador lee eso
(`dashboard-app/src/lib/print-queue.ts:264`) y manda todas las comandas a
`needs_attention` con «Impresora no configurada», **sin avisar en pantalla**
(`print-queue.ts:369-381`).

Dos cambios:

- `/health` de una secundaria debe reportar las estaciones **efectivas** —las de la Caja
  cuando reenvía— o declarar explícitamente que reenvía, para que el cliente no decida
  con el dato equivocado.
- Comandas detenidas deben **verse en la pantalla del POS**. Un fallo silencioso en una
  comanda es inaceptable: el mesero se va de la mesa creyendo que la cocina ya la tiene.

Toca `local-server` → **requiere instalador nuevo**.

### 0.2 · Preparar a las 40 personas

Sólo el admin puede autenticarse sin internet, en las dos terminales. Cada persona debe
validar su PIN **con internet** en **cada terminal**, y la habilitación dura 7 días.

- **Operativo:** agendar la preparación antes del cutover, nunca el mismo día.
- **Producto:** una acción de «preparar esta terminal para operar sin internet» que
  precargue a todo el personal activo, y un aviso visible de cuántos faltan.

Sin esto, cualquier prueba offline se hace con el único usuario que puede entrar — que
no es lo que va a pasar el día real.

### 0.3 · Decidir cómo se entregan los arreglos de interfaz

El POS no carga la página de Vercel: sirve el `ui-bundle` del instalador
(`electron-app/offline-ui/protocol.js:19-31`, `main.js:1206`). Hoy eso significa que
**ninguna corrección de pantalla llega a una terminal sin reinstalar**.

Hay que elegir una y documentarla:

- **(a)** el actualizador descarga y verifica paquetes de interfaz por separado, sin
  reinstalar la aplicación;
- **(b)** el POS prefiere la red cuando hay internet y usa el paquete sólo como respaldo;
- **(c)** se acepta que sólo se actualiza por instalador, y entonces el instalador tiene
  que ser trivial de desplegar en toda la flota.

La (a) es la correcta para mil restaurantes. La (c) es la que hay hoy sin que nadie lo
supiera.

### 0.4 · Un instalador que traiga todo

El instalador debe empaquetar, juntos y sellados con el mismo commit: Pedro, el
`ui-bundle`, y el servicio de huella con su DLL. Hoy `electron-app/fingerprint/` está
vacío en el repo, así que **ninguna caja nueva recibe la huella** — funciona sólo donde
alguien la compiló a mano.

**Salida de la Fase 0:** un instalador único, con un commit único, que al abrirse en una
máquina limpia deja POS, Pedro, impresión y huella funcionando sin intervención manual.

---

## Fase 1 — Reconciliar el código

AMALAY opera con `claude/pos-touch-first`, **38 commits adelante de `main`**. La terminal
de producción corre código que no está en la rama principal, y el arreglo del cobro vive
en las dos por caminos distintos (#399 y #400).

1. Integrar la rama a `main` con CI verde.
2. Sellar **un** build desde `main`.
3. Instalar **ese mismo build** en las cuatro máquinas: caja, entrada, escondite, KDS.

Regla: a partir de aquí, nada se instala en campo desde una rama lateral.

---

## Fase 2 — Matriz funcional, sobre AMALAY

AMALAY todavía no opera con Fullsite, así que es el laboratorio: hardware real,
impresoras reales, red real, sin dinero de por medio.

### Bloque A — Una terminal

Turno → captura → enviar → **comanda impresa** → cobrar en efectivo → corte X → corte Z.
Con modificadores obligatorios, con descuento, con propina, con pago mixto.

### Bloque B — Multi-terminal

Mesa abierta en entrada y cobrada en Caja. Transferir platillo entre mesas. Dos cajeros
sobre la misma cuenta al mismo tiempo. Comanda desde escondite con la Caja encendida.

### Bloque C — Degradaciones

Sin internet pero con LAN. Sin LAN. Apagar la Caja con una comanda a medias. Reiniciar el
POS durante un cobro. Impresora sin papel. Lector de huella desconectado. Disco lleno
—que ya pasó de verdad esta noche, con 70 MB libres.

### Bloque D — Recuperación

Volver la red y comprobar que **nada se duplicó ni se perdió**: ni una comanda de más,
ni un cobro repetido, ni una mesa fantasma.

Cada caso se registra con: qué se hizo, qué se esperaba, qué pasó, y la evidencia.

---

## Fase 3 — Revisión adversarial

Alguien distinto del autor intenta romperlo, con foco en dinero:

- doble cobro con dos terminales sin red;
- cobrar una cuenta ya cerrada;
- cancelar un platillo ya enviado y ya cobrado;
- corte Z con cuentas abiertas;
- reinicio a media escritura del almacén de eventos.

---

## Fase 4 — Cutover

1. Preparación de los 40 usuarios, con internet, en cada terminal.
2. Capacitación por rol.
3. Día D con Wansoft disponible como respaldo.
4. Plan de retorno probado **antes**, no improvisado.

---

## Lo transversal — que un fallo deje de verse como salud

El patrón que ya costó caro tres veces: **el guardián mudo**. Una flota que no reporta se
ve idéntica a una flota sana; un demo muerto con el CI en verde; una alerta de ingesta
ignorada 51 días; y esta semana, comandas detenidas en silencio y terminales sin usuarios
preparados.

Antes de declarar cerrado, tiene que existir al menos:

- telemetría de flota que efectivamente reporte (`local_server_heartbeats` tiene cero
  filas desde que existe — PR #401);
- alerta por **ausencia**, no sólo por error;
- avisos en la pantalla del POS para: comandas detenidas, usuarios sin preparar,
  disco bajo, y paquete de interfaz desactualizado.

---

## Orden recomendado y qué bloquea qué

```
Fase 0  ──►  Fase 1  ──►  Fase 2  ──►  Fase 3  ──►  Fase 4
(bloquea       (bloquea      (bloquea      (bloquea
 medir)        instalar)     certificar)   operar)
```

Nada de la Fase 2 en adelante vale si la Fase 0 no está cerrada: se estaría midiendo un
sistema con defectos conocidos que invalidan los resultados.
