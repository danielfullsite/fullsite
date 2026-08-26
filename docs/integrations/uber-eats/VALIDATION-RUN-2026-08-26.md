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

## Estado de los 11 endpoints de la certificación

| # | Endpoint | Estado | Bloqueado por |
|---|---|---|---|
| — | `scope_probe` (diagnóstico) | ✅ **200**, `eats.order` concedido | — |
| 1 | Activate Integration | ⛔ | token 403 para `eats.store …` |
| 2 | Get Integration Details | ⛔ | token 403 para `eats.store …` |
| 3 | Menu: Update Item/modifier | ⛔ | scope `eats.store` |
| 4 | Order: Accept | ⛔ | **no hay orden sandbox** |
| 5 | Cancel Notification (webhook) | ✅ implementado; rechaza firma inválida con 401 (verificado) | falta un evento real |
| 6 | Order: Cancel | ⛔ | **no hay orden sandbox** |
| 7 | Order: Deny | ⛔ | **no hay orden sandbox** |
| 8 | Order: Get details | ⛔ | **no hay orden sandbox** |
| 9 | Order: Mark Ready | ⛔ | **no hay orden sandbox** |
| 10 | Promotions: Create | ⛔ | token 403 para `eats.store` |
| 11 | Reporting: Get Report files | ⛔ | token 403 para `eats.report` |

---

## Bloqueos del lado de Uber (con evidencia)

**1. Scopes no concedidos al test client `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq`.**
La petición de token M2M devuelve **403** por combinación de scopes:

| Scopes pedidos | Resultado |
|---|---|
| `eats.order` | ✅ concedido (probe 200, 04:17 UTC) |
| `eats.store eats.store.status.write eats.order eats.store.orders.read` | ❌ 403 |
| `eats.store` | ❌ 403 |
| `eats.report` | ❌ 403 |
| `eats.deliveries` | ❌ 403 |

**2. Las órdenes de prueba NO son un bloqueo de Uber — las ponemos nosotros.**
`delivery_sandbox_order` probó `POST /v1/eats/sandbox/orders` y `POST /v1/sandbox/eats/orders`;
ninguno existe. Y no deberían: la guía *Order Integration → Testing Orders* de Uber dice que la
orden se coloca **a mano, como cliente**, contra el test store con la tienda en **Open**.
Uber ya nos lo respondió en el caso #59128344 el 2026-08-20.
Procedimiento: [RUNBOOK-ORDEN-DE-PRUEBA.md](RUNBOOK-ORDEN-DE-PRUEBA.md).
**No volver a pedírselas.**

**3. USL no completado para el store nuevo.** `phase1_usl.db_status = no_row_found` — el store
recién creado no tiene token almacenado. Requiere que el dueño re-autorice, y que
**el redirect URI del sandbox quede registrado en el Developer Dashboard del test app**:
`https://fullsite-uber-sandbox.vercel.app/api/integrations/uber-eats/auth/callback`

**4. Endpoint de token degradado — evidencia incompleta.** Cronología real:

| Hora UTC | Qué se observó |
|---|---|
| 04:17 | `scope_probe` **200 PASS** — `eats.order` concedido. Único dato limpio. |
| 04:30 | 7 acciones seguidas → **403** con el scope enumerado: `scope='eats.store'`, `scope='eats.report'`, y el combo de 4 |
| 04:31 en adelante | el endpoint devuelve **HTML en vez de JSON** (`Unexpected token '<'`) |
| 05:01 | sigue devolviendo HTML, 30 min después |

Se dispararon ~20 peticiones de token en dos minutos, así que **rate limiting es la hipótesis
principal** — pero no está probado, y mientras el endpoint devuelva HTML **no se puede
re-confirmar el estado de los scopes**. La tabla de 403 de arriba se apoya en la corrida de las
04:30, que ya pudo estar degradada.

> No mandar la reclamación de scopes a Uber hasta re-confirmar en frío con **una sola** corrida.

---

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
