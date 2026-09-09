# Acceso de empleados en Caja

Estado: candidato local; no desplegado. Complementa la credencial de instalación de [transporte LAN](LAN-TRANSPORT-AUTH.md) y el [contrato financiero](FINANCIAL-COMMANDS-2026-09-05.md).

## Flujo

El POS autorizado envía el PIN a su Pedro por `POST /auth/pin`. Un secundario reenvía la petición a Caja conservando la identidad de terminal. Caja consulta la autoridad HTTPS de PIN; sólo la respuesta de esa petición puede preparar al empleado. Datos `staff`, `role` o `deviceId` del body no provisionan permisos. La identidad de terminal viene del transporte y sigue dependiendo del secreto compartido de instalación; aún no es una clave individual por dispositivo.

Caja guarda verificadores scrypt con salt e índice HMAC, alcance restaurante/sucursal y preparación por terminal. No guarda PIN en claro. Firma sesiones locales, las devuelve sin caché HTTP y comprueba firma, alcance, terminal, vigencia y revocación antes de cada comando financiero. El token viaja en `x-fullsite-actor` (HTTP) o en el sobre WS, fuera del payload persistido. HTTP y WS del secundario ejecutan en la misma Caja.

La credencial preparada dura como máximo siete días; una sesión dura como máximo ocho horas y nunca supera la vigencia de la credencial. Son límites del candidato, expuestos por `/auth/status`; el arranque frío completo aún debe certificarse con su paquete offline. Preparar una persona no prepara automáticamente otra terminal. Un PIN rechazado explícitamente revoca su verificador; una terminal revocada queda bloqueada sin revocar al empleado en otras terminales. Caídas de infraestructura se distinguen de rechazo para no invalidar acceso local por una falla de nube.

Diez intentos fallidos en diez minutos bloquean nuevos intentos. El contador es global por Caja, durable y serializado. Reiniciar no lo limpia; retroceder el reloj falla cerrado. Un fallo de persistencia no emite una sesión basada sólo en memoria y bloquea nueva autorización hasta reiniciar y verificar almacenamiento.

## Permisos y límites

La tabla granular existente de `pos-permissions.ts` se movió sin alterar valores a `electron-app/local-server/core/permission-profiles.json`. Ambos runtimes consumen ese mismo archivo. Conserva alias de dueño/personal y la regla de cancelación sólo por administrador. El permiso de resultado de proveedor externo nunca pertenece a un perfil humano.

La pantalla Electron/configurada usa el PIN de Caja y conserva la sesión en sessionStorage; los cachés anteriores del navegador no la sustituyen. Bloquear o vencer la sesión elimina el token de pantalla. La presencia/exclusividad online conserva el módulo anterior; su equivalente durable por LAN sigue pendiente. El PIN local offline no depende de la disponibilidad de ese módulo cloud.

La huella del cliente no constituye todavía una autenticación verificable por Caja: en este candidato se pide PIN para entrar al POS local. Falta conectar y certificar el lector y su prueba de presencia. No habilitar este candidato como actualización transparente de una instalación que dependa de huella sin completar esa aceptación.

En el candidato integrado `a01087e5`, operaciones y finanzas de Caja exigen contexto de empleado y permisos. Las rutas legacy de impresión cruda, cajón y resolución manual se bloquean en modo Caja; la impresión canónica de comandas sigue el resultado autorizado de `ORDER_SEND`. El recibo de cobro, cajón y resolución autorizada de impresión aún requieren integración. Las APIs cloud tienen su propia revisión de permisos pendiente: un token local no las autoriza ni demuestra un cobro bancario. Véanse [operaciones](OPERATIONAL-COMMANDS-2026-09-05.md) y [brechas vigentes](../audit/FULLSITE-HUECOS-ACTUALES-2026-09-08.md).

## Evidencia inicial (histórica)

- Servidor integrado: 367/367.
- Frontend integrado: 2979/2979.
- Autoridad y finanzas con el runtime Node de Electron: 30/30.
- Laboratorio de cuatro procesos Electron y pantallas reales: 7/7; incluye pago parcial por HTTP de POS 2 reflejado en POS 3, liquidación sin retirar cocina y comando WS del secundario confirmado en Caja. Sesiones sintéticas preparadas; aún no pulsa PIN/cobro ni certifica banco.
- TypeScript: 22 errores existentes en pruebas UI por dependencia `@testing-library/react` ausente y sus tipos derivados; ninguno en los archivos del cambio.

Estos contadores describen la entrega inicial de autenticación. La [evidencia integrada posterior](../audit/evidence-20260905/integrated-candidate.json) incluye arranque frío 5/5 con PIN pulsado, operación UI 13/13 y TypeScript aprobado; todavía no certifica huella ni Windows. No se aplicaron migraciones cloud ni se modificaron datos de clientes.
