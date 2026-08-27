# SQUARE FOR RESTAURANTS BIBLE — el freemium, de pies a cabeza

**Fecha:** 2026-08-27 · **Método:** búsqueda pública, guías de pricing y reviews 2026. Convención: [HECHO] / [INFERENCIA].
**Complementa:** `../COMPETITIVE-INTELLIGENCE.md` §2.2. **No compite en MX** (sin CFDI, sin presencia restaurantera real) — esta biblia es más corta y sirve como **benchmark de producto y pricing**, no como desarme de amenaza.

---

## 1. Ficha

- Block, Inc. (NYSE: SQ). El POS del "long tail" — millones de micronegocios; restaurantes son una vertical encima del ecosistema de pagos [HECHO].
- Modelo: **software casi regalado, gana por procesamiento** (2.4–2.6% + fijo). El anti-Toast en fricción de entrada: te registras solo, sin contrato, hardware barato.

## 2. Planes y pricing 2026 [HECHO]

| Plan | USD/mes | Procesamiento presencial | Notas |
|---|---|---|---|
| Free | $0 | 2.6% + 15¢ | POS completo, menús, reportes básicos, online ordering, team mgmt, 1 location |
| Plus | $49 | 2.5% + 15¢ | + inventario integrado, close-of-day reports, coursing básico; KDS $30/device; Kiosk $50/device |
| Premium | $149 | 2.4% + 15¢ | + coursing y seat management; KDS $20/device; Kiosk $30/device |

- Online: 2.9% + 30¢ en todos.
- **KDS y Kiosk se cobran POR DISPOSITIVO** y bajan de precio en el plan alto — pricing de expansión inteligente [HECHO].
- Sin contrato de permanencia; hardware genérico barato (iPad) o propio (Square Register/Terminal).

## 3. Producto — lo relevante

- POS en iPad/hardware propio; menús, modificadores, coursing (Premium), seat management (Premium).
- **Novedades 2025-2026** [HECHO]: **AI Voice Ordering** (oct-2025: IA conversacional contesta el 100% de las llamadas, toma la orden personalizada y la manda a cocina/POS) · combo menu items · **custom report builder**.
- Dashboard web: reportes de ventas, close-of-day, inventario (Plus+), team; el ecosistema Square agrega payroll, marketing, lending (Square Capital), banking — el mismo playbook fintech de Toast pero horizontal, no vertical.
- Offline: modo limitado con pagos almacenados (riesgo asumido por el comercio) — no diseñado para full-service con 15 mesas abiertas [HECHO/INFERENCIA].

## 4. Qué copiar · qué ignorar

**Copiar:**
- **AI Voice Ordering** — contestar el teléfono con IA y meter la orden al POS. En MX el equivalente natural es WhatsApp (ya es nuestra arquitectura de orquestador; el caso de uso "pedido por WhatsApp directo a cocina" es constructible con lo que tenemos) [INFERENCIA].
- **Custom report builder** — cuando el dashboard madure, dejar que el dueño arme su reporte.
- Pricing por dispositivo para KDS/Kiosk que BAJA en el plan alto — incentiva upgrade en vez de castigar expansión.
- Onboarding self-service total: registrarse, configurar menú y cobrar el mismo día sin hablar con nadie — la vara de "clonabilidad Minute 0" que ya perseguimos con el Golden Skeleton.

**Ignorar:**
- Su modelo de negocio (subsidiar software con procesamiento) no nos aplica hasta tener la pata de pagos.
- Coursing/seat management fino: nuestro ICP (café/brunch/casual MX) no lo pide hoy.

## 5. Material de estudio

- squareup.com/us/en/point-of-sale/restaurants (producto) · Square YouTube channel (demos oficiales).
- Reviews con capturas: fitsmallbusiness.com/square-for-restaurants, NerdWallet, posusa.com.

## 6. Qué falta por verificar

- [ ] Demo del custom report builder (video).
- [ ] Detalle técnico del AI Voice Ordering (¿qué stack, qué precio?).
