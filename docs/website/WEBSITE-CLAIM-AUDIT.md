# Website Claim Audit — Fullsite Landing Page

**Fecha:** 2026-08-05
**Alcance:** `fullsite-web/index.html` (pre-commit en branch `credibility-pass-aug2026`)
**Metodología:** Inspección manual de todos los claims de producto, métricas, integraciones y garantías comerciales.

---

## 1. Métricas y estadísticas

| Claim original | Fuente real | Tipo | Decisión |
|---|---|---|---|
| `$72M+ MXN analizados` | Wansoft histórico migrado a Supabase (wansoft_daily) | MIGRATED DATA | Cambiar label a "en ventas históricas analizadas *"; agregar nota de pie |
| `97K+ tickets procesados` | Conteo histórico migrado | MIGRATED DATA | Cambiar label a "tickets analizados"; agregar nota de pie |
| `883 días operando` | Cobertura del historial de Wansoft | MIGRATED DATA | Cambiar a "días de historial operacional integrado" |
| `24/7 monitoreo IA` | GitHub Actions crons activos + agentes Supabase | VERIFIED | OK sin cambios |

**Nota de pie agregada:** "* Incluye información histórica migrada del sistema anterior."

---

## 2. Claims de producto

| Claim original | Status real | Decisión |
|---|---|---|
| "Detección automática de fraude" (feature 2, benefits card, meta) | Funcionalidad de monitoreo de cancelaciones/descuentos existe, pero llamarla "fraude" implica culpabilidad legal no verificada | MODIFICADO → "Cancelaciones y excepciones" |
| "Sin contar a mano" (inventario) | Inventario teórico funciona (descuenta por receta), pero no reemplaza conteos físicos | MODIFICADO → "Inventario teórico" con descripción honesta |
| "Predicción de ventas" | Agente activo que corre a las 2pm/4pm/6pm | EN DESARROLLO → badge "En desarrollo" agregado |
| "Qué platillos quitar, cuáles subir de precio" | Agente de menu engineering existe pero no da recomendaciones definitivas | MODIFICADO → "Rentabilidad por producto" |
| "Opera tu restaurante 24/7" (hero sub) | Agentes monitorean, no operan el restaurante | MODIFICADO → copy honesto en hero sub |
| Offline-first | En certificación de campo (no completamente certified) | Referencia eliminada del hero y feature copy (la sección de offline no estaba en el hero) |

---

## 3. Integraciones

| Logo mostrado | Status real | Decisión |
|---|---|---|
| WhatsApp | ACTIVO (notificaciones y agentes) | Mostrar como "Activo" |
| Mercado Pago | EN DESARROLLO (MP Point Smart en progress) | Mostrar como "Próximamente" |
| SAT / CFDI | EN DESARROLLO (Facturapi, pendiente CSD de Andy) | Mostrar como "Próximamente" |
| Uber Eats | UNKNOWN para Fullsite nativo (Wansoft vía E-Commerce) | ELIMINADO del scroll |
| Rappi | UNKNOWN para Fullsite nativo | ELIMINADO del scroll |
| DiDi Food | UNKNOWN para Fullsite nativo | ELIMINADO del scroll |

---

## 4. Claims comerciales y legales

| Claim original | Status | Decisión |
|---|---|---|
| "60 días de garantía, te devolvemos el setup" (FAQ) | No hay evidencia de que se ofrezca formalmente por escrito | MODIFICADO → "los términos se definen en cada implementación" |
| "Empieza en 48 horas" (CTA section) | Tiempo no validado con implementaciones externas reales | ELIMINADO del CTA |
| "Cada sucursal adicional se activa en 24 horas" (FAQ, JSON-LD) | No validado externamente | MODIFICADO → "los tiempos dependen de la evaluación" |
| "Sin contrato de permanencia" | Correcto para AMALAY, pero no hay contrato formal con clientes externos | MODIFICADO → "las condiciones se definen caso por caso" |
| `aggregateRating: 5/5, ratingCount: 1` (JSON-LD) | 1 review = restaurante del fundador, no cliente independiente | ELIMINADO del JSON-LD |
| `offers.price: 4999` (JSON-LD) | Precio no validado con clientes externos pagando | ELIMINADO del JSON-LD |

---

## 5. Copy agresivo / competitivo

| Claim original | Decisión |
|---|---|
| "Reemplaza Wansoft, Soft Restaurant y cualquier POS tradicional" (meta description) | ELIMINADO |
| "La mayoría te da el POS o el dashboard. Nunca los dos." | MODIFICADO → copy de valor sin denigrar competidores |
| "IA que trabaja por ti" con implicación de autonomía total | MODIFICADO → "inteligencia operativa" con alcance honesto |
| "nunca se equivoca de formato" (FAQ IA) | ELIMINADO |

---

## 6. Schema.org / SEO

| Elemento | Decisión |
|---|---|
| `AggregateRating` con 1 review | ELIMINADO |
| `SoftwareApplication.offers` con precio | ELIMINADO |
| Title: "POS completo + Dashboard + IA" | MODIFICADO → "Software operativo para restaurantes" |
| Meta description con "detección de fraude" | MODIFICADO |
| FAQPage JSON-LD | Todas las respuestas actualizadas para consistencia con HTML |

---

## 7. CTAs

| CTA original | Decisión |
|---|---|
| "Empieza con Fullsite" → WhatsApp (nav, hero, mobile) | MODIFICADO → "Agenda una demo" → /demo.html |
| "Agendar demo" → WhatsApp (hero) | MODIFICADO → "Habla por WhatsApp" → wa.me |
| "Escribenos por WhatsApp" → WhatsApp (CTA section) | MODIFICADO → "Agenda una demo" → /demo.html |

---

## Resultado

- **Claims eliminados:** 5 (rating falso, precio, garantía 60 días, 48h install, "nunca se equivoca")
- **Claims modificados:** 12
- **Integraciones eliminadas:** 3 (Uber Eats, Rappi, DiDi)
- **Claims verificados y mantenidos:** 1 (24/7 monitoreo IA)
- **"fraude" mentions:** 7 → 0
