# Wansoft Backoffice — Conocimiento Operativo Extraido

> No copiamos Wansoft. Extraemos 20 anos de conocimiento operativo
> y decidimos conscientemente que adoptar, que superar, y que reinventar.
> Fecha: 2026-06-30

---

## 1. Lecciones de Wansoft

Las 20 ideas de negocio mas valiosas que descubrimos:

### Las que cambian como pensamos

**1. Produccion es un proceso de primera clase.**
26 SPs — el modulo con mas variantes en todo Wansoft. Batch cooking
(salsas, panes, bases, postres) consume ingredientes ANTES de que se
venda el platillo. Sin este proceso, el inventario de ingredientes no
refleja la realidad en restaurantes con area de panaderia/pasteleria.
AMALAY tiene panaderia. Esto nos afecta directamente.

**2. "Cuantos platillos puedo servir?" es la pregunta correcta.**
`spSelExistenciaPlatillo` calcula porciones posibles basado en el
ingrediente limitante. El chef no piensa en kilos — piensa en
porciones. Fullsite responde "tienes 5 kg de pollo" cuando deberia
responder "puedes servir 12 milanesas mas."

**3. Stock comprometido vs disponible son cosas diferentes.**
`CantidadEnProduccion` separa lo que ya esta en preparacion. Si 5 kg
de pollo estan marinandose, no estan disponibles para otros platillos
aunque fisicamente existan en el almacen.

**4. "Se preparo?" al cancelar es brillante.**
Vincula la decision operativa con el impacto en inventario con UNA
sola pregunta al cajero. Simple y efectivo.

### Las que revelan como opera la industria

**5. Wansoft NO tiene compras, proveedores, ni recepcion.**
A pesar de 20 anos y miles de restaurantes. La industria ha vivido
sin esto y lo ve como "extra." Esto es donde hay oportunidad real —
nadie lo resuelve bien.

**6. El modulo de inventario tiene 23 KB.** Es el mas pequeno de todo
el sistema. El negocio de Wansoft es el POS de ventas, no el backoffice.
La cadena de suministro del restaurante es territorio inexplorado.

**7. AMALAY tiene "bloqueo de venta sin stock" desactivado.**
Prefieren nunca decirle "no" al cliente. El chef adapta o sustituye.
Esto sugiere que el bloqueo automatico es un default incorrecto —
deberia ser una alerta, no un bloqueo.

**8. Los reportes de inventario son impresos, no digitales.**
"Consumo por receta" y "existencias" son templates MR6 de impresion.
No hay dashboard ni alertas. La informacion existe pero nadie la
consulta porque es inaccesible.

### Las que impactan costos

**9. No hay FIFO, promedio ponderado, ni costos historicos.**
El costeo es "ultimo precio de compra" sin sofisticacion. Esto
significa que la industria tolera esta simplificacion — no necesitamos
FIFO para el MVP, pero si necesitamos historial de precios.

**10. Sin rendimiento/yield, el food cost es ficcion.**
1 kg de pollo crudo no da 1 kg cocido. Sin factor de rendimiento,
todo food cost esta subestimado. Esto es un error sistematico que
afecta las decisiones de precio del menu.

### Las que no esperabamos

**11. Las transferencias entre sucursales son masivas (760 refs).**
Para cadenas, mover producto entre sucursales es un proceso diario,
no excepcional. Cada transferencia es un mini-ciclo de envio/recepcion.

**12. Produccion tiene su propio concepto de "orden".**
No es un ajuste de inventario — es una ORDEN con items, cantidades,
y status. El chef "ordena" producir 20 croissants como si fuera un
pedido interno.

**13. Wansoft vincula existencias a GRUPOS, no solo a items.**
"Cuantos de la categoria Bowls puedo servir?" — vista agregada que
ningun dashboard moderno ofrece.

### Las que son workarounds

**14-17.** La deduccion al cobrar (no al enviar), la falta de sub-recetas,
la ausencia de conteo fisico digital, y la falta de alertas automaticas
son limitaciones de los 23 KB del modulo, no decisiones de diseno.

### Las que son red flags

**18-20.** Sin versionamiento de recetas, sin aprobacion de ajustes de
inventario, y sin trazabilidad de cambios de costo — estas ausencias
explican por que muchos restaurantes no confian en su propio sistema
de inventario.

---

## 2. Lo que Fullsite ya hace mejor

No por tecnologia — por operacion:

| Area | Por que somos mejores |
|---|---|
| **Compras** | Wansoft no tiene. Fullsite tiene OC completas con IA sugerida, recepcion con discrepancias, facturas con aprobacion |
| **Recepcion** | Wansoft no tiene. Fullsite verifica item por item con 6 motivos de discrepancia |
| **Merma** | Wansoft solo en cancelaciones. Fullsite tiene modulo dedicado con 7 motivos y costos |
| **Conteo fisico** | Wansoft manual. Fullsite digital con diferencias automaticas y ajuste masivo |
| **Food cost** | Wansoft no tiene dashboard. Fullsite tiene monitor con alertas proactivas |
| **Alertas de reorden** | Wansoft no tiene. Fullsite alerta automaticamente al deducir |
| **Recetas** | Wansoft tiene ingrediente-cantidad-unidad. Fullsite agrega elaboracion, presentacion, alergenos, tiempos |
| **Matching inteligente** | Wansoft por ID rigido. Fullsite con 4 niveles de matching incluyendo fuzzy |
| **Market stock** | Wansoft no distingue. Fullsite tiene dual track: receta para cocina, 1:1 para retail |
| **Deduccion automatica** | Wansoft basica. Fullsite con reversa automatica en cancelaciones |

**Score: Fullsite 12 — Wansoft 4 en backoffice.**

La razon es simple: Wansoft puso el 95% de su esfuerzo en el POS de
ventas y el 5% en inventario. Fullsite puso esfuerzo real en ambos.

---

## 3. Lo que debemos construir

Solo lo que realmente aumenta el valor del Restaurant Operating System.
Ordenado por impacto, no por facilidad:

### Construir antes de 100 restaurantes

| # | Que | Por que | Esfuerzo | Cuando |
|---|-----|---------|----------|--------|
| 1 | **Existencias por platillo** | "Puedo servir 12 milanesas mas" es mas util que "tengo 5 kg de pollo" | 2d | Post-cutover mes 1 |
| 2 | **Sub-recetas** | Sin esto, mantener 100 menus con recetas compartidas es imposible | 3d | Post-cutover mes 2 |
| 3 | **Rendimiento/yield** | Sin esto, todo food cost esta mal calculado | 1d | Post-cutover mes 1 |
| 4 | **Vinculacion receta→item por ID** | El fuzzy matching no escala a 100 restaurantes con nombres distintos | 2d | Post-cutover mes 1 |

### Construir antes de 500 restaurantes

| # | Que | Por que |
|---|-----|---------|
| 5 | **Produccion/batch cooking** | Panaderias, pastelerias, preparacion de bases |
| 6 | **Historial de costos por ingrediente** | Detectar inflacion de proveedores |
| 7 | **Conteo ciego** | Conteos fisicos sin sesgo del sistema |
| 8 | **Transferencias entre sucursales** | Cadenas mueven producto diariamente |

### Construir cuando haya IA madura

| # | Que | Moat competitivo |
|---|-----|-----------------|
| 9 | **Prediccion de compras** | "Manana necesitas 200 huevos" |
| 10 | **Prediccion de merma** | "Los lunes pierdes 15% mas ensaladas" |
| 11 | **Sustitucion inteligente** | "Sin aguacate? Usa hummus, food cost baja 4%" |
| 12 | **Red de proveedores** | Compras grupales entre restaurantes Fullsite |

---

## 4. Lo que nunca deberiamos copiar

| Que | Por que es mala idea |
|---|---|
| Modulo de 23 KB para inventario | Deuda tecnica disfrazada de minimalismo |
| Deduccion solo al cobrar | Incorrecto — el consumo real es al preparar |
| Inventario sin dashboard | La informacion existe pero nadie la consulta |
| Reportes impresos como unica salida | 2026, no 2007 |
| Sin compras ni proveedores | El 40% del costo de un restaurante es insumos y nadie lo controla |
| Sin conteo fisico digital | Excel + ajuste manual = fraude facil |
| Existencias como config de terminal, no del sistema | Config local es fragil |
| Sin alertas proactivas | Si nadie revisa, nadie se entera |
| Sin historial de cambios en recetas | Nadie sabe quien cambio que ni cuando |
| Costeo sin rendimiento | Food cost sistematicamente incorrecto |

---

## La pregunta final

**Si hoy fundaramos Fullsite desde cero con todo lo que aprendimos
de Wansoft, que construiriamos diferente desde el primer dia?**

Tres cosas:

**1. La receta como unidad atomica del sistema, no el platillo.**

Todo en un restaurante gira alrededor de la receta: que ingredientes
necesito, cuanto cuestan, cuanto tardo en preparar, cuanto pierdo
en el proceso, y cuantas porciones puedo servir. El platillo del
menu es solo la cara visible. Debajo esta la receta, y debajo de
la receta estan los ingredientes, y debajo de los ingredientes
estan los proveedores y los costos.

Wansoft modelo platillos. Fullsite debio modelar recetas desde el dia 1.

**2. La deduccion de inventario al ENVIAR a cocina, no al cobrar.**

El momento real del consumo es cuando el chef toma el ingrediente
del refrigerador, no cuando el cajero cobra. Wansoft deduce al cobrar.
Fullsite tambien. Ambos estan mal. El inventario teorico siempre va
a estar desfasado del real mientras no deduzcamos en el momento correcto.

Nota: Fullsite ya tiene la infraestructura para hacerlo (INV-1 fixed,
deduccion en handleSendToKitchen), pero la tabla de recetas opera al
cobrar todavia en muchos flujos.

**3. El flujo de compras como ciudadano de primera clase.**

El 35-45% del ingreso de un restaurante se va en insumos. Es el gasto
mas grande despues de nomina. Y en 20 anos, Wansoft nunca construyo
un modulo de compras. Fullsite lo tiene — pero es un add-on, no el
centro del sistema.

Si empezaramos de cero, el flujo seria:
Receta → ingrediente necesario → proveedor → OC automatica →
recepcion → stock actualizado → costo actualizado → food cost
actualizado → alerta si el margen baja.

Ese flujo cerrado, automatizado con IA, es el moat real de Fullsite.
No el POS. No el KDS. No la impresion. El control total de la
cadena de suministro del restaurante.

Ningun competidor en LATAM lo tiene. Y con los datos de 100+
restaurantes, la IA puede hacer predicciones que un solo restaurante
nunca podria hacer por si solo.

**Eso es lo que haria a Fullsite un Restaurant Operating System,
no solo un POS con inventario.**

---

> Documento de conocimiento permanente.
> Cada leccion fue extraida de 822 stored procedures, 80+ tablas,
> 47 templates de impresion, y 20 anos de operacion en restaurantes.
> No copiamos. Aprendimos. Y ahora construimos algo mejor.
