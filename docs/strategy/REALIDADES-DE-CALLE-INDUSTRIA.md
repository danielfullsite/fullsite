# Realidades de calle — los landmines de la industria restaurantera (MX)

> El conocimiento callejero que nadie te dice hasta que ya estás sangrando. En el espíritu del
> reality-check de Alejandro (ex-Parrot/Bento) pero ampliado a todos los frentes. Objetivo: que no
> nos sorprendan — metidos al modelo, al producto y a la venta desde el día uno.
> Ver [[project_pricing]], `docs/strategy/LECCIONES-ALEJANDRO-PARROT-BENTO.md`, `docs/strategy/COMPANY-BRAIN.md`.

**Marcador de cada uno:** 🛠️ lo atacamos con tech · 🤝 es proceso/relación · 🎯 se resuelve con ICP/venta · 🪨 solo se aguanta (métrelo al modelo).

---

## A) La gente y el robo (más allá del inventario)

- **No es un ladrón — es colusión.** 🤝🎯 Mesero + cajero + cocina se coordinan. Cortesías fantasma
  ("va por la casa"), merma inflada ("se cayó / se echó a perder") para tapar robo, y la peor: **venden
  SU producto con TU insumo** (el cocinero trae sus tacos, los vende por tu sistema, se lleva la lana, tú
  pagas el insumo). Lo detectamos por patrones cruzados (descuentos raros, merma fuera de rango, arqueo
  que no cuadra), pero **lo cierra el dueño metido, no el código.**
- **Rotación brutal (100%+/año).** 🛠️ Cada mes reconfiguras PINs, huellas, capacitas de nuevo. Si el
  alta de un mesero no es de **~30 segundos** con roles-plantilla, te ahogas en soporte y en errores.
- **El turno de la noche.** 🛠️ El robo pasa cuando el dueño no está. Las alertas tienen que llegar **en
  el momento** (tiempo real sobre el event store), no en el reporte del viernes.
- **El gerente-cacique.** 🎯 El que "sabe cómo está armado todo" y sabotea cualquier sistema que le corte
  el control (Alejandro). Aunque el dueño lo ame, el gerente lo entierra. → ICP: dueño-operador involucrado.

## B) El dinero y lo fiscal (el hoyo negro)

- **El efectivo que nunca entra al sistema.** 🪨🤝 Es la fuga #1 y el POS es **ciego** a la venta en
  efectivo no registrada. Y el dueño **quiere** algo off-books (fiscal) → no puedes forzar captura al
  100% sin perder al cliente. Aprietas el arqueo de caja y marcas el hueco efectivo-vs-ventas, pero el
  **% fiscal lo controla el dueño**, no tú.
- **El SAT se mueve solito.** 🛠️ CFDI 3.3 → 4.0 → carta porte → complementos. Lo fiscal es blanco móvil;
  persigues al SAT para siempre. **Jugada obligada: PAC (Facturapi) para que ELLOS persigan al SAT.**
  Nunca timbrar a mano.
- **Facturación parcial (el 70%).** 🛠️ El dueño quiere facturar menos de lo que vende; si un comensal de
  ese 70% pide su factura, hay que cancelar la global y re-timbrar. Requisito de venta, no opción. La
  distinción de oro: **dueño optimizando impuestos = legítimo** (se lo facilitamos); **empleado bajando
  el ticket = robo** (lo delatamos).
- **Cobranza a ti.** 🪨 Los restaurantes pagan tarde o truenan debiéndote. → Tarjeta domiciliada / prepago,
  corte de servicio por falta de pago (con tacto).

## C) El fierro y el soporte (lo que te quita el sueño)

- **La impresora térmica es el enemigo #1.** 🛠️ Drivers, se traba, muere a media comida, cada marca tiene
  sus mañas de ESC/POS. Será tu llamada de soporte más frecuente por mucho. Print bridge robusto (ya lo
  tenemos) + fallbacks + validar cobertura de impresoras por estación al arranque (OFF-01).
- **Internet, luz, el fierro físico.** 🛠️🪨 Fibra caída (offline — ya resuelto), apagones, la tablet que
  se muere o se roban, grasa/calor/agua en pantallas de cocina. El ambiente destruye hardware rápido.
- **Soporte 24/7 y "quiero que vengas".** 🤝🪨 Operan noches y fines; POS caído = pánico = todo es P0 para
  ellos. En México esperan que **alguien VAYA**, no un ticket. → Remoto primero (TeamViewer), pero maneja
  la expectativa desde la venta. El soporte malo de Wansoft es tu palanca — pero cuesta dinero y gente.

## D) La venta y el churn (lo estructural)

- **El que decide ≠ el que usa ≠ el que paga.** 🎯 El dueño compra, el gerente sabotea, el mesero sufre.
  Tres ventas distintas en un solo trato. El ICP contempla a los tres.
- **Churn que no es tuyo: los restaurantes MUEREN.** 🪨🎯 El 80% truena en 5 años. Tu base se evapora no
  porque estén molestos, sino porque el negocio cerró. Métrelo a los unit economics desde hoy. La vuelta
  bonita: **tu IA que los ayuda a NO truncar es tu retención** — es literalmente la propuesta de valor.
- **Mercado chico, reputación por anécdota.** 🤝 En San Pedro todos los dueños se conocen. Un cliente
  enojado envenena el pozo; un referido bueno vale oro. El audit trail te salva ("el sistema no falló,
  mira el registro"), pero la relación pesa más que el software.
- **Mano de obra barata compite contigo.** 🎯 El empleado de $5,000/mes hace lo que hace tu sistema
  (Alejandro). Tu valor **no** es reemplazar mano de obra — es la **decisión/inteligencia** que el humano
  no puede dar. Si te vendes como "hago lo del contador barato", pierdes.
- **Migración = data sucia.** 🛠️ Su menú/histórico viejo es un desastre; importarlo = garbage in. El
  onboarding tiene que **limpiar mientras importa** (asistido por IA), o arrancas con basura.
- **"El sistema está mal" — el chivo expiatorio universal.** 🤝 Todo error humano se le echa al sistema.
  Y no confían en tu número hasta que cuadra con su corazonada / con el efectivo. Si tu reporte dice X y
  la caja dice Y, le creen a la caja y te culpan a ti.

---

## El patrón de fondo (lo más importante)

Casi **ninguno de estos es un problema de código.** Son la razón por la que la estrategia es:

1. **ICP = dueño-operador metido.** Robos, colusión, sabotaje del gerente, "no confío en el número" — casi
   todo se neutraliza con un dueño que opera y quiere control. El dueño ausente es mal cliente aunque
   tenga dinero.
2. **Obsesión con hacer trivial el paso humano** (contar al recibir, dar de alta un mesero, cobrar,
   facturar). El muro nunca es el software — es que la gente lo haga. Gana quien lo hace tan fácil que sí lo hacen.
3. **Lo que solo se aguanta (🪨) va al modelo desde el día uno**, no como sorpresa: churn de restaurantes
   que truenan, efectivo off-books, soporte 24/7, cobranza difícil.

**Nuestra ventaja honesta:** nacemos sin legacy, con IA, en la era donde el cash se muere y el
dueño-operador joven llega. Eso nos da margen que Alejandro no tuvo — pero solo si respetamos estas
realidades en vez de idealizarlas.
