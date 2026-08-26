# Identidades y accesos de las plataformas de delivery

> **Por qué existe:** el 2026-08-26 se perdió media sesión investigando por qué el Uber
> Developer Dashboard mostraba *"Something went wrong"* y cero aplicaciones. La respuesta no era
> un fallo de Uber: **el navegador estaba con una cuenta distinta a la dueña de la aplicación.**
> Eso no estaba escrito en ningún lado del repo.
>
> **Regla:** ninguna plataforma se da por bloqueada hasta confirmar **con qué identidad** se está
> entrando. Este documento es la fuente de esa respuesta.

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
