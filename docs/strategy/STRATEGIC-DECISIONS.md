# FULLSITE — Decisiones Estratégicas

> Derivado de: COMPETITIVE-INTELLIGENCE.md + ICP-PLAYBOOK.md
> No es investigación. Son decisiones.
> Última actualización: 2026-07-10

---

## 1. Comportamiento del comprador mexicano

No competimos contra Toast. Competimos contra la inercia.

### ¿Quién toma la decisión?

| Persona | Poder de decisión | Poder de veto | Qué le importa |
|---------|:-:|:-:|---------|
| **Dueño** | 90% | Absoluto | "¿Cuánto me cuesta y cuánto me ahorra?" |
| **Gerente operativo** (tipo Eduardo Ezq) | 5% | Alto — si dice "esto no funciona", el dueño cancela | "¿Es más fácil que lo que tengo?" |
| **Contador** | 3% | Medio — puede bloquear si facturación no jala | "¿Se integra con CONTPAQi? ¿Genera CFDI?" |
| **Meseros** | 2% | Bajo pero colectivo — si todos se quejan, el gerente escala | "¿Es más rápido que lo anterior?" |

**HECHO** (basado en AMALAY): El dueño decide, el gerente valida, el contador pone condiciones, los meseros adoptan o sabotean.

### Ciclo de compra real

| Etapa | Duración | Qué pasa | Quién participa |
|-------|:--------:|----------|-----------------|
| Trigger ocurre | Día 0 | Algo se rompe, descubren fraude, vence contrato | Dueño |
| Busca opciones | 1-2 semanas | Pregunta a conocidos, Googlea poco, pide recomendaciones en WhatsApp | Dueño + gerente |
| Primer contacto | 1-3 días | Demo o llamada. Decide en 15 min si le interesa o no | Dueño (a veces gerente solo) |
| Evaluación | 1-2 semanas | "Déjame pensarlo", consulta contador, consulta gerente | Dueño + contador + gerente |
| Decisión | 1 día | Si el trigger sigue activo, compra. Si se enfrió, ghostea | Dueño |
| Implementación | 1 día | Si tarda más de 1 día, empieza la duda | Gerente + meseros |
| Primeros 7 días | Críticos | Si algo falla, pierde confianza. Si funciona, se queda | Todos |

**INFERENCIA**: El ciclo completo es 2-6 semanas. Pero la decisión real se toma en los primeros 15 minutos de la demo. Todo lo demás es validación.

### Objeciones por etapa

| Etapa | Objeción | Quién la dice | Respuesta |
|-------|----------|:-------------:|-----------|
| Primer contacto | "Ya tengo sistema" | Dueño | "¿Te dice dónde pierdes dinero?" |
| Primer contacto | "No tengo tiempo" | Dueño | "Se instala en 30 min, en tu horario muerto" |
| Evaluación | "Tengo contrato" | Dueño | "¿Cuánto te cuesta quedarte? Calculemos" |
| Evaluación | "Mi contador dice que no" | Dueño | "Facturamos CFDI 4.0. Tu contador va a tener los datos más rápido" |
| Evaluación | "Mis meseros no van a aprender" | Gerente | "Si saben usar WhatsApp, saben usar Fullsite" |
| Decisión | "Es muy nuevo" | Dueño | "Por eso te lo doy 3 meses gratis. Riesgo cero" |
| Implementación | "Esto no jala igual que antes" | Mesero | "¿Qué específicamente? Lo arreglamos hoy" |
| Primeros 7 días | "Se cayó / no imprimió" | Gerente | Soporte en <2 min. Esto es P0 — si pasa, perdemos al cliente |

**HECHO** (Eduardo): "Si no hay comanda, no te hago nada." Un solo fallo de impresión puede costar el cliente.

---

## 2. Fullsite Moat — Ventajas estructurales

No features. No IA. Ventajas que son difíciles de copiar.

### Moat Tier 1: Cosas que tenemos HOY

| Ventaja | Por qué es difícil de copiar | Durabilidad |
|---------|------------------------------|:-----------:|
| **Implementación en <4 horas** | Toast tarda semanas. Wansoft tarda días + $150K. Nosotros: 1 tarde. | 3-5 años |
| **$0 instalación, sin contrato** | Competidores dependen de contratos para retener. Nosotros retenemos con producto. | Permanente |
| **Eduardo (12 años Wansoft)** | Conoce cada dolor, cada stored procedure, cada cliente insatisfecho de Wansoft | 2-3 años (hasta que alguien lo contrate) |
| **Iteración en horas, no meses** | Un solo founder técnico + Claude = ship en el mismo día. Wansoft tarda meses por burocracia. | 1-2 años (se pierde al crecer equipo) |
| **Susy (ex-Wansoft/Parrot)** | Entiende los errores que cometieron ambos competidores. Sabe qué NO hacer. | Permanente (conocimiento) |
| **Offline-first** | El POS funciona sin internet. Wansoft depende de servidor local. Si se va la luz, ellos paran. | Permanente (arquitectura) |

### Moat Tier 2: Cosas que podemos construir en 12 meses

| Ventaja | Cómo se construye | Por qué es moat |
|---------|-------------------|-----------------|
| **Datos operativos de N restaurantes** | Cada cliente alimenta los modelos de IA | Más clientes = IA más inteligente = mejor producto = más clientes (flywheel) |
| **Costos de cambio** | Inventario + recetas + historial + huellas digitales + configuración | Después de 3 meses, migrar a otro POS es doloroso |
| **Red de referidos** | Restauranteros hablan entre ellos. 1 caso de éxito = 3-5 leads | Eduardo conoce a todos en Monterrey |
| **Soporte en <2 minutos** | Mientras seamos chicos, podemos dar soporte personal que nadie más da | Diferenciador brutal vs Wansoft ("un sábado sin POS") |

### Moat Tier 3: Cosas que construimos en 3-5 años

| Ventaja | Qué es | Por qué mata |
|---------|--------|-------------|
| **Operating Graph** | Red de datos entre restaurantes: benchmarks, proveedores, precios, estacionalidad | Nadie más tiene esto. Es el verdadero moat a largo plazo |
| **Payments (procesamiento)** | Fullsite procesa pagos directamente, como Toast | Take rate de 2-3% sobre GMV. Revenue masivo |
| **Financing** | Préstamos basados en datos de POS (como Toast Capital) | Conocemos el flujo real del restaurante mejor que cualquier banco |

---

## 3. Decisiones que tomamos gracias a este análisis

### LO QUE VAMOS A HACER

| Decisión | Razón | Prioridad |
|----------|-------|:---------:|
| **Enfocarnos 100% en ICP-01 (Premium Casual, $1-3M/mes)** | Product-market fit demostrado en AMALAY. No dispersarnos. | P0 |
| **Primeros 5 clientes gratis / subsidiados** | Necesitamos casos de éxito para vender. Sin social proof, no cerramos. | P0 |
| **Construir Payments antes que Loyalty** | Payments = revenue recurrente (take rate 2-3%). Loyalty = feature, no negocio. INFERENCIA de Toast. | P1 |
| **Integrar con CONTPAQi antes que construir contabilidad** | 80% de contadores en México usan CONTPAQi. No vamos a reemplazarlo. | P1 |
| **Venta founder-led los primeros 20 clientes** | Nadie vende mejor que el fundador. Después estandarizamos el playbook. | P0 |
| **Soporte personal (WhatsApp directo) los primeros 50 clientes** | Es nuestra ventaja más grande contra Wansoft. No automatizar hasta que duela. | P0 |
| **Delivery aggregation después de estabilizar POS** | Parrot ganó ahí, pero nosotros ganamos en full-service primero. Delivery es fase 2. | P2 |
| **Multi-sucursal como prioridad después de 5 clientes** | ICP-02 paga $6K-16K/mes. Pero primero necesitamos el core perfecto. | P1 |
| **Activar Facturama producción antes del 21 julio** | Cita SAT el 21. Sin facturación real, no podemos vender a nadie. | P0 |

### LO QUE NO VAMOS A HACER

| Decisión | Por qué no | Trampa que evitamos |
|----------|-----------|---------------------|
| **No competir por precio contra OlaClick/Clip** | Ellos van por micro-negocios con $0/mes. Nuestro ICP paga $1,999 feliz si le demostramos ROI. | Race to the bottom |
| **No construir payroll/nómina** | Complejidad regulatoria enorme (IMSS, ISR, PTU). Integrar con NOI o similar. | Distracción de 6+ meses |
| **No atacar hoteles** | Diferente operación, diferente buyer, diferente ciclo. Foco = restaurantes. | Dispersión |
| **No construir marketplace B2B de proveedores (aún)** | Requiere supply-side + demand-side. Demasiado temprano. Es fase 3+ (2028). | Two-sided marketplace trap |
| **No construir app de cliente final** | El restaurante no necesita que sus clientes descarguen una app. QR + web basta. | "Si lo construyes vendrán" fallacy |
| **No hacer white-label** | Cada personalización = deuda técnica. Un solo producto, muchos clientes. | Death by customization |
| **No invertir en SEO/content marketing ahora** | Los primeros 20 clientes vienen de referidos y outbound. SEO escala después. | Premature optimization |
| **No construir reservas** | OpenTable/Resy ya existen. Integrar, no competir. | Build everything syndrome |

---

## 4. Cómo nos pueden matar — Riesgos reales

No teóricos. Escenarios que podrían pasar en los próximos 12-24 meses.

| Escenario | Probabilidad | Impacto | Plan de mitigación |
|-----------|:------------:|:-------:|---------------------|
| **Clip compra Wansoft** y le mete inversión para modernizar | 10% | Catastrófico | Cerrar 20+ clientes antes de que esto pase. Costos de cambio nos protegen. |
| **Soft Restaurant lanza versión cloud** con IA | 20% | Alto | Ya llevan 25 años sin innovar. Su burocracia es nuestra ventaja. Pero no dormirse. |
| **Parrot baja precios agresivamente** en full-service | 30% | Medio | Parrot es fuerte en delivery, débil en full-service. Nuestro ICP no es el suyo. |
| **Un POS gratuito con IA** entra al mercado mexicano | 15% | Alto | Gratuito = sin soporte. Nuestro moat es implementación + soporte personal. |
| **Facturama cambia precios o cierra** | 10% | Alto | Tener plan B (PAC alternativo). No depender de un solo proveedor de timbrado. |
| **Eduardo se va** (o lo contratan) | 25% | Muy alto | Documentar todo su conocimiento. No depender de una sola persona para ventas. Susy como backup. |
| **Dependencia de un solo canal comercial** (solo referidos) | 40% | Alto | Diversificar: LinkedIn outbound + eventos + partnerships con proveedores de alimentos. |
| **AMALAY falla como piloto** (problemas operativos el lunes) | 20% | Muy alto | Smoke test exhaustivo. Tener plan de rollback. No prometer lo que no está probado. |
| **Daniel burnout** (founder solo, sin equipo técnico) | 35% | Existencial | Claude como multiplicador. Pero necesita co-founder técnico antes de 50 clientes. |
| **Supabase sube precios o tiene downtime crítico** | 15% | Alto | Arquitectura offline-first mitiga. Pero evaluar plan de contingencia a 12 meses. |

**El riesgo #1 no es un competidor. Es que no cerremos los primeros 10 clientes lo suficientemente rápido.** Si en 90 días no tenemos 10 restaurantes pagando, nada más importa.

---

## 5. Recomendación ejecutiva

**Si un inversionista leyera solo esta página:**

### Dónde competimos
Restaurantes full-service en México ($1-3M MXN/mes de facturación). Primer mercado: Monterrey. Segundo: CDMX. Tercero: ciudades secundarias + San Antonio TX.

### Dónde NO competimos
Micro-negocios (<$500K/mes). Hoteles. Cadenas de 20+ sucursales (por ahora). Quick-service puro. Fuera de LatAm (por ahora).

### Nuestra estrategia
Reemplazar POS legacy (Wansoft, Soft Restaurant) en restaurantes full-service con un sistema AI-native que se instala en 4 horas, cuesta $0 de entrada, y se paga solo en la primera semana con el fraude que detecta.

### Nuestra ventaja
1. IA nativa (no add-on)
2. Implementación en horas (no semanas)
3. $0 instalación (no $150K)
4. Eduardo + Susy (conocimiento profundo del mercado)
5. Offline-first (no depende de internet)
6. Iteración en horas (no meses)

### Roadmap 24 meses

| Periodo | Meta | Revenue target |
|---------|------|:-:|
| Jul-Sep 2026 | AMALAY cutover + 5 clientes piloto | $10K MRR |
| Oct-Dec 2026 | 15 clientes pagando, multi-sucursal listo | $30K MRR |
| Ene-Mar 2027 | 30 clientes, aplicar YC Winter 2027 | $60K MRR |
| Abr-Jun 2027 | YC batch, 50 clientes, payments beta | $100K MRR |
| Jul-Dec 2027 | 100 clientes, payments live, CDMX | $250K MRR |
| 2028 | 300 clientes, financing, marketplace | $750K MRR |

### La pregunta que responde todo

**¿Puede AMALAY operar una semana completa sin Wansoft y sin incidentes críticos?**

Si la respuesta es SÍ después del lunes → tenemos product-market fit demostrado y todo lo demás es ejecución comercial.

Si la respuesta es NO → arreglamos lo que falle y no salimos a vender hasta que sea SÍ.

**Esa es nuestra única prioridad.**
