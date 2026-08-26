# Protecciones construidas vs activadas

> Levantado el 2026-08-26 tras una noche en la que cinco hallazgos seguidos tuvieron la misma
> forma: **el guardián existía, escrito y probado, pero no estaba encendido.**
>
> Este documento no busca agujeros nuevos. Pregunta otra cosa: *de las protecciones que ya
> construimos, ¿cuáles están puestas?*

## Cómo leerlo

Una protección apagada no es automáticamente un riesgo. Lo que decide es **hacia dónde falla**:

- **Falla ABIERTA** — sin su variable, el sistema autoriza. Apagada = desprotegido, en silencio.
- **Falla CERRADA** — sin su variable, el sistema deniega. Apagada = la función no existe, pero
  nadie entra.

Un mecanismo que falla abierto y está apagado **se ve idéntico a uno que funciona**. Ésa es la
razón de este documento.

---

## El estado, al 2026-08-26

| Protección | Activada | Falla hacia | Estado |
|---|:---:|---|---|
| `SHIFT_TOKEN_SECRET` | ✅ | — | Identidad del POS firmada |
| `INTEGRATION_ADMIN_SECRET` | ✅ | — | Endpoints admin de integraciones |
| `UBER_WEBHOOK_SECRET` | ✅ | — | Firma de webhooks de Uber |
| `RAPPI_WEBHOOK_SECRET` | ✅ | — | Firma de webhooks de Rappi |
| `POS_FALLBACK_CLIENT_ID` | ✅ | cerrada | Puesto el 2026-08-26 |
| **`KITCHEN_TOKEN_SECRET`** | 🔴 | **ABIERTA** | **Demostrado explotable** |
| ~~`CRON_SECRET`~~ | 🔴 | **cerrada** en `main` | Corregida (#130). **Aún no en producción** |
| `CANCEL_APPROVAL_STRICT` | 🔴 | observa | Registra pero no bloquea |
| `POS_APPROVAL_STRICT` | 🔴 | observa | Registra pero no bloquea |
| `PLATFORM_2FA_ENFORCED` | 🔴 | abierta *(a propósito)* | Rollout sin segundo factor |
| `ONBOARDING_SECRET` | 🔴 | **cerrada** | `503`. Correcto |
| `INTERNAL_ADMIN_PASSWORD` | 🔴 | **cerrada** | `500`. Correcto |
| `MANAGER_PINS_CLIENT_ID` | 🔴 | cerrada | Irrelevante: `MANAGER_PINS` tampoco está |

**5 activadas · 1 apagada fallando abierta · 2 en modo observación · 1 apagada a propósito ·
4 apagadas fallando cerradas.**

> Al 2026-08-26 quedaba **una** fallando abierta: `KITCHEN_TOKEN_SECRET`. `CRON_SECRET` se
> corrigió el mismo día —no encendiéndola, sino invirtiendo el default— pero el arreglo está
> en `main`, **no desplegado**: Vercel rechazó el build de producción con *"Deployment rate
> limited — retry in 24 hours"*. Mientras no despliegue, **producción sigue con las dos**.

---

## Las dos que fallan abiertas

### 1. `KITCHEN_TOKEN_SECRET` — comprobado en vivo

```
GET https://app.fullsite.mx/api/pos/kitchen?client_id=lab-resto   → 200 · 8 órdenes
```

Sin credenciales de ningún tipo. Devuelve mesa, mesero, items, notas y tiempos de cualquier
restaurante cuyo slug se adivine. Procedimiento de activación —que **requiere provisionar las
pantallas primero**— en [`ACTIVAR-KITCHEN-TOKEN.md`](ACTIVAR-KITCHEN-TOKEN.md).

### 2. `CRON_SECRET` — CORREGIDA el 2026-08-26

Era:

```ts
if (cronSecret && authHeader !== `Bearer ${cronSecret}`) { ... 401 }
```

Sin la variable la condición entera se saltaba, y la variable no estaba puesta. Cualquiera podía
disparar la corrida de los 5 agentes: cuota de Groq, escrituras en `agent_events`, avisos por
Telegram.

**No se arregló poniendo el secreto, sino invirtiendo el default.** Al revisarlo resultó que la
ruta no tiene ningún llamador legítimo: no aparece en el repo y **no hay `crons` en
`vercel.json`**. El agendado real de agentes lo hacen los workflows de GitHub Actions.

Así que exigir el secreto no rompe nada, y sin él la ruta ya no existe (`503`) en vez de existir
sin puerta. Si algún día se agrega un Vercel Cron, basta con poner la variable: Vercel manda la
cabecera solo.

5 pruebas de regresión; prueba de mutantes confirmada. Mergeada en #130.

> ⚠️ **Implementado y probado, no desplegado.** El build de producción del merge falló con
> *"Deployment rate limited — retry in 24 hours"* — el límite diario de deploys de Vercel,
> quemado la madrugada del 26. Hasta que despliegue, producción sigue sirviendo la ruta sin
> puerta. Verificar en vivo cuando se libere: `GET /api/agents/cron` sin cabecera → **503**.

---

## Las que están apagadas y está bien

`ONBOARDING_SECRET` devuelve `503` y `INTERNAL_ADMIN_PASSWORD` devuelve `500` cuando no están
configuradas. Eso es exactamente lo correcto: sin secreto, la función no existe.

**Sirven de patrón.** Las dos que fallan abiertas deberían verse así.

---

## Las dos en modo observación

`CANCEL_APPROVAL_STRICT` y `POS_APPROVAL_STRICT` registran las cancelaciones y reaperturas sin
aprobación, pero **no las bloquean**. El plan era voltearlas 3–7 días después del demo de agosto,
cuando `legacy_no_approval` llegara a ~0 en `pos_audit_log`.

Eso fue hace tres semanas. La consulta que decide está en
`security/FRAUD-ENFORCEMENT-FLAGS.md`; el dato ya debería alcanzar.

Mientras sigan en observación, **el sistema antifraude ve el fraude y no lo detiene.**

---

## La regla que sale de aquí

> Una protección nueva nace **fallando cerrada**, o nace con una fecha para voltearla.
> Un `if (SECRET && ...)` es una protección que se apaga sola y no avisa.

Y una prueba concreta que vale la pena agregar a CI: que este documento y las variables reales
no se separen. Si aparece un mecanismo de seguridad gateado por entorno que no está listado aquí,
la prueba truena.

## Cómo se regenera

```bash
# 1. Variables de seguridad que el código lee
grep -rhoE "process\.env\.[A-Z][A-Z0-9_]*" --exclude-dir=node_modules --exclude-dir=__tests__ \
  dashboard-app/src | sed 's/process\.env\.//' | sort -u \
  | grep -iE "SECRET|TOKEN|STRICT|ENFORCE|PASSWORD" | grep -v NEXT_PUBLIC

# 2. Cuáles están puestas en producción
vercel env ls production | awk '{print $1}'

# 3. Para cada apagada, leer el código y responder: ¿falla abierta o cerrada?
```

El paso 3 no se automatiza: es leer. Pero son minutos, y es la pregunta que esta noche contestó
cinco veces seguidas con "hay otra".
