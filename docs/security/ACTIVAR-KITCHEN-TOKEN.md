# Activar el token de cocina — procedimiento

> 🔴 **Hueco abierto en producción.** Encontrado el 2026-08-26 barriendo todas las rutas API.
> El mecanismo que lo cierra **ya está construido de los dos lados**; sólo está apagado.
>
> No se activa sin provisionar primero las pantallas: encenderlo a ciegas deja la cocina sin
> comandas.

## Qué está pasando

`/api/pos/kitchen` sirve las órdenes de cocina a las pantallas KDS, que son *login-less* por
diseño — una pantalla en la cocina no teclea contraseñas. Se gatea por `client_id`, que es un
slug adivinable.

`lib/kitchen-token.ts` existe justamente para cerrar eso: ata la lectura a
`HMAC(kitchen:<client_id>, KITCHEN_TOKEN_SECRET)`. Pero es **opt-in**, y falla ABIERTO:

```ts
export function kitchenTokenEnabled(): boolean {
  return SECRET.length >= 16          // sin secreto → deshabilitado
}
export function verifyKitchenToken(clientId, token) {
  const expected = signKitchenToken(clientId)
  if (!expected) return true          // ← deshabilitado = autoriza a todos
  ...
}
```

**`KITCHEN_TOKEN_SECRET` no está configurada en producción.**

### Demostrado en vivo (2026-08-26)

Sin credenciales de ningún tipo, desde una máquina cualquiera:

```
GET https://app.fullsite.mx/api/pos/kitchen?client_id=amalay      → 200 · 0 filas
GET https://app.fullsite.mx/api/pos/kitchen?client_id=boruca      → 200 · 0 filas
GET https://app.fullsite.mx/api/pos/kitchen?client_id=lab-resto   → 200 · 8 filas
```

Ocho órdenes de cocina de otro restaurante. El endpoint devuelve `mesa`, `mesero`, `items`,
`notas`, `order_number` y tiempos. No expone dinero —la proyección excluye total, propina y
métodos de pago— pero sí la operación y los nombres del personal.

**El `client_id` es adivinable.** Un slug como `amalay` o el nombre de cualquier restaurante que
firmes se prueba en un segundo.

## Por qué NO se activa sin preparar

El token se guarda en `localStorage` de cada pantalla, con la llave `pos_kitchen_token`
(`lib/pos-data.ts:1606`). En cuanto `KITCHEN_TOKEN_SECRET` existe, el endpoint **exige** el
token: toda pantalla sin provisionar empieza a recibir `401` y **se queda sin comandas**.

En una cocina eso no es un error de log: es que dejan de salir los platillos.

## Procedimiento de activación

**Hacerlo con el restaurante cerrado, o con alguien parado frente a las pantallas.**

1. **Generar el secreto** (≥16 caracteres; 32 bytes aleatorios está bien) y guardarlo en el
   gestor de contraseñas.

2. **Calcular el token de cada tenant.** Es determinista, no hay que guardarlo en BD:
   ```
   token = base64url( HMAC-SHA256( clave = SECRET, mensaje = "kitchen:<client_id>" ) )
   ```
   Hay un helper: `signKitchenToken(clientId)` en `lib/kitchen-token.ts`.

3. **Provisionar cada pantalla ANTES de encender el secreto.** En cada KDS, desde la consola:
   ```js
   localStorage.setItem('pos_kitchen_token', '<token de ese tenant>')
   ```
   Con el secreto aún apagado el token se ignora, así que se puede provisionar sin prisa y sin
   riesgo.

4. **Encender en modo `grace` primero** (recomendado). Poner en Vercel:
   ```
   KITCHEN_TOKEN_SECRET = <el secreto>
   KITCHEN_TOKEN_MODE   = grace
   ```
   En `grace` el endpoint **verifica pero sigue sirviendo**, y deja en los registros de
   Vercel una línea por cada pantalla que no trae token válido:
   ```
   [kitchen-token] sin token válido, servido en modo grace { client_id, trae_token, ua }
   ```
   Así se ve **qué pantallas faltan por provisionar sin que la cocina se quede a ciegas**.
   Es el mismo patrón grace → strict del enforcement antifraude
   ([`FRAUD-ENFORCEMENT-FLAGS.md`](FRAUD-ENFORCEMENT-FLAGS.md)).

   > Un turno completo de servicio en `grace` es suficiente: si no aparece ninguna línea,
   > todas las pantallas están provisionadas.

5. **Pasar a `strict`** quitando `KITCHEN_TOKEN_MODE` (sin la variable, con secreto, el
   default ya es `strict`) y redesplegar.

6. **Verificar las dos direcciones:**
   - Una pantalla provisionada sigue recibiendo comandas.
   - Una petición sin token a `?client_id=<otro tenant>` devuelve **401**.

## Pendiente aparte: que falle CERRADO

Aun después de activarlo, el diseño sigue siendo opt-in: si algún día el secreto se borra o se
despliega un entorno sin él, el endpoint vuelve a servir abierto **sin avisar**.

Es el mismo antipatrón que tenía `POS_FALLBACK_PIN` antes del 2026-08-26. Una vez provisionadas
las pantallas, conviene invertirlo: sin secreto, **denegar** en vez de autorizar.

**Sigue sin cambiarse, y a propósito.** Invertir el default hoy —con el secreto ausente en
producción— dejaría a la cocina de AMALAY sin comandas en el siguiente despliegue, que es
exactamente lo que este documento trata de evitar. El modo `grace` existe para poder llegar a
ese punto sin ese riesgo: primero se comprueba que todas las pantallas traen token, después se
invierte el default.

> El orden importa y no es negociable: **provisionar → `grace` → `strict` → fallar cerrado.**
> Saltarse un paso se paga en el pase de cocina, en hora pico.

## Estado del código

| | |
|---|---|
| Firma y verificación del token | ✅ `lib/kitchen-token.ts` |
| Rollout `off` → `grace` → `strict` | ✅ `evaluarTokenCocina()` |
| Reporte de pantallas sin provisionar | ✅ registro en `grace` |
| Pruebas | ✅ 13, incluidas token ajeno y modo basura |
| `KITCHEN_TOKEN_SECRET` en producción | 🔴 **no está** — por eso el endpoint sirve abierto |
| Pantallas provisionadas | 🔴 ninguna |

Sin el secreto, todo lo anterior está inerte y el comportamiento es idéntico al de siempre.
**El código no es lo que falta: falta el turno con las pantallas enfrente.**
