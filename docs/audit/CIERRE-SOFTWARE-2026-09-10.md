# Cierre de software antes de visitar AMALAY

Daniel confirmó el 10 de septiembre: el trabajo se hace fuera de AMALAY y debe
cerrar el software antes de la visita. La ausencia de equipos físicos no bloquea
implementar, integrar ni ensayar los flujos con fallos inducidos. La aceptación
física queda aparte y no justifica funciones sin terminar.

## En ejecución

- H09: las dos rutas reales del proxy validan el cuerpo del usuario antes de
  estampar identidad. Un mesero puede actualizar cocina sin que el tenant añadido
  por el servidor lo bloquee. PATCH no cambia id/client_id para ningún rol. Los
  catálogos de precio, modificadores e inventario exigen gerente. 34 casos nuevos
  contra los handlers; las pruebas anteriores sólo inspeccionaban fuente.
- H04 legacy: transferencia de platillo mediante `r1_transfer_item_atomic`.
  Origen/destino/recibo se comprometen juntos; un fallo no hace rollback con un
  PATCH incondicional. Firma de supervisor por tenant verificada por la API.
  El navegador conserva operation_id ante respuesta perdida y publica los
  snapshots confirmados, no importes de una copia local. PostgreSQL temporal:
  descuentos/revisiones/replay, colisión de identidad, fallo del destino,
  competencia de dos terminales, aislamiento/rol y creación en misma sucursal.
  Migración **PENDIENTE**; no aplicada en producción. Falta el recorrido visual
  completo de transferencia, continuidad de cocina e integración con inventario.
- H01 local: corte X y cierre Z comparten el cálculo de pagos aceptados en Caja.
  Incluye parciales y órdenes pagadas aún en cocina; reservas desconocidas no
  cuentan como cobrado. Saldo incluye consumo anterior a preparar finanzas.
  `/reports/turn` requiere sesión y permiso corte_x y se reenvía desde secundarios.
  La UI de corte elige autoridad confirmada y no cae a nube ante fallo de Caja.
  Pruebas puras, de HTTP y runtime: 23/23. Se agregaron dos recorridos de UI.

## Evidencia y fronteras

Primera suite web tras proxy/transferencia: 3,605/3,605 (sin proveedor IA real).
DOM 232/232; servidor 541/541; TypeScript sin errores. CI 34452431052 sobre 5e897bd4: legacy 21/21, Caja 15/15, protocolo y PostgreSQL aprobados. No reutilizar el resultado 21/21 de fe444cb5 como si cubriera este código.
El instalador c275ce17 corresponde al candidato anterior; requiere reconstrucción
cuando este bloque quede validado.

H01 cloud/dashboard, H02–H08 del nuevo modo Caja y H10–H16 requieren continuar la
revisión e implementación según OPEN-ITEMS. H09 requiere además comprobar tablas
hijas sin client_id, upserts y pertenencia de relaciones. Ningún H se marca
completo sólo por añadir un guard o pasar una suite parcial.

## Segunda tanda, validación en curso

- H06: retiro/depósito con autorización de Caja, identidad durable, recuperación tras reinicio, límite de retiro y cálculo común X/Z. Proyección SQL idempotente y formulario de autorización. Servidor 542/542 y PostgreSQL 12/12 antes de los ajustes LAN de revisión; se vuelve a ejecutar la suite tras ellos.
- H14: corregida la incompatibilidad anon/service_role del outbox con una ruta fija del servidor; service key permanece fuera de Electron. Siete pruebas de handler, incluyendo eventos válidos superiores a 2 MB.
- Revisión independiente encontró pérdida de tombstones al reconectar y sobrescritura por snapshots versionados atrasados. Se incorporan regresiones; las revisiones cero legacy aún no representan orden global.
- H09: siguen en trabajo la normalización de rutas, selecciones de columnas sensibles, tablas hijas, upsert entre tenants y compatibilidad de deducción automática de inventario. Estos hallazgos impiden declarar el cierre global.

## Aislamiento del proxy, siguiente tanda

Se restringe el recurso a una tabla canónica y las selecciones a columnas planas;
los alias/embeds no pertenecen al contrato genérico. También se rechazan filtros
sobre secretos de identidad. Los upserts pasan a `pos_scoped_upsert`: el conflicto
sólo actualiza una fila del tenant verificado y no reasigna id/client_id. Las tablas
hijas pasan por `pos_scoped_child`, que comprueba padre e ingrediente dentro de
PostgreSQL en cada lectura/escritura. Ambas migraciones permanecen PENDIENTES:
la ausencia de RPC devuelve indisponibilidad y nunca abre un fallback privilegiado.
Se deben aplicar en el entorno de validación antes de desplegar estos handlers.

La deducción legacy de inventario todavía requiere integración con una operación
confiable del servidor; restringir escrituras arbitrarias del navegador por sí
solo no la termina. Tampoco se ha cerrado la pertenencia de todas las relaciones
restantes de las tablas con client_id.

CI 34454000448 pasó protocolo/servidor, legacy 21/21 y PostgreSQL (transferencias,
materializador). Caja pasó 13 casos antes de que el selector accesible de tipo de
movimiento no coincidiera con la etiqueta exacta del laboratorio. Se corrige el
nombre accesible explícito del control y se repite el recorrido completo.

## Tercera tanda: confirmación y recuperación

CI 34454791513: Caja 16/16, legacy 21/21 y PostgreSQL aprobados. Una prueba
del servidor construía dos polls con horas distintas para afirmar que eran el
mismo mensaje; ahora reutiliza exactamente el mismo payload. La suite local
posterior pasó 554/554 y DOM 235/235, antes de la integración de recuperación
de cancelaciones/reportes/inventario que está en curso.

- Transferencias: un solo evento durable transporta ambas cuentas confirmadas;
  conserva preparación y remapea los estados de cocina por identidad del platillo.
  Transferir el último platillo libera la cuenta origen sin inventar un pago.
  PostgreSQL 9 grupos aprobados, incluida creación simultánea desde otra terminal
  y mesa reutilizada cuando su cuenta pagada conserva historia en cocina.
  El índice de una cuenta activa por mesa está PENDIENTE; duplicados existentes
  bloquean su instalación y requieren resolución explícita, no borrado automático.
- Cancelación: calcula descuento e IVA registrados en centavos; rechaza cuentas
  pagadas o inconsistentes y devuelve fila/revisión confirmadas. Una respuesta
  rechazada no autoriza sustituir el snapshot de LAN.
- Inventario manual: operación autenticada y transacción única para recibo exacto,
  ledger, stock y costo promedio. Reintentos conservan la identidad; no existe
  fallback a PATCH de existencias. Migración PENDIENTE y laboratorio PostgreSQL.
- Conciliación de venta: cancelar sin preparar devuelve el consumo fijado una
  sola vez; cancelar preparado lo conserva aun después de retirar el renglón del
  ticket. Transferir conserva el mismo registro de consumo y su provenance.
  Siete grupos PostgreSQL aprobados. No cambia la autoridad ni clasifica productos
  por aproximación de nombre: una clasificación ausente sigue BLOCKED.
- Reportes: venta pagada independiente del estado de cocina, día de venta,
  paginación completa, exclusión de padres divididos y métodos de pago registrados.
  Los cobros parciales requieren su ledger separado y aún no cierran H01/H13.
- Actualizador: verifica estado durable, comandos en vuelo, saldos, outbox y
  trabajos de impresión; vuelve a comprobar inmediatamente antes de instalar.
  No se activaron releases ni actualización automática.

Las nuevas migraciones deben validarse juntas antes del despliegue coordinado.
La deducción automática legacy se está integrando a la reconciliación canónica;
los restantes H02–H16 y el nuevo instalador siguen en trabajo. Esta evidencia no declara cerrado
el sistema ni sustituye las verificaciones físicas de la visita.

Validación conjunta de esta tanda: web 3,679/3,679 (sin proveedor IA real), DOM
245/245 y servidor local 554/554. PostgreSQL: transferencia 9 grupos, movimiento
manual 7 grupos y conciliación de consumo 7 grupos. Se ejecutará el laboratorio
multi-terminal en CI sobre el commit integrado; aún no se traslada evidencia del
commit anterior a éste.
