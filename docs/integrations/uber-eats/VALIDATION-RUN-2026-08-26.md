# Uber — corrida de validación 2026-08-26 (caso #59499952)

> Qué es: la primera corrida contra el **test store nuevo** que Uber creó el 2026-08-25.
>
> ⚠️ **CORREGIDO el 2026-08-26.** La primera versión de este documento afirmaba que el sandbox
> nunca había servido la aplicación y que ésa era la causa raíz del histórico "cero 2xx".
> **Era falso, y el error fue mío.** Ver la sección siguiente.

---

## Corrección — el 404 me lo causé yo

La versión anterior de este documento decía que el proyecto de Vercel `fullsite-uber-sandbox`
tenía **Root Directory = `.`**, que la raíz del repo no tiene build, y que por eso toda la API
devolvía 404 desde siempre.

Lo primero es cierto: el Root Directory sí estaba en `.`. Lo segundo **no**: los deployments
anteriores **sí servían la aplicación**. Se comprueba golpeando cada deployment por separado —
`401` significa que la ruta existe y rechaza firma inválida (fail-closed correcto), `404`
significa que no hay app:

| Deployment | `POST /api/integrations/uber-eats/webhook` |
|---|---|
| `3qotxbspm` — hace 15 días | **401** ← la app estaba ahí |
| `h6t55c4fe` — hace 15 días | **401** ← la app estaba ahí |
| `q17y23fnw` — mi deploy desde la raíz, 03:11 | **404** ← lo introduje yo |
| `7gebmxq6a` — mi deploy desde `dashboard-app`, 04:17 | **401** |

O sea: **desplegué desde la raíz, rompí el sandbox, y luego reporté el arreglo como si fuera el
hallazgo.** El "cero 2xx" histórico **sigue sin explicación probada**, y la hipótesis viva es
otra: si la petición de token falla, nunca sale una llamada a la API, y Uber no registra nada.

> Regla que se me olvidó: antes de declarar causa raíz, comprobar que el síntoma existía
> **antes** de que yo tocara algo.

## Lo que sí cambió de configuración

El Root Directory del proyecto está en `.` y la raíz del repo no tiene build, así que hay que
desplegar **desde `dashboard-app`** (que trae su propio `vercel.json` con `framework: nextjs`).
Es una trampa real del proyecto, pero **no era la causa de nada** — los deploys anteriores se
habían hecho bien.

---

## Lo que se corrigió (nuestro lado)

| # | Problema | Corrección |
|---|---|---|
| 1 | Root Directory en `.` — desplegar desde la raíz rompe el sandbox (me pasó) | Desplegar siempre desde `dashboard-app` |
| 2 | **Vercel SSO protection activa** en `all_except_custom_domains` — cualquier llamada externa a las URLs del sandbox recibía una pantalla de login. Bloqueaba al **runner**, no a los webhooks de Uber: el webhook registrado apunta a `app.fullsite.mx` | Desactivada para este proyecto (sandbox, `UBER_ENV` fail-closed, endpoints admin con secreto propio) |
| 3 | Faltaban `UBER_ENV`, `UBER_TEST_CLIENT_ID` e `INTEGRATION_ADMIN_SECRET` en el proyecto | Agregadas en Production y Preview |
| 4 | `INTEGRATION_ADMIN_SECRET` (Vercel) y `UBER_SANDBOX_ADMIN_SECRET` (GitHub) podían no coincidir | Regenerado y sincronizado en ambos lados |
| 5 | `UBER_REDIRECT_URI` caía por default a `https://app.fullsite.mx/...` — **el código de USL habría aterrizado en producción**, no en el sandbox | Apuntado al callback del sandbox |
| 6 | Store de prueba clavado en workflows y docs | Ahora es input con default; barrido de los tres stores (`a4f298f4` vigente; `0f655507` y `633b57d4` retirados) |

---

## Estado de los 11 endpoints — medido con la plataforma sana (06:20 UTC)

> Las mediciones de las 04:30 quedaron invalidadas: Uber estaba degradado. Éstas son en frío,
> después de que el probe volvió a pasar.

**Los scopes SÍ están concedidos.** `scope_probe` phase2 devuelve `blocker: null` y
`granted_scope: "eats.order eats.store eats.store.orders.read eats.store.status.write"`.
Los 403 de las 04:30 eran la caída, no un bloqueo.

| # | Endpoint | Estado | Nota |
|---|---|---|---|
| — | `scope_probe` | ✅ 200 | 4 scopes concedidos |
| — | Store Status (GET) | ✅ 200 | `{"status":"ONLINE"}` — de ahí salió el enum correcto |
| 1 | Activate Integration | ✅ **200** | Estaba en rojo por mandar `action` en vez de `status`. Corregido y verificado en vivo |
| 2 | Get Integration Details | ✅ **200** | Devuelve *"Fullsite POS Test Store — AMALAY"* |
| 3 | Menu: Update Item/modifier | ⏳ sin probar | Requiere subir un menú real al store |
| 4 | Order: Accept | ⏸ | Requiere orden de prueba (se pone a mano) |
| 5 | Cancel Notification (webhook) | ✅ implementado | Rechaza firma inválida con 401 (verificado) |
| 6 | Order: Cancel | ⏸ | Requiere orden de prueba |
| 7 | Order: Deny | ⏸ | Requiere orden de prueba |
| 8 | Order: Get details | ⏸ | Requiere orden de prueba |
| 9 | Order: Mark Ready | ⏸ | Requiere orden de prueba |
| 10 | Promotions: Create | ✅ **resuelto** | Uber habilitó `eats.store.promotion.write` y `.read`. **Promoción creada con éxito** (caso #59620807) |
| 11 | Reporting: Request Report | ✅ **200** | Devuelve `workflow_id` |

**Marcador al cierre del 2026-08-26: 6 verdes · 5 esperando la orden de prueba · 0 bloqueados
por Uber · 1 sin probar** (`Menu: Update Item/modifier`, ya desbloqueado — el menú se subió con
`200`).

### Lo único que falta, y no es código

**Una cuenta de comensal (*eater*) de prueba.** La que Uber creó el 25-ago es de tipo
*Restaurant* (`daniel+test@fullsitetest.mx`), o sea el lado del comerciante. Para poner una
orden de prueba hace falta la del cliente.

El test store **no aparece en la app de Uber Eats** buscándolo por nombre con la dirección de
entrega puesta en la tienda — y es lo esperado: **el test store vive en sandbox y la app del
consumidor es producción.**

Pedido a Uber el 2026-08-26 13:12 con la plantilla del caso #59032062
(`daniel+eater@fullsitetest.mx`, misma dirección, ligada al test client). Uber acusó recibo a
la 13:53: *"Our technical team will review and respond to the issue."*

> **Está en su cancha.** Los cinco endpoints del ciclo de orden —Get, Accept, Deny, Cancel,
> Mark Ready— están implementados y esperan una orden real. No hay nada que preguntar de nuevo
> hasta que contesten.

## Bloqueos del lado de Uber — ya no queda ninguno

> ### ✅ Actualizado el 2026-08-26 por la tarde, contra el hilo de correo
>
> **Fuente:** caso **#59620807** (continuación del #59499952), no una corrida nueva. Este
> documento se había quedado atrás de la conversación con Uber.
>
> **Promociones: resuelto.** Uber habilitó `eats.store.promotion.write` **y**
> `eats.store.promotion.read` para el test client. Ambos scopes vuelven concedidos en el token
> M2M y **se creó una promoción con éxito**. Lo de abajo describe el estado anterior.
>
> **Delivery Store API: las cinco llamadas pasan** — List Stores, Get Store, Get Store Status,
> Pause y Activate. Dos fallaban por bugs nuestros, ya corregidos:
>
> - `update-store-status` rechazaba `PAUSED` como enum desconocido — el GET devuelve `PAUSED`
>   pero el POST espera `OFFLINE`;
> - poner una tienda offline exige `is_offline_until`, que no se mandaba.
>
> **Menú: subido.** `PUT /v2/eats/stores/{store_id}/menus` → **200**. La tienda reporta
> `onboarding_status ACTIVE` y `orderability ONLINE`, con horario de 24 h.

**Estado anterior, para referencia histórica:**

**`eats.store.promotion.write` no está habilitado para el test client.**
Con la ruta correcta, Uber nombra el scope él mismo:

> *"This endpoint requires at least one of the following scopes: eats.store.promotion.write"*

Y al pedir un token con ese scope, el endpoint responde **400**. Es el único punto de la
certificación que requiere que Uber mueva algo.

**Ya NO son bloqueos** (se cayeron al medir con la plataforma sana):

- ~~Scopes `eats.store` y compañía~~ → concedidos.
- ~~`eats.report`~~ → el cert #11 pasa.
- ~~Órdenes sandbox~~ → no son un bloqueo de Uber: se ponen a mano, ver
  [RUNBOOK-ORDEN-DE-PRUEBA.md](RUNBOOK-ORDEN-DE-PRUEBA.md).
- ~~Dashboard caído~~ → fue una degradación temporal de la plataforma de Uber
  (dashboard en todas sus rutas + endpoint de token devolviendo HTML entre 04:31 y ~05:50 UTC).

**Pendiente que no es un bloqueo técnico:** la titularidad de la aplicación está bajo
`admon@cafeamalay.com`. Ver [`../IDENTIDADES-Y-ACCESOS.md`](../IDENTIDADES-Y-ACCESOS.md).

## Cómo reproducir

```
SANDBOX_URL=https://fullsite-uber-sandbox.vercel.app \
INTEGRATION_ADMIN_SECRET=<secreto del proyecto sandbox> \
UBER_TEST_STORE_ID=a4f298f4-202f-47f5-b375-d2eefec0126c \
node dashboard-app/scripts/uber-validation/runner.mjs
```

Códigos de salida: `0` todo pasó · `1` algo falló · `2` sin fallos pero con pasos bloqueados
(el estado esperado hasta que Uber genere órdenes) · `3` error de configuración.

> El workflow `uber-validation-runner.yml` **no se puede disparar con `gh workflow run`** porque
> no existe en la rama default. Hasta que se mergee a `main`, correr el runner localmente.
