# Identidades y accesos de las plataformas de delivery

> **Por qué existe:** el 2026-08-26 se perdió media sesión investigando por qué el Uber
> Developer Dashboard mostraba *"Something went wrong"* y cero aplicaciones, sin saber con qué
> cuenta se estaba entrando. La identidad correcta (`admon@cafeamalay.com`) no estaba escrita en
> ningún lado del repo.
>
> **Regla:** ninguna plataforma se da por bloqueada hasta confirmar **con qué identidad** se está
> entrando. Este documento es la fuente de esa respuesta.
>
> ⚠️ **Nota (misma fecha):** en este caso la cuenta **no** era la causa — ver
> *"El dashboard sí está roto"* abajo. La regla sigue valiendo; el diagnóstico de ese día, no.

**Este documento NO contiene secretos.** Sólo dice *qué cuenta* y *dónde vive* cada credencial.
Los valores viven en Vercel, en GitHub Secrets, o en el gestor de contraseñas. Nunca aquí.

---

## Uber Eats

| Qué | Identidad | Notas |
|---|---|---|
| **Developer Dashboard** (apps, scopes, webhook URL) | **`admon@cafeamalay.com`** | ⚠️ Es el buzón de **AMALAY**, no de Fullsite. Ver el problema estructural abajo |
| Casos de soporte con Uber GTS | `daniel@fullsite.mx` | Los correos llegan aquí, pero el dashboard es de otra cuenta |
| **Uber Eats Orders** del test store | `daniel+test@fullsitetest.mx` | La creó Uber el 2026-08-25. La contraseña llegó **en texto plano por correo** → cambiarla |
| Cuenta de cliente para poner órdenes de prueba | pendiente de definir | Requerida por la guía *Testing Orders* |

**Test client ID:** `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq`
**Production client ID:** `6bHtSqLJsdTZxWvFRt0f1jjv-BzbE92T`
**Test store vigente:** `a4f298f4-202f-47f5-b375-d2eefec0126c`

### El dashboard sí está roto — evidencia (2026-08-26)

Se probó con dos cuentas distintas, incluida `admon@cafeamalay.com` recién autenticada
(round-trip de OAuth completo, `_csid` y `state` frescos en la URL). Resultado idéntico:

| Ruta | Resultado |
|---|---|
| `/dashboard/products` (listado) | *"Something went wrong"* |
| `/dashboard/products/{client_id}` (detalle) | *"Something went wrong"* |
| **`/dashboard/create-application`** | *"Something went wrong"* + el botón queda deshabilitado |

La tercera es la que decide: **crear una aplicación no depende de que existan aplicaciones
previas.** Si esa ruta también truena, no es un problema de titularidad ni de cuenta vacía.

Señales adicionales: el endpoint `/dashboard/graphql` responde **HTTP 200** (el servidor
contesta) pero la UI entra a su rama de error, y **no hay errores en consola** — o sea que la
app está manejando deliberadamente un error que viene del servidor.

**Correlación, no prueba:** desde las **04:31 UTC** del mismo día, el endpoint de token del
sandbox (`sandbox-login.uber.com`) devuelve **HTML en vez de JSON**, y a las 05:04 seguía igual.
Dos superficies de la plataforma de desarrolladores degradadas el mismo día. Vale la pena
mencionárselo a Uber GTS junto, por si es el mismo incidente — pero **no afirmar que lo es**.

> Consecuencia práctica: mientras el dashboard no cargue, **no se puede cambiar el webhook URL
> del test app ni revisar los scopes aprobados**, que son dos de los tres bloqueos de Uber.

### 🚩 Problema estructural — la app de Uber no es de Fullsite

La integración vive bajo el buzón administrativo de **un cliente**. Fullsite es el **integrador
POS** y va a conectar muchos restaurantes; la aplicación tiene que ser de Fullsite, con AMALAY
como *merchant*, no al revés.

Consecuencias si no se corrige:

- Si la relación con AMALAY cambia, **se pierde la integración de todos los clientes futuros**.
- El cliente #2 no puede colgarse de una app que pertenece al cliente #1.
- Nadie de Fullsite puede tocar scopes ni webhooks sin pedirle la contraseña a AMALAY.
- La identidad partida (dashboard de un lado, casos de soporte del otro) es exactamente lo que
  hace que un caso se responda con *"no encontramos logs de tu aplicación"*.

**Acción:** pedirle a Uber GTS que **transfiera la titularidad** de la aplicación a una cuenta de
Fullsite, o que agregue `daniel@fullsite.mx` como desarrollador de la app. Hasta entonces,
cualquier cambio de configuración pasa por la cuenta de AMALAY.

---

## Rappi

| Qué | Identidad | Notas |
|---|---|---|
| Contacto en Rappi | Rodrigo Murguía Irigoyen — TAM Integraciones | Responde por correo |
| Usuario de la plataforma de pruebas | `daniel@fullsite.mx` | Así se dio de alta el 2026-08-12 |
| **Integrations Manager** (menú, suscripciones) | `integrations-manager.rappi.com` | Alta por *password-recovery* |
| Credenciales DEV | Vercel / gestor | ⚠️ **Expuestas** — viajaron en texto plano por correo el 2026-08-13. Rotar |

**Store de pruebas:** `900173586` · **Portal PROD:** sólo aparece `DEFAULT (NO USAR)` hasta que
Rappi aprovisione `Fullsite_PROD`.

Aquí la titularidad **sí es correcta**: la integración es de Fullsite Technologies, con AMALAY
como merchant.

---

## DiDi Food

Sin cuenta, sin contrato, sin credenciales. Lo único que existe en el repo es el parseo de
webhooks en `cloudflare/delivery-worker/src/index.ts`. No hay identidad que documentar todavía.

---

## Antes de declarar un bloqueo

1. ¿Con qué cuenta estoy entrando? ¿Es la dueña del recurso?
2. ¿El síntoma existía **antes** de que yo tocara algo?
3. ¿La plataforma ya respondió esta pregunta en algún hilo de correo?

Las tres se saltaron el 2026-08-26 y costaron horas.
