# Lecciones de Alejandro (ex-Parrot / fundador de Bento) — problemas reales y cómo los resolvemos

> Llamada 2026-08-20 con Alejandro, ~8 años en food-tech: estuvo en Parrot (POS) y fundó **Bento**
> (OMS/compras-ventas entre restaurantes y proveedores; se asoció temprano con un grupo tipo
> Sigma/Alsea). Un operador que ya se estrelló contra los muros que vienen. Este doc convierte su
> reality-check en acciones para Fullsite, honesto sobre qué resolvemos hoy vs qué falta.
> Ver [[project_pricing]], `docs/ai/AI-ARCHITECTURE-DIRECTION.md`, `docs/PLAN-AHORA.md`, master plan (pagos).

---

## La tesis que Alejandro VALIDÓ y afiló

Coincidió con nuestra visión ("el restaurante solo debería cocinar rico; lo demás automático") — **pero
la corrigió:** eso solo es posible si **confías en el dato del POS, y el dato del POS solo es confiable
si el inventario es verdad.** Y el bloqueador más profundo no es técnico — es **humano** (mafia de robo
+ dueños ausentes) y **fiscal** (todos quieren facturar menos de lo que venden).

> *"El pedo es confiar en la información que te da el punto de venta… y tiene todo que ver con el
> inventario. Si no hay dato, ¿qué estás automatizando?"*

Los 8 problemas que señaló, y nuestra respuesta:

---

## 1. Verdad de inventario — la raíz de todo

**Él:** el inventario nunca cuadra. Dos frentes:
- **Salidas (recetas):** ¿cuánto aguacate lleva una enchilada? Tamaños distintos, gramos vs kilos. Hacer
  recetas "bonitas" en software es difícil → los restaurantes no las hacen → food cost ficticio.
- **Entradas (recepción):** pides 20 cajas, llegan 16, "mañana te hago 4 más" en un papelito → el sistema
  dice 20, el físico es 16 → descuadre. Pasa hasta en Sigma/Alsea/Bimbo (una factura de **$300M** de descuadre).

**Cómo lo resolvemos:**
- ✅ **Ledger inmutable** (`recordMovement()`, contrato en `AGENTS.md`): toda entrada/salida/merma/ajuste
  es un movimiento atómico con costo promedio ponderado + idempotencia. Ya migramos merma y conteo físico.
- ✅ **Conteo físico** como control de precisión (no como mecanismo) — coincide con MaxIA (descuento al producir).
- 🔶 **Salidas por receta:** el gap real — **71% de recetas de AMALAY tienen 1 solo ingrediente** → food
  cost falso. Fix: **auto-completar recetas con IA** (Claude, ~30 min de revisión vs 200 hrs a mano).
  Es *exactamente* la "oportunidad enorme con la gente" que Alejandro mencionó. → `PLAN-AHORA` Ola 3 (OP-30).
- ⬜ **Entradas / recepción vs físico:** el gap más grande y el que Bento atacó. Ver #2.

**Regla que emerge:** el inventario no se automatiza — se **reconcilia**. Sistema (ledger) vs físico
(conteo) vs factura (recepción). Sin las 3 patas, la lata que reportas es falsa.

---

## 2. Recepción y proveedores — el hueco de Bento (lo que NO hacemos hoy)

**Él:** el país es informal. Pedidos por WhatsApp/llamada, precios que cambian cada semana y nadie
actualiza. Bento conectó **cliente Y proveedor en la misma plataforma**: el proveedor abastece por ahí,
si no llega completo lo modifica ahí, y se **limpia el pedido contra la factura** → muchos checks de que
la orden llegó completa. El reto: integrar sistemas viejos sin API abierta ("un retote, no lo arreglas nunca").

**Cómo lo resolvemos (por fases, honesto):**
- **Fase 1 (factible ya):** **ingesta de facturas de proveedor** (CFDI XML — el proveedor SIEMPRE factura)
  → parsear cantidades + precios → cruzar contra la recepción física en el POS. El CFDI es el "papelito"
  digitalizado que Alejandro decía que falta. Esto ancla la entrada sin pedirle al proveedor que use nada.
- **Fase 2:** monitoreo de precios de proveedor (ya tenemos el agente) — ver #3 por el problema de las alertas.
- **Fase 3 (Bento-like, grande):** conectar proveedores. Es un producto aparte (OMS), no día-1. Pero la
  arquitectura de ledger + factura-match nos deja llegar ahí sin reescribir.

**Cabo honesto:** hoy Fullsite no cierra la entrada contra el físico. Es el trabajo pendiente de
`facturas-proveedor` + `recepcion-factura` al contrato (OP-21) — justo lo que dejamos para pase enfocado.

---

## 3. Precios de proveedor cambiantes → "70 alertas rojas"

**Él (advertencia directa):** *"En papel está padre. Te voy a decir qué te va a pasar: va a llegar a un
restaurante y va a tener 70 alertas."* Frutas/verduras/proteínas varían 20-40% y es normal → tu reporte
va todo en rojo → el operador deja de leer.

**Cómo lo resolvemos (ya lo teníamos escrito hoy):** es exactamente por qué la IA debe ser **un experto
con contexto, no 24 agentes ciegos** (`docs/ai/AI-ARCHITECTURE-DIRECTION.md`). El agente de precios NO
debe alertar cada variación — debe:
- Conocer el **rango normal** de cada insumo (baseline histórico) y solo alertar fuera de banda.
- Pasar por **gate de severidad** (get_monitoring_context + agent_events) → una sola voz, no 70 pings.
- Distinguir "variación normal de temporada" de "esto no cuadra". 

La advertencia de Alejandro es la prueba viviente de que la Fase 0 de IA (cerrar el bucle de valor +
contexto compartido) es prerequisito, no lujo. Sin eso, nuestro agente de precios se vuelve las 70 alertas.

---

## 4. La trampa fiscal — facturar menos de lo que vendes (lo que más importa)

**Él:** *"A veces eso importa más que todo lo demás."* El restaurante quiere facturar el **70% de lo que
vende** (evadir). Mecanismo: factura **público en general** por ~70%. Pero si un comensal de ese 70%
pide su factura → hay que **cancelar** la factura global y emitir la suya, y rehacer la global. *"No me
forces a facturar todo, porque entonces lo invento o no te uso."* Alguien que vende $2M puede "perder"
$100-200k solo por no poder esconder entradas.

**Cómo lo resolvemos:**
- Es el gap que la auditoría ya marcó: **editor de ticket POS-side ausente** + CFDI (OP-22). **Es
  requisito para vender a restaurantes reales**, no un nice-to-have. Sin poder facturar X% + público
  general + cancelar/re-timbrar, no cierras un cliente que factura.
- **La tensión clave (y cómo la resolvemos con honestidad):** esto **choca aparentemente** con nuestra
  detección de skimming. La distinción es **quién** esconde:
  - **El DUEÑO optimizando impuestos** (facturar 70% público general) = decisión legítima del negocio → el
    sistema se la debe *permitir y facilitar* (control fiscal en manos del dueño).
  - **El EMPLEADO robando** (bajar el total de un ticket para embolsarse la diferencia) = fraude → el
    sistema lo *detecta y alerta al dueño*.
  Fullsite debe servir el control fiscal del dueño **Y** delatar el robo del empleado. Son cosas distintas
  aunque ambas "esconden dinero". El editor de ticket + el arqueo por mesero son los dos lados.

---

## 5. Robos + dueño ausente — el muro más profundo (es GTM, no solo tech)

**Él (lo más importante):** los chefs/operadores son una **mafia**. Roban (compran más caro y se quedan
la diferencia, descuentos, etc.). El **dueño de San Pedro con dinero muchas veces NO opera** su negocio:
*"Tengo 100, al final del mes 150, no quiero saber si me robaron."* El operador **no quiere tu sistema
porque le corta el robo**. Aunque el dueño lo ame, el operador lo sabotea: *"si te contrato pierdo a mi
güey de 7 años que me roba pero me hace dinero."* Muchos negocios se salieron de Bento por eso.

**Cómo lo resolvemos — y aquí Alejandro nos dio el ICP exacto:**
- La detección de robo (nuestro anti-fraude) es un **feature para el dueño involucrado** y un **bug para
  el dueño ausente**. No es un problema de tecnología — es de **a quién le vendes.**
- **ICP afinado (no negociable):** no "restaurante de X sucursales" — es **el dueño-operador joven, que
  está tomando el negocio, metido en la operación, que quiere tecnología y quiere control** (no el dueño
  ausente que prefiere al ladrón feliz). Ese dueño *quiere* que le detectes el robo.
- **Coincide con nuestro target actual** (café/brunch San Pedro, tipo AMALAY/Cali) — pero lo afila: el
  dueño debe **operar**, no ser rentista. Un Cali cuyo dueño no contesta y no opera es MAL cliente para
  nosotros aunque tenga dinero.
- Regla: nuestros primeros 100 clientes deben ser dueños-operadores que **aman** que la IA les cuide el
  negocio. Con ese ICP, la detección de robo es lo que *venden*, no lo que los espanta.

---

## 6. Multi-RFC / multi-marca / CEDI / series — la complejidad de grupos

**Él:** un restaurante es fácil; un **grupo con múltiples marcas, múltiples RFCs, productos con/sin IVA**
= desmadre. >4 sucursales suelen tener **CEDI** (centro de distribución) que se comporta como proveedor
pero es parte del restaurante → lo quieren en el mismo sistema, con **pedidos internos** y **series
fiscales**. El CEDI a veces tiene fábrica (produce) vs solo distribuye. *"Prepárate para una arquitectura
complejilla. Multi-RFC es clave, súper clave en México."*

**Cómo lo resolvemos:**
- Ya tenemos esqueleton multi-tenant + Golden Skeleton, pero **multi-RFC, CEDI-como-proveedor, pedidos
  internos y series son gaps reales** (los impuestos hoy están hardcodeados — OP-24; el editor de ticket
  ausente — OP-22).
- **El consejo de oro de Alejandro (aplicable a ti por Grupo Galería):** *"Prepara la arquitectura como
  si un grupo complejo (tipo Galería/Crunchtime) lo pudiera usar, aunque no lo use hoy — úsalos como caso
  de prueba de complejidad, no como tu primer cliente."* Así, de ese nivel para abajo, **cualquiera**
  (20 marcas, multi-RFC, con/sin series) ya está cubierto. Tienes acceso: mapea cómo se ve un restaurante
  MUY complejo del grupo → diseña el scope de la arquitectura → aunque no lo vendas aún.

---

## 7. Créditos — valor enorme, pero requiere verdad de inventario para prestar seguro

**Él:** *"Todo el mundo quiere crédito. Si ofreces crédito, todos quieren tu sistema, no importa si es
bueno o malo."* Toast/Clip: 85% del revenue del POS es **pagos**. Bento daba crédito: *"yo pago tu
factura y me pagas en 30 días"* → valor enorme (el negocio de comida vive del flujo). **Pero para prestar
SEGURO** necesitas saber que la compra es real — si solo tienes POS, prestas a ciegas. Bento limpiaba la
orden (cliente + proveedor + factura) → prestaba sobre compras verificadas.

**Cómo lo resolvemos:**
- Es la jugada de **pagos/crédito del master plan (05·B)** — el endgame de revenue. Clip ya te habló
  (founder), pero a tasa cara (~3%). Ahí está el negocio real.
- **La conexión que Alejandro nos regala:** el crédito seguro **depende de la verdad de inventario** (#1-2).
  El mismo ledger + factura-match que arregla el inventario es lo que te deja prestar sobre compras
  verificadas. No son dos proyectos — es uno: **verdad de inventario → crédito seguro → moat de pagos.**

---

## 8. Lecciones de GTM (cómo NO estrellarse como él)

- **ICP perfecto > todo** (ver #5): dueño-operador joven que quiere IA para no vivir en el negocio.
- **100 clientes que te AMEN antes de escalar.** Ellos te dicen qué construir (¿quieren detección de robo?
  ¿reorden? ¿costeo?). *"No te pierdas de eso — nosotros nos perdimos y fue un error."*
- **NO te sobre-asocies con un gigante temprano.** El error de Bento: se asoció con un monstruo (miles de
  clientes día 1) → distracción, construyendo para alguien enorme antes de probar su valor. → **Matiz para
  ti:** usa Grupo Galería como **guía de arquitectura/caso de complejidad**, NO como tu primer cliente que
  te distrae. (Ya lo tienes bien: LOI firmado pero te pidieron ~20 restaurantes + revenue + SOC2 antes.)
- **Robustez + soporte, no solo "es fácil".** La industria está acostumbrada a sistemas malos; ganarás con
  robusto-que-se-siente-simple + soporte el mismo día (tu ventaja vs Wansoft: sin legacy, nube, mejoras en días).
- **Vende contra lo que ya conocen:** "tu módulo de cocina, así lo hago más fácil; tu costeo, automático".
  El POS es fácil de vender porque el cliente YA sabe medir uno (a diferencia de Bento/OMS, categoría nueva).

---

## Lo honesto del cruce

Alejandro se sale de la industria por la gente (robo, informalidad, mano de obra barata). **Tú la eliges a
propósito** — acceso familiar, la oportunidad de IA, y *menos competencia porque nadie quiere entrar aquí*
(tu amigo hace IA para dentistas/real-estate/bancos, no restaurantes). Ese es un moat contrarian válido:
**el foso es que es horrible y nadie más lo quiere.** Pero hay que respetar las realidades que él aprendió a
golpes:
1. Sin **verdad de inventario** (entradas+salidas+físico), automatizas sobre datos falsos.
2. La IA de precios sin **contexto** = 70 alertas rojas.
3. El **editor de ticket/fiscal** no es opcional — es requisito de venta (y sirve al dueño, no al ladrón).
4. El **robo + dueño ausente** se resuelve con **ICP** (dueño-operador involucrado), no solo con detección.
5. **Multi-RFC/CEDI/series** — diseña la arquitectura al nivel Galería aunque vendas café-brunch primero.
6. **Verdad de inventario → crédito seguro → pagos** es un solo camino, no tres.

**En una frase:** Alejandro confirma que Fullsite ataca el problema correcto (decisiones sobre dato
confiable), y nos regala el mapa de los tres muros que tumban a los demás — **inventario real, fiscal
flexible, e ICP de dueño-operador** — más el premio final: verdad de inventario es lo que desbloquea el
crédito, y el crédito es el negocio de Toast/Clip.
