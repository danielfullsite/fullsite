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

## Evidencia local

- Dos regresiones de estado fallaron antes del arreglo (liberar una cuenta ajena,
  reabrir una anulada). La ampliación con replay/comanda/poll también falló antes
  de proteger la proyección cloud. Suite de estado: 33/33.
- Dos regresiones de orden de reintento fallaron antes de la corrección.
- Avisos y separación de borradores: 33/33 en dos archivos.
- Suite web: 3,568/3,568 antes de la última extracción del cálculo de avisos;
  excluye `analyst-planner-live.test.ts` (usa proveedor real).
- Primera pasada web: un timeout en `vercel-ignore-build` y una indisponibilidad
  del proveedor de IA. La prueba de Vercel pasó aislada y en la segunda suite.
- TypeScript: sin errores después de la extracción.
- Laboratorio UI local: no aprobado. Primera corrida agotó compilación; segunda
  pasó cocina y ACK WebSocket y agotó hidratación al abrir cuenta; tercera agotó
  navegación inicial. No atribuir estos fallos sólo al instrumento sin evidencia.

## Límites que impiden declararlo cerrado

El borrador debe pasar el laboratorio completo en CI y revisión de las cinco
mutaciones recuperadas. Las pruebas de fuente no reemplazan recorrer cancelación
individual, transferencia individual y fusión con sus fallos de red/concurrencia.
La actualización de snapshots desde distintas terminales todavía necesita su
propia prueba de concurrencia; la cola ordenada aquí cubre una terminal.

El build previo de Windows en main fue exitoso (run 34435874786), pero no contiene
estos cambios. Construir este candidato sin publicar un release de autoactualización.

Siguen pendientes las condiciones H01–H16 de `state/OPEN-ITEMS.md`, que distinguen
el modo legacy de la transición a autoridad de Caja. Este trabajo no completa por
sí solo todas las funciones de dinero, inventario y plataforma allí enumeradas.
Papel, huella, reinicio eléctrico, restauración y aceptación en AMALAY requieren
pruebas con equipos reales sobre el mismo candidato. No se modificó producción.
