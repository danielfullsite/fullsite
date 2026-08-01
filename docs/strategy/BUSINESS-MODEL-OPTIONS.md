# Modelos de Negocio para Fullsite: Analisis Completo

**Fecha:** 4 de julio de 2026
**Proposito:** Mapear TODOS los modelos de ingreso posibles para Fullsite. El due diligence previo identifico correctamente que "solo SaaS tiene ceiling demasiado bajo" y que se necesita SaaS + Payments + Fintech para llegar a $1B. Este documento desglosa cada modelo con numeros, factibilidad, y recomendaciones concretas.

**Dato clave de referencia:** Toast genera $6.15B de revenue anual. De eso, el 81% viene de fintech (pagos + lending), y solo 16% de SaaS. La ratio es 5:1 fintech vs software. Esto no es un accidente -- es la estructura economica de vertical SaaS en restaurantes.

**Fuentes principales:** S-1 de Toast, reportes Q1 2026, a16z "Fintech Scales Vertical SaaS", Fractal Software "Vertical SaaS Fintech Playbook", datos de Clip Mexico, Shopify Capital, Stripe embedded payments.

---

## LECCION #1: LA EVOLUCION ES PREDECIBLE

La trayectoria de vertical SaaS + fintech sigue un patron documentado por a16z y confirmado por Toast, Shopify, Mindbody, y ServiceTitan:

```
Fase 1: SaaS puro (subscripcion)
  |
Fase 2: + Pagos embebidos (2-3% por transaccion)
  |
Fase 3: + Lending (prestamos usando datos operativos)
  |
Fase 4: + Banking / Insurance / Payroll
  |
Fase 5: + Marketplace / GPO / Data
```

**El revenue per user aumenta 2-5x al agregar fintech.** Toast con solo SaaS: ~$6,500/restaurante/ano. Toast con fintech: ~$37,000/restaurante/ano. Esa es la diferencia entre un negocio de $100M y uno de $6B.

---

## MODELO 1: SAAS (SUBSCRIPCION)

### Que es
Cobro mensual fijo por acceso al software: POS, KDS, dashboard, inventario, agentes IA.

### Situacion actual
- Precio: $1,999 MXN/mes (~$100 USD) por sucursal
- Terminal adicional: +$499 MXN/mes
- Sin contrato minimo
- Instalacion, migracion, capacitacion: $0

### Numeros

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| MRR | $100K MXN | $400K MXN | $1.0M MXN | $2.0M MXN |
| ARR | $1.2M MXN | $4.8M MXN | $12M MXN | $24M MXN |
| ARR (USD) | ~$60K | ~$240K | ~$600K | ~$1.2M |

### Analisis brutal
- **Ceiling:** Incluso con 1,000 restaurantes a $1,999/mes, el ARR es $24M MXN (~$1.2M USD). Esto NO justifica valuacion significativa.
- **Margen bruto:** ~80% (hosting, soporte, desarrollo). Excelente como base.
- **Problema fundamental:** $1,999 MXN/mes es ~$100 USD. Toast cobra ~$110 USD/mes SOLO por SaaS, y su SaaS es 16% del ingreso total por restaurante. El SaaS es el gancho, no el negocio.

### Veredicto
**Necesario pero insuficiente.** El SaaS es la cuota de membresía que justifica la relacion. El revenue real viene de lo que haces DESPUES de tener esa relacion.

### Factibilidad: 10/10 (ya existe)
### Timeline: Ya esta
### Riesgo: Presion de precios si competidores bajan
### Fortalece el core: Si -- es el core

---

## MODELO 2: PAGOS EMBEBIDOS (PAYMENT PROCESSING)

### Que es
Procesar todos los pagos con tarjeta del restaurante a traves de Fullsite, cobrando un porcentaje por transaccion (tipicamente 2.5-3.5% en Mexico). El restaurante deja de usar su terminal bancaria independiente y paga a traves de Fullsite.

### Como funciona la economia

| Concepto | Porcentaje |
|---|---|
| Tasa cobrada al restaurante | 2.80% |
| Interchange (pago al banco emisor) | ~1.65% |
| Red (Visa/MC) | ~0.15% |
| Procesador/adquirente (Clip, Stripe, etc.) | ~0.30% |
| **Revenue neto para Fullsite** | **~0.70%** |

Toast retiene ~61 puntos base (0.61%) netos por dolar procesado. En Mexico, con comisiones mas altas, Fullsite podria retener 50-80 puntos base.

### Numeros (asumiendo 65% de ventas son tarjeta)

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Ventas promedio/rest/mes | $500K MXN | $500K MXN | $500K MXN | $500K MXN |
| Ventas tarjeta/rest/mes | $325K MXN | $325K MXN | $325K MXN | $325K MXN |
| GPV mensual total | $16.25M | $65M | $162.5M | $325M |
| Revenue neto (0.65%) | $106K MXN | $423K MXN | $1.06M MXN | $2.11M MXN |
| **ARR pagos** | **$1.27M MXN** | **$5.07M MXN** | **$12.7M MXN** | **$25.3M MXN** |
| **ARR pagos (USD)** | **~$63K** | **~$254K** | **~$635K** | **~$1.27M** |

### Comparacion: SaaS + Pagos combinados

| Escala | ARR SaaS | ARR Pagos | ARR Total | % Pagos |
|---|---|---|---|---|
| 50 rest. | $1.2M MXN | $1.27M MXN | $2.47M MXN | 51% |
| 200 rest. | $4.8M MXN | $5.07M MXN | $9.87M MXN | 51% |
| 1,000 rest. | $24M MXN | $25.3M MXN | $49.3M MXN | 51% |

**A 50 restaurantes, pagos ya duplica el revenue total.**

### Como implementarlo en Mexico

**Opcion A: Partnership con Clip**
- Clip es el procesador dominante en Mexico ($2B valuacion, 1,219 empleados)
- Clip ya tiene licencia IFPE (Institucion de Fondos de Pago Electronico)
- Fullsite integraria la terminal Clip dentro del flujo POS
- Revenue share: Clip paga 20-40% de la comision a Fullsite como referral
- Pros: Rapido (3-6 meses), sin regulacion
- Contras: Revenue share bajo (~0.30-0.50% neto vs 0.65%), dependencia de Clip

**Opcion B: Partnership con Stripe Mexico**
- Stripe tiene operaciones en Mexico desde 2022
- Embedded payments (Stripe Connect) permite a Fullsite ser el "platform" y cada restaurante es un "connected account"
- Fullsite pone la comision, Stripe procesa
- Pros: Control total del pricing, mejor margen, herramientas superiores
- Contras: Stripe Mexico aun tiene limitaciones, onboarding de merchants es mas complejo

**Opcion C: Agregador propio (largo plazo)**
- Requiere licencia de agregador ante CNBV o partnership con banco adquirente
- Fullsite seria como Clip pero solo para restaurantes
- Pros: Maximo margen, control total
- Contras: Requiere capital ($500K-$2M USD), regulacion, compliance, 12-24 meses

**Recomendacion:** Empezar con Clip partnership (3-6 meses). Migrar a Stripe Connect cuando haya 50+ restaurantes. Evaluar procesamiento propio con 500+ restaurantes.

### Factibilidad: 7/10 (requiere partnership, no tecnologia propia)
### Timeline: 6-12 meses para Clip partnership, 12-18 para Stripe
### Riesgo: Medio. Regulatorio es manejable con partnership. Riesgo de que Clip cambie terminos.
### Fortalece el core: SI. Pagos integrados simplifican la experiencia y generan datos para lending.

---

## MODELO 3: LENDING / FINANCIAMIENTO

### Que es
Usar los datos operativos del restaurante (ventas diarias, estacionalidad, ticket promedio, food cost) para ofrecer prestamos de capital de trabajo. El restaurante paga un porcentaje fijo de sus ventas diarias hasta completar el pago.

### Como lo hacen los que ya lo hacen

| Empresa | Monto | Plazo | Costo | Cobranza |
|---|---|---|---|---|
| Toast Capital | $5K-$300K USD | 90-360 dias | Factor rate (no APR) | % de ventas diarias |
| Square Capital | $300-$250K USD | 18 meses max | Factor rate 1.1-1.16 | % de ventas diarias |
| Shopify Capital | $200-$2M USD | Continuo (Capital Flex) | Factor rate variable | % de ventas diarias |

**Shopify entrego $4.2B USD en financiamiento en 2025.** Su ventaja: ven TODA la operacion del merchant, entonces underwrtiting es superior a un banco.

**Toast Capital ha originado ~$1B en prestamos acumulados.** Contribuye $51M en gross profit trimestral (Q1 2026), que es ~16% del gross profit de fintech no-pagos.

### La ventaja de Fullsite
Fullsite ve MAS que un procesador de pagos:
- Ventas diarias por hora, por mesero, por producto
- Food cost en tiempo real
- Patrones de fraude (cancelaciones, descuentos)
- Estacionalidad (887 dias de historia en AMALAY)
- Inventario y relacion con proveedores
- Tips (indicador de calidad de servicio)

Un banco ve estados de cuenta. Clip ve transacciones de tarjeta. Fullsite ve la OPERACION COMPLETA. Esto permite:
1. **Underwriting superior:** Saber que un restaurante tiene food cost de 28% y esta bajando es mejor senal que un estado de cuenta
2. **Menor riesgo:** Cobrar como % de ventas diarias via el POS elimina riesgo de no-pago
3. **Productos diferentes:** Adelanto para inventario de temporada, financiamiento de remodelacion, capital para nueva sucursal

### Numeros (conservadores)

Supuestos: 15% de restaurantes toman un prestamo, monto promedio $150K MXN, factor rate 1.12 (12% costo total), plazo 180 dias.

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Restaurantes que toman prestamo | 8 | 30 | 75 | 150 |
| Monto total prestado | $1.2M MXN | $4.5M MXN | $11.25M MXN | $22.5M MXN |
| Revenue por lending (12% fee) | $144K MXN | $540K MXN | $1.35M MXN | $2.7M MXN |
| **ARR lending** | **$288K MXN** | **$1.08M MXN** | **$2.7M MXN** | **$5.4M MXN** |

**NOTA:** Estos numeros son conservadores. Toast Capital origina $1B+ acumulado con 127K+ restaurantes. El revenue de lending escala con confianza y datos -- los primeros 2 anos son modestos.

### Requisitos
1. **Capital:** Necesitas dinero para prestar. Opciones: (a) fondeo propio (limitado), (b) linea de credito de un banco, (c) fondo de deuda (como Clip hizo con $500M de Morgan Stanley), (d) partnership con SOFOM
2. **Legal:** Operar como SOFOM (Sociedad Financiera de Objeto Multiple) en Mexico, o partnershipearlo
3. **Scoring model:** Algoritmo de underwriting basado en datos del POS (ventas, estacionalidad, trend)
4. **Cobranza:** Automatica via POS -- se retiene % de cada venta

### Factibilidad: 4/10 hoy, 7/10 con 200+ restaurantes
### Timeline: 18-24 meses minimo (regulatorio + capital + producto)
### Riesgo: Alto. Riesgo crediticio real. Necesita capital externo. Regulacion CNBV/CONDUSEF.
### Fortalece el core: MUCHO. Lock-in brutal (no cambias de POS si le debes dinero). 28% de clientes Toast Capital lo usan para flujo de caja.

---

## MODELO 4: SEGUROS (INSURANCE)

### Que es
Ofrecer seguros a restaurantes usando datos operativos para underwriting: seguro contra robo, responsabilidad civil, interrupcion de negocio, seguros de equipo.

### Estado del mercado
- El insurtech en restaurantes es emergente globalmente
- Seguros parametricos (pago automatico basado en triggers predefinidos, ej: si ventas caen 50% por 3 dias = pago automatico) estan creciendo
- En Mexico, no existe ningun POS que ofrezca seguros integrados
- Carriers como HDI, GNP, Chubb podrian ser partners

### Numeros estimados

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Prima promedio/rest/ano | $24K MXN | $24K MXN | $24K MXN | $24K MXN |
| Penetracion (% que compra) | 10% | 15% | 20% | 25% |
| Primas totales | $120K MXN | $720K MXN | $2.4M MXN | $6M MXN |
| Comision Fullsite (15%) | $18K MXN | $108K MXN | $360K MXN | $900K MXN |

### Analisis
- Revenue modesto comparado con pagos o lending
- La ventaja real es **reduccion de churn**: restaurante con seguro via Fullsite es mas sticky
- Datos operativos permiten pricing mas preciso que una aseguradora tradicional
- Modelo parametrico (si tus ventas caen X% por desastre, te pago automaticamente) es diferenciador

### Factibilidad: 3/10 (requiere partnership con aseguradora, regulacion)
### Timeline: 24-36 meses
### Riesgo: Bajo (Fullsite no asume riesgo, solo distribuye)
### Fortalece el core: Neutral a positivo. Agrega valor pero no es diferenciador de venta.

---

## MODELO 5: GRUPO DE COMPRAS (GPO)

### Que es
Agregar el poder de compra de multiples restaurantes para negociar mejores precios con proveedores. Fullsite se lleva una comision sobre el ahorro o sobre el volumen de compra.

### Contexto del mercado
- Los GPOs en foodservice generan ahorros del 10-30% en insumos
- Foodbuy es el GPO mas grande de Norteamerica
- En Mexico no hay un GPO digital para restaurantes independientes
- Las cadenas grandes (Alsea, CMR) tienen sus propios departamentos de compras

### Como funcionaria con Fullsite
1. Fullsite ya tiene datos de inventario y recetas de cada restaurante
2. Sabe que compra cada uno, a que proveedor, a que precio, y cuanto consume
3. Agrega demanda: "50 restaurantes Fullsite necesitan 2 toneladas de pollo/semana"
4. Negocia con distribuidores (Costco Business, Sigma, Lala) mejores precios
5. Revenue: 3-5% de comision sobre el volumen de compras canalizado

### Numeros

Supuesto: restaurante promedio gasta 30% de ventas en insumos = $150K MXN/mes en compras.

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Compras mensuales totales | $7.5M MXN | $30M MXN | $75M MXN | $150M MXN |
| % canalizado via GPO | 20% | 30% | 40% | 50% |
| Volumen GPO mensual | $1.5M MXN | $9M MXN | $30M MXN | $75M MXN |
| Comision Fullsite (4%) | $60K MXN | $360K MXN | $1.2M MXN | $3M MXN |
| **ARR GPO** | **$720K MXN** | **$4.32M MXN** | **$14.4M MXN** | **$36M MXN** |

### Analisis critico
- **A 500+ restaurantes, el GPO genera MAS revenue que SaaS.** Esto no es accidental -- el gasto en insumos es 60x mas grande que el gasto en software.
- El modelo funciona MEJOR con concentracion geografica (todos en Monterrey = mismos distribuidores)
- Requiere equipo de compras/negociacion -- no es solo software
- El valor para el restaurante es inmediato y tangible: "te ahorro $15K/mes en pollo"
- **Este modelo es el mas subestimado de todos.** Es el unico donde Fullsite literalmente pone dinero en el bolsillo del restaurante.

### Factibilidad: 6/10 (requiere masa critica de 50+ restaurantes y equipo de compras)
### Timeline: 12-18 meses (piloto con 20 restaurantes, 3-5 proveedores)
### Riesgo: Medio. Logistica de distribucion, relaciones con proveedores, calidad.
### Fortalece el core: MUCHO. Es la razon #1 por la que un restaurante NO cancelaria Fullsite. El ahorro es visible cada mes.

---

## MODELO 6: MARKETPLACE DE PROVEEDORES

### Que es
Plataforma que conecta restaurantes con proveedores. Los restaurantes hacen pedidos directamente desde Fullsite. Los proveedores pagan por estar en la plataforma o Fullsite cobra comision por transaccion.

### Contexto
- Mercado global de B2B food marketplace proyectado a >$102B para 2030 (CAGR 18%)
- Plataformas como MarketMan, Supy, Tinvio ya hacen esto
- En Mexico, la mayoria de restaurantes piden por WhatsApp o telefono
- No hay un marketplace dominante de proveedores para restaurantes en Mexico

### Diferencia con GPO
| Aspecto | GPO | Marketplace |
|---|---|---|
| Quien negocia | Fullsite | El restaurante (con precios visibles) |
| Revenue model | Comision sobre ahorro | Comision por transaccion o fee al proveedor |
| Requiere volumen | Si (50+) | No (funciona con 10) |
| Complejidad operativa | Alta | Media |
| Control de precio | Fullsite | Mercado |

### Numeros

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Pedidos mensuales/rest | 20 | 20 | 20 | 20 |
| Valor promedio pedido | $8K MXN | $8K MXN | $8K MXN | $8K MXN |
| GMV mensual | $8M MXN | $32M MXN | $80M MXN | $160M MXN |
| Comision (2.5%) | $200K MXN | $800K MXN | $2M MXN | $4M MXN |
| **ARR marketplace** | **$2.4M MXN** | **$9.6M MXN** | **$24M MXN** | **$48M MXN** |

### Factibilidad: 5/10 (requiere integracion con proveedores, que es mas trabajo humano que tecnico)
### Timeline: 12-24 meses
### Riesgo: Medio-alto. Two-sided marketplace es dificil. Proveedores pueden no cooperar.
### Fortalece el core: Si. Simplifica operaciones del restaurante, genera datos de compras.

---

## MODELO 7: HARDWARE AS A SERVICE (HaaS)

### Que es
Fullsite provee el hardware (tablets, impresoras, cajones, lectores) en renta mensual en vez de que el restaurante lo compre. Similar a como Toast vende sus terminales.

### Numeros

| Concepto | Costo Fullsite | Renta mensual | Meses para recuperar |
|---|---|---|---|
| Kit basico (1 terminal) | $10K MXN | $599 MXN | 17 meses |
| Kit completo (2 terminales + KDS) | $18K MXN | $999 MXN | 18 meses |

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| % que renta hardware | 40% | 50% | 60% | 60% |
| Renta promedio/mes | $799 MXN | $799 MXN | $799 MXN | $799 MXN |
| Revenue mensual | $16K MXN | $80K MXN | $240K MXN | $480K MXN |
| **ARR hardware** | **$192K MXN** | **$960K MXN** | **$2.88M MXN** | **$5.76M MXN** |

### Analisis
- Margen bruto bajo (~30-40% despues de depreciacion y reemplazos)
- Requiere capital upfront para inventario de hardware
- Reduce friccion de onboarding (el restaurante no tiene que comprar nada)
- Toast vende hardware a perdida para ganar en pagos -- modelo que funciona solo con pagos activos
- En Mexico, la percepcion de "renta" es complicada -- muchos prefieren comprar

### Factibilidad: 7/10 (es logistica, no tecnologia)
### Timeline: 6-12 meses
### Riesgo: Medio. Capital atado en hardware, riesgo de dano/robo, logistica de soporte.
### Fortalece el core: Neutral. Reduce friccion de entrada pero no diferencia el producto.

---

## MODELO 8: DATA / INTELIGENCIA DE MERCADO

### Que es
Vender datos anonimos y agregados sobre la industria restaurantera: benchmarks de food cost, tendencias de menu, patrones de consumo, indicadores economicos.

### Quien compra esto
- Distribuidores de alimentos (quieren saber que se vende mas)
- Marcas CPG (Coca-Cola, Nestle quieren saber penetracion en restaurantes)
- Aseguradoras (quieren datos de riesgo)
- Gobierno (indicadores economicos)
- Inmobiliarias (datos de trafico y ventas para ubicaciones)
- Consultoras de restaurantes

### Referencia
- Black Box Intelligence cobra $50K-$200K USD/ano por benchmarks de restaurantes
- Datassential es la plataforma #1 de food intelligence
- Toast no monetiza datos directamente (por ahora), pero su S-1 menciona el potencial

### Numeros

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Valor del dataset | Bajo | Medio | Alto | Muy alto |
| Clientes data potenciales | 0 | 2-3 | 5-10 | 10-20 |
| Revenue estimado/ano | $0 | $500K MXN | $2M MXN | $5M MXN |

### Analisis critico
- **No funciona con pocos restaurantes.** 50 restaurantes no es un dataset estadisticamente relevante.
- Requiere 500+ para que los datos tengan valor comercial
- Riesgo reputacional: si los restaurantes se enteran de que vendes sus datos, pierdes confianza
- Requiere consentimiento explicito y cumplimiento de privacidad
- Es revenue de "cereza en el pastel", no motor principal

### Factibilidad: 2/10 hoy, 6/10 con 500+ restaurantes
### Timeline: 24-36 meses (necesita escala primero)
### Riesgo: Medio-alto. Reputacional + regulatorio (proteccion de datos personales en Mexico)
### Fortalece el core: Puede debilitarlo si se maneja mal. Neutral si se hace con consentimiento.

---

## MODELO 9: GESTION DE FRANQUICIAS / MULTI-UNIDAD

### Que es
Herramientas especializadas para operadores de multiples sucursales o franquicias: consolidacion financiera, comparativos entre unidades, estandarizacion de recetas/menus, auditorias remotas.

### Contexto
- FranConnect tiene 1,500+ marcas y 1.3M ubicaciones globalmente
- Restaurant365 domina en multi-unidad en USA
- En Mexico: Grupo Galeria (Pampas, Sonora Grill, etc.), Alsea (Dominos, Starbucks MX), CMR
- Ningun competidor mexicano ofrece multi-tenancy real con IA

### Numeros

Precio premium por multi-unidad: $3,999-$7,999 MXN/mes por grupo (no por sucursal) + $999/sucursal.

| Metrica | 5 grupos | 15 grupos | 30 grupos | 50 grupos |
|---|---|---|---|---|
| Sucursales promedio/grupo | 4 | 5 | 6 | 8 |
| Total sucursales | 20 | 75 | 180 | 400 |
| Revenue SaaS/grupo/mes | $8K MXN | $9K MXN | $10K MXN | $12K MXN |
| **ARR franquicias** | **$480K MXN** | **$1.62M MXN** | **$3.6M MXN** | **$7.2M MXN** |

### Analisis
- ARPU mas alto que restaurante individual
- Ciclo de venta mas largo (6-12 meses vs 2-4 semanas)
- Requiere features enterprise: SSO, roles complejos, APIs, consolidacion
- Un solo grupo con 20 sucursales = 20 restaurantes individuales en revenue
- Eduardo tiene relaciones en este segmento (Grupo Galeria, noreste)

### Factibilidad: 5/10 (producto base existe, faltan features enterprise)
### Timeline: 12-18 meses para feature parity enterprise
### Riesgo: Bajo-medio. Ciclo de venta largo pero deals grandes.
### Fortalece el core: Si. Cadenas son los mejores case studies y generan volumen para GPO/pagos.

---

## MODELO 10: ADVERTISING / PROVEEDORES PATROCINADOS

### Que es
Proveedores pagan para ser recomendados dentro de Fullsite cuando un restaurante hace pedidos o busca nuevos proveedores. Similar al modelo de advertising de Amazon dentro de su marketplace.

### Numeros

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Proveedores que pagan | 3 | 10 | 25 | 50 |
| Fee promedio/proveedor/mes | $5K MXN | $8K MXN | $10K MXN | $12K MXN |
| **ARR advertising** | **$180K MXN** | **$960K MXN** | **$3M MXN** | **$7.2M MXN** |

### Analisis
- Solo funciona si Fullsite tiene marketplace de proveedores (Modelo 6)
- Riesgo de conflicto de interes: si recomiendas al que paga mas, pierdes confianza
- Revenue moderado pero de alto margen (100% margen bruto)
- En Mexico, distribuidores grandes (Sysco/Sigma/Lala) tienen presupuesto de trade marketing

### Factibilidad: 3/10 (requiere marketplace activo primero)
### Timeline: 24-36 meses
### Riesgo: Medio. Conflicto de interes percibido.
### Fortalece el core: Puede debilitarlo si se hace mal. Neutral si hay transparencia.

---

## MODELO 11: STAFFING / MARKETPLACE DE PERSONAL

### Que es
Marketplace que conecta restaurantes con trabajadores temporales o de tiempo completo. El restaurante necesita un mesero extra para un evento de fin de semana y lo consigue via Fullsite.

### Contexto
- Instawork tiene 9M+ trabajadores verificados, valuado en $760M
- En Mexico, la rotacion de personal en restaurantes es ~80% anual
- No hay un "Instawork" para Mexico
- El 85% de duenos de restaurantes en USA reportan problemas de staffing

### Numeros

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| % que usa staffing | 15% | 20% | 25% | 30% |
| Turnos/mes por restaurant activo | 4 | 6 | 8 | 10 |
| Comision por turno | $200 MXN | $200 MXN | $200 MXN | $200 MXN |
| Revenue mensual | $6K MXN | $48K MXN | $200K MXN | $600K MXN |
| **ARR staffing** | **$72K MXN** | **$576K MXN** | **$2.4M MXN** | **$7.2M MXN** |

### Analisis
- Two-sided marketplace = dificil de arrancar
- En Mexico, el mercado informal compite (personal que llega por WhatsApp, "tengo un primo")
- Requiere verificacion de antecedentes, manejo de nomina, seguros
- Fullsite ya tiene datos de horarios pico = sabe CUANDO necesitan personal
- Podria integrar con IMSS/nomina (complejidad regulatoria alta)

### Factibilidad: 3/10 (es un negocio completamente diferente)
### Timeline: 24-36 meses
### Riesgo: Alto. Es un negocio aparte, distrae del core.
### Fortalece el core: Debil. No tiene sinergia directa con POS.

---

## MODELO 12: CAPACITACION / CERTIFICACION

### Que es
Cursos de gestion restaurantera powered by IA: food cost, operaciones, servicio, marketing. Certificaciones que validan competencia. Fullsite tiene los datos para personalizar el aprendizaje.

### Numeros

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| % que compra cursos | 20% | 25% | 30% | 35% |
| Precio promedio/curso | $2K MXN | $2K MXN | $3K MXN | $3K MXN |
| Cursos/ano por comprador | 2 | 3 | 3 | 4 |
| **ARR capacitacion** | **$40K MXN** | **$300K MXN** | **$1.35M MXN** | **$4.2M MXN** |

### Factibilidad: 6/10 (el contenido sale de los datos y la experiencia)
### Timeline: 6-12 meses para primer curso
### Riesgo: Bajo. Costo de produccion bajo, no distrae del core.
### Fortalece el core: Si. Restaurantes mejor capacitados usan mejor el producto y tienen menos churn.

---

## MODELO 13: PAYROLL / NOMINA INTEGRADA

### Que es (bonus -- no solicitado pero critico)
Procesar la nomina de los empleados del restaurante directamente desde Fullsite. Fullsite ya tiene datos de horas trabajadas, propinas, horarios. Integracion con IMSS, SAT, FONACOT.

### Referencia
- Gusto (USA) tiene embedded payroll para SaaS platforms
- En Mexico, la nomina es compleja (IMSS, ISR, aguinaldo, vacaciones, PTU)
- Ningun POS mexicano ofrece nomina integrada
- Servicios de nomina cuestan $50-$200 MXN/empleado/mes

### Numeros

| Metrica | 50 rest. | 200 rest. | 500 rest. | 1,000 rest. |
|---|---|---|---|---|
| Empleados promedio/rest | 15 | 18 | 20 | 22 |
| Total empleados | 750 | 3,600 | 10,000 | 22,000 |
| % que usa nomina Fullsite | 20% | 30% | 40% | 50% |
| Fee/empleado/mes | $80 MXN | $80 MXN | $70 MXN | $60 MXN |
| Revenue mensual | $12K MXN | $86.4K MXN | $280K MXN | $660K MXN |
| **ARR nomina** | **$144K MXN** | **$1.04M MXN** | **$3.36M MXN** | **$7.92M MXN** |

### Factibilidad: 4/10 (regulacion laboral mexicana es compleja)
### Timeline: 18-24 meses (partnership con procesador de nomina o desarrollo propio)
### Riesgo: Medio. Errores en nomina generan problemas legales severos.
### Fortalece el core: MUCHO. Es la ultima pieza del "sistema operativo del restaurante".

---

## TABLA COMPARATIVA: TODOS LOS MODELOS

| # | Modelo | ARR @ 50 rest. | ARR @ 200 rest. | ARR @ 1,000 rest. | Factibilidad | Timeline | Fortalece core |
|---|---|---|---|---|---|---|---|
| 1 | SaaS | $1.2M MXN | $4.8M MXN | $24M MXN | 10/10 | Ya existe | Si (es el core) |
| 2 | Pagos | $1.27M MXN | $5.07M MXN | $25.3M MXN | 7/10 | 6-12 meses | Si |
| 3 | Lending | $288K MXN | $1.08M MXN | $5.4M MXN | 4/10 | 18-24 meses | Mucho |
| 4 | Seguros | $18K MXN | $108K MXN | $900K MXN | 3/10 | 24-36 meses | Neutral |
| 5 | GPO | $720K MXN | $4.32M MXN | $36M MXN | 6/10 | 12-18 meses | Mucho |
| 6 | Marketplace | $2.4M MXN | $9.6M MXN | $48M MXN | 5/10 | 12-24 meses | Si |
| 7 | Hardware | $192K MXN | $960K MXN | $5.76M MXN | 7/10 | 6-12 meses | Neutral |
| 8 | Data | $0 | $500K MXN | $5M MXN | 2/10 | 24-36 meses | Puede debilitar |
| 9 | Franquicias | $480K MXN | $1.62M MXN | $7.2M MXN | 5/10 | 12-18 meses | Si |
| 10 | Advertising | $180K MXN | $960K MXN | $7.2M MXN | 3/10 | 24-36 meses | Puede debilitar |
| 11 | Staffing | $72K MXN | $576K MXN | $7.2M MXN | 3/10 | 24-36 meses | Debil |
| 12 | Capacitacion | $40K MXN | $300K MXN | $4.2M MXN | 6/10 | 6-12 meses | Si |
| 13 | Nomina | $144K MXN | $1.04M MXN | $7.92M MXN | 4/10 | 18-24 meses | Mucho |

---

## REVENUE MIX RECOMENDADO POR FASE

### FASE 1: 50 Restaurantes (Meses 0-18)

| Modelo | % del Revenue | ARR estimado | Status |
|---|---|---|---|
| SaaS | 55% | $1.2M MXN | Activo |
| Pagos (Clip partnership) | 35% | $760K MXN | En desarrollo |
| Hardware (renta opcional) | 5% | $100K MXN | Piloto |
| Capacitacion | 5% | $100K MXN | Contenido basico |
| **Total** | **100%** | **$2.16M MXN** | |
| **Total USD** | | **~$108K** | |

**Prioridad:** Cerrar los primeros 50 restaurantes con SaaS. En paralelo, integrar pagos con Clip. No distraerse con nada mas.

### FASE 2: 200 Restaurantes (Meses 18-30)

| Modelo | % del Revenue | ARR estimado | Status |
|---|---|---|---|
| SaaS | 30% | $4.8M MXN | Creciendo |
| Pagos | 32% | $5.07M MXN | Partnership activo |
| GPO (piloto) | 20% | $3.2M MXN | 50 restaurantes en GPO |
| Lending (piloto) | 5% | $800K MXN | Primeros prestamos |
| Hardware | 5% | $800K MXN | Renta disponible |
| Franquicias | 5% | $800K MXN | 3-5 grupos |
| Capacitacion + otros | 3% | $480K MXN | Cursos + certificacion |
| **Total** | **100%** | **$15.96M MXN** | |
| **Total USD** | | **~$798K** | |

**Prioridad:** Escalar pagos. Lanzar GPO con primeros proveedores. Empezar lending con capital propio o SOFOM partner.

### FASE 3: 500 Restaurantes (Meses 30-42)

| Modelo | % del Revenue | ARR estimado | Status |
|---|---|---|---|
| SaaS | 18% | $12M MXN | Base |
| Pagos (Stripe Connect) | 28% | $18.5M MXN | Migracion a Stripe |
| GPO | 22% | $14.4M MXN | 200+ en GPO |
| Marketplace | 15% | $10M MXN | Proveedores activos |
| Lending | 7% | $4.5M MXN | Creciendo |
| Franquicias | 5% | $3.3M MXN | 10+ grupos |
| Nomina | 3% | $2M MXN | Lanzamiento |
| Otros | 2% | $1.3M MXN | HaaS, capacitacion |
| **Total** | **100%** | **$66M MXN** | |
| **Total USD** | | **~$3.3M** | |

### FASE 4: 1,000 Restaurantes (Meses 42-60)

| Modelo | % del Revenue | ARR estimado | Status |
|---|---|---|---|
| SaaS | 12% | $24M MXN | Base estable |
| Pagos | 25% | $50M MXN | Procesamiento propio? |
| GPO / Marketplace | 30% | $60M MXN | Motor principal |
| Lending | 10% | $20M MXN | Escala |
| Nomina | 8% | $16M MXN | Penetracion creciente |
| Franquicias | 7% | $14M MXN | 30+ grupos |
| Otros (seguros, data, ads) | 8% | $16M MXN | Diversificado |
| **Total** | **100%** | **$200M MXN** | |
| **Total USD** | | **~$10M** | |

---

## EL CAMINO A $1B DE VALUACION

### La matematica

Para valer $1B USD ($20B MXN) con un multiplo de 10x revenue (growth stage fintech):
- Necesitas $100M USD ($2B MXN) de ARR
- O $50M USD de ARR con 50%+ crecimiento anual (multiplo 20x)

### El escenario realista

Con el mix de revenue completo (SaaS + Pagos + GPO + Marketplace + Lending + Nomina):

| Escala | ARR/restaurante | ARR total | Multiplo | Valuacion |
|---|---|---|---|---|
| 1,000 rest. MX | $200K MXN/ano | $200M MXN (~$10M USD) | 10x | $100M USD |
| 5,000 rest. MX+LATAM | $250K MXN/ano | $1.25B MXN (~$62.5M USD) | 12x | $750M USD |
| 10,000 rest. MX+LATAM | $300K MXN/ano | $3B MXN (~$150M USD) | 10x | $1.5B USD |

**Conclusion:** $1B es alcanzable con 7,000-10,000 restaurantes en Mexico + LATAM con revenue mix completo. Con solo SaaS, necesitarias 50,000+ restaurantes -- imposible en el mercado mexicano.

### Comparacion con Toast

| Metrica | Toast (2026) | Fullsite target (5 anos) |
|---|---|---|
| Restaurantes | 127,000+ | 5,000-10,000 |
| ARR/restaurante | ~$48K USD | ~$12.5K USD |
| Revenue total | $6.5B USD | $50-150M USD |
| % SaaS | 16% | 12-18% |
| % Fintech | 81% | 25-35% |
| % Supply chain (GPO+Marketplace) | 3% | 30% |

**Fullsite NO puede ser Toast.** Toast opera en USA con 80% de revenue de pagos. En Mexico, la penetracion de tarjeta es mucho menor (14% de merchants aceptan tarjeta vs 80%+ en USA). El camino de Fullsite pasa mas por supply chain (GPO + Marketplace) que por pagos. Esta es la tesis diferenciadora.

---

## LOS 3 MODELOS QUE CAMBIAN TODO

Si tuviera que elegir SOLO 3 modelos adicionales al SaaS base, en orden de impacto:

### 1. PAGOS EMBEBIDOS (Prioridad inmediata)
- Porque: Duplica revenue, datos para lending, lock-in
- Como: Partnership con Clip en 6 meses
- Costo: Bajo (integracion tecnica)
- Revenue: $1.27M MXN/ano con 50 restaurantes

### 2. GPO / GRUPO DE COMPRAS (Diferenciador unico)
- Porque: Pone dinero en el bolsillo del restaurante. Nadie mas lo ofrece. Genera lealtad brutal.
- Como: Equipo de 1-2 personas de compras, empezar con pollo, lacteos, bebidas
- Costo: Medio (equipo + relaciones)
- Revenue: $4.32M MXN/ano con 200 restaurantes
- **Este es el modelo que ningun competidor mexicano esta persiguiendo.**

### 3. LENDING (Motor de crecimiento a largo plazo)
- Porque: Datos operativos = mejor underwriting que cualquier banco. Lock-in maximo.
- Como: SOFOM partnership, capital de deuda
- Costo: Alto (regulatorio + capital)
- Revenue: $5.4M MXN/ano con 1,000 restaurantes

---

## SIGUIENTE ACCION CONCRETA

| Prioridad | Accion | Responsable | Deadline |
|---|---|---|---|
| P0 | Cerrar primeros 10 restaurantes SaaS | Daniel + Eduardo | Agosto 2026 |
| P1 | Reunirse con Clip para explorar partnership de pagos | Daniel | Agosto 2026 |
| P1 | Mapear 5 proveedores principales de restaurantes en Monterrey | Eduardo | Agosto 2026 |
| P2 | Investigar requisitos SOFOM o partnership con SOFOM existente | Daniel | Septiembre 2026 |
| P2 | Disenar primer curso de capacitacion (food cost management) | Daniel | Septiembre 2026 |
| P3 | Crear feature de comparativo de precios de proveedores en dashboard | Desarrollo | Q4 2026 |

---

## APENDICE: TIPO DE AFIRMACION DE CADA CONCLUSION

| Conclusion | Tipo |
|---|---|
| Toast genera 81% de revenue de fintech | HECHO (SEC filing) |
| Revenue per user 2-5x con fintech | HECHO (a16z, datos publicos) |
| Pagos duplicarian revenue de Fullsite | INFERENCIA (basada en datos de mercado MX) |
| GPO puede generar mas que SaaS | INFERENCIA (basada en unit economics de compras) |
| Clip partnership es viable en 6 meses | HIPOTESIS (no hay conversacion con Clip) |
| 1,000 restaurantes en 5 anos es alcanzable | HIPOTESIS (no hay datos de velocidad de venta) |
| GPO es el modelo mas subestimado | INFERENCIA (basada en estructura de costos) |
| $1B requiere 7-10K restaurantes con mix | INFERENCIA (matematica de multiplos) |
| Supply chain > pagos para Mexico | HIPOTESIS (basada en baja penetracion de tarjeta) |

---

*Documento creado: 4 de julio de 2026*
*Fuentes: SEC filings Toast (Q1 2026), a16z "Fintech Scales Vertical SaaS", Fractal Software, Stripe, Shopify Capital reports, CNBV Mexico, Clip public data, Foodbuy GPO, Black Box Intelligence*
