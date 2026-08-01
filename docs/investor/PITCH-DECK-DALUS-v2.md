# FULLSITE — Pitch Deck v2
## Dalus Capital | Julio 2026
## Operational Intelligence for Physical Businesses

---

## SLIDE 1 — Portada

**FULLSITE**

Operational Intelligence.

*El software registro el trabajo.*
*La IA va a operarlo.*

---

## SLIDE 2 — El cambio de paradigma

*Pregunta que responde: ¿Por que este problema importa?*

**El software de operaciones fisicas se quedo en 2007.**

Los ERPs digitalizaron las corporaciones.
Los POS digitalizaron los restaurantes.

Pero digitalizar no es operar.

Hoy, un restaurante de $30M MXN al ano tiene el mismo software
que uno de $3M. Ambos registran ventas.
Ninguno toma decisiones.

El dueno se entera de los problemas al dia siguiente.
Cuando ya perdio dinero.

**La siguiente capa no registra. Decide.**

---

## SLIDE 3 — La tesis

*Pregunta que responde: ¿Por que ahora?*

**Tres cosas cambiaron al mismo tiempo:**

**1. Los modelos de IA ya pueden razonar sobre operaciones.**
No solo clasificar imagenes. Pueden leer 903 dias de ventas, cruzarlos con 615 recetas y 202 proveedores, y decirte que tu platillo estrella depende de un ingrediente de $5 que compras a un solo proveedor.

**2. La infraestructura cloud elimino la barrera de entrada.**
El lider del mercado necesito 20 anos, 822 stored procedures y SQL Server local. Nosotros replicamos su funcionalidad completa en meses con Next.js y Supabase.

**3. El incumbente no puede responder.**
Wansoft corre sobre .NET 4.5 de 2007. Su arquitectura hace fisicamente imposible integrar IA, tiempo real, o mobile. No es que no quieran. Es que no pueden.

**La ventana esta abierta. En 3 anos se cierra.**

---

## SLIDE 4 — Que es Fullsite

*Pregunta que responde: ¿Que hacen exactamente?*

**El sistema operativo con IA para negocios fisicos.**
**Empezando por restaurantes.**

No un POS. No un dashboard. No un chatbot.

Un sistema que ingiere cada evento operativo — cada venta, cada comanda, cada ingrediente, cada proveedor, cada turno — y lo convierte en decisiones.

"Se te esta acabando el aguacate. Tu proveedor lo entrega en 24h. Genero la orden de compra?"

"El food cost de tus chilaquiles subio de 16% a 23%. El tomate aumento 40% esta semana. Quieres ajustar porcion o precio?"

"Oscar cancelo 3 platillos en 45 minutos. Su promedio es 0.8 por turno. Probabilidad de anomalia: 94%."

**Eso es Operational Intelligence.**

---

## SLIDE 5 — Por que el incumbente ya no puede competir

*Pregunta que responde: ¿Por que no Wansoft?*

**Wansoft domino Mexico por 20 anos. Esto es lo que aprendimos haciendole ingenieria inversa completa.**

211 pantallas. 822 stored procedures. 150+ endpoints. 80+ tablas. 97 reportes. Todo documentado.

**Wansoft es un System of Record.**
Registra lo que paso. Te da un Excel. Tu decides.

**Fullsite es un System of Intelligence.**
Analiza lo que paso. Predice lo que va a pasar. Te dice que hacer.

Wansoft no puede hacer esa transicion. No es un problema de voluntad. Es un problema de arquitectura:

- Los datos viven en SQL Server **local**, en la terminal del restaurante
- Sincroniza al portal web cada X horas — no hay tiempo real
- No hay pipeline de eventos, no hay modelos, no hay canal de alerta
- Cada restaurante es una isla. Los datos nunca se cruzan

**Para agregar IA, Wansoft tendria que reescribir todo desde cero.**
**Nosotros ya lo hicimos.**

---

## SLIDE 6 — Lo que ya descubrimos

*Pregunta que responde: ¿Ya funciona? ¿Que han encontrado?*

**Con la data real de un solo restaurante, la IA ya encontro cosas que 20 anos de Wansoft nunca detectaron:**

**26 platillos generan el 80% del revenue.**
CHILAQUILES = 17.2% de todas las ventas. $904K en 90 dias. Un solo platillo.

**56 platillos dependen de una flor de $5.**
Flor comestible. Cuesta nada. Pero si falta, caen 56 items del menu. Nadie lo sabia.

**5 platillos se venden con margen negativo.**
Una totebag de $75 tiene costo de $1,000. Perdida pura. Invisible hasta hoy.

**Un solo proveedor abastece toda la cadena critica.**
Erikajaqueline Treviño Cruz — frutas y verduras. Si falla, caen el 40% de los platillos.

**439 de 615 recetas tienen un solo ingrediente.**
El restaurante nunca mantuvo recetas reales. Wansoft no lo detecto. Fullsite lo detecto en segundos.

**Esto con UN restaurante. Imagina con 100.**

---

## SLIDE 7 — Evidencia de ejecucion

*Pregunta que responde: ¿Pueden ejecutar?*

| | Que hicimos | Por que reduce riesgo |
|---|---|---|
| **$73.7M MXN** | Ventas procesadas en 903 dias | No es un piloto. Es un negocio real funcionando |
| **Cutover completo** | Reemplazando Wansoft en produccion (8 julio 2026) | El momento mas dificil del go-to-market ya lo estamos haciendo |
| **Reverse engineering** | 211 pantallas, 822 SPs, 97 reportes analizados | Conocemos al incumbente mejor que sus propios ingenieros |
| **30 agentes IA** | Corriendo 24/7 sobre datos reales | No es un roadmap. Ya esta en produccion |
| **615 recetas migradas** | Con ingredientes, costos, proveedores vinculados | Probamos que la migracion es posible y rapida |
| **Offline-first** | Funciona sin internet, sincroniza al reconectar | Resuelto el problema #1 de POS en LATAM |

**No estamos pidiendo dinero para construir.**
**Estamos pidiendo dinero para escalar.**

---

## SLIDE 8 — El flywheel

*Pregunta que responde: ¿Por que ganan?*

```
        +1 Restaurante
              |
              v
      Mas operaciones
              |
              v
       Mas eventos
     (ventas, comandas,
    inventario, compras)
              |
              v
     Mejores modelos
    (food cost, demanda,
    fraude, staffing)
              |
              v
  Mejores recomendaciones
   (alertas, predicciones,
    compras automaticas)
              |
              v
    Mas valor por cliente
              |
              v
    Menor churn + mas
     referidos + datos
     para el siguiente
       restaurante
              |
              v
        +1 Restaurante ←──┘
```

**Cada restaurante hace mas inteligente a todos los demas.**

Con 1 restaurante encontramos el Pareto, los margenes negativos, los puntos de falla.

Con 100: benchmarks anonimos, predicciones cruzadas, compras grupales.

Con 1,000: el dataset operativo mas valioso de la industria restaurantera en LATAM.

**Wansoft tiene miles de clientes pero cada uno es una isla.**
**Fullsite construye un continente.**

---

## SLIDE 9 — La matriz competitiva

*Pregunta que responde: ¿Por que no Toast? ¿Por que no Square?*

```
                    Point Solutions ←————→ Operating System
                          |                      |
   System of              |                      |
   Intelligence           |                      |
        ^                 |               ★ FULLSITE
        |                 |
        |          [Toast, Square]
        |          (POS inteligente
        |           pero no OS)
        |                 |
   System of              |                      |
   Record                 |                      |
        v          [Poster, Clip]        [Wansoft, Oracle]
                   (POS basico)          (OS legacy)
                          |                      |
```

**Toast y Square** digitalizaron el punto de venta pero no operan el negocio.
**Wansoft y Oracle** operan el negocio pero con tecnologia de hace 20 anos.
**Nadie ha construido un Operating System con Intelligence.**

Fullsite no compite con POS. Crea la categoria.

---

## SLIDE 10 — Mercado

*Pregunta que responde: ¿Por que es un mercado enorme?*

**Restaurantes son el punto de entrada. No el destino.**

| Capa | Mercado | Tamano |
|---|---|---|
| **Entrada:** Restaurantes Mexico | 600K+ establecimientos | $850M USD |
| **Expansion:** Restaurantes LATAM | 3M+ establecimientos | $4.2B USD |
| **Categoria:** Hospitality (hoteles, bares, cafes, dark kitchens) | 8M+ establecimientos | $12B USD |
| **Vision:** Operational Intelligence para negocios fisicos | Retail, farmacias, gimnasios, clinicas | $45B+ USD |

**La tesis no es "software para restaurantes".**

**La tesis es: todo negocio fisico necesita una capa de inteligencia operativa.**

Restaurantes son el vertical perfecto para empezar:
- Alta complejidad operativa (inventario perecedero, personal rotativo, multiples canales)
- Baja sofisticacion tecnologica (90% legacy o nada)
- Alto dolor de cabeza diario (el dueno no sabe si gano o perdio hasta que cierra)
- Alta frecuencia de datos (cientos de transacciones diarias)

**Si funciona en restaurantes, funciona en cualquier negocio fisico.**

---

## SLIDE 11 — Por que Daniel

*Pregunta que responde: ¿Por que esta persona y no otra?*

**Fullsite no podria existir sin alguien que sea dueno de restaurante Y ingeniero de software al mismo tiempo.**

Daniel opera AMALAY Coffee & Market en Monterrey.
$31M MXN en ventas en 2025. 40 empleados. 522 platillos. 202 proveedores.

No "valido el problema hablando con restauranteros".
**Vive el problema todos los dias.**

Sabe por que el chef necesita 2 clicks en el KDS, no 3.
Sabe por que el cajon de dinero debe abrir con efectivo pero no con tarjeta.
Sabe por que 439 recetas tienen un solo ingrediente (el staff no tiene tiempo de capturar recetas completas).
Sabe que cuando la impresora falla a las 2pm en sabado, tienes 30 segundos para resolverlo o pierdes mesas.

Eso no se aprende en un whiteboard.
Eso se aprende operando.

**Construyo todo el stack solo:**
POS, KDS, print bridge, 30 agentes IA, dashboard de 17 paginas, arquitectura offline-first, sync engine, event store, sistema de permisos de 50 granularidades.

Y ademas hizo el reverse engineering mas completo que existe del lider del mercado.

**La combinacion de acceso + obsesion + capacidad tecnica es lo que hace esto posible.**

---

## SLIDE 12 — Modelo de negocio

*Pregunta que responde: ¿Como ganan dinero?*

**SaaS + Intelligence Premium**

| Capa | Que incluye | Precio |
|---|---|---|
| **Base** | POS, KDS, comandas, cobros, cortes | $2,500 MXN/mes |
| **Intelligence** | Food cost, predicciones, alertas, compras sugeridas | +$2,500 MXN/mes |
| **Network** (futuro) | Benchmarks, compras grupales, predicciones cruzadas | Comision sobre ahorro |

**Unit economics target:**
- ARPU: $4,000 MXN/mes (~$225 USD)
- Payback: < 2 meses
- LTV (36 meses, 3% churn): $144K MXN
- LTV/CAC: 25x+

**El upsell natural:**
Entras con el POS (gratis de instalar, facil de adoptar).
Te quedas por la inteligencia (imposible de replicar, dificil de abandonar).

---

## SLIDE 13 — La ronda

*Pregunta que responde: ¿Por que invertir hoy?*

**Pre-seed: $500K USD | SAFE post-money**

| Uso | Inversion | Resultado |
|---|---|---|
| CTO + primer equipo de ingenieria | $250K | Acelerar de 1 persona a 4 |
| Go-to-market Monterrey | $150K | De 1 a 50 restaurantes |
| Operaciones + legal | $100K | Incorporacion, SAFE, infra |

**Hitos a 12 meses:**
- 50 restaurantes activos en Monterrey
- $200K MXN MRR
- Food cost engine + compras automaticas en produccion
- Aplicacion a YC W27

**Por que hoy y no en 6 meses:**
- El cutover del piloto es la proxima semana (8 julio 2026)
- Eduardo de la Garza (ex-director comercial Wansoft, 35 personas) esta disponible como Head of Sales
- La ventana para capturar los primeros 100 restaurantes Wansoft en Monterrey esta abierta ahora
- Cada mes sin fondeo es un mes que otro puede empezar

---

## SLIDE 14 — La vision

*Pregunta que responde: ¿Que tan grande puede ser esto?*

**ERP digitalizo corporaciones. $50B+**

**POS digitalizo restaurantes. $15B+**

**Fullsite construye la capa de inteligencia que va a operar negocios fisicos.**

Hoy: un restaurante en Monterrey que sabe su food cost en tiempo real.

En 3 anos: 1,000 restaurantes en Mexico que compran juntos, predicen juntos, y operan mejor que cualquier cadena — sin ser cadena.

En 10 anos: la plataforma que opera el negocio fisico promedio. Restaurantes, cafes, hoteles, retail, clinicas. Cualquier negocio con inventario, personal y clientes fisicos.

**El activo mas valioso no es el software.**
**Es el conocimiento operativo acumulado de miles de negocios, estructurado en modelos que mejoran con cada transaccion.**

Un POS se copia en 6 meses.
Un dashboard se copia en 3 meses.

Pero anos de conocimiento operativo, integrado en un sistema que aprende de cada restaurante, no se copia.

**Eso es el moat.**

---

## SLIDE 15 — Cierre

**El software registro el trabajo durante 20 anos.**

**La IA va a operarlo.**

**Fullsite es la empresa que lo esta construyendo.**

Y ya empezamos.

daniel@fullsite.mx

---

## APPENDIX — Datos de respaldo

### Metricas del piloto (AMALAY Coffee & Market)

| Periodo | Ventas |
|---------|--------|
| Total (903 dias) | $73.7M MXN |
| 2024 | $27.8M MXN |
| 2025 | $31.1M MXN |
| 2026 (6 meses) | $14.7M MXN |
| Promedio diario | $81,565 MXN |
| Delivery (proyeccion mensual) | ~$200K MXN |

### Stack tecnico

Next.js 15 (PWA, offline-first) + Supabase (PostgreSQL) + Vercel + Claude API + 30 agentes autonomos via GitHub Actions + Bridge Node.js para impresion ESC/POS

### Reverse engineering de Wansoft

211 pantallas | 822 stored procedures | 150+ endpoints | 80+ tablas | 97 reportes | 47 templates de impresion | Documentacion completa en "La Biblia de Wansoft" (918 lineas)

### Datos migrados del incumbente

522 platillos | 615 recetas | 3,000+ productos | 878 costos | 202 proveedores | 840 existencias | 300+ reorder points | 114 modificadores | 517 asignaciones | 36 clientes FE | 40 empleados | 14 metodos de pago | 903 dias de ventas historicas
