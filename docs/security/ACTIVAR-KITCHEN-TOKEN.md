# Activar el token de cocina — procedimiento

> 🟠 **El código ya falla cerrado. Falta desplegarlo, y el orden importa.**
>
> Encontrado el 2026-08-26 barriendo las rutas API, y **reproducido en producción el mismo
> día**. El mecanismo estaba construido de los dos lados pero era opt-in: sin secreto
> autorizaba a todos, y el secreto nunca se puso.
>
> Ese default ya se invirtió (`verifyKitchenToken` devuelve `false` sin secreto). Con eso,
> **desplegar sin haber provisionado las pantallas deja la cocina sin comandas.** El orden de
> abajo no es una recomendación.

## Qué está pasando

`/api/pos/kitchen` sirve las órdenes de cocina a las pantallas KDS, que son *login-less* por
diseño — una pantalla en la cocina no teclea contraseñas. Se gatea por `client_id`, que es un
slug adivinable.

`lib/kitchen-token.ts` existe justamente para cerrar eso: ata la lectura a
`HMAC(kitchen:<client_id>, KITCHEN_TOKEN_SECRET)`. Era **opt-in**, y fallaba ABIERTO:

```ts
// ANTES — el bug
export function verifyKitchenToken(clientId, token) {
  const expected = signKitchenToken(clientId)
  if (!expected) return true          // ← sin secreto = autoriza a todos
  ...
}

// AHORA
export function verifyKitchenToken(clientId, token) {
  const expected = signKitchenToken(clientId)
  if (!expected) return false         // ← sin secreto = no autoriza a nadie
  ...
}
```

**`KITCHEN_TOKEN_SECRET` sigue sin estar configurada en producción.** Mientras no se ponga,
el endpoint deniega todo — que es lo correcto, pero también significa que las pantallas no
funcionan hasta terminar el procedimiento.

### Por qué nadie lo vio en meses

`verifyKitchenToken` **ya estaba registrado** en `GUARDIANES_DE_SESION`
(`lib/seguridad/guardianes-api.ts`), así que el barrido de rutas contaba `/api/pos/kitchen`
como protegida y daba verde. El barrido comprueba que la ruta **llame** a un guardián, no que
el guardián **pueda negar**. Un guardián que autoriza a todos se ve idéntico a uno que
funciona.

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

2. **Calcular el token de cada tenant.** Es determinista, no se guarda en BD:
   ```
   token = base64url( HMAC-SHA256( clave = SECRET, mensaje = "kitchen:<client_id>" ) )
   ```
   Hay un script que lo imprime listo para pegar:
   ```bash
   KITCHEN_TOKEN_SECRET='...' node scripts/token-cocina.mjs amalay demo lab-resto
   ```
   El secreto va por variable de entorno, no como argumento: los argumentos quedan en el
   historial del shell y en la lista de procesos.

3. **Provisionar cada pantalla, con el código viejo todavía en producción.** En cada KDS,
   desde la consola:
   ```js
   localStorage.setItem('pos_kitchen_token', '<token de ese tenant>')
   ```
   Mientras el secreto no exista en Vercel, el código viejo ignora el token — así que este
   paso se puede hacer sin prisa y sin romper nada. **Es la única ventana segura.**

4. **Poner `KITCHEN_TOKEN_SECRET` en Vercel.** Desde aquí las pantallas sin provisionar ya
   reciben `401`.

5. **Mergear el PR que hace fallar cerrado y redesplegar.**

   > Si se invierte el orden de 3 y 4/5, todas las pantallas se quedan sin comandas al mismo
   > tiempo. No hay degradación parcial: o tienen token o no lo tienen.

6. **Verificar las dos direcciones:**
   - Una pantalla provisionada sigue recibiendo comandas.
   - Sin token, `?client_id=<otro tenant>` devuelve **401** (antes devolvía `200`).
   - Con el token de un tenant, pedir OTRO tenant devuelve **401**.

## Qué queda cubierto y qué no

**Cubierto.** Ya no se puede enumerar entre restaurantes con un slug, y un despliegue sin la
variable deniega en vez de abrir. El caso "se borró el secreto" ahora se nota en dos segundos
en vez de filtrar en silencio: `route.ts` distingue en el log *falta la variable* de *token
inválido*, porque en operación se ven igual —la pantalla dice "sin comandas"— pero se
arreglan distinto.

**No cubierto.** El token vive en `localStorage` de cada pantalla y se provisiona a mano.
Quien tenga acceso físico o remoto a una pantalla puede leerlo, y sirve para ese tenant hasta
que se rote el secreto (lo cual obliga a re-provisionar todas las pantallas de todos los
tenants a la vez). Es aceptable para un dispositivo dentro del restaurante; deja de serlo si
alguna vez hay una pantalla fuera del local.

La versión que quita ese pendiente es que la pantalla obtenga su token de una sesión real la
primera vez que se configura, en vez de que alguien la teclee. No se hace en este PR porque
cambia el flujo de alta del KDS y esto es un P0 de seguridad.
