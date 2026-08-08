# COMPETITIVE MOAT MAP
> Análisis estructural de competidores vs Fullsite.
> **Fecha:** 2026-08-05
> **Versión:** 1.0 — Para revisión del Founder.
>
> **Clasificación de evidencia:**
> - FACT: URL pública o documento verificable
> - INFERENCE: Razonamiento de product category, no documento directo
> - HYPOTHESIS: Creencia no verificada
> - UNKNOWN: Sin información confiable disponible

---

## Framework de análisis

Para cada competidor:
- Qué controla (datos que origina)
- Qué solo consume (datos de terceros)
- Qué puede ejecutar (acciones reales en el negocio)
- Qué puede medir (resultados reales)
- Dependencia de internet
- Dependencia de hardware
- Dependencia de integraciones
- Cuál es su wedge de entrada
- Cuál podría ser su moat
- Dónde Fullsite puede construir ventaja estructural

---

## 1. Toast

**País:** USA. **Categoría:** POS + payments + hardware.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Qué controla | Toda la transacción: hardware → POS → payments → cloud | FACT: toast.com/pricing |
| Datos que origina | Cada orden, cada pago, cada item vendido | FACT |
| Datos que solo consume | Inventory via integraciones (Crunchtime, Restaurant365) | FACT: toast.com/integrations |
| Qué puede ejecutar | Cobrar, imprimir, enviar a cocina, scheduling básico | FACT |
| Qué puede medir | Ventas, ticket promedio, labor cost (con scheduling add-on) | FACT |
| Offline | Modo limitado para pagos. Full offline NOT SUPPORTED | FACT: toast.com/resources offline mode documentation |
| Dependencia de hardware | CRÍTICA: Toast Go handhelds, $799+ por terminal | FACT: toast.com/hardware |
| Dependencia de internet | Alta: cloud-first architecture | FACT |
| Dependencia de integraciones | Media: marketplace de 200+ integraciones para inventory/accounting | FACT |
| Presencia en México | NO | FACT: no operations MX |
| Pricing | $0/mes (básico) + $0.15 + 2.49%/transacción | FACT |

**Wedge:** Hardware ecosystem. Una vez instalado Toast Go, cambiar = reemplazar hardware.

**Moat real:**
- Hardware sunk cost
- Payment processing margin (0.15% + fee en cada transacción = recurring revenue sin esfuerzo)
- Data network effects: 100K+ restaurantes → patrones de industria

**Debilidades estructurales:**
- No opera en México (FACT)
- Offline limitado: internet cortado = operación degradada (FACT)
- Hardware costoso elimina SME del mercado objetivo
- Full P&L requiere pagar R365 + Toast + scheduling = 3 plataformas

**Ventaja Fullsite vs Toast:** México (absent), offline-first, cero hardware, full-stack sin integración tax.

---

## 2. Restaurant365

**País:** USA. **Categoría:** Accounting/ERP para restaurantes.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Qué controla | Contabilidad, P&L, inventory, labor scheduling | FACT: r365.com/features |
| Datos que origina | Contabilidad, payroll, POs — PERO depende de POS para transacciones | FACT: r365.com/integrations |
| Datos que solo consume | Ventas, órdenes (via POS integración) | FACT |
| Qué puede ejecutar | Aprobación de POs, generación de reportes financieros | FACT |
| Qué puede medir | P&L completo, prime cost, contribution margin | FACT |
| Offline | NO — cloud-only SaaS | FACT |
| Dependencia de hardware | Ninguna | FACT |
| Dependencia de integraciones | CRÍTICA: requiere Toast/Square/POS para datos de ventas | FACT |
| Presencia en México | NO | FACT |
| Pricing | $249-$459/mes + POS add-on | INFERENCE (precios no públicos directamente) |

**Wedge:** Chart of accounts para restaurantes. Una vez que la contabilidad está en R365, cambiar = re-mapear todo el COA.

**Moat real:**
- Switching cost contable (COA, historial financiero)
- No tienen POS = nunca compiten directamente con POS players
- Integran con cualquier POS = son el "backend" de la industria

**Debilidades estructurales:**
- Completamente dependiente de POS para datos operativos
- Cloud-only: no apto para mercados con internet inestable
- Requiere contador que sepa usar el sistema (no operador)
- No tiene operations control = no puede detectar fraude en tiempo real

**Ventaja Fullsite vs R365:** Fullsite origina los datos de ventas (no los consume). Fullsite puede construir P&L sin necesitar R365, con datos propios.

---

## 3. Marble / Truffle

**País:** USA (New York). **Categoría:** Restaurant AI analytics. **Funding:** YC S26.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Funding | YC S26 | FACT: YC company directory |
| Sede reportada | Nueva York | FACT: materiales públicos de la compañía |
| Enfoque declarado | AI-native para back-of-house (scheduling, ordering, ops) | FACT: claims públicos de la compañía |
| Datos que origina | UNKNOWN — no documentado públicamente | UNKNOWN |
| Qué puede ejecutar | Claims de producto publicados por la propia compañía | FACT (claims propios, no verificado independientemente) |
| Qué puede medir | Claims de resultados publicados por la propia compañía | FACT (claims propios) |
| Offline | NO PUBLIC EVIDENCE FOUND DURING THIS REVIEW | — |
| Presencia en México | No current public evidence of Mexico market presence found during this review | — |

**Nota metodológica:** No extrapolar más allá de lo publicado. Marble/Truffle es una compañía en etapa temprana (YC S26). Capacidades exactas, arquitectura y métricas de clientes no están independientemente verificadas.

**Wedge declarado:** AI insights para restaurantes (claim de la propia compañía).

**Moat potencial (INFERENCE):** Si acumulan datos de múltiples restaurantes → network effect de datos. No verificado.

**Análisis estructural (INFERENCE):**
Los productos que no originan eventos operativos dependen de integraciones para sus datos. Sin POS propio, la calidad del análisis depende de la calidad y completitud del POS del cliente. Esta es una desventaja estructural, no necesariamente insuperable.

---

## 4. Nory

**País:** UK/Irlanda. **Categoría:** Restaurant intelligence + scheduling.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Qué controla | Scheduling, demand forecasting, analytics | FACT: nory.ai/features |
| Datos que origina | Schedules, labor costs | FACT |
| Datos que solo consume | Ventas (via Square, Lightspeed, etc.) | FACT: nory.ai/integrations |
| Qué puede ejecutar | Generar schedules optimizados, alertas | FACT |
| Qué puede medir | Labor cost vs forecast, productividad | FACT |
| Offline | NO | FACT |
| Dependencia de integraciones | Alta: requiere POS para ventas | FACT |
| Presencia en México | NO — UK/Irlanda focused | FACT |

**Wedge:** Demand forecasting + labor scheduling combinados. Primero en UK market que conecta ambas.

**Moat:** Scheduling workflow adoption. Una vez que el gerente hace el schedule en Nory, cambiar = reaprender proceso.

**Debilidades estructurales:**
- UK/Irlanda únicamente → mercado geográfico limitado
- Sin datos de transacciones propios
- Sin operations control

**Ventaja Fullsite vs Nory:** Fullsite tiene datos de ventas propios (no via integración). La oportunidad geográfica de México es inaccesible para Nory sin expansión activa.

---

## 5. Supy

**País:** UAE/MENA. **Categoría:** Inventory + purchasing management.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Qué controla | Inventario, recetas, órdenes de compra, proveedores | FACT: supy.io/features |
| Datos que origina | Counts físicos, POs, recetas propias | FACT |
| Datos que solo consume | Ventas (via POS integración para consumption tracking) | FACT |
| Qué puede ejecutar | Generar POs, alertas de stockout | FACT |
| Qué puede medir | Food cost actual vs teórico, variance | FACT |
| Offline | UNKNOWN | UNKNOWN |
| Dependencia de integraciones | Media: funciona parcialmente sin POS (manual counts) | INFERENCE |
| Presencia en México | NO — MENA focused | FACT |

**Wedge:** Inventory management con yield factor y subrecetas. Soluciona el problema más doloroso de cadenas de restaurantes: "¿qué se pierde?"

**Moat potencial:** Relaciones con proveedores. Si Supy conecta directamente con distribuidores, el valor de cambiar aumenta.

**Debilidades estructurales:**
- Sin operations control (no POS)
- MENA focused → México inaccesible sin expansión
- Sin datos de ventas propios → food cost teórico puede diferir del real

**Ventaja Fullsite vs Supy:** Fullsite tiene datos de ventas reales (consumption tracking exacto, no estimado). En México, no hay competencia de Supy.

---

## 6. Tenzo

**País:** UK. **Categoría:** Restaurant analytics y reporting.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Qué controla | Dashboard multi-marca, scheduling (Rota) | FACT: tenzo.io |
| Datos que origina | Ninguno operativo — todo via API | FACT |
| Datos que solo consume | Ventas, labor (via POS + scheduling integración) | FACT |
| Qué puede ejecutar | Reportes, alertas, schedule | FACT |
| Qué puede medir | KPIs vs targets, trends | FACT |
| Offline | NO APLICA | FACT |
| Dependencia de integraciones | TOTAL | FACT |
| Presencia en México | NO | FACT |

**Wedge:** Multi-brand visibility. Grupos de restaurantes con múltiples marcas y locations pueden ver todo en un dashboard.

**Moat:** Enterprise relationships con grupos de restaurantes. Una vez integrado en 50 locations, cambiar = proyecto de TI grande.

**Debilidades:** Sin datos propios. Sin Mexico. Sin offline. Sin operations control.

**Ventaja Fullsite vs Tenzo:** Fullsite en México sin competencia de Tenzo. Datos propios.

---

## 7. Wansoft

**País:** México. **Categoría:** Full-stack POS legacy.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Qué controla | POS, KDS, impresión, inventario, recetas, nómina básica, CFDI | FACT: encuesta interna, Eduardo interview, reverse engineering NetSilver |
| Datos que origina | TODO — SQL Server local es la única fuente de verdad | FACT: TeamViewer access, WANSOFT_LESSONS.md |
| Datos que solo consume | Clima, tipos de cambio (UNKNOWN si los integra) | UNKNOWN |
| Qué puede ejecutar | Cobrar, imprimir, inventario, reportes | FACT |
| Qué puede medir | Ventas, food cost, inventario, nómina básica | FACT |
| Offline | TOTAL — SQL Server on-premise, sin dependencia de internet | FACT: operación confirmada sin internet en AMALAY |
| Dependencia de hardware | Media: Windows PC requerido, no mobile | FACT |
| Dependencia de integraciones | Baja: autosuficiente | FACT |
| Presencia en México | FUERTE: 1,500+ clientes, 20+ años | FACT: Eduardo interview |
| Pricing AMALAY (cotización directa) | Hardware: $130,466 MXN antes IVA / Renta: $1,500 MXN/mes / Total inmediato c/IVA: $154,580.45 MXN | FACT: cotización documentada AMALAY |
| Pricing mercado general | ~$2,800+IVA/mes renta / $23K+ consultoría / $1,160/hr soporte | FACT: encuesta, Eduardo interview |
| AI/Agents | NINGUNO | FACT |
| Mobile | NINGUNO | FACT |
| Cloud | NINGUNO | FACT |

**Wedge:** Data lock-in. SQL Server NetSilver es la única fuente de verdad. Todos los datos históricos están ahí. Cambiar = perder historial o migrar manualmente.

**Moat real:**
- 20 años de datos históricos en SQL Server → irreemplazable para el restaurantero (FACT)
- Relationships con cadenas medianas — 350+ clientes, crecimiento post-Clip (FACT: Eduardo interview)
- Conocimiento profundo del mercado México (CFDI, IEPS, SAT) (FACT)
- Costo inicial conocido y presupuestado — aunque elevado, el cliente sabe qué pagar (FACT: cotización AMALAY $154K con IVA)

**Debilidades estructurales:**
- Windows desktop únicamente: sin mobile, sin tablet nativa, sin cloud
- Precio oculto: $23K consultoría + $1,160/hr soporte (FACT)
- Sin AI, sin intelligence, sin agentes
- UI de los años 90 (FACT: screenshots internos)
- Sin alertas proactivas, sin detección de anomalías, sin forecasting
- Soporte deficiente post-adquisición por Clip (Eduardo interview: "están perdiendo clientes")

**Donde Wansoft gana HOY:**
- Offline 100% (Fullsite aún no CERTIFIED)
- CFDI completo con todos los regímenes (Fullsite bloqueado en SAT)
- Inventario con almacenes múltiples (Fullsite no tiene inventario propio)
- Market share México (1,500+ clientes)
- Soporte con equipo dedicado

**Ventaja Fullsite vs Wansoft:**
- Mobile-first: tablet y cualquier dispositivo (FACT — operación real AMALAY)
- AI/agentes: Wansoft tiene CERO publicado (FACT)
- Cloud + offline: Wansoft es solo offline (FACT)
- Sin consultoría obligatoria de implementación (HYPOTHESIS — no validado con cliente externo)
- Pricing: Fullsite = UNKNOWN/HYPOTHESIS vs Wansoft cotización AMALAY $154K con IVA (FACT)
- Datos en tiempo real vs end-of-day de Wansoft (FACT — arquitectura documentada)

---

## 8. Parrot

**País:** México. **Categoría:** POS + delivery integrations.

| Dimensión | Estado | Evidencia |
|---|---|---|
| Integración Uber Eats | Recepción, impresión y seguimiento de órdenes de delivery | FACT: documentación pública Parrot |
| Integración Rappi | Recepción, impresión y seguimiento de órdenes de delivery | FACT: documentación pública Parrot |
| Integración DiDi Food | Recepción, impresión y seguimiento de órdenes de delivery | FACT: documentación pública Parrot |
| Datos que origina | UNKNOWN — no documentado con suficiente detalle en materiales públicos | UNKNOWN |
| Offline | NO PUBLIC EVIDENCE FOUND DURING THIS REVIEW | — |
| AI/Agents | NO PUBLIC EVIDENCE FOUND DURING THIS REVIEW | — |
| Presencia en México | Activa — cliente base no verificada independientemente | INFERENCE |
| Plataforma (Android/iOS/web) | NO PUBLIC EVIDENCE FOUND DURING THIS REVIEW con suficiente detalle | — |
| Parrot Pay | NO PUBLIC EVIDENCE FOUND DURING THIS REVIEW sobre obligatoriedad | — |

**Nota metodológica:** La documentación pública detallada de Parrot sobre capacidades técnicas (offline, AI, plataforma, condiciones de uso de Parrot Pay) no fue suficiente para clasificar estos puntos como FACT. Verificar con fuentes directas antes de usar en materiales de ventas o conversaciones competitivas.

**Wedge verificado:** Integración nativa con plataformas de delivery (Uber Eats, Rappi, DiDi Food) — recepción, impresión y seguimiento de órdenes en un solo sistema.

**Moat potencial (INFERENCE):** Si el restaurante procesa volumen significativo vía delivery, cambiar de POS = reconfigurar integraciones de delivery. Switching cost proporcional al volumen de delivery del negocio.

**Fullsite vs Parrot:** Fullsite no tiene integraciones de delivery nativas documentadas. Parrot no tiene inteligencia operativa ni offline certificado documentados. Las ventajas son ortogonales — depende del perfil del restaurante (delivery-heavy vs dine-in offline-sensitive).

---

## 9. Avocado

**UNKNOWN — información insuficiente para análisis.**

Existe al menos una empresa llamada "Avocado" en espacio de restaurantes LATAM. Sin información pública verificable sobre capacidades, pricing, o mercado objetivo.

**Recomendación:** No incluir en materiales competitivos hasta tener FACT verificables.

---

## 10. Fudo

**País:** Argentina (fundación). **Categoría:** Restaurant management + POS. **Funding:** a16z (portafolio público).
**Revisión:** 2026-08-05

| Dimensión | Estado | Evidencia |
|---|---|---|
| Funding | Portafolio público de a16z | FACT: a16z.com portfolio (consultado 2026-08-05) |
| Restaurantes activos | >35,000 en Latinoamérica (company-reported, no auditado independientemente) | FACT (claim propio): materiales públicos Fudo |
| Capacidades declaradas | POS, caja, stock, reportes, delivery, facturación electrónica | FACT: materiales públicos fudo.com |
| Dependencia de internet | Plataforma descrita como 100% online. Centro de ayuda indica que internet es indispensable | FACT: fudo.com / centro de ayuda Fudo (consultado 2026-08-05) |
| Offline | No soportado según documentación pública | FACT: propia declaración de la plataforma |
| Presencia en México | Expansión activa en México declarada públicamente | FACT: materiales públicos Fudo |
| CFDI en México | CUSTOMER-REPORTED SIGNAL — ver detalle abajo | ver nota |
| Calidad de soporte | CUSTOMER-REPORTED SIGNAL — ver detalle abajo | ver nota |
| Estrategia de pricing | INFERENCE — ver detalle abajo | ver nota |
| AI/Agents | NO PUBLIC EVIDENCE FOUND DURING THIS REVIEW | — |

**CUSTOMER-REPORTED SIGNAL — CFDI:**
Fuente: reseñas de clientes en plataformas públicas (no especificada con URL en esta revisión).
Limitaciones: muestra desconocida, país de origen de las reseñas no verificado, pueden reflejar incidentes individuales o configuración incorrecta del usuario, no necesariamente un fallo generalizado del producto.
Clasificación correcta: señal de fricción reportada por usuarios — no equivale a "CFDI 4.0 roto".
Acción: verificar con demo o fuente directa antes de usar como argumento competitivo.

**CUSTOMER-REPORTED SIGNAL — Soporte:**
Fuente: calificaciones en plataformas de reseñas (no especificada con URL en esta revisión).
Limitaciones: volumen de reseñas desconocido, sesgo de selección (usuarios insatisfechos tienden a reseñar más), no representativo sin muestra validada.
Clasificación correcta: señal de satisfacción de clientes reportada — no equivale a "soporte deficiente como política".

**INFERENCE — Estrategia de pricing:**
La descripción de "decoy pricing" es una interpretación de la estrategia comercial de Fudo, no un hecho verificable directamente. Clasificar como INFERENCE hasta tener evidencia de que el tier de menor precio tiene restricciones documentadas que lo hacen funcionalmente inutilizable.

**Wedge:** Escala LATAM (35K+ restaurantes company-reported) + a16z backing. Expansión en México activa.

**Análisis estructural:**
Fudo es el competidor LATAM con mayor señal de escala y respaldo institucional identificado en esta revisión. Su ausencia de offline documentada lo excluye de mercados con conectividad inestable — pero su expansión en México y funding de a16z lo posicionan como el competidor de mayor riesgo a mediano plazo.

**Fullsite vs Fudo:**
- Offline: Fudo no soporta según documentación propia. Fullsite P0-4 PENDING FIELD CERTIFICATION.
- CFDI: Fudo tiene señales mixtas (customer-reported). Fullsite bloqueado en CSD (P0-3 OPEN).
- AI/intelligence: NO PUBLIC EVIDENCE FOUND para Fudo. Fullsite: agentes activos sin certificar.
- Escala: Fudo 35K+ (company-reported). Fullsite 1 cliente pagando.
- Funding: Fudo a16z. Fullsite bootstrapped.

---

## Mapa estructural de la industria

```
                    DATA ORIGINATION
                    ↑ Alta
                    │
  Wansoft ──────────┤──── Fullsite (target)
  Restaurant365 ────┤     (POS + Intelligence + Action)
  Fudo ─────────────┤
                    │
  Toast ────────────┤ (POS only, no Mexico)
  Parrot ───────────┤ (POS only, cloud-dependent)
                    │
  Marble ───────────┤──── Nory ─── Tenzo ─── Supy
  (analytics only)  │    (analytics/scheduling)
                    │
                    ↓ Baja
                    
              OFFLINE-FIRST
              ↑ Alta
              │
  Wansoft ────┤  (SQL Server, 100% offline)
              │
  Fullsite ───┤  (target, P0-4 pending certification)
              │
  Toast ──────┤  (limited offline)
  Fudo ───────┤  (unknown)
  Parrot ─────┤  (limited, browser-based)
              │
  R365 ───────┤  (cloud-only)
  Nory ───────┤  (cloud-only)
  Marble ─────┤  (cloud-only)
  Tenzo ──────┤  (cloud-only)
  Supy ───────┤  (cloud-only)
              │
              ↓ Baja
```

---

## MARKET GAP ANALYSIS

**HYPOTHESIS:**
En la revisión de capacidades públicas realizada (2026-08-05, 10 competidores), no se identificó una plataforma en México que demuestre simultáneamente: offline certificado, CFDI funcional en producción, inteligencia operativa verificada, pricing transparente, y migración profunda desde sistemas legacy.

**UNKNOWN:**
Competidores pueden tener capacidades internas, privadas, en beta, o no indexadas públicamente que cubran parte o todo de este espacio. Una revisión de materiales públicos no es exhaustiva.

**POSITIONING OPPORTUNITY — NOT YET OWNED:**
Fullsite no puede declarar que ocupa este espacio todavía. Siguen pendientes:
- Offline field certification (P0-4 PENDING FIELD)
- CFDI productivo (P0-3 OPEN, CSD en trámite)
- Agentes certificados (cero hoy)
- Pricing validado con clientes externos (UNKNOWN)
- Migration bridge repetible (1 sandbox completado, segundo real pendiente)

La oportunidad existe en el análisis. Fullsite aún no la ocupa.

---

## WHERE WE CAN WIN

### 1. México — mercado con ausencia de jugadores globales top

- Toast: ausente (FACT)
- R365: ausente (FACT)
- Nory: ausente (FACT — UK/US focused)
- Tenzo: ausente (FACT — UK/US focused)
- Supy: ausente (FACT — MENA focused)
- Marble/Truffle: No current public evidence of Mexico market presence found during this review
- Wansoft: fuerte pero aging, soporte deteriorado post-Clip (FACT: Eduardo interview)
- Parrot: presente, delivery-focused, no offline documentado
- Fudo: expansión activa en México, cloud-only confirmado, a16z-backed — riesgo creciente

HYPOTHESIS: Fullsite puede competir en restaurantes dine-in donde offline y margin intelligence son prioritarios.
UNKNOWN: Si existen otros players locales con capacidades similares no documentados en esta revisión.

### 2. Offline-first para mercados con internet inestable
- Los analytics players investigados son cloud-only (FACT para los 10 analizados)
- Wansoft tiene offline pero sin intelligence publicada (FACT)
- HYPOTHESIS: Un sistema con offline certificado + intelligence verificada sería una combinación no observada en este análisis. UNKNOWN si existe en otros mercados no cubiertos.
- Mercado potencial: restaurantes fuera de zonas prime con conectividad inestable (HYPOTHESIS — sin datos de tamaño de mercado)

### 3. Integrated stack sin integration tax
- Marble + Nory + Supy + Tenzo + R365 = 5 plataformas, 5 contratos, 5 APIs
- Cada integración es una fuente de inconsistencia de datos
- **Fullsite: un sistema, una fuente de verdad, sin integración tax**
- El dueño ve P&L en el mismo sistema donde el mesero toma la orden

### 4. Transparencia en métricas de AI
FACT:
Durante esta investigación no se encontraron métricas públicas de precision y recall
para agentes de restaurante en ninguno de los 10 competidores analizados.

HYPOTHESIS:
Publicar certificación transparente de agentes (precision, recall, backtest) podría
convertirse en una oportunidad de posicionamiento para Fullsite.

UNKNOWN:
No sabemos si competidores tienen métricas internas no publicadas o capacidades en desarrollo.

### 5. Menor costo de despliegue inicial
FACT:
Wansoft cotizó para AMALAY: $154,580.45 MXN con IVA inversión inicial más $1,500/mes renta.

HYPOTHESIS:
Fullsite podría ofrecer un menor costo de inversión inicial al reutilizar hardware compatible
y no requerir consultoría de implementación obligatoria.

UNKNOWN:
Precio de Fullsite sin validar con clientes externos. Disposición a pagar sin datos.

---

## WHERE WE CANNOT WIN YET

### 1. Enterprise chains con IT dedicado
- Requieren SOC 2 Type II, SLA 99.99%, soporte 24/7, APIs enterprise
- Toast y R365 los tienen — Fullsite no aún

### 2. Delivery marketplace como core
- Parrot tiene Uber Eats / Rappi / DiDi integradas
- Si el restaurante hace 40% de ventas via delivery, Parrot es difícil de desplazar
- Fullsite no tiene delivery integrations nativas

### 3. CFDI (Segment-Specific Commercial Blocker)
- Wansoft tiene CFDI completo con todos los regímenes SAT (FACT: 20 años de expertise)
- Fullsite bloqueado en CSD (P0-3 OPEN) — CFDI no disponible en producción (FACT)
- CFDI = BLOCKER DESDE DÍA 1 para: cadenas corporativas, clientes con contratos empresa-empresa, Grupo Galería si requiere CFDI en contratación de proveedores
- CFDI = BLOCKER DIFERIDO para: restaurantes SME con <10% facturación o workaround temporal
- No afirmar que TODO cliente corporativo es inaccesible — depende de sus políticas específicas

### 4. Soporte escalado (24/7, español, teléfono)
- Wansoft tiene equipo de soporte (aunque degradado)
- Fullsite tiene solo fundador como soporte
- Limitante crítico para escalar más allá de 5-10 clientes

### 5. Multi-country / multi-currency
- Fudo (Argentina), Nory (UK) tienen esto
- Fullsite es MXN/México only

---

## WHAT MUST BE TRUE TO WIN

1. **Core Offline FIELD CERTIFIED** — sin esto, Wansoft gana en reliability
2. **Segundo cliente onboarded sin Daniel** — sin esto, no hay negocio escalable
3. **3 agentes CERTIFIED con métricas** — sin esto, "AI" es solo marketing
4. **CFDI funcional** — sin esto, cliente corporativo es inaccesible
5. **Soporte playbook para top 5 incidentes** — sin esto, no se puede escalar sin el fundador

---

## WHAT WE SHOULD NOT BUILD

### 1. Hardware propio
- Toast ya lo hizo con $800M en capital
- El margen está en software + datos, no en hardware
- BYOD (Bring Your Own Device) es nuestra ventaja, no nuestra debilidad

### 2. Payment processing propio
- Toast tiene esto — requiere licencia financiera, compliance, capital
- Integrar con Clip / MP Point / Getnet es suficiente para el mercado
- El margen de payments es de Toast y Clip, no de Fullsite

### 3. Delivery marketplace nativo
- Uber Eats / Rappi tienen APIs — integrar es suficiente
- No construir un marketplace propio de delivery
- No competir con Uber Eats / Rappi

### 4. Loyalty y apps para consumidores
- Loyalty requiere base de usuarios final (consumidores) — diferente go-to-market
- Construir para el operador primero, no para el comensal
- Si loyalty se necesita: integrar con un tercero (Kalory, Whappy)

### 5. Payroll fiscal propio
- SAT compliance para nómina es complejo y cambia constantemente
- Integrar con Nomipaq / CONTPAQi — no construir propio
- No competir con sistemas de nómina especializados

### 6. Decenas de agentes genéricos
- El número de agentes NO es una métrica de valor
- 3 agentes CERTIFIED > 30 agentes sin certificar
- No añadir agentes sin evidence of demand y sin plan de certificación

### 7. Voice ordering / AR / gimmicks
- Sin evidencia de demanda en el mercado objetivo (SME México)
- Distraen del core: operación confiable + inteligencia precisa

---

## Ventaja estructural defendible de Fullsite

La ventaja que los competidores tienen más dificultad de replicar:

**El ciclo de datos propio (CURRENT — FIELD VERIFIED en AMALAY):**
```
Operación (Fullsite POS) → genera datos → Fullsite Intelligence los analiza
→ genera insights con provenance → ejecuta acciones en el mismo sistema
→ mide resultado en los mismos datos operativos → aprende
```

**Ventaja estructural (INFERENCE — no verificado externamente):**
Los productos que no originan eventos operativos tienen una desventaja estructural para
controlar y medir el ciclo completo, salvo que construyan, compren o integren profundamente
un sistema de registro. Esta desventaja no es insuperable — puede ser cerrada mediante
adquisición, integración profunda, o desarrollo de POS propio.

**El moat que Fullsite PUEDE construir (POTENTIAL):**
1. Datos históricos de restaurantes mexicanos — si se acumulan con 3+ clientes (POTENTIAL)
2. Agentes certificados con metodología pública — nadie lo hace hoy (HYPOTHESIS)
3. Stack offline + intelligence en México — combinación no observada (HYPOTHESIS)
4. Switching cost bidireccional: datos propios en Fullsite, sin silos de integraciones (CURRENT — aplica a AMALAY hoy)

---

## Grupo Galería LOI — External traction

```
LOI EXISTENCE REPORTED BY FOUNDER = FACT
SIGNED ARTIFACT IN REPOSITORY    = NOT LOCATED
SIGNATURE VERIFICATION           = PENDING

ARCHIVO LOCALIZADO:  docs/legal/loi-fullsite-grupo-galeria.html
CONTENIDO DEL ARCHIVO: Template HTML con placeholders "SIGN HERE" sin llenar y
                        campos de fecha vacíos. No es el artefacto firmado.

ACCIÓN REQUERIDA (Founder): Cargar o archivar la copia firmada (PDF, escaneo, o
firma digital) en docs/legal/ o confirmar ubicación alternativa.

COUNTERPART:  Monica Garcia Pons, Board Member, Grupo Galería
SCOPE:        Dunkin Mexico, Carl's Jr, BWW, IHOP — pilotos en selected locations
NEXT STEPS:   Definir location, timeline, success metrics en 6 meses
BINDING:      NON-BINDING — Sección 2 explícita: "not a binding agreement"

LO QUE EL LOI PRUEBA (asumiendo firma existe):
- Interés comercial formal de contraparte externa identificada
- Apertura a explorar piloto con POS + KDS + Inventory + AI

LO QUE EL LOI NO PRUEBA:
- Cliente pagando / revenue / MRR
- Contrato definitivo / implementación / operación en producción
- Product-market fit / demanda repetible
```

**Formulación correcta:**
> Candidato a primer cliente externo respaldado por un LOI con Grupo Galería
> (existencia reportada por el Founder, artefacto firmado pendiente de localizar),
> sujeto a los gates técnicos, operativos y comerciales de implementación.
