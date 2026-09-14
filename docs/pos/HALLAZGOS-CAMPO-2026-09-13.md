# Hallazgos de campo — AMALAY, noche del 2026-09-13 al 14

Sesión con acceso remoto a la Caja (TeamViewer) y, desde la madrugada, con acceso
directo por Tailscale. Todo lo que sigue está **medido**, no inferido: cada afirmación
trae el comando o el archivo que la sostiene.

Terminales involucradas:

| Nodo | Tailscale | LAN | Rol | Build al cierre |
|---|---|---|---|---|
| `SERVER1` (caja) | `100.108.165.48` | `192.168.1.71` | `server_pos` | 1.4.0 · `1dfd213492d7` |
| `PDV2` | `100.91.142.45` | `192.168.1.4` | secundaria | 1.4.0 · `793125c804a5` |

---

## 1. CERRADO — La huella no servía porque el binario era de julio

**Síntoma.** «Entrar con huella» en gris, con el texto «Huella no disponible: Lector
DigitalPersona no disponible».

**Causa raíz.** El `fingerprint-service.exe` instalado en `C:\fullsite\` era del
**2026-07-08**, 18 KB, versión `0.0.0.0`. Contestaba `200` a peticiones **sin firmar** y
su respuesta no traía firma HMAC. Pedro exige las tres cosas —firma válida,
`ipc_auth_required: true` y `ipc_auth_scheme: 'hmac-sha256-v1'`— en
`electron-app/local-server/index.js:793-796`, y antes de eso ya lanza al verificar la
firma de la respuesta (`index.js:425-435`). Esa excepción caía en el `catch` de
`index.js:797-799`, que es el que imprime literalmente ese texto.

Nunca fue el lector: su `/health` reportaba `"ok":true`, reconocía el sensor
(`{E2130C8E-55AF-B847-85E0-C547BE6B6B61}`) y `"enrolled":1`.

**Arreglo.** Se compiló `print-bridge/fingerprint-service.cs` en la propia Caja con el
compilador de C# que Windows ya trae (`print-bridge/build-fingerprint.bat`) y se
reemplazó el binario. Respaldo del anterior en
`C:\fullsite\fingerprint-service.VIEJO.exe`.

**Verificado en campo:** el botón quedó activo y el servicio dejó de responder a
peticiones sin firmar.

**Efecto colateral cerrado — era un hueco de seguridad.** Con el binario viejo,
cualquier programa corriendo en esa máquina podía pedirle al lector que identificara a
una persona, sin credencial alguna. La capa HMAC existe justo para cerrar eso.

**Pendiente.** Este arreglo es **sólo de esa caja**. `electron-app/fingerprint/` está
vacío en el repo a propósito (el DLL es del SDK propietario de DigitalPersona), así que
el instalador no empaqueta el binario y ninguna terminal nueva lo recibe. Mientras no se
resuelva, la huella funciona donde alguien la compiló a mano y en ninguna caja nueva.

---

## 2. CERRADO — No se podía cobrar: el POS no recibe los arreglos por Vercel

**Síntoma.** «Esta orden fue modificada por otro usuario. Recarga la mesa.» al cobrar,
sin que nadie hubiera tocado la orden. Persistía tras reiniciar el POS.

**Lo que se descartó, con medición.** El servidor estaba sano: la orden de la mesa 8
(`062aba3b`) tenía `order_revision = 1` en Supabase **y** `rev = 1` en Pedro. Los dos
libros coincidían. El arreglo de la comparación (`order_revision` en lugar de
`updated_at`) ya estaba en `main` y **desplegado en producción** (deployment de
`54b3cf30`, posterior al merge de #400).

**Causa raíz.** El POS de Electron **no carga la página de Vercel**. Instala un
interceptor de protocolo que sirve todo lo que va a `https://app.fullsite.mx` desde un
paquete guardado en disco; sólo `/api/*` sale a la red:

```js
// electron-app/offline-ui/protocol.js:19-31
if (url.origin !== ORIGIN || url.pathname.startsWith('/api/')) return { network: true }
…
return { file }   // sirve del paquete instalado
```

Y ese paquete **viaja dentro del instalador**, no se actualiza solo:

```js
// electron-app/main.js:1206
const bundledPath = … path.join(__dirname, 'ui-bundle')
bundle = fs.existsSync(bundledPath) ? store.install(bundledPath) : store.load()
```

Medido en la Caja: ninguno de los paquetes instalados en
`%APPDATA%\fullsite-pos\ui-packages\` contenía la cadena `order_revision,status`.

**Arreglo.** Se instaló el build `1dfd2134` (rama `claude/pos-touch-first`), que sí trae
el arreglo en su `ui-bundle`. Verificado por contenido antes de abrirlo, no por hash.

**Verificado en campo:** la mesa 8 cobró. En Supabase quedó
`status: cerrada`, `order_revision: 2`, `total: 150.80`.

> **La lección que vale para toda la flota.** «Esto llega por Vercel con un F5» es cierto
> para un navegador y **falso para el POS de Electron**. Cualquier corrección de interfaz
> que se declare entregada porque está en producción, y que se haya probado sólo en un
> navegador, **no está en las terminales**. Esto afecta a cada restaurante que se instale.

---

## 3. CERRADO — Mesas fantasma bloqueaban la operación

**Síntoma.** El plano mostraba 5 mesas ocupadas con $0.00 y 0 personas, incluida una
**mesa 43** en un salón de 33. Ninguna cuenta se podía abrir ni cobrar, y un aviso
amarillo duplicado ocupaba ~150 px de los 632 útiles.

**Causa raíz.** El event store local de Pedro
(`%APPDATA%\fullsite-pos\events.ndjson`) arrastraba 7 órdenes de sesiones de prueba
anteriores, **ninguna con `items`**. Esa carpeta es la misma para todos los builds, así
que sobrevivió a cada reinstalación.

Con órdenes sin `items`, `order_snapshot_complete` nunca puede volverse verdadero
(`electron-app/local-server/core/state.js:747`), y con esa bandera en falso
`seleccionarCuenta` devuelve **«incierta»** para toda cuenta
(`dashboard-app/src/lib/pedro-cliente.ts:112-118`). Además dos mesas tenían **dos
órdenes cada una**, lo que corta antes con «La caja reporta varias cuentas para esta
mesa» (`pedro-cliente.ts:108`).

Mientras tanto, las **dos cuentas reales** —mesa 1 con $197.20 y mesa 2 con $232.00—
estaban en la nube y la pantalla no las mostraba.

**Arreglo.** Se movieron `events.ndjson` y `processed-commands.ndjson` a una carpeta de
respaldo con fecha dentro del mismo directorio. No se borró nada. Antes se comprobó que
no hubiera cola de negocio ni impresiones inciertas pendientes.

**Verificado en campo:** `order_snapshot_complete: true`, dos mesas ocupadas que
coinciden con la nube, sin fantasmas y sin el aviso duplicado.

---

## 4. ABIERTO · P0 — Si se cae el internet, 39 de 40 personas no pueden entrar

**Medido el 2026-09-14 por el túnel.**

```
GET /auth/status  →  CAJA: prepared_users=1  roles=['admin']
                     PDV2: prepared_users=1  roles=['admin']

pos_staff de amalay, activos: 14 mesero · 14 cocina · 5 gerente · 4 cajero · 2 barra · 1 admin
```

**Por qué importa.** `requiereCaja()` devuelve `true` en **cualquier** ventana de
Electron, sin mirar el modo de autoridad
(`dashboard-app/src/lib/pedro-cliente.ts:26`). Las dos terminales de AMALAY son
Electron, así que el PIN se valida contra Pedro, y Pedro sólo acepta a los usuarios que
ya tiene preparados.

La caché de personal del navegador **no es una alternativa**: `/api/pos/staff-cache`
existe, pide las PINs a Supabase con la llave de servicio y las hashea, pero **ningún
archivo del repo la consume**. Y el propio módulo de autoridad lo dice en su
encabezado: *«Browser staff/role caches never …»*
(`electron-app/local-server/core/actor-authority.js:3`).

La política es explícita: *«Cada usuario y terminal deben validar PIN con internet antes
del corte WAN»*, con validez de 7 días (`max_validity_ms: 604800000`).

**Qué hay que hacer:**

1. **Operativo, antes del cutover.** Cada persona debe entrar una vez, con su PIN y con
   internet, **en cada terminal**. No puede hacerse el mismo día del cambio: si justo
   ese día falla la red, el restaurante se queda sin sistema y sin respaldo.
2. **De producto.** Falta una acción de «preparar esta terminal para operar sin
   internet» que precargue a todo el personal activo, y un aviso visible del tipo
   «faltan 39 usuarios por habilitar». Hoy el sistema **no avisa** que está a un apagón
   de no poder trabajar.

> Es el mismo patrón que ya costó caro tres veces en este proyecto: **el guardián mudo**.
> Una terminal sin usuarios preparados se ve idéntica a una terminal lista.

---

## 5. ABIERTO — Ruta muerta que expone PINs

`dashboard-app/src/app/api/pos/staff-cache/route.ts` lee `pos_staff` con la llave de
servicio y devuelve el hash de la PIN de **todo el personal activo**. Ningún archivo del
repo la llama (comprobado con `grep` sobre `dashboard-app/src` y `electron-app`).

Superficie de ataque sin beneficio. Debe borrarse, o documentarse por qué existe.

---

## 6. ABIERTO — PDV2 no tiene ninguna estación de impresión

```
CAJA: stations = [barra, caja, cocina, tickets]
PDV2: stations = []
```

Falta confirmar si eso es correcto —una secundaria puede reenviar la impresión a la
Caja— o si significa que PDV2 no puede mandar a cocina cuando la Caja está apagada.
Sin verificar.

---

## 7. ABIERTO — 119 operaciones en la cola de sincronización de la Caja

`sync_queue_size: 119`, con `last_sequence: 119`: **nada** se ha sincronizado nunca. La
cola de negocio no está configurada (`/sync/status` → `BUSINESS_SYNC_NOT_CONFIGURED`),
lo cual es coherente con el modo legacy, donde el dinero lo escribe el navegador contra
la nube. Falta decidir si esa cola debe existir en modo legacy o si está creciendo sin
propósito.

Relacionado: la telemetría de flota nunca reportó (PR #401, `local_server_heartbeats`
con cero filas).

---

## 8. ABIERTO — Barra de desplazamiento horizontal en la comanda

El contenedor de la lista de platillos declara `overflow-y-auto` y deja el eje
horizontal en `visible` (`dashboard-app/src/app/pos/page.tsx:4923`). Por CSS, cuando un
eje deja de ser `visible`, el otro se vuelve desplazable. Y el renglón mide
contador + silla + importe + dos botones ≈ 324 px, así que al angostarse la ventana se
desborda — que es el mismo defecto reportado en campo como «está un poco cortado el
cancelar item y transferir platillo».

Taparlo con `overflow-x-hidden` cortaría los botones. La forma correcta es que el
renglón **se envuelva**.

---

## Estado de las suites al cierre

```
web   : 230 archivos · 3,803 pruebas · 0 fallas
Pedro : 116 suites   ·   679 pruebas · 0 fallas
DOM   :  44 archivos ·   326 pruebas · 0 fallas
```

**Los cuatro defectos de esta noche pasaron por ese verde.** Ninguno era detectable sin
una terminal real: el binario de huella, el paquete de interfaz congelado, la basura en
el event store y los usuarios sin preparar viven fuera del alcance de las pruebas.

---

## Gobierno — lo que hay que ordenar

- AMALAY opera con `claude/pos-touch-first`, **38 commits adelante de `main`**. La
  terminal de producción corre código que no está en la rama principal.
- El arreglo del cobro vive en esa rama y en `main` por dos caminos distintos (#399 y
  #400). Hay que reconciliarlos.
- La fuente del servicio de huella con HMAC **sólo** está en `claude/pos-touch-first`.
  Si esa rama se integra a medias, la huella se rompe en toda la flota con el síntoma de
  la sección 1.
