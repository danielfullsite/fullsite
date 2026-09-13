# Servicio de huella — binarios para empaquetar

Deja aquí los dos archivos y el instalador (NSIS) los llevará dentro de la app:

- `fingerprint-service.exe`  — compilado de `print-bridge/fingerprint-service.cs`
- `DPUruNet.dll`             — SDK DigitalPersona U.are.U (HID, propietario)

## Cómo se obtienen
- `DPUruNet.dll`: viene del SDK **DigitalPersona U.are.U** (o ya está en la caja de AMALAY en `C:\fullsite\`).
- `fingerprint-service.exe`: compilar con `print-bridge/build-fingerprint.bat` (usa `csc.exe`, no necesita Visual Studio).

## Qué pasa al instalar la app
`electron-app/main.js` → `startFingerprintService()` copia estos binarios a `C:\fullsite\`
la primera vez (si no existen) y los arranca en `127.0.0.1:7718`. Así **ya no hay que
copiarlos a mano** en cada caja — es el camino clonable a N clientes.

## Autorización local obligatoria

El arranque genera un `fingerprint-ipc-secret` de 32 bytes aleatorios. En Windows
vive bajo `%APPDATA%\Fullsite POS\fingerprint`, con ACL sólo para el usuario de la
caja y `SYSTEM`; el instalador manual y Electron leen exactamente el mismo archivo.
Pedro y el servicio lo conservan sólo en memoria. El secreto **nunca cruza HTTP**.
Cada llamada, incluida `health`, lleva timestamp, un nonce aleatorio y un HMAC que
liga método, ruta y hash del cuerpo. El servicio rechaza timestamps vencidos y
nonces repetidos. Su respuesta lleva otro HMAC ligado al mismo nonce, método,
ruta, status y cuerpo. Así Pedro no confía en cualquier proceso que haya ocupado
el puerto 7718 y dicho «soy el lector».

El secreto no forma parte de `config.json`, del preload, de `localStorage` ni de
la página web. El archivo y la variable de entorno sólo aprovisionan los dos
procesos locales; no se usan como cabecera bearer.

El servicio anterior no entiende esta protección. La actualización debe detener
el proceso viejo, reemplazar `fingerprint-service.exe` por el compilado nuevo y
reiniciar Fullsite. El arranque detecta la respuesta anterior y pide actualizar;
no cae a un modo compatible abierto. Pedro exige una respuesta HMAC válida en
cada llamada; firma ausente, firma incorrecta, replay o reloj fuera de ventana
hacen que el acceso a huella falle cerrado.

> Estos binarios **NO se commitean** (`.exe`/`.dll` propietario). El `.gitkeep` mantiene la carpeta.
> El build sólo los empaqueta si están presentes localmente al correr `electron-builder`.
