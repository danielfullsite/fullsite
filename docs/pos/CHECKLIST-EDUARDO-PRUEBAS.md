# Checklist de pruebas físicas — Eduardo

> **Para quién:** Eduardo, en las terminales de AMALAY.
> **Qué NO es:** una sesión de uso libre. Es un guion cerrado: se siguen los pasos en orden,
> se anota lo que se ve, y se para donde diga parar.
>
> **Creado:** 2026-08-24.

---

## Las cuatro reglas

**1. Nunca una mesa real.** Todas las pruebas van en **UNA sola mesa designada**, acordada
con Daniel antes de empezar y anotada abajo. Si esa mesa aparece ocupada, **no se usa**: se
para y se avisa. Nunca se abre una mesa que ya tenga algo.

**2. Fuera de horario de servicio.** Con el corte de caja hecho y sin turno abierto. Si hay
comensales, no es momento.

**3. Eduardo observa y anota; no arregla ni limpia.** Si algo falla, se anota y se pasa al
siguiente punto o se para — **no se intenta arreglar**, no se borran órdenes, no se
reinstala nada. La limpieza de órdenes de prueba está reservada a Daniel por diseño
(`canCleanupAllOrders`), así que las de prueba se quedan hasta que él las quite.

**4. Ante cualquier cosa rara: PARAR y no tocar.** Si aparece una orden que nadie creó, un
cobro duplicado, o algo que no está en el guion — **congelar la escena**. No cobrar, no
enviar, no borrar. Anotar y avisar. Esa evidencia vale más que terminar el checklist.

---

## Antes de empezar — Daniel llena esto

| | |
|---|---|
| Mesa designada para pruebas | **`___`** |
| Platillo con término obligatorio (para B) | **`___________`** (p. ej. arrachera) |
| Fecha y hora de la sesión | `___________` |
| Corte de caja hecho | ☐ sí |
| Cola de sincronización en 0 | ☐ sí |

Sin estos cinco, no se arranca.

---

## Bloque A — La caja sigue cobrando sin internet
*(matriz offline T-01, T-02)*

| # | Paso | Qué anotar |
|---|---|---|
| A1 | Abrir el POS de la **caja** con internet. Esperar a que cargue el mapa de mesas. | ¿Cuántos segundos tardó? |
| A2 | Apagar **sólo el internet** (WAN). Dejar el WiFi/LAN prendido y Pedro corriendo. | ¿Apareció algún aviso en pantalla? |
| A3 | Abrir la **mesa designada**. | ¿Abrió? ¿En cuántos segundos? |
| A4 | Agregar un producto cualquiera. Enviar a cocina. | ¿Salió comanda impresa? ¿Apareció en el KDS? |
| A5 | Cobrar en efectivo. | ¿Imprimió el ticket? ¿La mesa quedó libre? |

**PARAR si:** la mesa no abre, no imprime, o el POS se queda pensando más de 30 segundos.

---

## Bloque B — El término de la carne *(esto valida el PR #63)*
*(sigue offline, sin volver a prender internet)*

| # | Paso | Qué anotar |
|---|---|---|
| B1 | Abrir la mesa designada otra vez. | |
| B2 | Tocar el platillo con término obligatorio. | **¿Te pidió el término?** ← lo que importa |
| B3 | Si lo pidió: elegir uno y enviar a cocina. | ¿La comanda impresa trae el término? |
| B4 | Si **no** lo pidió: no enviar. Anotar y seguir a B5. | |
| B5 | Cancelar/cerrar la mesa sin cobrar. | |

> **Por qué importa:** offline se estaban perdiendo los grupos obligatorios y la comanda
> salía a cocina sin el término, en silencio. Si en B2 **sí** pide el término, el arreglo
> funciona. Si **no**, el arreglo no basta y hay que saberlo antes de mergearlo.

---

## Bloque C — Volver a conectar sin duplicar
*(matriz offline T-22, T-23)*

| # | Paso | Qué anotar |
|---|---|---|
| C1 | Prender el internet. Dejar POS, KDS y Pedro abiertos. | |
| C2 | Esperar **60 segundos** sin tocar nada. | |
| C3 | Mirar el mapa de mesas. | ¿La mesa designada quedó libre? |
| C4 | Revisar la impresora. | ¿Reimprimió algo por su cuenta? (no debería) |
| C5 | Entrar a la mesa designada. | ¿Aparece alguna orden que no creaste? |
| C6 | Diagnóstico de sincronización en el POS. | ¿Cuántos pendientes? ¿Algún error? |

**PARAR si:** aparece una orden que nadie creó, algo se reimprime solo, o hay pendientes con
error. **No tocar nada** — es exactamente la evidencia que se busca.

---

## Bloque D — El corte de caja *(esto valida el PR #61)*

| # | Paso | Qué anotar |
|---|---|---|
| D1 | Con quién está la caja abierta (¿cajero o gerente?). | Nombre y rol |
| D2 | Hacer un movimiento de caja pequeño (retiro de $50). | ¿Lo aceptó? |
| D3 | Esperar 1 minuto. | ¿La sesión se cerró sola? ¿Pidió PIN de nuevo? |
| D4 | Diagnóstico de sincronización. | ¿El retiro quedó pendiente? |
| D5 | Repetir D3 dos veces más, con 1 minuto entre cada una. | ¿Se volvió a desloguear? |

> **Por qué importa:** un 403 de negocio se confundía con "sesión expirada" y sacaba al
> cajero cada ~20 segundos, en bucle, mientras la cola dejaba de subir. Si en D3/D5 **no**
> se desloguea, el arreglo funciona.

---

## Bloque E — Entrada y Escondite
*(las dos estaciones que nunca se probaron offline)*

Repetir **el Bloque A completo**, primero en **Entrada** (PDV3) y después en **Escondite**
(PDV1), una a la vez. No abrir la segunda hasta cerrar la primera.

| Estación | A1 | A2 | A3 | A4 | A5 | Notas |
|---|---|---|---|---|---|---|
| Entrada | | | | | | |
| Escondite | | | | | | |

---

## Al terminar

1. **No limpiar nada.** Las órdenes de prueba se quedan; Daniel las quita.
2. Entregar esta hoja con todo lo anotado, incluidas las fotos si las hubo.
3. Decir en voz alta cuál bloque **no** se completó y por qué. Un bloque a medias que se
   reporta como completo es peor que uno saltado.

## Lo que este checklist NO cubre

Arranque en frío sin internet (prender la máquina con el WAN caído), reinicio del Local
Server, reinicio del KDS, cambio de IP por DHCP, y las pruebas de carga (1000 eventos, 200
operaciones pendientes). Son 5 de los 23 escenarios de la matriz y requieren a Daniel.

**Este checklist cubre 8 de los 23.** Completarlo no certifica offline — lo acerca.
