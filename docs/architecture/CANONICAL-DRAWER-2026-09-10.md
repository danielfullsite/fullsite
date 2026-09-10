# Cajón autorizado en Caja

Candidato opt-in, validado con receptor TCP sintético. Complementa
[durabilidad](DURABLE-COMMANDS-2026-09-05.md) y
[documentos](CANONICAL-PRINT-2026-09-10.md). No acredita apertura física.

## Comandos y autoridad

`canonical-drawer.js` prepara las aperturas; la UI usa `pedro-cajon.ts` y el
journal de comandos existente. El navegador no elige bytes ni destino.

- `PAYMENT_DRAWER_OPEN`: actor con `pos.payments.collect`, cuenta propia o
  `ver_todas_cuentas`, pago en efectivo aceptado y positivo del turno vigente.
  Un pago sólo permite una apertura original; recuperar usa el mismo comando.
- `DRAWER_OPEN`: turno vigente, permiso `cajero` y motivo explícito.
- `DRAWER_UNCERTAIN_RESOLVE`: permiso `gerente`, trabajo canónico de cajón,
  episodio vigente, motivo y decisión `opened` o `retry_pulse`.

Aceptar dinero no dispara el cajón. La apertura es una acción explícita y un
fallo de impresora no invalida el pago. Se revalidan actor y permisos al recuperar
un comando; una apertura ya comprometida puede recuperarse después de cerrar el
turno. Abrir de nuevo exige una nueva intención manual autorizada.

## Un destino y un pulso

La configuración exige `drawer_printer_id`: una impresora habilitada con estación
`caja`. El asistente permite elegirla explícitamente, conserva la selección al
importar/guardar y exige corregir una selección que ya no sea válida. Guardar
configuración no envía pulsos. No se elige automáticamente otra impresora.

`prepareDrawerJobs` captura un solo trabajo, una copia y bytes ESC/POS
`1b700019fa`. Ignora las copias de papel y no usa fallback de estaciones.
Los efectos durables conservan la conexión original después de un reinicio o
cambio de configuración. El flujo de papel rechaza trabajos de cajón y viceversa.

## Resultado incierto y persistencia

`drawer_operations` reserva la apertura al comprometer el evento, antes del
efecto de cola. `drawer_resolutions` reserva cada episodio de la misma forma.
Así, una falla de cola posterior al commit no permite comprometer otra apertura
por ese pago ni una segunda decisión para el mismo episodio.

Una interrupción deja el pulso incierto: no se repite automáticamente. El
encargado confirma `opened` o solicita explícitamente `retry_pulse`, que envía
un solo pulso al destino original. Reproducir el recibo de una decisión antigua
no resuelve un episodio nuevo. La UI conserva intentos hasta validar el recibo y
ofrece recuperación global incluso fuera de la cuenta o del turno original.

Los eventos se materializan como auditoría, sin modificar dinero, órdenes ni
pagos. SQL valida turno/sucursal, referencia de efectivo aceptado, identidad del
trabajo, motivo y unicidad por pago/episodio. No se envían bytes a nube.

## Evidencia y límites

El recorrido integrado pasa 22/22 casos con Caja, otras terminales y KDS;
verifica apertura manual y por abono, dos pulsos exactos y dinero intacto.
Pruebas de servidor incluyen interrupción SIGKILL, reinicio, cambio de destino,
falla de cola después de commit, deduplicación y autorización. PostgreSQL pasa
15 grupos del materializador. TCP confirma transporte; impresora, cajón físico,
sensores, cortes eléctricos y aceptación Windows permanecen en H05/H15.
