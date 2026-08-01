# Script — Junta Rappi
## 6 julio 2026

---

## Contexto

Rappi es ~14% del delivery de AMALAY (32 órdenes / $12,601 en 13 días de mayo). UberEats es ~82% (149 órdenes / $75,991). Ticket promedio delivery: $488.

Fullsite necesita la integración directa con Rappi para:
1. Recibir órdenes automáticamente en el POS (hoy se capturan manual en tablet)
2. Actualizar disponibilidad de items por inventario en tiempo real
3. Eliminar la tablet de Rappi como dispositivo separado

---

## Apertura (2 min)

"Hola, soy Daniel Ramonfaur, founder de Fullsite. Estamos construyendo un sistema operativo para restaurantes con IA. Mañana hacemos cutover completo en nuestro primer restaurante — AMALAY Coffee & Market en Monterrey — reemplazando Wansoft que llevan usando 20 años.

Rappi es un canal importante para AMALAY y queremos integrar las órdenes directamente al POS para eliminar la captura manual y los errores."

---

## Lo que queremos (2 min)

1. **API de órdenes** — recibir órdenes de Rappi directamente en Fullsite (webhook o polling)
2. **API de catálogo** — sincronizar menú y disponibilidad desde Fullsite a Rappi
3. **API de status** — confirmar, rechazar, y actualizar estado de órdenes

"No necesitamos nada custom. Solo acceso a su API estándar de partners para poder recibir y procesar órdenes automáticamente."

---

## Lo que ofrecemos (2 min)

"Para Rappi, esto significa:
- Menos órdenes rechazadas (disponibilidad en tiempo real por inventario)
- Tiempos de preparación más rápidos (la orden llega directo al KDS de cocina, sin captura manual)
- Mejor experiencia para el restaurante (1 sistema en vez de POS + tablet Rappi)

Estamos en proceso de desplegar en 50 restaurantes en Monterrey este año. Cada uno sería un restaurante que opera Rappi directamente desde Fullsite."

---

## Preguntas para Rappi

1. **¿Cuál es el proceso para obtener acceso a la API de partners?**
   - ¿Necesitamos firmar algún acuerdo?
   - ¿Hay requisitos mínimos (# de restaurantes, volumen)?

2. **¿Cuál es el modelo de integración?**
   - ¿Webhook (Rappi nos manda la orden) o polling (nosotros consultamos)?
   - ¿Hay sandbox para pruebas?

3. **¿Qué documentación tienen disponible?**
   - API docs
   - Postman collection
   - Ejemplo de integración

4. **¿Hay algún programa para integradores/POS partners?**
   - Wansoft tiene integración con Rappi — ¿cómo funciona esa relación?
   - ¿Hay un partnership tier para POS que quieran integrarse?

5. **Timeline**
   - ¿Cuánto toma desde solicitud hasta tener credenciales de sandbox?
   - ¿Cuánto toma certificación para producción?

---

## Si preguntan sobre Fullsite

- "Somos un Restaurant OS cloud-native con IA. POS, KDS, inventario, compras, 30 agentes de IA."
- "Mañana reemplazamos Wansoft en producción en nuestro primer restaurante."
- "Nuestro plan es 50 restaurantes en Monterrey este año, todos con integración directa Rappi."
- "Ya tenemos los datos de delivery de AMALAY analizados — 32 órdenes Rappi en 13 días, $12,601, ticket promedio $488."

---

## Si dicen NO o "todavía no"

"Entiendo. ¿Qué necesitaríamos tener para calificar? ¿Hay un número mínimo de restaurantes? Mientras tanto, ¿hay alguna forma de recibir las órdenes de forma semi-automatizada — por ejemplo, un webhook a un email o un CSV de órdenes?"

---

## Cierre

"Gracias por su tiempo. Les mando un resumen por email con lo que platicamos. ¿Quién es mi punto de contacto para seguimiento?"

Pedir:
- Nombre y email del contacto directo
- Link a documentación de API
- Timeline estimado

---

## Datos que llevar preparados

| Dato | Valor |
|------|-------|
| Restaurante piloto | AMALAY Coffee & Market, Monterrey |
| Órdenes Rappi (mayo, 13 días) | 32 |
| Revenue Rappi (mayo, 13 días) | $12,601 MXN |
| Ticket promedio Rappi | $394 MXN |
| Órdenes rechazadas | 2 |
| % de delivery total | 14% (Rappi) vs 82% (UberEats) |
| Marca en Rappi | "Amalay" |
| Restaurantes planeados año 1 | 50 en Monterrey |
| Stack técnico | Next.js + Supabase + Vercel |
| Cutover | Martes 8 julio 2026 |
