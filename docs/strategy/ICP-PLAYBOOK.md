# FULLSITE — ICP & Sales Playbook

> Documento vivo. Última actualización: 2026-07-09.
> Cada dato está etiquetado: **HECHO** (validado), **ESTIMACIÓN** (modelo propio), **HIPÓTESIS** (pendiente de validar).

---

## ICP-01: Premium Casual Operator

### Quién es

Restaurante de servicio completo, operado por el dueño o un gerente de confianza. Cocina con múltiples estaciones. Menú extenso con modificadores. El dueño quiere dejar de estar en caja y empezar a tomar decisiones con datos.

| Atributo | Valor | Fuente |
|----------|-------|--------|
| Sucursales | 1-3 | ESTIMACIÓN |
| Empleados | 15-60 | HECHO (AMALAY = 40) |
| Facturación mensual | $1M-$3M MXN | HECHO (AMALAY = ~$2.2M/mes) |
| Facturación anual | $12M-$36M MXN | HECHO (derivado de AMALAY) |
| Ticket promedio | $180-$400 MXN | HECHO (AMALAY TP = ~$288) |
| Categorías de menú | 15-40 | HECHO (AMALAY = 33) |
| Items de menú | 80-250 | HECHO (AMALAY = 522) |
| Estaciones de cocina | 2-4 (cocina, barra, panadería, caja) | HECHO |
| POS actual | Wansoft, Soft Restaurant, National Soft | HECHO (AMALAY = Wansoft) |
| Costo POS actual | $2,500-$8,000/mes + instalación $50K-$150K | HECHO (Wansoft AMALAY = $154K instalación) |
| Tamaño del mercado (Monterrey) | ~300-600 restaurantes de este perfil | HIPÓTESIS |
| Tamaño del mercado (México) | ~5,000-15,000 | HIPÓTESIS |

### Madurez digital del dueño

**Nivel 3: Establecido digital** — Ya tiene POS, ya paga software, pero sabe que no le saca provecho. Usa WhatsApp para todo. Tiene Excel para algunas cosas. No usa analytics. Quiere datos pero no sabe cómo obtenerlos.

**Indicadores de madurez:**
- Tiene POS hace 3+ años (HECHO — Wansoft lleva 20 años)
- Pide reportes al contador que tardan días (HECHO — Eduardo lo confirmó)
- Ha buscado alternativas pero el contrato lo amarra (HECHO — cliente con contrato hasta 2028)
- El gerente sabe más del sistema que el dueño (HECHO — Eduardo vs Daniel's parents)

### Qué le duele

| Dolor | Frecuencia | Intensidad | Evidencia |
|-------|:----------:|:----------:|-----------|
| No sabe su food cost real hasta fin de mes | Diaria | 9/10 | HECHO — Eduardo: "el chef tiene 800 cosas, no se mete a inventarios" |
| Fraude hormiga (descuentos, cancelaciones, cortesías) | Semanal | 8/10 | HECHO — detectamos descuento "influencer" no autorizado en AMALAY |
| Soporte del POS actual es terrible | Mensual | 7/10 | HECHO — Eduardo: "un sábado sin POS, no me contestan" |
| No puede ver qué pasa cuando no está | Diaria | 8/10 | HECHO — Eduardo: "tiene que estar un encargado presente" |
| El contador le pide datos que tardan días | Mensual | 6/10 | ESTIMACIÓN |
| Instalación cara y amarrado a contrato | Al comprar | 9/10 | HECHO — $154K instalación Wansoft |

### Triggers de compra

¿Qué evento hace que este restaurante busque un nuevo POS?

| Trigger | Probabilidad | Urgencia | Cómo detectarlo |
|---------|:------------:|:--------:|-----------------|
| **Contrato actual vence** | Alta | Alta | Preguntar fecha. Wansoft = contratos 12 meses | 
| **Descubrió robo/fraude** | Media | Muy alta | "¿Cuándo fue la última vez que un descuento no cuadraba?" |
| **Remodelación / renovación** | Media | Media | LinkedIn, redes sociales del restaurante |
| **Gerente nuevo** (como Eduardo) | Media | Alta | Eduardo literalmente evaluó Fullsite para esto |
| **El POS se cayó en hora pico** | Baja pero explosiva | Máxima | Wansoft: "un sábado sin sistema" |
| **Quiere abrir segunda sucursal** | Media | Alta | "¿Estás pensando en crecer?" |
| **Cambio generacional** (hijo entra) | Baja | Media | Hijo en la operación = señal clara |
| **Quiere integrar delivery** (Rappi/Uber) | Alta | Media | "¿Cómo manejas tus pedidos de plataformas?" |

**Regla: vender durante el trigger, no antes.** Un restaurante sin trigger no va a cambiar.

### Por qué NOS comprarían

| Razón | Peso | Mensaje clave |
|-------|:----:|---------------|
| IA detecta fraude y fugas | 30% | "Te dice exactamente dónde pierdes dinero" |
| $0 instalación vs $150K+ Wansoft | 25% | "Empiezas mañana sin invertir nada" |
| Dashboard en tiempo real desde el celular | 20% | "Ve tu restaurante desde cualquier lugar" |
| Sin contrato, cancela cuando quieras | 15% | "Si no te gusta, no pagas" |
| Soporte 24/7 vs Wansoft que no contesta | 10% | "2 segundos, no 1 semana" |

### Por qué NO nos comprarían

| Objeción | Realidad | Respuesta |
|----------|----------|-----------|
| "Mi POS funciona bien, para qué cambiar" | Funciona para cobrar, no para decidir | "¿Sabes tu food cost real ahora mismo? ¿Cuánto perdiste en fraude este mes?" |
| "Cambiar POS es un desmadre" | Sí lo es, pero Fullsite se instala en 30 min | "Te instalo en tu horario muerto, sin parar operación" |
| "Tengo contrato hasta 2028" | Barrera real | "¿Cuánto te cuesta quedarte? Calcula el fraude que no detectas" |
| "La IA es buzzword, no sirve de verdad" | Válido si no se demuestra | Demo en vivo con datos reales de AMALAY |
| "No confío en la nube, ¿y si se cae?" | Fullsite es offline-first | "Funciona sin internet. Wansoft depende de un servidor local que si se va la luz, paras" |
| "Es muy nuevo, no tiene track record" | Cierto, somos nuevos | "Por eso te lo doy 3 meses gratis. Si no te convence, regresas a Wansoft sin costo" |
| "Mis meseros no van a aprender otro sistema" | Miedo real | "Si saben usar WhatsApp, saben usar Fullsite. Login con huella, 2 segundos" |

### Scoring objetivo

| Dimensión | Score (1-10) | Justificación |
|-----------|:------------:|---------------|
| Facilidad de cerrar | 6 | Tienen dolor real pero miedo al cambio |
| Tiempo de implementación | 8 | 2-4 horas (HECHO — AMALAY se instaló en una noche) |
| Riesgo de churn | 3 (bajo) | Si el onboarding es bueno, no regresan a Wansoft |
| Potencial de expansión | 5 | 1-3 sucursales, crecimiento moderado |
| Referral power | 8 | Restauranteros hablan entre ellos. Un caso de éxito genera 3-5 leads |
| Soporte requerido | 4 (moderado) | Primera semana intensiva, después mínimo |
| Compatibilidad con producto actual | 9 | Producto construido para exactamente este perfil |
| Tiempo para recuperar CAC | 7 | CAC estimado $9-12K, recuperado en 5-6 meses a $1,999/mes (ESTIMACIÓN) |
| **TOTAL** | **50/80** | |

### Demo: qué enseñar (en orden)

1. **Planograma de mesas** — "Este es TU restaurante" (3 min)
2. **Tomar una orden con modificadores** — "Así de fácil" (2 min)
3. **Comanda impresa por estación** — "Automático, sin errores" (1 min)
4. **Dashboard con datos reales** — "Esto es lo que no ves hoy" (3 min)
5. **Agente de fraude** — "Esto detectó un descuento no autorizado" (2 min)
6. **Food cost por platillo** — "¿Sabías que este platillo te cuesta más de lo que cobras?" (2 min)
7. **Login con huella** — "Sin teclado, 2 segundos" (30 seg)
8. **Precio** — "$1,999/mes todo incluido, $0 instalación, sin contrato" (30 seg)

**Total: 15 minutos. No más.**

### ROI que demostrar

| Concepto | Ahorro estimado | Fuente |
|----------|:-:|--------|
| Fraude detectado | $3,000-$15,000/mes | HIPÓTESIS (basado en caso AMALAY: descuento "influencer") |
| Food cost optimizado (2-3 puntos) | $20,000-$60,000/mes | HIPÓTESIS (en $2M facturación, 2% = $40K) |
| Tiempo de reportes (contador) | $5,000/mes | ESTIMACIÓN |
| Eliminación de instalación Wansoft | $150,000 una vez | HECHO |
| Diferencia mensual POS | $1,000-$6,000/mes | HECHO ($3-8K Wansoft vs $1,999 Fullsite) |

**Pitch de ROI:** "Fullsite se paga solo en la primera semana. El fraude que detectamos en AMALAY en un mes pagó 6 meses de suscripción."

---

## ICP-02: Growing Chain Operator

### Quién es

Fast casual que creció de 1 a 3-10 sucursales. El dueño ya no puede estar en todas. Necesita control remoto, estandarización, y visibilidad consolidada.

| Atributo | Valor | Fuente |
|----------|-------|--------|
| Sucursales | 3-10 | ESTIMACIÓN |
| Empleados | 30-150 | ESTIMACIÓN |
| Facturación mensual total | $3M-$15M MXN | ESTIMACIÓN |
| Ticket promedio | $120-$250 MXN | ESTIMACIÓN |
| POS actual | Parrot, Soft Restaurant, Wansoft, varios | HIPÓTESIS |
| Tamaño del mercado (México) | ~2,000-5,000 cadenas | HIPÓTESIS |

### Madurez digital

**Nivel 3-4:** Ya usan POS en todas las sucursales pero cada una es isla. Quieren consolidar pero su POS actual no lo hace bien.

### Triggers de compra

| Trigger | Probabilidad | Urgencia |
|---------|:----------:|:--------:|
| Abre sucursal 3 o 4 (pierde control) | Alta | Alta |
| Descubre inconsistencia entre sucursales | Alta | Media |
| Quiere franquiciar | Media | Muy alta |
| POS actual no soporta multi-sucursal | Media | Alta |

### Por qué NO nos comprarían

| Objeción | Realidad |
|----------|----------|
| "Necesito multi-sucursal probado, no beta" | Multi-sucursal es parcial en Fullsite (HECHO) |
| "Cambiar en 10 sucursales es riesgoso" | Válido — implementar una por una |
| "Ya tengo equipo de TI que maneja mi POS" | Fullsite elimina la necesidad de TI local |

### Scoring

| Dimensión | Score |
|-----------|:-----:|
| Facilidad de cerrar | 4 |
| Implementación | 5 |
| Churn | 4 (medio) |
| Expansión | 9 |
| Referral | 9 |
| Soporte | 6 (más intensivo) |
| Compatibilidad producto | 6 (necesita multi-suc) |
| Recuperar CAC | 8 (revenue alto) |
| **TOTAL** | **51/80** |

**Cuándo atacar:** Después de 5 clientes ICP-01 validados y multi-sucursal completo.

---

## ICP-03: Digital-Native Newcomer

### Quién es

Restaurante nuevo o en transición generacional. El hijo/sobrino entra al negocio familiar. O un emprendedor de 25-35 años que abre su primer restaurante. No tiene POS legacy — está eligiendo su primer sistema.

| Atributo | Valor | Fuente |
|----------|-------|--------|
| Sucursales | 1 | ESTIMACIÓN |
| Empleados | 5-20 | ESTIMACIÓN |
| Facturación mensual | $200K-$1M MXN | ESTIMACIÓN |
| POS actual | Ninguno, Clip, o heredado del papá | HIPÓTESIS |
| Tamaño del mercado (México) | ~10,000 nuevos restaurantes/año | HIPÓTESIS |

### Madurez digital

**Nivel 4-5: Digital-forward.** Usa Instagram para marketing. Tiene Rappi. Quiere todo en la nube. No le tiene miedo a la tecnología. Busca en Google "mejor POS para restaurante".

### Triggers de compra

| Trigger | Probabilidad | Urgencia |
|---------|:----------:|:--------:|
| Abre restaurante nuevo | Muy alta | Máxima |
| Hijo toma las riendas del negocio familiar | Alta | Alta |
| Migra de Clip/básico a sistema real | Media | Media |

### Por qué SÍ nos comprarían
- $0 instalación (no tiene capital para $150K de Wansoft)
- Sin contrato (no sabe si va a sobrevivir 12 meses)
- IA desde el día 1 (no tiene vicios de "así siempre lo hemos hecho")
- Se instala en 30 minutos

### Por qué NO nos comprarían

| Objeción | Realidad |
|----------|----------|
| "$1,999/mes es mucho para mí" | Válido si factura $200K. Pero si factura $500K+, es nada |
| "No necesito tantas funciones" | Puede usar solo POS básico e ir activando |
| "Clip me cobra 0/mes" | Clip no tiene inventario, recetas, IA, ni dashboard |

### Scoring

| Dimensión | Score |
|-----------|:-----:|
| Facilidad de cerrar | 7 |
| Implementación | 9 |
| Churn | 5 (medio-alto) |
| Expansión | 6 |
| Referral | 6 |
| Soporte | 3 (bajo) |
| Compatibilidad producto | 7 |
| Recuperar CAC | 6 |
| **TOTAL** | **49/80** |

**Cuándo atacar:** En paralelo con ICP-01. Son fáciles de cerrar y sirven como volumen base. Pero no son el core.

---

## Matriz: A quién NO le vendemos

| Perfil | Por qué no |
|--------|-----------|
| Puesto de tacos de $50/ticket | No puede pagar $1,999/mes. ROI no cierra |
| Cadena de 20+ sucursales con TI propio | Demasiado complejo, quieren SAP/Oracle |
| Restaurante con contrato 2+ años restantes | No van a cambiar ahora. Nurture, no vender |
| Dueño que "siempre ha usado libreta y le funciona" | Nivel 1 de madurez digital. No va a adoptar |
| Franquicia corporativa (McDonald's, Starbucks) | Tienen sus propios sistemas globales |

---

## Eje adicional: Madurez Digital

```
Nivel 1: Analog         → NO es nuestro cliente (hoy)
Nivel 2: Basic digital   → Podría ser ICP-03 si está en transición
Nivel 3: Established     → SWEET SPOT (ICP-01). Tiene POS pero quiere más
Nivel 4: Digital-forward  → ICP-01 o ICP-03. Adopta rápido
Nivel 5: Tech-first      → Raro en restaurantes. Early adopter extremo
```

**El ICP ideal de Fullsite es Nivel 3 transitando a Nivel 4.** Ya sabe que necesita tecnología, ya paga por ella, pero sabe que lo que tiene no es suficiente.

---

## Resumen ejecutivo

| | ICP-01 | ICP-02 | ICP-03 |
|---|:---:|:---:|:---:|
| **Nombre** | Premium Casual Operator | Growing Chain Operator | Digital-Native Newcomer |
| **Score total** | 50/80 | 51/80 | 49/80 |
| **Prioridad** | **AHORA** | Después de 5 ICP-01 | En paralelo (volumen) |
| **Revenue/cliente** | $24K/año | $72K-$192K/año | $24K/año |
| **Producto listo** | 95% | 70% | 90% |
| **Mensaje core** | "Te dice dónde pierdes dinero" | "Ve todas tus sucursales desde tu celular" | "Tu primer sistema inteligente, $0 para empezar" |
| **Competencia** | Wansoft, Soft Restaurant | Parrot, NCR | Clip, Square, Poster |
| **Kill shot** | Fraude + food cost + $0 instalación | Dashboard consolidado multi-suc | IA desde día 1 sin inversión |

---

## Sección 4: ¿Dónde los encontramos?

Para cada ICP, las coordenadas exactas de dónde pasan tiempo, cómo llegar a ellos, y quién nos abre la puerta.

### ICP-01: Premium Casual Operator — Canales de acceso

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **¿Dónde pasan tiempo físico?** | En su restaurante (7am-11pm). Proveedores en Central de Abastos (6-8am). Reuniones CANIRAC Nuevo León. Expos: ANTAD, Alimentaria México, ABASTUR. Clusters gastronómicos: San Pedro Garza García, Valle Oriente, Cumbres, Barrio Antiguo | HECHO (AMALAY) |
| **¿Dónde pasan tiempo digital?** | WhatsApp (100% del día). Instagram (siguen cuentas foodie: @monterreyfoodie, @maboreal, @mtyfood). Facebook grupos: "Restauranteros de Monterrey", "Emprendedores Gastronómicos NL". YouTube (recetas, no tecnología). Google Maps (obsesionados con sus reseñas) | ESTIMACIÓN |
| **¿Cómo los encontramos?** | 1. Red de Eduardo: 12 años en Wansoft, conoce ~200 restaurantes en MTY. 2. Red de Susy (ex-Wansoft, ex-Parrot): Toño Márquez, Josué Saldaya. 3. CANIRAC NL: directorio de afiliados. 4. Google Maps: buscar restaurantes con 4+ estrellas, 500+ reseñas, menú extenso en zonas target. 5. Instagram: restaurantes que postean diario = dueño activo. 6. Rappi/Uber Eats: filtrar por restaurantes de servicio completo que también tienen delivery | HECHO / HIPÓTESIS |
| **¿Quién nos puede presentar?** | Eduardo de la Garza (ex-Wansoft, conoce a todos). Susy (ex-Parrot, red comercial). Proveedores de alimentos (Coca-Cola reps, distribuidores de cerveza, Sysco equivalentes locales). Contadores que atienden restaurantes. Arquitectos de interiores especializados en restaurantes. Vendedores de equipo de cocina (Torrey, Hobart). El "amigo del restaurantero" — el que vende café, servilletas, uniformes | HECHO / ESTIMACIÓN |
| **¿Qué eventos atienden?** | Expo ANTAD (Guadalajara, feb). ABASTUR (CDMX, sep). Alimentaria México. Cenas de CANIRAC NL (trimestrales). Festivales gastronómicos locales. "Restaurant Day" (eventos efímeros) | ESTIMACIÓN |
| **¿Qué grupos de WhatsApp/Facebook?** | Grupos de proveedores con sus clientes. "Restauranteros MTY" en Facebook (~3K miembros). Grupo de CANIRAC NL. Grupos informales de dueños que se conocen entre sí (5-10 personas, difíciles de penetrar sin referido) | HIPÓTESIS |
| **¿Qué cámaras/asociaciones?** | CANIRAC Nuevo León. CANACO Monterrey. Cámara de Comercio de San Pedro. Asociación de Bares y Restaurantes de NL | ESTIMACIÓN |
| **¿Quién ya les vende hoy?** | Wansoft/Soft Restaurant (POS). Facturama/Contpaqi (facturación). Coca-Cola/Pepsi reps (refrescos). Distribuidores de cerveza (Heineken, AB InBev). Sysco/proveedores de proteína. Rappi/Uber Eats (delivery). Reservandonos/OpenTable (reservaciones). Vendedores de equipo (Torrey). Fumigadores. Contadores especializados. **Cada uno de estos es un canal de referido.** | HECHO / ESTIMACIÓN |

**Táctica de acceso #1 — Eduardo como caballo de Troya:**
Eduardo conoce ~200 restaurantes de Wansoft. Cada uno que tenga contrato venciendo en los próximos 6 meses es un lead caliente. Eduardo los llama: "Oye, ya no estoy en Wansoft. Encontré algo que necesitas ver." (HECHO — Eduardo está disponible)

**Táctica de acceso #2 — La ruta del proveedor:**
El rep de Coca-Cola visita 50 restaurantes por semana. Si le damos una comisión por referido ($500 por cliente cerrado), nos presenta en cada visita. El costo de adquisición baja dramáticamente. (HIPÓTESIS)

**Táctica de acceso #3 — Susy como puente a Parrot churners:**
Susy conoce restaurantes que probaron Parrot y no les funcionó para servicio completo. Son leads pre-calificados: ya decidieron cambiar, ya están en la nube, pero Parrot no les resolvió. (HIPÓTESIS)

### ICP-02: Growing Chain Operator — Canales de acceso

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **¿Dónde están?** | Expos de franquicias. LinkedIn (más activos que ICP-01). Grupos de franquiciatarios. Consultores de crecimiento restaurantero | HIPÓTESIS |
| **¿Cómo los encontramos?** | Buscar cadenas que abrieron sucursal 3+ recientemente (Google Maps, redes). Eventos de franquicias. Referidos de ICP-01 que crecieron | HIPÓTESIS |
| **¿Quién nos presenta?** | Consultores de franquicias. Abogados de marca. Contadores que manejan multi-sucursal. ICP-01 que creció y nos recomienda | HIPÓTESIS |

### ICP-03: Digital-Native Newcomer — Canales de acceso

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **¿Dónde están?** | Instagram/TikTok (postean todo). Google "mejor POS para restaurante". Incubadoras (Tec de Monterrey, UANL). Cursos de gastronomía. Eventos de emprendimiento | HIPÓTESIS |
| **¿Cómo los encontramos?** | SEO: "POS para restaurante México", "sistema para restaurante". Google Ads. Instagram Ads segmentados por ubicación + interés "restaurante". Partnerships con escuelas de gastronomía | HIPÓTESIS |
| **¿Quién nos presenta?** | Profesores de gastronomía. Arquitectos que diseñan restaurantes nuevos. Brokers de locales comerciales. El papá (si es cambio generacional) | HIPÓTESIS |

---

## Sección 5: Customer Journey — ICP-01

El viaje completo desde "no sabe que tiene problema" hasta "nos recomienda a 5 amigos". Cada etapa con la intervención exacta de Fullsite.

### Etapa 1: No sabe que tiene problema

**¿Cómo se ve?** El dueño llega a las 7am, trabaja 16 horas, cierra, repite. Su POS "funciona" — toma órdenes, imprime tickets, cobra. No sabe su food cost real. No sabe cuánto pierde en fraude. No sabe qué platillos le dan margen y cuáles le cuestan dinero. Cree que "así es el negocio de restaurantes".

**¿Cuánto tiempo se queda aquí?** Años. Literalmente años. El 80% de los restauranteros están aquí. (ESTIMACIÓN)

**Fullsite interviene aquí haciendo:** Nada directamente. Pero sembramos contenido: posts en Instagram/LinkedIn con datos reales tipo "¿Sabías que el restaurante promedio pierde 3-5% en fraude hormiga?" Casos de estudio de AMALAY. Eduardo habla en eventos sobre lo que descubrió.

### Etapa 2: Empieza a sentir fricción

**Síntomas:**
- "¿Por qué este mes vendimos menos si tuvimos más mesas?"
- El contador tarda 5 días en dar un reporte que ya no sirve
- El chef dice que la merma es "normal" pero no hay datos
- Un mesero renunció y nadie sabe sus cuentas abiertas
- Las reseñas de Google bajan de 4.5 a 4.2 y no sabe por qué

**¿Cuánto dura?** 3-12 meses. La fricción se acumula pero no es suficiente para actuar. (ESTIMACIÓN)

**Fullsite interviene aquí haciendo:** Si ya lo conocemos (por Eduardo, por evento, por red), le mandamos un WhatsApp casual: "Oye, vi que abriste otra sucursal. ¿Cómo vas con el control?" No vender. Solo plantar la semilla.

### Etapa 3: Ocurre un trigger

**Triggers de mayor conversión** (referencia tabla de triggers ICP-01):

| Trigger | Ventana de oportunidad | Acción Fullsite |
|---------|:----------------------:|-----------------|
| Contrato Wansoft vence | 2-3 meses antes del vencimiento | Eduardo llama: "Tu contrato vence en marzo. ¿Ya viste opciones?" |
| Descubrió robo/fraude | 48 horas (la emoción se enfría rápido) | "Te muestro cómo lo detectamos en AMALAY en 15 minutos" |
| POS se cayó en hora pico | 1 semana | "Fullsite es offline-first. Esto no te vuelve a pasar" |
| Quiere abrir segunda sucursal | 1-2 meses antes de abrir | "¿Ya pensaste cómo vas a ver las dos sucursales desde tu celular?" |
| Gerente nuevo entra | Primeras 2 semanas del gerente | El gerente nuevo es el champion. Él evalúa y recomienda |

**Regla de oro: si no hay trigger, no hay venta.** No perder tiempo empujando a quien no tiene urgencia.

**Fullsite interviene aquí haciendo:** Activación inmediata. Llamada o WhatsApp dentro de 48 horas del trigger. Demo en menos de una semana. El trigger es perecedero.

### Etapa 4: Empieza a investigar

**¿Dónde busca?**
- Google: "sistema punto de venta restaurante", "mejor POS México", "alternativa a Wansoft" (HIPÓTESIS)
- Pregunta a otros restauranteros (amigos, CANIRAC, grupo de WhatsApp)
- Pregunta a su contador
- Pregunta a su proveedor de equipo
- Llama a Wansoft/Soft Restaurant para cotizar (porque ya los conoce)
- Busca en Instagram/Facebook recomendaciones

**¿Qué googlea exactamente?**
- "punto de venta para restaurante precio"
- "POS con facturación electrónica"
- "cuánto cuesta Wansoft"
- "alternativa a Soft Restaurant"
- "POS con inventario para restaurante"

**Fullsite interviene aquí haciendo:** SEO + Google Ads para estas búsquedas. Landing page con calculadora de ROI. Testimonial de AMALAY en video. Tabla comparativa vs Wansoft/Soft/Parrot visible en Google.

### Etapa 5: Compara opciones

**Set de consideración típico** (ESTIMACIÓN):
1. Wansoft — "el que todos conocen"
2. Soft Restaurant — "el otro grande"
3. Parrot — "el moderno" (si lo encontró)
4. Fullsite — si llegó por referido o búsqueda
5. "Quedarme con lo que tengo"

**Criterios de decisión (en orden de importancia para ICP-01):**

| # | Criterio | Peso | Quién lo evalúa |
|---|----------|:----:|-----------------|
| 1 | "¿Funciona para mi tipo de restaurante?" | 25% | Dueño + gerente |
| 2 | Precio total (instalación + mensualidad) | 20% | Dueño |
| 3 | "¿Me van a dejar tirado si falla?" (soporte) | 20% | Gerente |
| 4 | Facilidad de uso para meseros | 15% | Gerente |
| 5 | Facturación electrónica incluida | 10% | Contador |
| 6 | Reportes y datos | 10% | Dueño |

**Fullsite interviene aquí haciendo:** Demo presencial de 15 minutos (ver sección Demo). Tabla comparativa impresa. Llamada de referencia con Daniel (AMALAY). Oferta: "Pruébalo 30 días gratis en paralelo con tu POS actual."

### Etapa 6: Decide

**¿Qué inclina la balanza?**
- Ver sus propios datos en el dashboard (no datos demo, SUS datos)
- Hablar con otro restaurantero que ya lo usa
- El precio: $0 instalación vs $154K de Wansoft
- "Si no te gusta, cancelas. Sin contrato"
- El gerente dice "este es más fácil" (el gerente tiene veto real)

**¿Quién tiene veto?**
| Persona | Poder | Cómo neutralizar |
|---------|:-----:|-----------------|
| Dueño | Decisión final | ROI + precio + referencia |
| Gerente | Veto técnico | Demo hands-on + "es más fácil que Wansoft" |
| Contador | Veto fiscal | "Incluye CFDI, se integra con CONTPAQi" |
| Esposa/socio | Veto emocional | "Sin riesgo, sin contrato, sin inversión" |

**Fullsite interviene aquí haciendo:** Eliminar toda fricción. $0 instalación. Sin contrato. 30 días gratis. Instalación en su horario muerto. Migración de datos incluida. "Si no te convence, te ayudo a regresar."

### Etapa 7: Implementa

**Semana 1 — el momento más delicado:**

| Día | Actividad | Riesgo | Mitigación |
|-----|-----------|--------|------------|
| Día 0 | Instalación en horario muerto (2-5pm) | "Se ve diferente a Wansoft" | Planograma idéntico al físico del restaurante |
| Día 1-2 | Shadow mode: Fullsite corre en paralelo con POS actual | Meseros confundidos con 2 sistemas | Solo 2-3 meseros usan Fullsite, resto sigue en POS viejo |
| Día 3-4 | Capacitación grupal (30 min antes de servicio) | "No le entiendo" | Login con huella (2 seg), interfaz touch grande |
| Día 5-7 | Cutover: Fullsite como sistema principal | Algo falla en hora pico | Soporte presencial las primeras 2 horas pico. POS viejo disponible como backup |

**Lo que puede salir mal:**
- Impresora no conecta → tener impresora de respaldo pre-configurada
- Mesero veterano se resiste → el gerente lo capacita 1-a-1, no el equipo Fullsite
- El menú tiene errores → validar Migration Diff Report ANTES del cutover (HECHO — ya es proceso estándar)

**Fullsite interviene aquí haciendo:** Soporte presencial los primeros 3 días. WhatsApp directo con Daniel/equipo. Revisión de datos cada noche de la primera semana.

### Etapa 8: Primeros 30 días

**¿Qué define éxito?**
- Meseros dejan de quejarse después del día 5 (HECHO — AMALAY)
- Dueño abre el dashboard desde su celular al menos 1x al día
- Primer reporte automático que antes tardaba 3 días
- Primer fraude detectado → momento "wow"
- Nadie pide regresar al POS viejo después del día 14

**¿Cuándo sienten buyer's remorse?**
- Día 2-3: "Era más fácil con Wansoft" (curva de aprendizaje normal)
- Día 7-10: si algo falló y no se resolvió rápido
- Día 15-20: si no ven valor diferencial (datos, alertas, detecciones)

**Fullsite interviene aquí haciendo:** Reporte semanal automático de "lo que Fullsite detectó esta semana." Llamada de check-in día 7 y día 21. Dashboard personalizado con KPIs que el dueño pidió.

### Etapa 9: Primeros 90 días

**¿Qué los hace quedarse?**
- El dashboard se vuelve su droga: lo abren 3-5 veces al día
- Detectaron al menos 1 fraude o fuga que no conocían
- El contador recibe los datos sin pedirlos
- El gerente ya no imagina trabajar sin el sistema
- "Wansoft era como manejar un carro viejo. No sabías que te faltaba dirección asistida hasta que la pruebas"

**¿Qué los haría irse?**
- Bug crítico que no se resolvió en 24 horas
- Funcionalidad que prometimos y no entregamos
- Soporte que dejó de ser rápido
- Competidor ofrece algo que necesitan y nosotros no tenemos

**Fullsite interviene aquí haciendo:** Encuesta NPS al día 60. Revisión trimestral de ROI con datos reales. Feature request tracking. Invitar al dueño a ser caso de estudio.

### Etapa 10: Se convierte en promotor

**¿Qué detona el word-of-mouth?**

| Momento | Probabilidad de referido | Cómo amplificamos |
|---------|:------------------------:|-------------------|
| Primer fraude detectado | Muy alta | "¿Conoces a otro restaurantero que tenga este problema?" |
| Otro dueño le pregunta "qué POS usas" | Alta | Darle materiales: video corto, comparativa impresa |
| Publica algo en redes sobre su restaurante | Media | Comentar y repostear. Que nos etiquete |
| Le ahorramos un problema con el SAT | Alta | Historia para caso de estudio |
| Eduardo/Susy lo mencionan en una conversación | Alta | Eduardo tiene credibilidad de 12 años en la industria |

**Programa de referidos:**
- $1,000 MXN de descuento por cada referido que cierre (al que refiere)
- Primer mes gratis al nuevo cliente referido
- Top referrers: acceso anticipado a features nuevas

**Fullsite interviene aquí haciendo:** Pedir el referido activamente en el momento correcto (post-wow moment, no antes). Darle herramientas fáciles para referir (link, WhatsApp forward, video corto). Reconocer públicamente a los promotores.

---

## Sección 6: Competitive Playbook

Para cada competidor: quiénes son, por qué ganan, por qué pierden, nuestro mensaje letal, y cuándo atacar.

### Wansoft

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **Quiénes son** | 20 años en el mercado. Desarrollado en .NET 4.5 (2007). SQL Server local. Sin nube, sin API HTTPS, sin IA. Dominan Monterrey y noreste de México. | HECHO |
| **Base instalada** | ~200-500 restaurantes en NL (ESTIMACIÓN). Eduardo atendía ~35 cuentas como comercial |  HECHO |
| **Precio** | Instalación: $50K-$154K. Mensualidad: $3K-$8K. Contrato 12 meses. Soporte extra | HECHO (AMALAY pagó $154K) |
| **Por qué los compran** | Track record de 20 años. "El que todos conocen." Eduardo los vendía. El gerente ya lo sabe usar. Miedo a lo desconocido | HECHO |
| **Por qué pierden** | Soporte terrible ("un sábado sin POS, no me contestan" — HECHO). Tecnología de 2007. Sin nube: si se va la luz, pierdes datos. Sin IA. Sin dashboard remoto. Instalación carísima. Contratos que amarran. No innovan desde hace años | HECHO |
| **Nuestro mensaje** | "Wansoft te cobra $154K por instalarte un sistema de 2007 y no te contesta el sábado. Fullsite te cuesta $0 para empezar, tiene IA que detecta fraude, y te responde en 2 segundos. ¿Por qué seguir pagando más por menos?" | — |
| **Cuándo atacar** | Vencimiento de contrato. Después de una falla de soporte. Cuando abren segunda sucursal (Wansoft no hace multi-suc bien). Cuando Eduardo habla con ex-clientes | HECHO |

**Kill move contra Wansoft:** Demo lado a lado. Abrir Wansoft y Fullsite en el mismo restaurante. "Mira lo que ves en Wansoft. Ahora mira lo que ves en Fullsite." El contraste visual es demoledor.

### Soft Restaurant

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **Quiénes son** | Competidor directo de Wansoft. También legacy. Más popular en centro/sur de México. National Soft como plataforma | ESTIMACIÓN |
| **Por qué los compran** | Nombre reconocido. Muchos contadores lo conocen. Buena facturación electrónica. Más "corporativo" que Wansoft | ESTIMACIÓN |
| **Por qué pierden** | Mismos problemas que Wansoft: tecnología vieja, sin IA, sin dashboard moderno, soporte mediocre. Interfaz anticuada. Instalación cara | ESTIMACIÓN |
| **Nuestro mensaje** | "Soft Restaurant fue bueno hace 10 años. Hoy necesitas un sistema que piense por ti, no solo que registre ventas. Fullsite tiene 30 agentes de IA que monitorean tu restaurante 24/7" | — |
| **Cuándo atacar** | Igual que Wansoft: vencimiento, falla, expansión. Especialmente cuando migran a zona MTY donde Wansoft domina y Soft es segundo | HIPÓTESIS |

### Parrot

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **Quiénes son** | Respaldado por YC. Fundado en MTY. Empezó como agregador de delivery (Rappi, Uber Eats, etc.). Migró de Windows a nube. Equipo tech fuerte | HECHO |
| **Por qué los compran** | Marca YC. Integración nativa con delivery. UI moderna. Sin instalación cara. Conocidos en el ecosistema startup | HECHO / ESTIMACIÓN |
| **Por qué pierden** | Su ADN es delivery, no full-service. Para un restaurante de servicio completo con 522 items, 33 categorías, y 4 estaciones de cocina, Parrot se queda corto. No tienen IA operativa real. Su fuerza (delivery aggregation) no es el dolor principal de ICP-01 | ESTIMACIÓN |
| **Nuestro mensaje** | "Parrot es excelente para delivery. Pero tu restaurante no es solo Rappi. Necesitas un sistema que entienda mesas, modificadores, estaciones de cocina, y que te diga dónde pierdes dinero. Fullsite fue construido para restaurantes como el tuyo" | — |
| **Cuándo atacar** | Cuando un restaurante full-service prueba Parrot y siente que le falta. Susy conoce estos casos. Cuando Parrot sube precios o cambia condiciones | HIPÓTESIS |

### Poster / Fudo

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **Quiénes son** | Cloud-native, UI moderna, fundados fuera de México (Poster = Ucrania, Fudo = Argentina). Genéricos: sirven para cafetería, bar, restaurante, tienda | ESTIMACIÓN |
| **Por qué los compran** | Bonitos. Fáciles. Baratos. Setup rápido. Buenos para operaciones simples | ESTIMACIÓN |
| **Por qué pierden** | No entienden México: sin CFDI nativo, sin conocimiento de regulación SAT, sin soporte en español mexicano. Genéricos: no resuelven los problemas específicos de un restaurante full-service con 40 empleados. Sin IA. Sin red local de soporte | ESTIMACIÓN |
| **Nuestro mensaje** | "Poster es un POS bonito para una cafetería en Europa. Tu restaurante en Monterrey necesita facturación SAT, recetas mexicanas, y un sistema que hable tu idioma. Fullsite es mexicano, para mexicanos" | — |
| **Cuándo atacar** | Cuando se topan con problemas de CFDI. Cuando necesitan soporte presencial y no hay nadie. Cuando crecen y el sistema genérico se queda corto | HIPÓTESIS |

### Clip / Square

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **Quiénes son** | Hardware-first. Clip es mexicano (terminal de cobro + POS básico). Square es gringo. Su negocio es el processing de pagos, el POS es secundario | HECHO |
| **Por qué los compran** | $0/mes (cobran comisión por transacción). Terminal de cobro bonita. Sin compromiso. Perfecto para puestos, food trucks, negocios pequeños | HECHO |
| **Por qué pierden** | No es un POS real para full-service. Sin mesas, sin estaciones de cocina, sin modificadores complejos, sin recetas, sin inventario serio, sin IA. Es una caja registradora glorificada. Para un restaurante con 40 empleados y 522 items, Clip no funciona | ESTIMACIÓN |
| **Nuestro mensaje** | **"Clip es para cobrar. Fullsite es para operar."** Clip te dice cuánto cobraste. Fullsite te dice dónde pierdes dinero, quién te roba, qué platillo te da margen, y qué mesero necesita capacitación | — |
| **Cuándo atacar** | Cuando el restaurante crece de food truck/cafetería a restaurante real. Cuando se dan cuenta que necesitan inventario, recetas, reportes. Cuando Clip les cobra 3.6% por transacción y se dan cuenta que es caro | ESTIMACIÓN |

### Excel / Libreta / "No hacer nada"

| Dimensión | Detalle | Fuente |
|-----------|---------|--------|
| **Quiénes son** | El competidor más grande. No es un producto, es la inercia. El dueño que usa Excel, libreta, o simplemente no mide nada. "Así llevo 15 años y aquí sigo" | HECHO |
| **Por qué "los compran"** | $0 costo. Cero curva de aprendizaje. Cero riesgo de implementación. El dueño siente control porque él lleva la libreta | HECHO |
| **Por qué pierden** | No saben lo que no saben. Pierden 3-8% en fraude hormiga sin enterarse. Su food cost real puede estar 5-10 puntos arriba de lo que creen. No pueden escalar. No pueden delegar. Están encadenados al restaurante 16 horas al día | ESTIMACIÓN |
| **Nuestro mensaje** | **"¿Cuánto dinero pierdes por no saber?"** Si no mides, no puedes mejorar. Si no detectas, no puedes detener. El costo de "no hacer nada" es el más caro de todos — solo que no lo ves en una factura | — |
| **Cuándo atacar** | Cuando un evento los sacude (robo grande, quiebra de otro restaurantero, el hijo entra y dice "papá, esto no puede seguir así"). Cuando Fullsite tiene suficientes casos de estudio para demostrar ROI con números reales | ESTIMACIÓN |

### Resumen competitivo

| Competidor | Por qué ganan | Por qué pierden | Kill message | Cuándo atacar |
|------------|---------------|-----------------|--------------|---------------|
| **Wansoft** | Track record, base instalada | Tech 2007, soporte pésimo, $154K | "¿$154K por un sistema de 2007?" | Vencimiento contrato, falla soporte |
| **Soft Restaurant** | Nombre, contadores lo conocen | Legacy, sin IA, sin nube real | "Necesitas un sistema que piense, no solo registre" | Expansión, cambio generacional |
| **Parrot** | YC, delivery, UI moderna | ADN delivery, no full-service | "Tu restaurante no es solo Rappi" | Full-service que probó Parrot y le faltó |
| **Poster/Fudo** | Bonito, fácil, cloud | Genérico, no México, sin CFDI | "Mexicano, para mexicanos" | Problemas CFDI, crecimiento |
| **Clip/Square** | $0/mes, terminal bonita | No es POS real | "Clip cobra. Fullsite opera" | Cuando crecen de café a restaurante |
| **No hacer nada** | $0, cero riesgo | Pierde sin saber, no escala | "¿Cuánto pierdes por no saber?" | Evento de shock, hijo entra |

### Intel competitivo — LinkedIn Insights (julio 2026) HECHO

| Métrica | Wansoft | Parrot | Fullsite |
|---------|---------|--------|----------|
| Empleados | 104 | 63 | 1 |
| Tendencia 6m | +2% | **-7%** | Construyendo |
| Tendencia 1y | +8% | **-5%** | — |
| Tendencia 2y | +22% | +2% | — |
| Tenure mediana | 3.2 años | 2.9 años | — |
| **Top función** | Sales 28% + BD 23% = **51% ventas** | Engineering 16%, Sales 14% | Engineering 100% |
| IT / Engineering | 14% (~15 personas) | 29% (~18 personas) | 1 founder + IA |
| Nómina estimada/mes | ~$3M+ MXN | ~$2M+ MXN | $0 |

**Implicaciones estratégicas:**

1. **Wansoft es empresa de ventas, no de tech.** 51% de su equipo vende. Solo 15 ingenieros mantienen un sistema de 2007. No van a innovar — van a defender base instalada con contratos y relaciones.

2. **Parrot está encogiendo.** -7% en 6 meses, -5% en 1 año. Gente se va (tenure 2.9 años). Sus clientes que necesitan servicio completo van a buscar alternativas. Oportunidad directa para Fullsite vía Susy (ex-Parrot).

3. **Wansoft necesita ~$3M/mes de nómina.** Por eso cobra $130K+ de instalación y $1,500/mes. Fullsite con COGS de ~$285/restaurante puede cobrar $1,999/mes con 86% de margen porque no tiene 104 sueldos que pagar.

4. **El headcount de ventas de Wansoft (53 personas) es una amenaza y una oportunidad.** Amenaza: tienen 53 vendedores tocando puertas. Oportunidad: si reclutamos a los mejores (como Eduardo), ya conocen a los 200+ clientes.

---

## Sección 7: Un día en la vida — ICP-01

Narrativa de un día típico del dueño de un restaurante ICP-01 (inspirado en la operación real de AMALAY).

---

**5:30 AM — Despierta.**
Revisa WhatsApp en la cama. 14 mensajes. El chef dice que no llegó el proveedor de pan. Un mesero avisa que no puede ir. El contador pregunta por las facturas del mes pasado.
**Estrés:** ya empezó el día y ya hay 3 problemas.
**Fullsite:** Briefing automático a las 6am: "Hoy tienes 2 reservaciones. Ayer vendiste $87K. Inventario crítico: pan francés (2 días), leche (1 día). El mesero Omar tuvo ticket promedio 15% debajo del equipo ayer."

**6:30 AM — Camino al restaurante.**
En el carro, llama al chef para resolver lo del pan. Llama al mesero de backup. Piensa en las facturas del contador pero no tiene los datos a la mano.
**Fullsite:** Dashboard en el celular: ve ventas de ayer, inventario en rojo, y las facturas pendientes ya exportadas al contador automáticamente.

**7:00 AM — Llega al restaurante.**
Revisa que la limpieza se hizo. Checa que los ingredientes estén. Cuenta el efectivo de ayer (a mano). El gerente le dice que ayer hubo una cancelación rara en la cuenta 14.
**Estrés:** ¿fue fraude la cancelación? No hay forma de verificar con Wansoft sin buscar en 5 pantallas.
**Fullsite:** Alerta automática: "Cancelación inusual: cuenta 14, $340, cancelada por mesero Julio a las 9:47pm (después de que el cliente pagó). Patrón similar a 3 cancelaciones previas de Julio este mes."

**8:00 AM — Apertura.**
Meseros llegan. Preparan mesas. El dueño está en la caja porque el cajero llegó tarde. No puede hacer nada más: está atrapado en la caja.
**Fullsite:** Login con huella. Sistema listo en 2 segundos. El dueño no necesita estar en caja — cualquier mesero abre desde su terminal.

**9:00 AM - 12:00 PM — Servicio de desayuno.**
Hora pico de chilaquiles. La cocina se satura. Un platillo sale mal, el cliente se queja. El mesero aplica un descuento del 50% sin autorización. El dueño no se entera hasta ver el corte.
**Estrés:** no sabe qué pasa en las mesas que no ve.
**Fullsite:** Alerta en tiempo real: "Descuento del 50% aplicado por mesero Brayan en mesa 7. Motivo registrado: 'error cocina'. ¿Autorizar?" El dueño aprueba o rechaza desde su celular.

**12:00 PM — Cambio de turno.**
El gerente de la tarde llega. El dueño le hace un resumen verbal de 20 minutos: qué pasó, qué falta, qué problemas hubo.
**Fullsite:** Resumen automático del turno matutino: ventas, incidentes, inventario consumido, alertas. El gerente lo lee en 2 minutos.

**1:00 PM - 4:00 PM — Servicio de comida.**
El dueño sale a hacer compras (Central de Abastos) o se queda resolviendo problemas administrativos. No ve lo que pasa en el restaurante.
**Estrés:** "¿Estará todo bien allá?"
**Fullsite:** Push notification: "Ventas a las 3pm: $42K (12% arriba del promedio para lunes). 3 mesas abiertas. Sin incidentes." El dueño ve su restaurante desde cualquier lugar.

**4:00 PM - 5:00 PM — Hora muerta.**
**Este es el momento para hacer demos.** El dueño tiene 30-60 minutos. Está en el restaurante pero no en servicio. Puede sentarse a ver una laptop.
**Fullsite interviene aquí:** Demo presencial de 15 minutos. "Mira, así se ve tu restaurante en Fullsite." Con datos reales.

**5:00 PM - 10:00 PM — Servicio de cena.**
El servicio más fuerte. Market, bebidas, cenas completas. El dueño debería estar atendiendo clientes VIP, pero está resolviendo problemas de cocina y caja.
**Fullsite:** Predicción de cierre a las 6pm: "Proyección de cierre: $95K (vs $88K promedio martes). Platillo estrella hoy: Arrachera ($12.4K). Sugerencia de upselling: postre con café tiene 73% de conversión los martes."

**10:00 PM — Pre-cierre.**
Corte de caja. Contar efectivo. Cuadrar tarjetas. Revisar cancelaciones. Calcular propinas. Esto toma 45-60 minutos con Wansoft.
**Fullsite:** Corte automático en 30 segundos. Propinas calculadas. Discrepancias marcadas. "Efectivo cuadra: $18,420. Tarjeta cuadra: $76,580. Propinas: $4,200 (14% debajo del martes pasado — considerar revisión de servicio)."

**11:00 PM — Cierra.**
El dueño sale agotado. No sabe realmente cómo le fue. "Creo que fue buen día" es lo mejor que puede decir. Los números reales los verá en 3-5 días cuando el contador procese todo.
**Fullsite:** Resumen del día enviado a WhatsApp: "Martes 8 julio. Ventas netas: $95,200. Ticket promedio: $312. Food cost estimado: 28.4%. Fraude detectado: $0. Platillo estrella: Arrachera. Mesero estrella: Omar ($14.2K). Acción sugerida: revisar merma de pan francés (32% arriba del estándar)."

**11:30 PM — En la cama.**
Revisa WhatsApp una última vez. Mañana repite.
**Con Fullsite:** por primera vez en años, sabe exactamente cómo le fue hoy. Sin esperar al contador. Sin confiar en la memoria del gerente. Sin contar billetes a las 10pm.

---

**Mejores momentos para vender/demostrar Fullsite:**

| Horario | Actividad del dueño | Por qué es buen momento |
|---------|--------------------|-----------------------|
| 4:00 - 5:00 PM | Hora muerta entre comida y cena | Tiene tiempo, está en el restaurante, puede ver demo |
| 7:00 - 8:00 AM | Llegando, antes de apertura | Está fresco, tiene problemas frescos de ayer |
| Lunes pre-apertura | Día más lento, planea la semana | Más receptivo, menos presión |

---

## Sección 8: Mapa de expansión — ¿Qué más le vendemos?

Después de cerrar el POS base ($1,999/mes), la ruta de expansión de revenue por cliente.

### Timeline de expansión

| Periodo | Producto/Servicio | Incluido en base | Precio adicional | Margen | Status |
|---------|-------------------|:----------------:|:----------------:|:------:|--------|
| **Mes 1-3** | POS core (órdenes, mesas, comandas, corte) | Sí | $0 | N/A | HECHO — construido |
| **Mes 1-3** | Dashboard básico (ventas, meseros, top platillos) | Sí | $0 | N/A | HECHO — construido |
| **Mes 1-3** | 30 agentes IA básicos (fraude, anomalías, predicción) | Sí | $0 | N/A | HECHO — construido |
| **Mes 1-3** | CFDI básico (facturación individual) | Sí | $0 | N/A | HECHO — construido |
| **Mes 3-6** | Facturación avanzada (multi-RFC, complementos de pago, facturación masiva) | No | $499/mes | ~90% | HIPÓTESIS — Facturama API cuesta ~$215/mes, cobrar $499 |
| **Mes 3-6** | Inventario premium (recetas con auto-deducción, puntos de reorden, alertas) | Parcial | $299/mes | ~95% | ESTIMACIÓN — lo piden desde mes 2 (Monica lo pidió) |
| **Mes 6-12** | IA operativa premium (agentes personalizados, benchmarking vs industria) | No | $799/mes | ~85% | HIPÓTESIS |
| **Mes 6-12** | Compras automatizadas (órdenes a proveedores basadas en inventario) | No | $499/mes | ~80% | HIPÓTESIS |
| **Mes 6-12** | Multi-sucursal (dashboard consolidado, menú centralizado, transferencias) | No | $999/mes por sucursal adicional | ~90% | ESTIMACIÓN — ICP-02 lo necesita |
| **Año 2+** | Fullsite Payments (procesamiento de pagos propio, tipo Toast/Clip) | No | ~2.5% por transacción | ~30-40% | HIPÓTESIS — requiere licencia CNBV o partnership |
| **Año 2+** | Nómina integration (cálculo de propinas, horas, integración con IMSS) | No | $399/mes | ~85% | HIPÓTESIS |
| **Año 2+** | Financiamiento (capital de trabajo basado en datos de ventas) | No | Comisión sobre monto | ~20-30% | HIPÓTESIS — modelo Toast Capital |
| **Año 2+** | Benchmarking (comparación anónima con restaurantes similares) | No | $299/mes | ~95% | HIPÓTESIS — requiere base de clientes |
| **Año 2+** | Marketplace B2B (marketplace de proveedores para restaurantes) | No | Comisión sobre transacción | ~10-15% | HIPÓTESIS — requiere red de proveedores |
| **Año 2+** | APIs para cadenas (integraciones custom, webhooks, data export) | No | $1,999/mes | ~95% | HIPÓTESIS — ICP-02 enterprise |

### Revenue potencial por cliente (ICP-01)

| Escenario | Mes 1-3 | Mes 6 | Mes 12 | Mes 24 | Fuente |
|-----------|:-------:|:-----:|:------:|:------:|--------|
| Solo POS base | $1,999 | $1,999 | $1,999 | $1,999 | HECHO |
| POS + facturación + inventario | $1,999 | $2,797 | $2,797 | $2,797 | ESTIMACIÓN |
| Full stack (POS + fact + inv + IA premium) | $1,999 | $2,797 | $3,596 | $3,596 | HIPÓTESIS |
| Full stack + Payments (2.5% de $2.2M/mes) | $1,999 | $2,797 | $3,596 | **$58,596** | HIPÓTESIS |

**Insight clave:** El POS a $1,999/mes es la puerta de entrada. El verdadero negocio es Payments. A 2.5% de $2.2M/mes de facturación = $55K/mes por cliente. Esto es exactamente el modelo de Toast. (HIPÓTESIS — requiere 2+ años y licencia regulatoria)

### Prioridad de construcción

| # | Producto | Cuándo construir | Justificación |
|---|----------|:----------------:|---------------|
| 1 | Inventario premium | Q3 2026 | Monica lo pidió, dueños lo necesitan, margen alto, ya está parcialmente construido |
| 2 | Facturación avanzada | Q3 2026 | Facturama integration ya existe, solo falta empaquetar |
| 3 | Multi-sucursal | Q4 2026 | Habilita ICP-02, revenue 5x por cliente |
| 4 | IA premium | Q1 2027 | Diferenciador vs todos los competidores |
| 5 | Payments | 2027-2028 | Requiere regulación, pero es el juego largo |

---

## Sección 9: Red Flags — Señales de que NO vale la pena

15 señales específicas de que un prospecto no es un buen fit. Detectarlas temprano ahorra semanas de esfuerzo.

| # | Señal | Por qué es red flag | Qué hacer |
|---|-------|--------------------|-----------| 
| 1 | **Solo pregunta por precio sin entender el producto** | Compra por precio, no por valor. Si cierra, churnea en 3 meses cuando encuentre algo $100 más barato | Dar precio transparente ($1,999/mes). Si no pregunta nada más, no perseguir |
| 2 | **Quiere 50 personalizaciones antes de comprar** | Señal de que nunca va a estar satisfecho. El costo de atenderlo excede el revenue | Explicar qué sí hace el producto. Si necesita algo muy custom, referir a Wansoft/Soft (que sí cobran $150K por customizar) |
| 3 | **No tiene autoridad para decidir** | Estás hablando con el gerente/mesero, no con el dueño. Puedes hacer 5 demos y que el dueño diga "no" sin haberte visto | Pedir hablar con quien decide. Si no puede arreglar la reunión, no invertir más tiempo |
| 4 | **"Mi POS funciona perfecto, no necesito cambiar"** | Sin dolor, sin venta. No importa qué tan bueno sea Fullsite. La inercia siempre gana si no hay dolor | Nurture: agregar a lista de contactos. Mandar contenido cada 2 meses. Esperar trigger |
| 5 | **Contrato con POS actual por 2+ años restantes** | Barrera legal real. No van a pagar doble. A menos que el dolor sea extremo | Calcular costo de quedarse vs salirse. Si no justifica, agendar follow-up 6 meses antes del vencimiento |
| 6 | **Restaurante factura menos de $300K/mes** | $1,999/mes = 0.67% de $300K. Puede ser mucho para ellos. El ROI tarda más en materializarse | Referir a Clip o Poster. O ofrecer plan básico cuando exista |
| 7 | **El dueño tiene 65+ años y dice "así llevo 30 años"** | No va a adoptar tecnología nueva. No es un tema de producto, es cultural. Respetarlo | Buscar si hay hijo/sobrino en el negocio. Si lo hay, hablar con el hijo (ICP-03). Si no, declinar amablemente |
| 8 | **Pide demo 3 veces y nunca cierra** | "Professional demo attendee." Disfruta que le vendan pero no compra. Cada demo cuesta ~2 horas | Después de la segunda demo: "¿Qué necesitas para decidir esta semana?" Si no hay respuesta concreta, parar |
| 9 | **Quiere que le paguen por usar el sistema** | "Debería ser gratis para mí, soy tu caso de estudio." Mentalidad de que te hace un favor | Solo un cliente piloto tiene justificación (AMALAY). Todos los demás pagan. Sin excepciones |
| 10 | **Tiene 4+ POS diferentes en 4 años** | Serial switcher. Nunca está satisfecho. Va a churear sin importar qué tan bueno sea el onboarding | Preguntar por qué cambió cada vez. Si las razones son legítimas (creció, se mudó), podría ser OK. Si es "no me gustó", red flag |
| 11 | **El gerente sabotea activamente** | El gerente actual aprendió Wansoft en 10 años y no quiere empezar de cero. Bloquea la adopción internamente | Necesitas al dueño como champion, no al gerente. Si el dueño no tiene voluntad de imponer el cambio, no va a funcionar |
| 12 | **"¿Puedo probar 6 meses gratis?"** | No valora el producto. Si no está dispuesto a pagar $1,999/mes, el producto no resuelve un dolor real para él | Oferta máxima: 30 días gratis o primer mes gratis con referido. 6 meses = working for free |
| 13 | **Quiere integrarse con 10 sistemas que no soportamos** | Complejidad técnica que no podemos resolver hoy. El onboarding se vuelve un proyecto de 3 meses | Ser honesto: "Hoy nos integramos con X, Y, Z. Si necesitas A, B, C — no somos tu mejor opción todavía" |
| 14 | **Restaurante en zona de alto riesgo de cierre** | Centro comercial vaciándose, zona con inseguridad creciente, concepto que no funciona. Si cierra en 6 meses, perdimos el CAC | Evaluar viabilidad del negocio antes de invertir en onboarding. Si tiene señales de cierre, priorizar otros prospects |
| 15 | **Negocia agresivamente cada centavo** | Si $1,999/mes es un deal-breaker, el restaurante probablemente no factura suficiente o el dueño no valora software. Cualquier upsell futuro será una pelea | Mantener precio. $1,999 es el precio. Sin descuentos por negociación (solo por referido o programa especial). Si no acepta, no es nuestro cliente |

**Regla general:** Es mejor decir "no somos tu mejor opción hoy" que cerrar un cliente que va a churear, consumir soporte, y dejar una mala reseña.

---

## Sección 10: Modelo de Scoring Vivo

Cómo actualizar el scoring de ICPs con datos reales conforme crecemos. El playbook es tan bueno como los datos que lo alimentan.

### Datos a recolectar por prospecto/cliente

| Campo | Tipo | Ejemplo | Cuándo capturar |
|-------|------|---------|----------------|
| Nombre del restaurante | Texto | "AMALAY Coffee & Market" | Primer contacto |
| Tipo de restaurante | Categoría | Full-service / Fast casual / Café / Bar | Primer contacto |
| Madurez digital (1-5) | Número | 3 | Primer contacto |
| Rango de facturación mensual | Rango | $1M-$3M MXN | Calificación |
| Número de sucursales | Número | 1 | Primer contacto |
| Número de empleados | Número | 40 | Calificación |
| POS actual | Texto | "Wansoft" | Primer contacto |
| ICP asignado | Categoría | ICP-01 / ICP-02 / ICP-03 | Calificación |
| Trigger de compra | Categoría | "Contrato vence" | Calificación |
| Fuente (cómo nos conoció) | Categoría | Referido Eduardo / Google / Evento | Primer contacto |
| Fecha primer contacto | Fecha | 2026-07-07 | Primer contacto |
| Fecha de demo | Fecha | 2026-07-14 | Post-demo |
| Fecha de cierre o pérdida | Fecha | 2026-07-28 | Al cerrar o perder |
| Resultado | Win / Loss | Win | Al cerrar o perder |
| Razón de pérdida (si aplica) | Texto | "Contrato vigente 2 años más" | Al perder |
| Tiempo de cierre (días) | Número | 21 | Calculado |
| Tiempo de implementación (días) | Número | 3 | Post-implementación |
| Satisfacción día 30 (1-10) | Número | 8 | Día 30 |
| Satisfacción día 60 (1-10) | Número | 9 | Día 60 |
| Satisfacción día 90 (1-10) | Número | 9 | Día 90 |
| NPS (0-10) | Número | 9 | Día 60 |
| MTBS — Mean Time Between Support (días) | Número | 14 | Continuo |
| Revenue mensual generado | Número | $1,999 | Mensual |
| Features adicionales compradas | Lista | "Facturación avanzada, Inventario" | Continuo |
| Referidos generados | Número | 2 | Continuo |

### Cómo calcular close rates por segmento

```
Close Rate (ICP-X) = Clientes cerrados ICP-X / Total prospectos calificados ICP-X

Ejemplo después de 6 meses:
- ICP-01: 8 cerrados / 25 prospectos = 32% close rate
- ICP-02: 1 cerrado / 5 prospectos = 20% close rate
- ICP-03: 12 cerrados / 40 prospectos = 30% close rate
```

**Actualizar cada trimestre.** Si ICP-03 tiene mejor close rate que ICP-01, cuestionar si la prioridad es correcta. El close rate no es todo — también importa el revenue/cliente y el churn.

### Template de Win/Loss Analysis

Para cada deal cerrado o perdido, llenar:

| Campo | Ejemplo Win | Ejemplo Loss |
|-------|-------------|--------------|
| Restaurante | "La Nonna Gorditas" | "Taquería El Norteño" |
| ICP | ICP-01 | ICP-01 |
| Trigger | Contrato Wansoft venció | Gerente nuevo evaluó |
| Fuente | Referido Eduardo | Google Ads |
| Días para cerrar | 14 | 45 (nunca cerró) |
| Razón win/loss | $0 instalación + demo dashboard + Eduardo recomendó | "Contrato Wansoft renovado por presión del vendedor" |
| Champion interno | Gerente | Nadie (dueño ausente) |
| Objeción principal | "¿Y si se cae?" → demo offline-first | "Mi vendedor de Wansoft me ofrece 30% descuento si renuevo" |
| Aprendizaje | Eduardo como referido cierra 3x más rápido | Sin champion interno = no cerrar. Dejar de perseguir |

### Cómo actualizar el scoring modelo

**Cada trimestre:**

1. Exportar todos los deals del periodo (win + loss)
2. Calcular por ICP:
   - Close rate
   - Tiempo promedio de cierre
   - Revenue promedio por cliente
   - Churn rate a 90 días
   - NPS promedio
   - MTBS promedio
   - Número de referidos generados
3. Recalcular los scores de cada dimensión basado en datos reales (no estimaciones)
4. Ajustar prioridades si los datos lo dictan
5. Documentar cambios en este playbook con fecha y justificación

### MTBS — Mean Time Between Support

Métrica clave para medir la calidad del onboarding y la estabilidad del producto.

| Rango MTBS | Interpretación | Acción |
|:----------:|---------------|--------|
| < 3 días | Problema grave de producto o onboarding | Escalación inmediata. Revisar implementación. Llamar al cliente |
| 3-7 días | Normal en primeros 30 días | Monitorear. Debería mejorar con el tiempo |
| 7-14 días | Bueno. Cliente estable | Mantener check-ins mensuales |
| 14-30 días | Excelente. Producto funciona solo | Pedir referido. Pedir caso de estudio |
| 30+ días | Cliente autónomo | NPS alto probable. Candidato a upsell |

**Cómo trackear:** Cada ticket de soporte se registra con timestamp. MTBS = promedio de días entre tickets consecutivos por cliente.

**Meta para Q4 2026:** MTBS promedio > 14 días para clientes con 90+ días. (HIPÓTESIS)

### Revisión trimestral — Checklist

- [ ] Exportar datos de CRM (todos los deals Q anterior)
- [ ] Calcular métricas por ICP (close rate, tiempo, revenue, churn, NPS, MTBS)
- [ ] Ejecutar win/loss analysis de los 3 deals más importantes
- [ ] Comparar scores estimados vs reales
- [ ] Actualizar scores en este documento
- [ ] Identificar 1-2 cambios de estrategia basados en datos
- [ ] Comunicar cambios al equipo

---

## Estructura de Playbooks (/playbooks)

Biblioteca planificada de playbooks operativos de Fullsite. Este documento (ICP Playbook) es el #1.

| # | Playbook | Qué cubre | Cuándo construir | Status |
|---|----------|-----------|:-----------------:|--------|
| 1 | **ICP Playbook** (este documento) | Quién es nuestro cliente, dónde encontrarlo, cómo venderle, competitive intelligence, scoring | Ya construido | HECHO |
| 2 | **Sales Playbook** | Scripts de pitch (telefónico, presencial, WhatsApp). Manejo de objeciones palabra por palabra. Flujo de demo. Cadencia de follow-up. Templates de propuesta | Cuando tengamos 3+ vendedores o primer sales hire | PENDIENTE |
| 3 | **Onboarding Playbook** | Checklist de implementación. Plan de capacitación por rol (mesero, cajero, gerente, dueño). Cronograma de primeras 2 semanas. Métricas de éxito de onboarding | Antes del cliente #5 | PENDIENTE |
| 4 | **Support Playbook** | Triage de tickets. Escalación (L1 auto → L2 remoto → L3 presencial). SLAs por severidad. Base de conocimiento. FAQ por rol | Antes del cliente #10 | PENDIENTE |
| 5 | **Product Principles** | Qué construir y qué no. Reglas de priorización. Cómo evaluar feature requests. Estabilidad > features. No features sin evidencia operativa | Ya parcialmente documentado en CLAUDE.md | EN PROGRESO |
| 6 | **Implementation Playbook** | Setup técnico paso a paso. Migración de datos (Wansoft → Fullsite). Migration Diff Report. Validación pre-cutover. Rollback plan. Checklist de hardware | Antes del cliente #3 | PENDIENTE |
| 7 | **YC Playbook** | Estrategia de aplicación W27. Métricas necesarias (MRR, growth rate, churn, NPS). Narrativa. Video. Respuestas a preguntas frecuentes. Timeline de preparación | Q3 2026 — 6 meses antes del deadline | PENDIENTE |
| 8 | **Fundraising Playbook** | Deck de inversión. Términos SAFE (recomendaciones de Luis). Due diligence prep. Unit economics. Cap table. Modelo financiero | Post-YC o cuando busquemos pre-seed | PENDIENTE |
| 9 | **Hiring Playbook** | Roles a contratar (orden). Cultura y valores. Proceso de entrevista. Compensación. Cómo evaluar commitment (filtro "¿cuándo sale el vuelo?"). Onboarding de equipo | Cuando tengamos revenue para contratar | PENDIENTE |

---

*Este documento es la base de todo el go-to-market de Fullsite. Cada vendedor debe poder responder: a quién buscamos, a quién no, cuándo nos acercamos, qué mensaje usamos, qué demo enseñamos, qué ROI demostramos, y qué objeciones esperamos.*
