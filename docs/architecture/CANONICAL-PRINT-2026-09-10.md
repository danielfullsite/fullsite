# Documentos y verificación de papel en Caja

Candidato de software en validación, sin impresoras productivas ni instalación.
Complementa [durabilidad](DURABLE-COMMANDS-2026-09-05.md) y
[operaciones](OPERATIONAL-COMMANDS-2026-09-05.md).

## Autoridad y documentos

`canonical-print.js` prepara documentos desde la orden y los pagos de Caja. El
navegador sólo envía identidad, revisiones y la intención de imprimir. No envía
bytes, importes, estaciones, empleado atribuido ni configuración de impresora.

- `ORDER_PRECHECK_PRINT`: consumo guardado, descuento, IVA, total, abonos,
  reservas y saldo. Exige revisión operacional y financiera cuando existe.
  Dice «PRECUENTA — NO ACREDITA PAGO». Una cuenta cancelada no genera una
  precuenta nueva.
- `PAYMENT_RECEIPT_PRINT`: únicamente un intento aceptado, incluso un abono
  parcial. Conserva importe, medio, cambio en efectivo o referencia externa y
  saldo de esa revisión. No modifica el pago ni la cocina.
- Cada documento original usa el ID del comando. Repetir el mismo comando
  recupera el recibo original. Una copia deliberada requiere documento original,
  motivo y permiso de reimpresión; conserva el contenido histórico y dice COPIA.

Imprimir exige `imprimir_cuentas` y propiedad de la cuenta o `ver_todas_cuentas`.
Copias exigen además `reimpresion_preticket`. Se revalida el actor aun para
recuperar un recibo. El destino es la estación configurada `caja` con tipo
`pre_ticket` o `receipt`; falta de salida falla antes del commit.

El documento y las intenciones de impresión se guardan en una transacción.
`print_documents` es una proyección del log; imprimir no reescribe órdenes ni
cuentas financieras. Los bytes y la ruta originales permanecen en los efectos,
por lo que un reintento no usa una impresora nueva por accidente.

## Interrupciones y decisión del encargado

Cada episodio incierto tiene `uncertain_episode_id` durable.
`PRINT_UNCERTAIN_RESOLVE` exige trabajo, episodio, resolución (`printed` o
`reprint`), motivo y permiso `gerente`; solicitar copia exige también permiso de
reimpresión. `printed` registra que el operador verificó el papel completo.

La proyección `print_resolutions` reserva el episodio al comprometer el comando,
antes de escribir la cola. Si falla esa escritura, otro ID no puede comprometer
una segunda decisión. La cola guarda recibo y transición en un reemplazo durable.
Reproducir una decisión anterior no resuelve un episodio posterior ni imprime
otra vez. Su recuperación debe conservar el comando original.

Reimpresión envía bytes marcados COPIA de los ejemplares restantes. Cuando todos
los ejemplares tenían confirmación de transporte pero faltó la transición final,
la solicitud explícita inicia una copia del juego completo. Se conservan los
contadores previos en el recibo. Confirmación TCP no demuestra papel físico.

`GET /print/uncertain` exige actor en modo Caja y devuelve un resumen sin bytes ni
conexiones de impresoras. Una secundaria reenvía la consulta y el actor al
primario; ante desconexión devuelve indisponibilidad. Los comandos sólo resuelven
trabajos con procedencia canónica conocida en el log. Trabajos legacy requieren
conciliación previa a la transición y no generan recibos nuevos incompatibles
con la nube.

## Nube, recuperación y límites

Los tres eventos conservan recibos auditados en nube, sin modificar órdenes,
pagos o turnos. Se validan restaurante, sucursal, referencias, importes y copias
contra el historial del mismo escritor. Los bytes de impresión no se envían.

La UI conserva el intento inmutable hasta validar el recibo y ofrece recuperación
aunque la cuenta ya se haya liquidado o el trabajo deje de aparecer como incierto.
La apertura del cajón y las pruebas físicas de papel, Windows y energía siguen
pendientes de H05/H15; estos comandos no abren el cajón.
