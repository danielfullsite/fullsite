# Comandos durables y recuperación de impresión

Estado: implementado y probado localmente sobre el candidato de cierre; no certifica Windows, energía eléctrica ni cobros autoritativos. Decisiones de producto: [ADR-005](../adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md).

## Contrato

1. Un comando tiene un ID estable y contenido de negocio inmutable. Un reenvío autorizado desde otra terminal puede conservar ese ID; restaurante, tipo y payload deben coincidir. Reutilizarlo con otro contenido produce `IDEMPOTENCY_KEY_REUSED`.
2. `CoreEventStore.processCommand` devuelve el evento original, con su secuencia original, cuando reconoce un reintento. Todos los reintentos concurrentes reciben el error original si el primer intento no pudo persistir.
3. Un registro NDJSON contiene una transacción con eventos, checksum, recibo implícito por ID e intenciones de efectos. El registro se escribe completo y se llama `fsync` antes de confirmar. Las intenciones de impresión contienen bytes, copias y configuración resuelta del destino; preparar esos datos no imprime.
4. La tabla de comandos en memoria se deriva del log. `processed-commands.ndjson` deja de decidir si un comando existe; un índice ausente o desfasado no puede crear duplicados ni inventar operaciones.
5. Un append fallido revierte hasta la longitud anterior y vuelve a sincronizar. Si la reversión también falla, el store queda indisponible hasta reiniciar y revisar el archivo. No consume secuencias en memoria ni responde con éxito.
6. Una última línea sin salto final se trata como escritura interrumpida, se conserva en `.torn-tail` y se corta hasta la frontera anterior. JSON, checksum, identidades o secuencias incorrectas dentro de datos comprometidos detienen el arranque. No se omiten silenciosamente órdenes.
7. La marca de sincronización usa reemplazo temporal, fsync y rename; si falla una frontera incierta, exige recarga antes de seguir escribiendo.

## Impresión y su significado para el personal

`PRINT_COMMAND` confirma aceptación durable del trabajo, no prueba que salió papel. El evento es un outbox durable: al arrancar `CommandHandler.recoverPendingEffects()` reconstruye la cola, deduplicando por trabajo y usando el destino original aunque cambie la configuración. Eventos antiguos sin intenciones no se reimprimen por inferencia.

La cola guarda todos los trabajos preparados de un comando antes de enviarlos, con IDs estables. Una escritura fallida se propaga; la memoria no presenta como persistido un trabajo perdido. Los recibos de comandos se conservan aunque sean antiguos, pues mientras el evento pueda reproducirse debe existir su deduplicación.

- `pending` / `retrying`: envío pendiente; puede intentarse sin conocimiento de un envío anterior incierto.
- `printing`: el estado quedó durable antes de enviar bytes. Se registra cada copia terminada.
- `printed`: el transporte/spooler informó éxito; no constituye evidencia física de papel.
- `recoverable`: no hubo envío al dispositivo y se puede reintentar cuando vuelva.
- `uncertain`: hubo interrupción durante el envío, error después de enviar bytes o reinicio con `printing`. Debe verificarse el papel; nunca se reimprime automáticamente.

`getUncertainJobs()` permite mostrar los trabajos a revisar. `resolveUncertain(id, 'printed')` registra la verificación del operador; `'reprint'` deja constancia de una reimpresión explícita y vuelve a encolar las copias restantes. El endpoint que lo exponga necesita autorización local. No hay garantía de exactamente una hoja física.

En TCP sólo un fallo anterior al envío se considera reintentable. Un timeout posterior queda incierto. En Windows no se prueba otro comando de spooler o nombre de impresora tras un error ambiguo: eso podía enviar dos tickets. Los nombres/destinos deben validarse en el asistente.

## Integración

Después de construir `cmdHandler` y antes de aceptar conexiones, invocar `await cmdHandler.recoverPendingEffects()`. Inicializar la impresora con una ruta persistente, por defecto `path.join(dataDir, 'print-queue.json')`. El adaptador expone `prepareJobs`, `enqueuePreparedJobs`, `getUncertainJobs`, `resolveUncertain`.

La transacción durable es una frontera de infraestructura. No valida aún cuentas, saldos, revisión, permisos de cobro ni autorizaciones bancarias. Esas reglas deben ejecutarse serializadas con lectura/validación/commit/proyección antes de usar esta capa como autoridad monetaria.

## Despliegue, formato y límites

El lector nuevo acepta logs antiguos de eventos simples. El escritor nuevo usa transacciones con checksum. **Un binario anterior no interpreta este formato ni recupera estos recibos: no se puede hacer downgrade conservando estos archivos sin una conversión validada y una Caja detenida.** La instalación debe respaldar el directorio y la versión, y el manifiesto debe impedir volver a un escritor incompatible. No se cambió ningún dato de producción.

Esta implementación usa módulos incluidos en Node/Electron, sin añadir SQLite ni módulos nativos. Se probó en el binario real de Electron disponible, Node 20.18.3, sobre macOS. En POSIX también se sincroniza el directorio al crear/reemplazar archivos. Node no expone ese fsync de directorio en Windows: el instalador, el sistema de archivos y un corte eléctrico real siguen siendo pruebas obligatorias. `fsync` tampoco protege de perder físicamente el disco.

El log y los recibos se mantienen completos; snapshot/compactación con retención coherente, límite de disco, backup/restauración y medición de latencia al volumen real siguen pendientes. Hay una sola instancia escritora por directorio, como la Caja designada; este adaptador no ofrece bloqueo entre procesos independientes ni elección de líder.

## Evidencia reproducible

`node --test electron-app/local-server/tests/*.test.js` — **309/309**, Node 24.14.1, macOS.

Selección con Electron real / Node 20.18.3 — **101/101**.

`durable-boundaries.test.js` cubre disco lleno con seis reintentos concurrentes; índice ausente/desfasado; ID reutilizado; fallo de fsync/reversión; corrupción y cola parcial; sincronización fallida; SIGKILL después de commit antes de ACK; cola sin escritura; reinicio durante impresión; recibos antiguos; corrupción de cola; recuperación de evento antes de enqueue; dos copias sobre TCP loopback; SIGKILL después de un envío TCP real. No contacta nube ni impresoras físicas.

La selección de event-store, durabilidad, configuración de impresión, integración offline e idempotencia también se ejecuta con `ELECTRON_RUN_AS_NODE=1` en el binario real de Electron. La topología completa de UI, Windows y campo pertenece al gate de liberación del producto.
