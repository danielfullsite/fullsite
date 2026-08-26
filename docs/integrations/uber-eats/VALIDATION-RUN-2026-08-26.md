# Uber — corrida de validación 2026-08-26 (caso #59499952)

> Qué es: la primera corrida contra el **test store nuevo** que Uber creó el 2026-08-25.
> Resultado corto: **el sandbox nunca había servido la aplicación**. Ésa era la causa raíz del
> histórico "cero 2xx" — no eran los scopes, era que no había app que responder.

---

## Causa raíz del "cero 2xx"

El proyecto de Vercel `fullsite-uber-sandbox` tenía **Root Directory = `.`** (la raíz del repo),
y la raíz **no tiene build** — `package.json` de raíz sólo declara `vitest`, y no hay `vercel.json`
ahí. El proyecto de producción `fullsite` sí apunta a `dashboard-app` con preset Next.js.

Consecuencia: cada deploy del sandbox terminaba "Ready" en 12-16 segundos sin construir nada, y
**todas las rutas `/api/...` devolvían 404**. Todas las corridas de validación anteriores
chocaban contra eso, no contra Uber.

Evidencia del antes y el después, misma llamada, mismo store:

| Hora (UTC) | Deploy | `scope_probe` |
|---|---|---|
| 03:11 | root `.` (12-16 s, sin build) | **404** — `eats.order NOT granted / probe error` |
| 04:17 | `dashboard-app`, Next.js 16.2.6 (2 min) | **200 PASS** — `eats.order granted (marketplace M2M)` |

---

## Lo que se corrigió (nuestro lado)

| # | Problema | Corrección |
|---|---|---|
| 1 | Root Directory apuntaba a la raíz del repo → 404 en toda la API | Deploy desde `dashboard-app` (que ya trae `vercel.json` con `framework: nextjs`) |
| 2 | **Vercel SSO protection activa** en `all_except_custom_domains` — los webhooks de Uber recibían una pantalla de login, nunca la app | Desactivada para este proyecto (sandbox, `UBER_ENV` fail-closed, endpoints admin con secreto propio) |
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
| 5 | Cancel Notification (webhook) | ✅ implementado, responde 200 | ahora sí alcanzable (SSO off) |
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

**2. No existe endpoint para crear órdenes sandbox.** `delivery_sandbox_order` probó los dos
documentados y ninguno responde:

- `POST /v1/eats/sandbox/orders`
- `POST /v1/sandbox/eats/orders`

Sin órdenes, los certs **4, 6, 7, 8 y 9** no se pueden ejercer. Uber tiene que generarlas.

**3. USL no completado para el store nuevo.** `phase1_usl.db_status = no_row_found` — el store
recién creado no tiene token almacenado. Requiere que el dueño re-autorice, y que
**el redirect URI del sandbox quede registrado en el Developer Dashboard del test app**:
`https://fullsite-uber-sandbox.vercel.app/api/integrations/uber-eats/auth/callback`

**4. Rate limiting observado.** Tras ~20 peticiones de token en dos minutos, el endpoint de
auth empezó a devolver **HTML en vez de JSON** (`Unexpected token '<'`). No es un fallo nuestro:
la misma llamada había pasado en 200 minutos antes. Espaciar las corridas.

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
