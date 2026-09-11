# Candidato POS/KDS — recuperación del 10 de septiembre de 2026

Base: `2a5a3ad3` (#391, con T-09 y #390). Se retomaron los cambios sin commit de
`cert/instalador-2026-09-10`. No hay instalación ni certificación de campo.

## Cambios del candidato

- Avisos a Caja después de anular, cancelar un platillo, mover una mesa,
  transferir un platillo y fusionar mesas (trabajo recuperado de Claude).
- Un aviso nuevo de la misma cuenta espera al anterior pendiente. Las pasadas de
  reintento no adelantan un segundo aviso si el primero sigue fallando.
- Una actualización parcial omite campos ausentes; no borra el turno con `null`.
- Las cancelaciones y transferencias no incorporan los borradores sin enviar al
  aviso compartido. El cálculo usa `calcOrderTotals`, con IVA de la configuración.
- Caja conserva la identidad anulada: ni un aviso retrasado, ni otra comanda,
  ni una lectura cloud anterior pueden reabrirla. La anulación sólo libera la
  mesa si todavía pertenece a esa cuenta, y se reconstruye al reproducir eventos.
- El cambio de número de mesa con productos se bloquea en Electron; la acción
  explícita de transferir comprueba el resultado antes de anunciar éxito a Caja.

## Evidencia automatizada

- Regresiones de estado y reintentos reproducidas antes de sus arreglos.
- Suite web: **3,569/3,569** (197 archivos); excluye
  `analyst-planner-live.test.ts`, que necesita proveedor real.
- Suite DOM: **230/230** (22 archivos).
- Servidor Caja: **535/535**, tanto en macOS como en Windows.
- TypeScript: **0 errores**. ESLint conserva 82 diagnósticos previos en los
  archivos revisados; la comparación por regla/severidad no añadió diagnósticos.
- Arranque frío: **5/5**, Electron real en macOS con el `ui-bundle` extraído del
  portátil Windows `9ae4320f`. Perfil Chromium vacío, sin Next ni WAN, PIN
  tecleado y verificado por Caja, catálogo LAN y reinicio del proceso real.
  Este bundle tiene el mismo código de producto que el candidato sellado;
  esta prueba usa el runtime macOS y no sustituye ejecutarlo en Windows.
- Laboratorio UI: **21/21**, tres POS y KDS,
  [CI fe444cb5](https://github.com/danielfullsite/fullsite/actions/runs/34449964970).
  Incluye traslado con HTTP 200 comprobado, anulación offline, cobro único y
  reintento del cierre perdido. El laboratorio usa nube HTTP sintética aislada.

## Instalador verificable

[Build Windows del candidato](https://github.com/danielfullsite/fullsite/actions/runs/34448151518),
commit `c275ce1738c5b1f7c1455bae9c3a59bb25d9938c`, versión `1.4.0`.
SHA-256 del instalador:
`eb81b06f44c7bbf0bd951787fe3cbfecc6b7902fb319ba4009241a3ceb5fd3b0`.

Se corrigió el pipeline: ahora sella `build-info.json` antes de empaquetar y
verifica dentro del ASAR el commit, versión y árbol limpio. El primer build de
esta recuperación carecía del sello y quedó reemplazado por éste.

No se publicó autoactualización ni se instaló en AMALAY. El repositorio no
contiene el SDK propietario/servicio compilado de huella: el candidato no
certifica una instalación nueva con huella. La evidencia estructurada está en
[evidence-20260910/candidate.json](evidence-20260910/candidate.json).

## Límites que impiden declararlo cerrado

El borrador pasó el laboratorio de 21 casos, pero falta completar la revisión
y aceptación de las cinco mutaciones recuperadas. Las pruebas de fuente no reemplazan recorrer cancelación
individual, transferencia individual y fusión con sus fallos de red/concurrencia.
En la ruta legacy de transferencia individual, la compensación del origen tras
fallar el destino aún escribe sin condición de versión; podría pisar una edición
concurrente. Es un bloqueo de revisión H04, no una garantía de atomicidad.
La actualización de snapshots desde distintas terminales todavía necesita su
propia prueba de concurrencia; la cola ordenada aquí cubre una terminal.

Siguen pendientes las condiciones H01–H16 de `state/OPEN-ITEMS.md`, que distinguen
el modo legacy de la transición a autoridad de Caja. Este trabajo no completa por
sí solo todas las funciones de dinero, inventario y plataforma allí enumeradas.
Papel, huella, reinicio eléctrico, restauración y aceptación en AMALAY requieren
pruebas con equipos reales sobre el mismo candidato. No se modificó producción.
