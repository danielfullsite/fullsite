# Prueba de humo — AMALAY

**Fecha del código que se prueba:** 2026-09-01 · **Duración:** ~15 minutos
**Dónde:** en la caja (SERVER1). Los pasos 3, 5 y 6 **sólo se pueden hacer estando ahí.**

---

## Qué es esto y por qué importa

El 31 de agosto y el 1 de septiembre se arreglaron **diez cosas** del POS. Todas tienen
pruebas automáticas, pero **ninguna se ha probado en una terminal real**.

Las pruebas automáticas verifican funciones sueltas. El modo sin internet es otra cosa
— navegador, caché, servidor local, red del restaurante, impresora — y eso sólo se
comprueba con el equipo enfrente.

> **El orden importa.** Cada paso depende del anterior. Si uno falla, **detente ahí**,
> anótalo y avisa. No sigas: los resultados de abajo dejarían de significar nada.

## Antes de empezar

- [ ] Que **nadie esté cobrando** en ese momento (el paso 3 apaga el POS).
- [ ] Tener a la mano cómo **desconectar el internet** sin apagar la red interna —
      normalmente es desconectar el cable que va del módem a internet.
      **No apagues el switch:** las terminales tienen que seguir viéndose entre ellas.
- [ ] Un teléfono para anotar la hora de cada paso.

---

## Paso 1 · Cargar el código nuevo

En la caja, en la barra de dirección del POS, entra a:

```
app.fullsite.mx/reset.html
```

Se limpia solo y te manda al login.

- [ ] Llegó a la pantalla de PIN
- Hora: ________

> **Si el POS no deja escribir direcciones:** ciérralo por completo, ábrelo, y ya dentro
> presiona `Ctrl + Shift + R`.
>
> **Sin este paso, todo lo demás no mide nada** — la terminal seguiría con el código viejo.

---

## Paso 2 · Entrar con huella

- [ ] Entró con huella
- [ ] Tardó: ________ segundos *(anota aunque funcione — se reportó lenta)*

**Si la huella no reconoce:** intenta con PIN. Anótalo y **sigue** — no es bloqueante.

---

## Paso 3 · 🔴 Arrancar SIN internet

**Éste es el más importante de todos.**

1. **Desconecta el internet** (el cable del módem hacia afuera).
2. Cierra el POS **por completo**.
3. Ábrelo otra vez.

- [ ] Llegó a la pantalla de PIN
- [ ] Tardó: ________ segundos
- [ ] Entró con huella o PIN

> **SI NO LLEGA AL PIN — DETENTE AQUÍ.** No sigas con los demás pasos.
> Reconecta el internet y avisa de inmediato: *"falló el paso 3, arranque sin internet"*.
> Es el cambio del caché del navegador y se revierte en minutos.

---

## Paso 4 · Abrir turno — dale tres veces

**Deja el internet desconectado.** Reconéctalo sólo si el paso 3 falló.

En la pantalla de abrir turno, pon el fondo y dale a **"Abrir turno"**
**tres veces seguidas, rápido.**

- [ ] Le di 3 veces
- Hora: ________

*(Antes esto creaba tres turnos. Ahora debe crear uno. Se verifica en remoto.)*

---

## Paso 5 · 🔴 Mandar comanda SIN internet

Sigue sin internet. Abre una mesa, agrega un platillo y **envía a cocina**.

- [ ] **Imprimió** el ticket de cocina
- [ ] **Apareció en la pantalla del KDS**
- [ ] Tardó en enviar: ________ segundos
- Mesa usada: ________ · Hora: ________

> **SI NO IMPRIME O NO LLEGA AL KDS — DETENTE.** Reconecta y avisa:
> *"falló el paso 5, no imprime sin internet"*. Es lo más grave que puede salir.

---

## Paso 6 · Otra comanda, otra mesa

Sigue sin internet. Manda una segunda comanda desde **otra mesa**.

- [ ] Imprimió
- [ ] Llegó al KDS
- Mesa usada: ________

---

## Paso 7 · Reconectar

**Vuelve a conectar el internet.** Espera **dos minutos** sin tocar nada.

- [ ] Reconectado · Hora: ________
- [ ] En el **Monitor**, la "Sync Queue" dice **sin pendientes**

*(Se verifica en remoto que las dos comandas subieron y que no se duplicaron.)*

---

## Paso 8 · Cerrar turno

Haz el corte normal, con huella o con PIN.

- [ ] Cerró el turno
- [ ] Usé: ☐ huella ☐ PIN
- Hora: ________

> *(Antes esto cerraba **todos** los turnos del restaurante de un golpe. Se verifica
> en remoto que sólo se cerró éste.)*

---

## Paso 9 · Intentar abrir turno con una mesa pendiente

1. Abre turno de nuevo.
2. Manda una comanda a cualquier mesa (**déjala sin cobrar**).
3. Cierra el turno otra vez.
4. **Intenta abrir un turno nuevo.**

- [ ] **Apareció una pantalla color ámbar** avisando de la cuenta abierta
- [ ] Traía un botón para cancelarla
- [ ] Le di al botón y **entonces sí** dejó abrir turno

> Ésta es la regla que pidió Eduardo: *"no puedes abrir un turno si sigues teniendo
> cuentas abiertas del anterior."*
>
> **Si NO aparece la pantalla ámbar** y deja abrir turno de frente, anótalo: la regla
> no se está aplicando.

---

## Paso 10 · El folio del día

Con el turno recién abierto, manda **una comanda**.

- [ ] Número de orden que salió en el ticket: **# ________**

> Debe **continuar** la numeración del día, no volver a 1. Si el turno anterior llegó
> al #3, éste debe ser **#4**.
>
> *(Antes el folio reiniciaba en cada turno y salían dos órdenes "#1" el mismo día,
> imposibles de distinguir en una factura.)*

---

## Al terminar

Manda una foto de esta hoja, o pasa los resultados. Los pasos **4, 7, 8, 9 y 10**
se verifican contra la base de datos en remoto — con las horas que anotaste alcanza.

**Deja el restaurante como estaba:** cancela las órdenes de prueba y cierra el turno.

---

## Anexo — sólo para Daniel

### Qué se revierte si falla cada paso

| Falla | Qué revertir | Efecto |
|---|---|---|
| **3** — no arranca sin internet | PR #282 / #283 / #285 (`sw.js` a v42) | Vuelve el caché anterior |
| **5** — no imprime sin internet | Lo más grave. Revisar antes si es el puente o el envío | — |
| **4** — se crearon 3 turnos | PR #289 | Vuelve el id aleatorio |
| **8** — se cerraron todos los turnos | PR #290 | **No revertir**: sería reabrir el bug. Investigar |
| **9** — no aparece la pantalla ámbar | PR #296 | Se quita la regla de Eduardo |
| **10** — el folio volvió a 1 | Migración `20260901180000` | Rollback al pie del archivo |
| **2** — la huella no autoriza el corte | PR #284 | **Ojo:** también trae el arreglo de seguridad. Revertir sólo la parte de UI |

### Qué se verifica en remoto, y con qué

| Paso | Consulta |
|---|---|
| 4 | `pos_turnos` abiertos en la ventana → debe ser **1** |
| 7 | `pos_orders` de la ventana → **2** comandas, sin duplicados |
| 8 | `pos_turnos` con `closed_at` en la ventana → **1**, y `closed_at > opened_at` |
| 9 | `pos_orders` con `notas` de cancelación al abrir turno |
| 10 | `order_number` correlativo dentro del mismo `dia_venta` |

### Lo que esta prueba NO cubre

- La terminal **Entrada** y **Escondite** — sólo se prueba la caja.
- El comportamiento con **varias terminales a la vez** (dos meseros en la misma mesa).
- **Volumen**: dos comandas no son un servicio lleno.
- La **lentitud** reportada de Entrada, que sigue sin medirse.

Un resultado verde aquí significa *"la caja no está rota"*, **no** *"el sistema está
certificado"*. La matriz completa vive en [`TEST-MATRIX.md`](TEST-MATRIX.md): 26
escenarios, **0 certificados**.
