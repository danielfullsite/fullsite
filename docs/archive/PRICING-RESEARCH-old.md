# Investigacion de Pricing — Fullsite Restaurant OS

**Fecha:** 2026-07-04
**Version:** 2.0 (reemplaza PRICING-FULLSITE.md v1)
**Contexto:** Day 0, AMALAY en vivo. Pre-seed, sin funding. Objetivo: 50 restaurantes en 6 meses.

---

## 1. Benchmark: Como cobran los mejores del mundo

### 1.1 Toast (USA) — El modelo a estudiar

| Plan | Precio/mes | Processing | Hardware |
|---|---|---|---|
| Starter Kit | **$0** | 2.99% + $0.15 | Incluido (1 terminal) |
| Point of Sale | $69 USD | 2.49% + $0.15 | $799-$1,500 |
| Build Your Own | $165+ USD | Negociable | Paquetes custom |

**Dato clave:** Toast genera el **78% de sus ingresos por procesamiento de pagos**, no por software. El plan gratis es un anzuelo para capturar el procesamiento. El software es el costo de adquisicion del cliente.

**Costo real para un restaurante:** $250-$500 USD/mes (cafe 10 mesas), $700-$1,200 USD/mes (full-service 30 mesas).

**Leccion para Fullsite:** Toast puede regalar software porque monetiza payments. Fullsite no tiene procesador de pagos propio, asi que el software ES el producto. No se puede copiar el modelo freemium de Toast.

### 1.2 Square for Restaurants (USA)

| Plan | Precio/mes | Processing |
|---|---|---|
| Free | $0 | 2.6% + $0.15 |
| Plus | $49-$69 USD/loc | 2.6% + $0.15 |
| Premium | $149-$165 USD/loc | Negociable |

**Modelo:** Igual que Toast — subsidian software con pagos. Hardware propio (Square Terminal $299 USD).

### 1.3 Lightspeed Restaurant (USA/Canada)

| Plan | Precio/mes |
|---|---|
| Basic | $69 USD |
| Essential | $189 USD |
| Premium | $399 USD |

**Modelo:** Software puro, mas caro. Processing obligatorio con Lightspeed Payments. Costo real: $300-$800 USD/mes para cafe pequeno.

### 1.4 Poster POS (LatAm/Global)

| Plan | Precio/mes | Productos |
|---|---|---|
| Starter | $14-$16 USD | Hasta 50 |
| Mini | $26-$29 USD | Hasta 100 |
| Business | $44-$49 USD | Hasta 300, KDS, delivery |
| Pro | $62-$69 USD | Hasta 1,500, reservas, control avanzado |

**Extras:** Registro adicional $19, mesero movil $9, sitio delivery $19.

**Modelo:** Software puro, sin procesamiento. Precios accesibles para LatAm. Sin IA.

### 1.5 Clip (Mexico)

| Concepto | Precio |
|---|---|
| Clip Total 3 (terminal) | $899 MXN (unica vez) |
| Clip Stand 2 (todo-en-uno) | $3,999 MXN |
| Comision por venta | 3.6% + IVA |
| Software POS | Incluido con hardware |

**Modelo:** Hardware barato + comision por transaccion. Adquirio Wansoft para agregar funcionalidad de restaurante. No cobra mensualidad de software.

### 1.6 SoftRestaurant (Mexico)

| Plan | Precio/mes |
|---|---|
| Lite (2 nodos) | $500-$811 MXN |
| Professional (10 nodos) | $900-$1,500 MXN |
| Enterprise | Cotizacion |

**Extras:** Instalacion $5,000-$8,000. Soporte telefónico en horario. Sin IA. Sin KDS moderno.

### 1.7 Wansoft (Mexico)

| Concepto | Rango |
|---|---|
| Instalacion | $10,000 MXN |
| Mensualidad | $3,000-$5,000 MXN |
| Soporte | Telefonico, horario limitado |
| Contrato | 12 meses minimo |

**Nota:** Ahora es "Wansoft by Clip" — la adquisicion sugiere que Clip monetizara via processing, no software.

---

## 2. Resumen comparativo global

| Sistema | Mensualidad (MXN equiv.) | Instalacion | IA | Processing propio |
|---|---|---|---|---|
| Toast Starter | $0 | $0 | No | Si (obligatorio) |
| Toast POS | ~$1,200 | $0 | No | Si |
| Square Free | $0 | $0 | No | Si |
| Lightspeed Basic | ~$1,200 | Variable | No | Si |
| Poster Business | ~$800 | $0 | No | No |
| Clip + Wansoft | $0* | $899-$3,999 | No | Si (3.6%) |
| SoftRestaurant Lite | $500-$811 | $5,000-$8,000 | No | No |
| SoftRestaurant Pro | $900-$1,500 | $5,000-$8,000 | No | No |
| Wansoft | $3,000-$5,000 | $10,000 | No | No |
| **Fullsite (propuesta)** | **$1,499-$2,999** | **$0** | **Si (30 agentes)** | **No** |

*Clip no cobra mensualidad de software; cobra comision por transaccion.

---

## 3. Economia de un restaurante mexicano: Que pueden pagar?

### 3.1 Ventas mensuales por segmento

| Segmento | Ventas mensuales | Utilidad neta | Ejemplo |
|---|---|---|---|
| Cafe/taqueria chica | $100K-$250K MXN | $10K-$35K | Taqueria de barrio, cafeteria |
| Restaurante mediano | $300K-$800K MXN | $30K-$80K | AMALAY, casual dining |
| Restaurante grande | $800K-$2M MXN | $80K-$200K | Full-service, ubicacion premium |
| Cadena (por sucursal) | $500K-$1.5M MXN | Variable | Franquicias, multi-location |

**Fuentes:** INEGI/CANIRAC: 96% de restaurantes en Mexico son microempresas (<10 empleados). 500,000 negocios generan $247B MXN anuales = promedio ~$41K MXN/mes por negocio. Pero esto incluye fondas y puestos. Un restaurante formal promedio en Monterrey maneja $300K-$800K/mes.

### 3.2 Gasto en tecnologia

- No existe un benchmark confiable de "% de revenue en tech" para Mexico
- El mercado de software de gestion para restaurantes en Mexico: $100.2M USD (2024), creciendo 20.1% anual hasta $291.5M USD en 2030
- **Regla practica:** Un restaurante mediano en Mexico gasta $2,000-$5,000 MXN/mes en tecnologia (POS + internet + telefono). El POS representa $1,500-$3,000 de eso.
- **Umbral de dolor:** Si el software cuesta mas del 1% de las ventas, el dueno empieza a cuestionar. Para un restaurante de $500K/mes, eso son $5,000 MXN.

### 3.3 Sensibilidad al precio por segmento

| Segmento | Rango aceptable/mes | Sensibilidad | Que valoran |
|---|---|---|---|
| Cafe chico ($100K-$250K) | $500-$1,500 | ALTA | Precio, simplicidad |
| Mediano ($300K-$800K) | $1,500-$3,000 | MEDIA | Funcionalidad, soporte |
| Grande ($800K-$2M) | $3,000-$5,000 | BAJA | Control, reportes, IA |
| Cadena (multi-location) | $4,000-$8,000/suc | BAJA | Centralizacion, datos |

---

## 4. Plan unico vs tiers: Que funciona para Fullsite hoy?

### 4.1 La evidencia

- **37% de SaaS early-stage usan precio fijo** (Kyle Poyar, OpenView Partners) porque cierra mas rapido y genera menos objeciones
- **3-4 tiers es el estandar** para SaaS maduro, pero requiere data sobre comportamiento de uso
- **Error comun en early-stage:** crear tiers basados en suposiciones sin data. Terminas con el 90% de clientes en un plan y los otros dos vacios

### 4.2 Recomendacion: UN SOLO PLAN (por ahora)

**Razon 1 — No tienes data.** No sabes que features usa cada tipo de restaurante. Poner features en un tier "Pro" que todos necesitan te va a obligar a regalar upgrades.

**Razon 2 — Friccion de venta.** Con un plan, el pitch es: "Son $X al mes, incluye todo, instalacion gratis." Con tres planes, el prospect pregunta: "Cual necesito? Que pasa si necesito algo del plan caro?" Eso mata la velocidad del ciclo de venta.

**Razon 3 — Velocidad de instalacion.** Con un plan, Eduardo instala lo mismo en todos lados. No hay decisiones, no hay configuraciones parciales.

**Razon 4 — Psicologia.** "Todo incluido" comunica confianza. "Planes limitados" comunica que te estan escondiendo valor.

### 4.3 Cuando agregar tiers

Despues de 20-30 clientes, cuando tengas data real de:
- Que features se usan vs cuales no
- Que tipo de restaurante genera mas revenue
- Cuantos agentes IA usa cada tipo de cliente
- Tasa de churn por segmento

---

## 5. Freemium vs pagado desde el dia 1

### 5.1 Freemium: NO para Fullsite

| Factor | Freemium | Fullsite |
|---|---|---|
| Conversion rate tipica | 2-5% (B2B SaaS) | Necesitas revenue AHORA |
| Modelo de negocio | Necesitas processing o ads | Solo vendes software |
| Volumen requerido | Miles de usuarios para funcionar | Target: 50 restaurants |
| Soporte | Self-service | White-glove (Eduardo en sitio) |
| Costo marginal | ~$0 por usuario free | $200 MXN/mes en API por usuario |

**Toast y Square pueden dar software gratis porque cobran 2.5-3% de CADA transaccion.** Un restaurante de $500K MXN/mes genera $12,500-$15,000 MXN en comisiones de procesamiento. Fullsite no tiene esa palanca.

**El costo de API de IA ($200 MXN/mes) hace que un usuario gratis sea un costo neto.** No puedes subsidiar.

### 5.2 Free trial: SI, pero corto

- **14 dias gratis** con todas las funcionalidades
- Eduardo instala, capacita, y el restaurante opera 2 semanas sin pagar
- Si no convierte despues de 14 dias, se apaga (o se limita a POS basico sin IA)
- **Conversion esperada de free trial:** 15-25% (vs 2-5% de freemium)

---

## 6. Hardware: Vender, rentar, o que el cliente compre?

### 6.1 Opciones

| Modelo | Pros | Contras |
|---|---|---|
| **Cliente compra** | $0 riesgo, $0 inventario | Friccion en la venta, cliente puede comprar malo |
| **Fullsite vende** | Margen, control de calidad | Inventario, logistica, garantias |
| **Fullsite renta** | Revenue recurrente, baja barrera | Capital inicial, riesgo de dano |
| **BYOD (trae tu propio)** | Cero friccion | Fragmentacion de hardware |

### 6.2 Recomendacion: BYOD + Kit recomendado

**Fase 1 (0-20 clientes):** "Fullsite funciona en cualquier tablet con Chrome. Te damos una lista de hardware recomendado que puedes comprar en Amazon/MercadoLibre."
- Tablet Android 10": $3,000-$5,000 MXN
- Impresora termica USB: $2,500-$4,000 MXN
- Cajon de dinero: $1,500-$2,500 MXN
- **Total estimado para el cliente: $8,000-$12,000 MXN**

**Fase 2 (20+ clientes):** Ofrecer "Kit Fullsite" pre-configurado a $15,000-$18,000 MXN con margen del 30%.

**Fase 3 (100+ clientes):** Hardware as a Service, renta mensual $500-$800 MXN. Financiado por el crecimiento.

**Razon:** No atar capital en inventario de hardware en etapa pre-seed. Cada peso invertido en hardware es un peso que no va a desarrollo o ventas.

---

## 7. Contrato: Mensual vs anual

### 7.1 Recomendacion: Sin contrato (mes a mes)

| Factor | Decision |
|---|---|
| Wansoft obliga 12 meses | **Diferenciador: sin contrato** |
| Restaurantes odian estar atrapados | Reduce la objecion #1 del prospect |
| Confianza | "Si no te gusta, cancelas. Sin letra chica." |
| Churn | Mayor riesgo, pero te obliga a entregar valor real |

### 7.2 Descuento anual (despues de primeros 20 clientes)

- Mes a mes: precio completo
- Pago anual: **11 meses** (1 mes gratis = ~8.3% descuento)
- No ofrecer anual al principio — necesitas validar churn primero
- Cuando sepas que el churn es <5% mensual, el pago anual se vuelve una palanca de cashflow

---

## 8. Psicologia de precios

### 8.1 Anchoring (anclaje)

El cerebro humano no evalua precios en aislamiento; los compara contra una referencia. Efectivo en SaaS: puede aumentar el valor promedio del contrato 15-20% (Simon-Kucher & Partners).

**Aplicacion para Fullsite:**
- En la pagina de precios, mostrar primero cuanto cuesta Wansoft ($5,000/mes + $10,000 instalacion = $15,000 primer mes)
- Luego mostrar Fullsite ($1,499/mes + $0 instalacion)
- El prospect ancla en $15,000 y percibe $1,499 como ganga

### 8.2 Precio charm (terminacion en 9)

- $1,499 se percibe como "mil y pico", no como "mil quinientos"
- $2,999 se percibe como "dos mil y pico", no como "tres mil"
- Funciona en consumer y en SMB. Menos efectivo en enterprise.

### 8.3 Decoy effect (efecto senuelo)

Dan Ariely (MIT): el senuelo redirige al 84% de los consumidores hacia la opcion premium.

**Aplicacion para cuando Fullsite tenga tiers:**
- Plan Basico: $999/mes (solo POS, sin IA — nadie lo quiere)
- Plan Completo: $1,999/mes (todo incluido)
- Plan Enterprise: $3,999/mes (multi-location, SLA dedicado)

El plan Basico sin IA existe solo para hacer que el Completo se vea como el "obvious choice."

**PERO: No usar tiers todavia.** Guardar esta tecnica para cuando haya 30+ clientes y data de uso.

### 8.4 Precio redondo vs preciso

- Para un plan unico: $1,499 MXN/mes (preciso, percibido como calculado cuidadosamente)
- No usar $1,500 (redondo, percibido como arbitrario)

---

## 9. RECOMENDACION FINAL

### El precio: $1,499 MXN/mes (todo incluido)

| Elemento | Detalle |
|---|---|
| **Precio** | $1,499 MXN/mes + IVA |
| **Incluye** | POS, KDS, inventario, recetas, food cost, compras, 30 agentes IA, corte de caja, reportes, soporte 24/7 |
| **Instalacion** | $0 |
| **Migracion de datos** | $0 |
| **Capacitacion** | $0 |
| **Contrato** | Sin contrato, mes a mes |
| **Trial** | 14 dias gratis, full funcionalidad |
| **Hardware** | BYOD (lista de recomendados incluida) |
| **Terminales adicionales** | $499 MXN/mes por terminal extra |

### Por que $1,499 y no $2,500 (el precio anterior)

| Razon | Explicacion |
|---|---|
| **Wansoft cobra $3,000-$5,000** | A $1,499 eres 50-70% mas barato. A $2,500 eres solo 17-50% mas barato. |
| **SoftRestaurant cobra $500-$1,500** | A $1,499 eres competitivo con SR Pro pero con 10x mas features (IA). A $2,500 eres 2x mas caro que SR Pro. |
| **Velocidad de cierre** | $1,499 esta por debajo del umbral de decision del dueno. $2,500 requiere "pensarlo". |
| **Volumen > margen unitario** | 50 clientes a $1,499 = $74,950/mes. 30 clientes a $2,500 = $75,000/mes. Pero 50 clientes te dan mas data, mas testimoniales, y mas defensibilidad. |
| **El AI es el upsell futuro** | $1,499 con IA incluida genera lock-in. Cuando subas precio (o agregues tiers), ya no pueden vivir sin los agentes. |
| **Monterrey es price-conscious** | Incluso restaurantes que facturan $500K/mes regatean. $1,499 no genera "tengo que consultarlo con mi socio." |

### Unit economics a $1,499/mes

| Concepto | Monto |
|---|---|
| Revenue mensual | $1,499 |
| Costo API Claude | -$200 |
| Comision vendedor (10%) | -$150 |
| **Margen mensual** | **$1,149 (76.6%)** |
| **Margen anual por cliente** | **$13,788** |

| Milestone | Revenue mensual | ARR |
|---|---|---|
| 10 clientes | $14,990 | $179,880 |
| 25 clientes | $37,475 | $449,700 |
| 50 clientes | $74,950 | $899,400 (~$50K USD) |
| 100 clientes | $149,900 | $1,798,800 (~$100K USD) |
| 200 clientes | $299,800 | $3,597,600 (~$200K USD) |

### Terminales adicionales: $499/mes

Un restaurante mediano necesita 2-3 terminales. Un grande necesita 4-6.

| Restaurante | Terminales | Mensualidad total |
|---|---|---|
| Cafe chico | 1 | $1,499 |
| Mediano (AMALAY) | 2 | $1,998 |
| Grande | 3 | $2,497 |
| Multi-location (2 suc) | 4 | $2,996 |

Esto sube el ticket promedio a ~$2,000 sin subir el precio base.

---

## 10. Hoja de ruta de pricing

### Fase 1: Lanzamiento (hoy - mes 3, 0-10 clientes)

- **Precio:** $1,499/mes todo incluido
- **Oferta de lanzamiento:** "Primeros 10 restaurantes: precio de fundador garantizado de por vida"
- **Sin contrato.** Sin instalacion. 14 dias gratis.
- **Hardware:** BYOD
- **Objetivo:** 10 clientes, product-market fit, casos de estudio

### Fase 2: Traccion (mes 4-6, 10-30 clientes)

- **Precio nuevo:** $1,799/mes (los fundadores mantienen $1,499)
- **Terminal extra:** $499/mes
- **Pago anual disponible:** 11 meses ($19,789 vs $21,588)
- **Objetivo:** Validar churn, NPS, adoption de IA

### Fase 3: Escala (mes 7-12, 30-100 clientes)

- **Introducir tiers** basados en data real:
  - **Operacion** ($1,499): POS + KDS + corte (sin IA, para los price-conscious)
  - **Inteligente** ($2,499): Todo incluido, 30 agentes IA (el sweetspot)
  - **Cadena** ($3,999/sucursal): Multi-location, API, SLA, onboarding dedicado
- El tier Operacion es el DECOY que hace que Inteligente sea el "obvious choice"
- Los fundadores de Fase 1 quedan en Inteligente a $1,499 para siempre

### Fase 4: Expansion (mes 12+, 100+ clientes)

- Hardware as a Service ($500-$800/mes renta)
- Marketplace de integraciones (delivery, contabilidad, nomina)
- Processing de pagos propio (a la Toast)
- Precio base sube a $1,999-$2,499 con mas features

---

## 11. El pitch de venta (para Eduardo / vendedor)

> "Son $1,499 al mes. Incluye todo: punto de venta, cocina, inventario, recetas, food cost, y 30 agentes de inteligencia artificial que monitorean tu restaurante 24/7.
>
> Instalacion gratis. Te lo configuramos hoy. Traes tus datos de Wansoft y en 24 horas estas operando.
>
> Sin contrato. Si no te gusta, cancelas y ya. Pero nadie ha cancelado, porque una vez que pruebas los agentes de IA, ya no puedes volver atras.
>
> Wansoft te cobra $5,000 al mes mas $10,000 de instalacion. Nosotros: $1,499 y cero instalacion. El primer mes ya te ahorraste $13,500."

---

## 12. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigacion |
|---|---|---|
| $1,499 es demasiado barato, deja dinero en la mesa | MEDIA | Precio de fundador es temporal. Fase 2 sube a $1,799. Terminales extras agregan ARPU. |
| Restaurantes chicos ($100K/mes) no pueden pagar ni $1,499 | BAJA | No es tu ICP. Target: restaurantes de $300K+/mes. Un restaurante de $500K paga 0.3% en tech. |
| Competidores bajan precio | BAJA | Wansoft/SR no tienen IA. Clip no tiene software serio de restaurante. Tu diferenciador no es precio, es IA + $0 instalacion. |
| Costo de API sube | MEDIA | $200/mes hoy. Si sube a $400, el margen baja de 76% a 63%. Sigue saludable. Largo plazo: modelos open-source. |
| Churn alto sin contrato | MEDIA | Invertir en onboarding. Los primeros 14 dias determinan si se quedan. Eduardo en sitio = churn bajo. |

---

## 13. Fuentes

- [Toast POS Pricing & Plans](https://pos.toasttab.com/pricing)
- [Toast Pricing Breakdown 2026 - UpMenu](https://www.upmenu.com/blog/toast-pricing/)
- [How Toast Makes Money - FourWeekMBA](https://fourweekmba.com/how-does-toast-make-money-toast-business-model-in-a-nutshell/)
- [Square for Restaurants Pricing](https://squareup.com/us/en/point-of-sale/restaurants/pricing)
- [Lightspeed Restaurant Pricing](https://www.lightspeedhq.com/pos/restaurant/pricing/)
- [Poster POS Pricing](https://joinposter.com/en/pricing)
- [Clip Mexico - Punto de Venta](https://www.clip.mx/clip-para/alimentos-bebidas/restaurantes)
- [Comisiones Clip 2026](https://atempora.studio/blog/comisiones-clip-2026)
- [SoftRestaurant Precios](https://softrestaurant.com/soft-restaurant-precio)
- [INEGI/CANIRAC - Industria Restaurantera](https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/nueva_estruc/702825199357.pdf)
- [PoloTab - Finanzas para restaurantes Mexico 2026](https://www.polotab.com/blog/finanzas-para-restaurantes-101-guia-practica-2025-mexico)
- [Mexico Restaurant Management Software Market - Grand View Research](https://www.grandviewresearch.com/horizon/outlook/restaurant-management-software-market/mexico)
- [SaaS Freemium Conversion Rates 2026 - First Page Sage](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)
- [SaaS Pricing Models - Paddle](https://www.paddle.com/blog/saas-pricing-models-strategies-fltr)
- [Pricing Psychology Statistics 2026](https://www.shno.co/marketing-statistics/pricing-psychology-statistics)
