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

CI 34457551266 sobre **647edd3e** completó todos los jobs: comunicación entre
terminales/servidor, UI Caja 16/16, UI legacy 21/21 y los laboratorios PostgreSQL.
Ésta es la evidencia del commit integrado; no corresponde todavía al siguiente
incremento H02.

## H02 aditivo: siguiente incremento en validación

Guardar y enviar consumo adicional después de preparar cuentas o recibir un pago
parcial compromete resultado operacional y financiero juntos. Se conserva cada
pago y reserva; sólo aumenta el total de la cuenta seleccionada. Ambas revisiones
se verifican y avanzan con un único recibo durable. La materialización SQL aplica
ambas proyecciones o ninguna. Una nueva ronda sin enviar bloquea nuevos cobros,
pero no bloquea resolver un pago ya pendiente. Disminuciones/reembolsos y las
demás operaciones posteriores a la apertura financiera todavía siguen abiertas.

Checkpoint H02: web 3,679/3,679, DOM previo a la corrección de navegación
255/255, servidor 562/562 y PostgreSQL materializador 13 grupos aprobados.
La selección operacional/aditiva también pasó 26/26 dentro de Electron.
La revisión adversarial no identificó otro defecto concreto en ese alcance.

El recorrido real encontró una carrera al salir de una mesa movida/anulada:
una lectura en vuelo y el último efecto de React podían recrear la caché con
borrador vacío. Una generación de sesión ahora invalida la lectura y suspende
persistencia antes de limpiar y navegar. Las pruebas focalizadas pasan; el
laboratorio UI completo continúa en validación en este checkpoint. No se
atribuye a H02 el resultado UI 16/16 del commit anterior.

El recorrido posterior de H02 terminó **17/17**: conserva la caché correcta tras
mover/anular, agrega $58 a la segunda cuenta después del abono de $29, confirma
total $174 y saldo $145, envía sólo la nueva ronda, recupera tras reiniciar y
cierra con $659 esperados/contados y diferencia cero. Evidencia local:
`output/closure/ui-operacion/results.json`. El checkpoint enviado es **720d2148**;
su CI se consulta por separado antes de trasladar esta evidencia a una publicación.

CI **34460442174** sobre **720d2148** completó correctamente el laboratorio
multi-terminal y PostgreSQL. También pasaron Dashboard Tests, Local Server Tests
y Offline E2E del mismo commit. La siguiente tanda de impresión requiere su
propio checkpoint y evidencia.

## H05: documentos e impresión incierta en integración

Se incorporan precuenta/recibo desde Caja y resolución por episodio, con copias
explícitas y recuperación del mismo comando. La revisión encontró y corrigió
dos ventanas: una segunda decisión comprometida mientras falla la cola y una
copia sin envío cuando el transporte había confirmado todos los ejemplares.
Contrato: [documentos canónicos](../architecture/CANONICAL-PRINT-2026-09-10.md).
La integración UI/servidor/SQL continúa en validación; no es cierre físico de H05.

Validación integrada de documentos: **20/20 UI** con Caja, POS 2, POS 3 y KDS,
incluyendo los 17 casos previos. Un receptor TCP de laboratorio recibió precuenta,
copia explícita, recibo de abono y recibo después de liquidar, sin cambios en los
pagos. Evidencia: `output/closure/ui-operacion/results.json` y
`synthetic-printed-documents.json`. El receptor es sintético, no papel físico.

Web 3,679/3,679; DOM 265/265; servidor 579/579; materializador PostgreSQL
14 grupos; selección de impresión dentro de Electron 15/15. El nuevo modo
`FULLSITE_LAB_PRINT=1` queda incluido en el job de Caja de CI. Cajón y aceptación
de impresoras reales continúan pendientes.


## H05: cajón autorizado integrado

[Contrato de cajón](../architecture/CANONICAL-DRAWER-2026-09-10.md): apertura
manual con PIN/motivo y acción explícita para efectivo aceptado. Un destino
configurado y un pulso por acción, con reserva durable por pago/episodio,
recuperación del mismo comando y decisión del encargado ante incertidumbre.
Los documentos de papel no producen pulsos y las aperturas no modifican dinero.

Recorrido UI **22/22**, servidor **589/589**, DOM **273/273**, TypeScript aprobado,
materializador PostgreSQL **15 grupos**. Evidencia local:
`output/closure/ui-operacion/results.json` y `synthetic-printed-documents.json`.
Receptor TCP sintético: dos pulsos exactos, manual y por abono. Revisión
adversarial sin otro defecto concreto. No se acredita hardware ni producción.

El CI 34461636234 del checkpoint anterior 70272c3c falló por el indicador de
Next desarrollo que interceptaba el botón Cuenta. El laboratorio ahora pulsa
un punto visible del mismo botón, sin force ni ocultar errores; el recorrido
22/22 pasó con esa corrección. El nuevo checkpoint necesita su propio CI.

Web **3,679/3,679** y selección de cajón dentro de Electron **10/10** aprobadas
en esta misma tanda. El asistente de configuración tiene dos pruebas DOM
incluidas en las 273; confirma selección explícita y eliminación persistida.

El checkpoint de cajón **7e843fe1** pasó CI **34462858845** multi-terminal,
además de Dashboard, servidor y Offline E2E del mismo commit.


## H12: lectura KDS y procedencia de caché

[Contrato de lectura por sucursal](../architecture/KDS-CLOUD-SCOPE-2026-09-10.md).
El endpoint resuelve un turno único por sucursal, no el último del restaurante.
Un error de turno no amplía la consulta a doce horas. La caché de cocina, barra
y las dos pantallas KDS pasa por el mismo filtro de restaurante/sucursal.

El bridge captura la identidad descubierta y las credenciales de su conexión;
los productores de caché conservan esa procedencia y no adoptan la identidad de
una navegación posterior. Se verificó también DELTA antes de SNAPSHOT: es una
secuencia válida del servidor después de autenticar al cliente y debe conservarse.

Web **3,684/3,684**, DOM **282/282**, TypeScript aprobado. El recorrido integrado
se registra por separado. No cierra H12: delivery cloud aún requiere sucursal,
el caché temporal requiere conciliación exacta de turno y falta la aceptación
de presencia/huella y del resto de escrituras cloud.


El recorrido posterior de H12 terminó **22/22**, incluido reinicio, pérdida de
Caja, preparación/entrega KDS, retiro/depósito y cierre con $659 esperados y
contados. Los intentos previos agotaron navegación/carga de Next; el laboratorio
acota el teclado PIN a su contenedor y alinea navegación con el presupuesto de
compilación (CI 300 s/local 90 s), manteniendo aserciones de interacción de 30 s.
Evidencia: `output/closure/ui-operacion/results.json`; receptor TCP sintético.

El checkpoint KDS **a379bda4** pasó todos sus checks de PR, incluidos CI
multi-terminal **34465179986**, Dashboard, servidor y Offline E2E.

## H11: alta reanudable y activación atómica

[Contrato de alta](../architecture/TENANT-PROVISIONING-2026-09-10.md).
El restaurante nace inactivo con un plan durable. Los reintentos pendientes
usan ese plan y conservan los datos ya sembrados. Un restaurante completo o
legacy no vuelve a sembrar filas eliminadas. La activación verifica el skeleton
y confirma ambas membresías en una sola transacción; un conflicto revierte
membresías y activación. Las rutas comparten esa orquestación y no declaran éxito
ante errores de Auth, siembra o membresía.

Personal de plantilla inactivo con PIN criptográfico; el pendiente de personal
se calcula en PostgreSQL, incluso tras reintentos. La UI distingue credenciales
nuevas de existentes y conserva los datos del envío confirmado. El wizard
anónimo incompleto dirige al alta autenticada. AuthContext ya no combina el
restaurante preferido con el rol de otra membresía.

Web **3,714/3,714**, DOM **284/284**, TypeScript aprobado; laboratorio PostgreSQL
privado **6 grupos**, agregado al workflow multi-terminal. Revisión adversarial
sin bloqueantes adicionales. Evidencia SQL:
`output/closure/tenant-provisioning/runtime.log`. La migración
`20260910070000_tenant_provisioning_atomic` permanece pendiente de producción.

No cierra H11: falta la recuperación segura de credenciales de servicio cuya
respuesta se perdió y la aceptación de enrolamiento/primera venta. La cuenta
existente conserva su contraseña; el alta nunca la rota implícitamente.

El checkpoint de alta **d4eee979** pasó todos los checks de PR; laboratorio
multi-terminal **34466866989**, incluido PostgreSQL de provisión. El build Windows
**34466889797** compiló la UI pero se detuvo en la prueba SIGKILL del cajón, antes
de empaquetar. Su receptor sólo registraba bytes al recibir FIN; ahora registra
DATA y el proceso se corta después de observar el pulso exacto, antes de guardar
el recibo. El nuevo checkpoint necesita pasar nuevamente Windows.

## H15: pérdida de recibos de impresión

Al recuperar un comando cuyo trabajo ya no existe en la cola, Caja conserva
destino/bytes pero crea un episodio incierto. Las decisiones anteriores al corte
durable de recuperación no reenvían papel ni pulsos. Una nueva decisión para ese
episodio sí se recupera después de otro reinicio, sin repetirla.

Servidor **592/592** y selección en Electron real **25/25**. Tres regresiones
nuevas cubren pérdida de cola después de papel/pulso enviados, replay de una
decisión antigua, resolución nueva y reintento del comando original. Usan log
durable, archivo de cola y receptor TCP. Revisión adversarial sin nuevos hallazgos.
No cierra restauración completa: falta coherencia entre archivos, cola antigua
todavía presente y ensayo de respaldo/recuperación en equipo de reemplazo.

El checkpoint de recibos **97aeac6a** pasó todos los checks de PR, incluido el
laboratorio multi-terminal **34467422852**. Windows se vuelve a construir en
**34467477379**; su resultado debe verificarse antes de identificar un instalador.

## H12: una demora no equivale a entrega

Cocina y barra ya no escriben `entregada` ni ocultan comandas pendientes sólo
por tener más de cuatro horas. Barra comprueba el rechazo explícito de escritura
y no registra una auditoría de éxito ante `false`.

Tres pruebas DOM importan ambas pantallas: una comanda de veinte horas sigue
visible sin mutación y el rechazo de estado conserva el pendiente. Web
**3,707/3,707**, DOM **287/287**, TypeScript aprobado. El conteo web baja en siete
porque se retiraron la constante sin uso y pruebas que repetían la regla antigua
de autoarchivo; la nueva evidencia verifica el comportamiento de las pantallas.
Las demás brechas de H12 continúan abiertas.
