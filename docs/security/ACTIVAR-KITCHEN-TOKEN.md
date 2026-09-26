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

4. **Recién entonces**, poner `KITCHEN_TOKEN_SECRET` en Vercel y redesplegar.

5. **Verificar las dos direcciones:**
   - Una pantalla provisionada sigue recibiendo comandas.
   - `curl` sin token a `?client_id=<otro tenant>` devuelve **401**.

## Plan de enrolamiento controlado

Este plan convierte el procedimiento en una operación verificable. No se debe
inventar ni registrar el secreto, los tokens, IDs de equipos o nombres de
restaurantes en tickets, JEV, Git o evidencia pública.

### Fase A — preparación (sin activar seguridad)

1. Crear un inventario privado de pantallas KDS: tenant opaco, sucursal,
   responsable presente y versión instalada.
2. Generar el secreto en el gestor de secretos aprobado; dos responsables
   verifican que no se copie a repositorios ni logs.
3. Calcular el token por pantalla dentro de una sesión segura y provisionarlo
   localmente mientras el endpoint aún está abierto.
4. Verificar, pantalla por pantalla, que conserva la lectura normal antes de
   pasar a la siguiente. Registrar únicamente un resultado de enrolamiento,
   nunca el token.

### Fase B — activación con observación

1. Confirmar que el inventario no tiene pantallas pendientes.
2. Configurar `KITCHEN_TOKEN_SECRET` sólo en producción y crear un despliegue
   identificable.
3. Probar una pantalla enrolada y una solicitud sin token contra un tenant de
   prueba. La primera debe funcionar y la segunda debe recibir `401`.
4. Observar las cocinas durante el turno acordado; no cambiar P19 ni el diseño
   POS durante esta ventana.

### Fase C — recuperación y cierre

- Si una pantalla no recibe comandas, se restaura el despliegue previo y se
  deja la pantalla fuera del siguiente intento hasta reenrolarla.
- No se borra el secreto ni se cambia a modo abierto como reacción rápida: se
  documenta la causa y se sigue el rollback de despliegue.
- Una vez que todas las pantallas operen con token, se abre una tarea separada
  para volver el endpoint fail-closed cuando falte el secreto.

## Pendiente aparte: que falle CERRADO

Aun después de activarlo, el diseño sigue siendo opt-in: si algún día el secreto se borra o se
despliega un entorno sin él, el endpoint vuelve a servir abierto **sin avisar**.

Es el mismo antipatrón que tenía `POS_FALLBACK_PIN` antes del 2026-08-26. Una vez provisionadas
las pantallas, conviene invertirlo: sin secreto, **denegar** en vez de autorizar.

No se cambia hoy porque hacerlo antes de provisionar tiene exactamente el efecto que este
documento trata de evitar.
