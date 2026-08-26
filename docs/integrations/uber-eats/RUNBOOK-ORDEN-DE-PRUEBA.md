# Runbook — generar una orden de prueba en el sandbox de Uber

> Fuente: guía oficial de Uber, *Order Integration → Testing Orders*
> (`developer.uber.com/docs/eats/guides/order-integration`), que Uber nos citó en el
> caso #59128344 el 2026-08-20. Ver [VALIDATION-RUN-2026-08-26.md](VALIDATION-RUN-2026-08-26.md).

**No existe un endpoint para crear órdenes de prueba.** Se ponen a mano, como cliente.
Esto cierra la pregunta que llevábamos tres casos repitiendo.

---

## Lo que Uber documenta, textual

1. **Customer Setup** — inicia sesión en Uber Eats con tu cuenta de prueba. Pon la dirección
   de entrega en el test store.
2. **Store Setup** — entra a **Uber Eats Orders** con las credenciales del test store.
   Asegúrate de que la tienda esté **Open**.
3. **Place an Order** — haz el pedido como cliente. **No se requiere pago ni repartidor.**
   La orden aparece en Uber Eats Orders y dispara el webhook.
4. **Check Webhook Receipt** — nuestro servicio recibe el webhook y responde **HTTP 200**.
5. **Test Accept/Deny** — se ejercitan los endpoints de Accept y Deny.

---

## Datos del test store vigente

| | |
|---|---|
| Store ID | `a4f298f4-202f-47f5-b375-d2eefec0126c` |
| Org UUID | `06f29618-7f2f-4115-a435-1d2027e43547` |
| Test client ID | `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq` |
| Dirección | Plaza Duendes, Calzada Mauricio Fernández Garza, Del Valle, San Pedro Garza García, NL |
| Login de Uber Eats Orders | `daniel+test@fullsitetest.mx` |
| Contraseña | llegó **en texto plano por correo** → cambiarla al primer acceso |

---

## Precondición que hay que resolver antes del paso 3

**¿A dónde llega el webhook?** El registrado con Uber apunta a
`https://app.fullsite.mx/api/integrations/uber-eats/webhook` (producción).

`UBER_ENV` es un switch **global por deployment** (`resolveUberEnv()` en
`lib/integrations/uber-eats/env.ts`): un deployment es sandbox **o** producción, nunca los dos.
Entonces sólo hay dos configuraciones válidas:

- **A — producción corre en `UBER_ENV=sandbox`** durante la certificación. Funciona, pero deja
  al POS vivo apuntando al sandbox de Uber. Aceptable sólo porque todavía no hay órdenes reales.
- **B — el webhook del *test app* apunta al deployment sandbox** (`fullsite-uber-sandbox`), y
  producción se queda en `production`. **Es la correcta**, y se cambia en el Developer Dashboard:
  `https://fullsite-uber-sandbox.vercel.app/api/integrations/uber-eats/webhook`

> **Bloqueo al 2026-08-26:** el Developer Dashboard de Uber responde *"Something went wrong"*
> tanto en `/dashboard/products` como en la URL directa de la aplicación. El GraphQL devuelve
> 200 y la UI truena igual. **Mientras siga así, la opción B no se puede aplicar.**

Verificado el 2026-08-26: ambas rutas de webhook del sandbox están vivas y **rechazan una firma
inválida con `401`** — comportamiento fail-closed correcto:

- `/api/integrations/uber-eats/webhook` → 401
- `/api/webhook/ubereats` → 401

---

## Después de que exista el order_id

```
SANDBOX_URL=https://fullsite-uber-sandbox.vercel.app \
INTEGRATION_ADMIN_SECRET=<secreto del proyecto sandbox> \
UBER_TEST_STORE_ID=a4f298f4-202f-47f5-b375-d2eefec0126c \
UBER_TEST_ORDER_ID=<el order_id de la orden de prueba> \
node dashboard-app/scripts/uber-validation/runner.mjs
```

Ejercita get → accept → ready → resolve → cancel y sale con `0` sólo si todo pasó.

---

## Lo que NO desbloquea esta prueba

Los scopes. `eats.store`, `eats.store.status.write`, `eats.store.orders.read`, `eats.report` y
`eats.deliveries` devuelven **403** en la petición de token; sólo `eats.order` está concedido.
Eso mantiene bloqueados Activate Integration, Get Integration Details, Menu Update, Store Status,
Create Promotion y Get Report files — **independientemente de las órdenes**. Ése es el único
punto que sí requiere que Uber mueva algo.

Poner la tienda en **Open** se hace desde el portal, no por API, así que la prueba de órdenes
puede avanzar en paralelo mientras los scopes se resuelven.
