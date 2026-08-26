# Posicionamiento — El punto de venta final

> Borrador v1 · 2026-08-25 · **pendiente de validación en campo.**
> Complementa [`WHY-FULLSITE-WINS.md`](WHY-FULLSITE-WINS.md) (los moats, hacia adentro) y
> [`CMO-DISTRIBUTION-STRATEGY.md`](CMO-DISTRIBUTION-STRATEGY.md) (los canales).
> Este documento responde una sola pregunta: **qué somos en una frase, hacia afuera.**

---

## La frase

> ## El punto de venta final.

Salió de la conversación con **JC Tame** (restaurantero y consultor de aperturas) el 2026-08-25,
y describe la promesa completa: *ya no tienes que probar con nadie más.*

---

## El problema que resuelve

JC lo dijo sin filtro, y es el diagnóstico más honesto que hemos recibido:

> *"Si yo no veo lo que tú tienes en persona, lo visualizo como otro punto de venta más."*

Ése es el problema. **No es de producto — es de encuadre.** Un dueño de restaurante ya vio
cinco POS. Todos le dijeron lo mismo: rápido, fácil, en la nube, soporte 24/7. Cuando llegamos
diciendo "punto de venta", entramos automáticamente a esa lista y competimos por precio.

"El punto de venta final" saca la conversación de esa lista. No promete ser el mejor de cinco:
promete ser **el último**.

---

## Qué significa

**Final en tres sentidos, y los tres son verificables:**

1. **Final porque no lo vas a volver a cambiar.** Mejora solo. Cada cliente nuevo hace más
   inteligente al sistema, y cada avance en los modelos de IA que usamos llega sin que pagues
   una actualización.
2. **Final porque no necesitas nada encima.** No es POS + inventario + BI + consultor +
   agencia. Es el sistema entero.
3. **Final porque el que sabe de tu negocio ya vive adentro.** No consultas a un externo que
   se tarda dos semanas en entender tu operación. La inteligencia ya tiene tus datos.

## Qué NO significa

- **No** significa "el más completo". Wansoft también es completo, y eso no vende.
- **No** significa "el más barato". Si competimos por precio, perdimos.
- **No** significa "ya está terminado". Significa que **para el restaurante** es el final del
  peregrinaje, no que para nosotros sea el final del roadmap.

---

## Los tres pilares — y qué evidencia tiene cada uno

Un posicionamiento sin evidencia es una promesa. Estado real al 2026-08-25:

| Pilar | Qué prometemos | Evidencia hoy | Falta |
|---|---|---|---|
| **1. Opera sin fallar** | El POS aguanta el día real, incluso sin internet | Offline implementado y probado en campo en AMALAY; P0-1 y P0-2 en `main` | Matriz del camino del dinero **ejercida físicamente**; cutover de AMALAY |
| **2. Piensa por ti** | Agentes que detectan, predicen y avisan | 5 agentes en producción; predicción de compra, reorder point, monitor de proveedores, varianza de costo | Que el aviso **cierre el ciclo** (ver abajo) |
| **3. Te conecta** | Proveedores, precios de mercado, apertura, marca | Nada construido. **Tesis, no producto.** | Todo — requiere agregación anónima y opt-in |

**Regla: sólo se vende el pilar 1 y 2. El pilar 3 se cuenta como visión, nunca como capacidad.**

---

## Lo que NO se dice todavía

Esto no es prudencia comercial — es que **no existe**, y decirlo nos quema con la primera
persona que lo pida en el demo:

- ❌ *"El sistema le manda solo el correo al proveedor."*
  **Realidad verificada:** `inventory_auto_order.py`, `purchase_predictor.py`,
  `stock_alert_agent.py` y `supplier_monitor.py` detectan el punto de reorden, predicen la
  compra semanal y **sugieren la orden** — pero el envío es **Telegram al dueño**. El correo o
  WhatsApp al proveedor **no está construido**. Cuando se construya, es un efecto externo
  Tipo A: requiere aprobación humana y operación recuperable.
  **Cómo se dice hoy:** *"Te avisa que te quedan dos días de aguacate y te arma la orden.
  Tú la apruebas."* Eso sí es cierto, y sigue siendo mejor que lo que tiene hoy.

- ❌ *"Comparamos tus precios contra los de otros restaurantes."*
  **Realidad:** requiere agregación anónima con consentimiento contractual. Prometerlo antes
  de tenerlo es un riesgo de aislamiento multi-tenant, no una exageración de marketing.

- ❌ *"Te decimos dónde abrir tu próximo restaurante."*
  Visión real y buena. Con un restaurante en producción, no hay base para sostenerla.

---

## Cómo cambia el demo

**Consecuencia directa e inmediata:** el demo **no puede abrir en la pantalla de mesas.**

Abrir en la cuadrícula de mesas es entrar por la puerta de "otro POS": lo primero que ve el
dueño es exactamente lo que ya tiene. El demo abre con **lo que su sistema actual no le puede
decir** — el hallazgo, el aviso, el número que no sabía. El POS se enseña **después**, como la
prueba de que el hallazgo salió de su operación real y no de una diapositiva.

Secuencia: **hallazgo → de dónde salió → cómo se opera.** Nunca al revés.

---

## Frases de apoyo

Salidas de la misma conversación, para el pitch y para materiales:

- *"Los restaurantes no quiebran por mal producto. Quiebran por finanzas y por falta de tiempo."*
  → nuestro trabajo es devolverle al dueño las dos cosas.
- *"Si hubiera empezado con lo que sabía en el tercer año, el primero habría sido otra cosa."*
  → vendemos el tercer año desde el primer día.
- El restaurante compite hoy por **comunidad y experiencia física** — lo único que ninguna IA
  le puede quitar. Nosotros nos encargamos de todo lo demás para que el dueño se dedique a eso.

---

## Estado y siguiente paso

**Borrador.** Una frase de posicionamiento no se aprueba en una junta: se aprueba cuando un
dueño de restaurante la escucha y contesta *"¿cómo funciona eso?"* en lugar de *"¿cuánto cuesta?"*.

Se valida en las primeras tres conversaciones de venta reales. Si en las tres hay que explicarla,
no sirve y se cambia.
