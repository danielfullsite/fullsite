# Website Copy Changes — Credibility & Conversion Pass

**Branch:** `credibility-pass-aug2026`
**Fecha:** 2026-08-05
**Tipo:** Copy únicamente — cero cambios de diseño, CSS, imágenes o estructura.

---

## index.html

### Meta / SEO

| Elemento | Antes | Después |
|---|---|---|
| `<title>` | "Fullsite — POS completo + Dashboard + IA para Restaurantes \| Monterrey" | "Fullsite — Software operativo para restaurantes \| Monterrey" |
| `meta description` | "No construimos otro POS… deteccion de fraude… Reemplaza Wansoft…" | "Fullsite conecta punto de venta, cocina, inventario y alertas operativas…" |
| OG/Twitter title | "Fullsite — POS completo + Dashboard + IA para Restaurantes" | "Fullsite — Software operativo para restaurantes" |

### JSON-LD

| Elemento | Acción |
|---|---|
| `Organization.description` | Actualizado (sin "detección de fraude") |
| `SoftwareApplication.name` | "Fullsite — POS completo + Dashboard + IA" → "Fullsite" |
| `SoftwareApplication.description` | Limpiado (sin "fraude", sin "Reemplaza Wansoft") |
| `SoftwareApplication.offers` (precio $4,999) | **ELIMINADO** |
| `SoftwareApplication.aggregateRating` | **ELIMINADO** |
| `FAQPage` respuestas | Todas actualizadas para consistencia con HTML |

### Navegación

| Elemento | Antes | Después |
|---|---|---|
| Enlace "Funcionalidades" (→ `#photos`) | Existía (sección no existe en HTML) | **ELIMINADO** |
| Enlace "Integraciones" | Existía | **ELIMINADO** (simplificado) |
| Enlace "Demo" | No existía | Agregado → `/demo.html` |
| CTA nav | "Empieza con Fullsite" → WhatsApp | "Agenda una demo" → `/demo.html` |

### Hero

| Elemento | Antes | Después |
|---|---|---|
| Eyebrow | "POS + Inteligencia Artificial" | "Software operativo para restaurantes" |
| H1 | "El sistema que los restaurantes necesitan" | "Deja de enterarte al cierre." |
| Sub | "POS completo con IA que detecta fugas, sugiere acciones y opera tu restaurante 24/7. Sin hardware propietario." | "Fullsite conecta punto de venta, cocina, inventario y alertas operativas para ayudarte a detectar los problemas mientras todavía puedes actuar." |
| CTA primario | "Empieza con Fullsite" → WhatsApp | "Agenda una demo" → `/demo.html` |
| CTA secundario | "Agendar demo" → WhatsApp | "Habla por WhatsApp" → `wa.me` |
| Social proof | Ninguno | "En operación dentro de un restaurante de servicio completo en Monterrey." |

### Feature 1

| Elemento | Antes | Después |
|---|---|---|
| Tag | "POS + Dashboard + IA" | "Operación conectada" |
| Título | "Todo en un solo lugar" | "POS, cocina, inventario e inteligencia. En un solo sistema." |
| Descripción | "La mayoría te da el POS o el dashboard. Nunca los dos…" | "Fullsite registra lo que ocurre durante el servicio, conecta cada estación…" |
| Bullets | "Predicción de ventas, detección de fraude, delivery (Uber Eats, Rappi)…" | "Punto de venta, mesas. KDS. Pagos. Caja. Permisos." |

### Feature 2

| Elemento | Antes | Después |
|---|---|---|
| Tag | "Tu copiloto operativo" | "Inteligencia operativa" |
| Título | "Te dice qué hacer, no solo qué pasó" | "Identifica lo que se sale de patrón, mientras todavía puedes actuar." |
| Descripción | "Tu POS actual te da números muertos al cierre…" | "Fullsite cruza ventas, cocina, descuentos y operación para detectar patrones fuera de lo normal…" |
| Bullet "fraude" | "Detección automática de fraude en cancelaciones y descuentos" | "Cancelaciones y excepciones fuera de patrón enviadas a revisión." |
| Bullet "menú" | "Análisis de menú: qué quitar, qué subir de precio, qué promocionar" | "Comparativa de rendimiento por producto con ventas y consumo." |

### Stats

| Stat | Label antes | Label después |
|---|---|---|
| `$72M+` | "MXN analizados" | "en ventas históricas analizadas *" |
| `883` | "dias operando" | "días de historial operacional integrado" |
| Nota de pie | Ninguna | "* Incluye información histórica migrada del sistema anterior." |

### Integraciones

| Elemento | Antes | Después |
|---|---|---|
| Heading | "Se integra con lo que ya usas" | "Conectado con herramientas clave de tu operación" |
| Sub | "Conectamos tu operación con las plataformas que mueven tu negocio." | "WhatsApp activo. Integraciones adicionales en desarrollo." |
| Logos mostrados | Uber Eats, Rappi, DiDi, SAT, Mercado Pago, WhatsApp (todos igual) | Solo WhatsApp (Activo) + Mercado Pago + SAT (Próximamente) |
| Animación | Infinite scroll | Grid estático con badge de estado |

### Sección "Por qué Fullsite"

| Elemento | Antes | Después |
|---|---|---|
| Heading | "Lo que ningún POS *te da*." | "Información operativa *en tiempo real*." |
| Sub | "Tu POS actual te da números. Fullsite te dice qué significan…" | "Conecta punto de venta, cocina, inventario y alertas para que el gerente pueda actuar…" |

### Benefit Cards

| Card | Antes | Después |
|---|---|---|
| Predicción de ventas | Sin badge | Badge "En desarrollo" agregado; copy actualizado |
| Detección de fraude | Título: "Detección de fraude" | Título: "Cancelaciones y excepciones"; copy actualizado |
| Ingeniería de menú | "Qué platillos quitar, cuáles subir de precio…" | Título: "Rentabilidad por producto"; copy actualizado |
| Inventario automático | "Se descuenta solo. Sin contar a mano." | Título: "Inventario teórico"; copy honesto de consumo esperado |

### CTA Section

| Elemento | Antes | Después |
|---|---|---|
| Heading | "Tu restaurante merece operar con inteligencia" | "Deja de descubrir problemas cuando ya te costaron dinero." |
| Sub | "Empieza en 48 horas. Sin contrato. Garantia de 60 dias." | "Conoce cómo Fullsite conecta la operación de tu restaurante y solicita una evaluación acompañada." |
| CTA primario | "Escribenos por WhatsApp" | "Agenda una demo" → `/demo.html` |
| CTA secundario | "Enviar email" | "Habla por WhatsApp" |

### FAQ

| Pregunta | Cambio |
|---|---|
| Tiempo de instalación | "48 horas" → "Depende de la operación. Evaluación acompañada." |
| POS actual | "Nos conectamos a Wansoft…" → "Fullsite tiene su propio POS. Evaluamos fit en la implementación." |
| Cambio de POS | Actualizado para ser más honesto |
| Garantía | "60 días, te devolvemos el setup" → "fit claro desde la evaluación; términos caso por caso" |
| IA | "nunca se equivoca de formato" → "la interpretación y decisión final siempre es tuya" |
| Permanencia | "Mes a mes" → "sin contrato de permanencia; términos caso por caso" |
| Sucursales | "24 horas" → "los tiempos se definen en la evaluación" |

---

## demo.html — Reescritura completa

El archivo anterior (`demo.html`) ha sido reemplazado por una experiencia de agendamiento.

### Estructura nueva

- **Diseño:** Dos columnas (descripción izquierda + Cal.com derecha); mobile: apilado
- **Sistema de diseño:** Mismo que `index.html` (Inter, blanco, verde `#10b981`)
- **Calendario:** Cal.com inline embed — requiere configuración de cuenta (ver comentario en `<head>`)
- **Fallback:** WhatsApp aparece automáticamente si Cal.com no carga en 8 segundos
- **Analytics:** PostHog (placeholder — activar con key real antes del launch)

### Pasos de configuración requeridos antes de activar

1. Crear cuenta en cal.com
2. Crear evento "Demo Fullsite — 30 min" con preguntas de lead capture
3. Conectar Google Calendar + Google Meet
4. Reemplazar `"daniel-fullsite/demo"` en el script de Cal.com con el slug real
5. Reemplazar `"phc_placeholder"` con la key real de PostHog

### Información que NO aparece en la nueva demo.html

- Demo interactiva en `app.fullsite.mx/demo/dashboard` (requería login — removido)
- Testimonial atribuido a "Operador de AMALAY" con nombre de cliente — reemplazado con proof genérico
- Número de WhatsApp diferente (`528112741000`) — unificado a `528115324371`
