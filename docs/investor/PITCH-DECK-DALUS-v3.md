# FULLSITE — Pitch Deck v3
## Dalus Capital | Julio 2026

---

## SLIDE 1 — Portada

**FULLSITE**

The Intelligence Layer for Restaurant Operations.

daniel@fullsite.mx

---

## SLIDE 2 — El cambio

*¿Por que este problema importa?*

El software de restaurantes lleva 20 anos haciendo lo mismo:
registrar transacciones.

Registra la venta. Registra el corte. Registra la cancelacion.

Pero no dice por que el food cost subio.
No dice que proveedor esta fallando.
No dice que platillos estan perdiendo dinero.

El dueno se entera al dia siguiente.
Cuando ya perdio dinero.

**Registrar no es operar.**

La siguiente generacion de software no registra.
Decide.

---

## SLIDE 3 — La oportunidad

*¿Por que ahora?*

Tres cosas cambiaron al mismo tiempo:

**Los modelos de IA ya razonan sobre operaciones.**
Pueden cruzar 903 dias de ventas con 615 recetas y 202 proveedores
y encontrar que tu platillo estrella depende de un ingrediente de $5
que compras a un solo proveedor.

**La infraestructura cloud elimino la barrera de entrada.**
Lo que antes requeria anos de desarrollo e instalacion local,
hoy se despliega en minutos como una app web.

**La arquitectura de los sistemas legacy hace extremadamente dificil
incorporar inteligencia operativa en tiempo real sin una
reconstruccion profunda.**
No es que no quieran. Es que el costo de la transicion es prohibitivo.

La ventana para construir la nueva categoria esta abierta.

---

## SLIDE 4 — Que es Fullsite

*¿Que hacen exactamente?*

**La capa de inteligencia sobre toda la operacion de un restaurante.**

No un POS. No un dashboard. No un chatbot.

Un sistema que ingiere cada evento operativo — cada venta, cada comanda,
cada ingrediente, cada proveedor, cada turno — y lo convierte en decisiones.

"El food cost de tus chilaquiles subio de 16% a 23%.
El tomate aumento 40% esta semana.
¿Ajustas porcion o precio?"

"Oscar cancelo 3 platillos en 45 minutos.
Su promedio es 0.8 por turno.
Probabilidad de anomalia: 94%."

"Se te acaba el aguacate en 2 dias.
Tu proveedor entrega en 24h.
¿Genero la orden de compra?"

---

## SLIDE 5 — Lo que ya descubrimos

*¿Ya funciona?*

Con la data de un solo restaurante, el sistema encontro cosas
que 20 anos de software legacy nunca detectaron:

**Costos**
5 platillos se venden con margen negativo.
Una totebag de $75 tiene costo de $1,000. Invisible hasta hoy.

**Cadena de suministro**
56 platillos dependen de una flor que cuesta $5.
Un solo proveedor abastece toda la cadena critica de frutas y verduras.

**Revenue**
26 platillos (19.3%) generan el 80% del ingreso.
CHILAQUILES = 17.2% de todas las ventas.

**Calidad de datos**
439 de 615 recetas tienen un solo ingrediente.
81 ingredientes son referencias rotas.
El software anterior nunca lo detecto.

**Esto con un restaurante. Imagina con 100.**

---

## SLIDE 6 — Evidencia de ejecucion

*¿Pueden ejecutar?*

| Que hicimos | Por que importa |
|---|---|
| 903 dias de operacion continua modelados | No es un piloto. Son 2.5 anos de operacion real |
| Cutover completo del sistema lider (8 julio 2026) | Estamos reemplazando al incumbente en produccion |
| Reverse engineering: 211 pantallas, 822 SPs, 97 reportes | Entendemos al lider mejor que sus propios equipos |
| 30 agentes de IA corriendo 24/7 | No es roadmap. Ya esta en produccion |
| 615 recetas + 522 platillos + 202 proveedores migrados | La migracion funciona y es rapida |
| Arquitectura offline-first con sync | Resuelto el problema #1 de software en LATAM |

No estamos pidiendo dinero para construir.
Estamos pidiendo dinero para ganar.

---

## SLIDE 7 — El flywheel

*¿Por que ganan?*

```
        +1 Restaurante
              |
        Mas operaciones
              |
         Mas eventos
              |
       Mejores modelos
              |
    Mejores decisiones
              |
      Mas valor por
        restaurante
              |
     Menor churn, mas
    referidos, mejores
    modelos para el
    siguiente restaurante
              |
        +1 Restaurante
```

**Los datos no son el moat.**
**Las decisiones aprendidas si.**

Cada restaurante alimenta modelos que mejoran las recomendaciones
para todos los demas. Eso no se replica con mas ingenieros.
Se replica con mas restaurantes.

---

## SLIDE 8 — Posicionamiento

*¿Por que no otro POS?*

```
                    Punto de venta  ←————→  Sistema operativo
                          |                      |
   Inteligencia           |                      |
   operativa              |                      |
        ^                 |               ★ FULLSITE
        |                 |
        |                 |
        |                 |
   Registro de            |                      |
   transacciones    [Poster, Clip]      [Wansoft, SoftRestaurant]
        v            (POS basico)         (sistema completo,
                                           tecnologia legacy)
```

Los POS basicos digitalizaron la caja pero no operan el negocio.
Los sistemas completos operan el negocio pero con tecnologia de hace 20 anos.

Nadie ha construido un sistema operativo con inteligencia.

Fullsite no compite con POS. Crea la categoria.

---

## SLIDE 9 — ¿Por que restaurantes?

*¿Por que este mercado?*

Restaurantes son el mejor punto de entrada para inteligencia operativa:

**Alta complejidad.**
Inventario perecedero. Personal que rota cada 3 meses.
Multiples canales (salon, llevar, delivery).
El 35-45% del ingreso se va en insumos.

**Baja sofisticacion.**
90% usa software legacy o no usa nada.
El lider del mercado corre en tecnologia de 2007.

**Alta frecuencia de datos.**
Cientos de transacciones diarias. Compras semanales. Rotacion de personal mensual.
Cada operacion es un evento que alimenta los modelos.

**Alto dolor.**
El dueno promedio no sabe su food cost real.
No sabe que platillos pierden dinero.
No sabe si un mesero esta robando.

**Mexico: 600,000+ restaurantes.**
El mercado donde se construye el playbook antes de escalar.

---

## SLIDE 10 — Por que Daniel

*¿Por que este founder?*

Construi Fullsite porque cada dia veia a los gerentes de mi restaurante
tomar decisiones con informacion que llegaba demasiado tarde.

En lugar de entrevistar restauranteros,
**opere uno.**
AMALAY Coffee & Market. $31M MXN en ventas 2025. 40 empleados.

En lugar de estudiar al lider del mercado,
**lo desmonte pieza por pieza.**
211 pantallas. 822 stored procedures. 150+ endpoints. Todo documentado.

En lugar de hacer un MVP,
**reemplace el sistema completo.**
Cutover en produccion: 8 julio 2026.

En lugar de contratar un equipo,
**construi todo solo.**
POS, KDS, print bridge, 30 agentes IA, dashboard,
arquitectura offline, sync engine, event store.

La combinacion de acceso operativo + obsesion + capacidad tecnica
es lo que hace esto posible.

No conozco a nadie mas que sea dueno de restaurante
e ingeniero de software al mismo tiempo.

---

## SLIDE 11 — Modelo de negocio

*¿Como escala?*

**Entrada → Inteligencia → Red**

**1. Entrada (POS):**
Setup gratuito. Adopcion inmediata. Reemplazo directo del sistema actual.
El POS es la puerta — no el producto.

**2. Inteligencia:**
Food cost en tiempo real. Alertas de fraude. Prediccion de demanda.
Compras sugeridas. El valor que retiene al cliente.
Attach rate target: 80% de la base.

**3. Red (con escala):**
Benchmarks anonimos entre restaurantes del mismo segmento.
Compras grupales (20 restaurantes negociando insumos juntos).
Predicciones cruzadas ("tu zona ve 20% mas trafico este viernes").
Cada restaurante agregado amplifica el valor para todos.

**El modelo expande revenue per customer sin expandir costo de servicio.**

---

## SLIDE 12 — La ronda

*¿Por que invertir hoy?*

**Pre-seed: $500K USD | SAFE post-money**

| Uso | Inversion |
|---|---|
| CTO + primer equipo de ingenieria | $250K |
| Go-to-market Monterrey | $150K |
| Operaciones + legal | $100K |

**Hitos a 12 meses:**
- 50 restaurantes activos en Monterrey
- $200K MXN MRR
- Food cost engine + compras automaticas en produccion
- Aplicacion a YC W27

**Esta ronda se trata de ganar Monterrey
antes de que alguien mas se de cuenta
de que la categoria cambio.**

El cutover del piloto es la proxima semana.
El ex-director comercial del incumbente esta disponible para liderar ventas.
Los primeros 100 restaurantes a migrar ya estan identificados.

Cada mes sin fondeo es un mes que alguien mas puede empezar.

---

## SLIDE 13 — La vision

Hace veinte anos, el software aprendio a registrar transacciones.

La proxima decada sera cuando aprenda a operar negocios.

Creemos que Fullsite sera la empresa que construya esa transicion.

**Every physical business eventually becomes an intelligence business.**

Y nosotros ya empezamos.

---

## SLIDE 14 — Cierre

**FULLSITE**

The Intelligence Layer for Restaurant Operations.

Daniel Ramonfaur
daniel@fullsite.mx
fullsite.mx

---

## APPENDIX — Datos de respaldo

### Operacion del piloto (AMALAY Coffee & Market, Monterrey)

| Periodo | Ventas |
|---------|--------|
| 903 dias modelados | $73.7M MXN |
| 2024 | $27.8M MXN |
| 2025 | $31.1M MXN |
| 2026 (6 meses) | $14.7M MXN |
| Promedio diario | $81,565 MXN |

### Inteligencia generada

| Hallazgo | Detalle |
|---|---|
| Pareto de revenue | 26 platillos (19.3%) = 80% del ingreso |
| Food cost cocina | 24.9% promedio (industria target: 25-35%) |
| Margenes negativos | 5 platillos detectados automaticamente |
| Dependencias criticas | 56 platillos dependen de 1 ingrediente de $5 |
| Riesgo de proveedor | 1 proveedor abastece 40% de ingredientes criticos |
| Calidad de datos | 439/615 recetas incompletas (nunca detectado por legacy) |

### Reverse engineering del incumbente

211 pantallas | 822 stored procedures | 150+ endpoints HTTP | 80+ tablas | 97 reportes exportados | Documentacion completa ("La Biblia de Wansoft", 918 lineas)

### Datos migrados

522 platillos | 615 recetas | 3,000+ productos | 878 costos | 202 proveedores | 114 modificadores | 517 asignaciones | 36 clientes FE | 40 empleados | 903 dias de ventas historicas

### Stack tecnico

Next.js 15 (PWA offline-first) | Supabase (PostgreSQL) | Vercel | Claude API | 30 agentes autonomos | Bridge Node.js ESC/POS | IndexedDB sync engine | Event store append-only
