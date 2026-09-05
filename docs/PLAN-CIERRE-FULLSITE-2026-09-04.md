# Plan de cierre Fullsite v1

**Fecha:** 4 de septiembre de 2026, Monterrey. **Estado:** plan de ejecución propuesto; D1 y D2 aprobadas. Ningún hito se declara implementado o certificado por este documento.

**Objetivo:** un restaurante puede instalar Fullsite, operar un servicio desde todas sus terminales aun sin internet, recuperarse de las caídas y cerrar con cifras explicables. Podemos repetirlo en otro restaurante sin modificar código ni corregir datos a mano.

Este plan concreta la [auditoría del 4 de septiembre](audit/FULLSITE-CIERRE-PUNTA-A-PUNTA-2026-09-04.md) y sus [12 paquetes de implementación](audit/FULLSITE-IMPLEMENTATION-TASKS-20260904.jsonl). Ordena el trabajo de cierre operativo posterior al plan de agosto; no sustituye el backlog comercial ni convierte certificaciones históricas en aceptación del candidato nuevo.

## 1. Qué significa «cerrado»

| Resultado | Condición verificable |
|---|---|
| **Operación compartida** | Una cuenta tiene la misma identidad, productos, revisiones y saldos en todos los POS admitidos. El personal puede continuarla desde otra terminal con sus permisos. |
| **Offline completo** | Con Caja y LAN, el restaurante termina el servicio sin WAN. Si pierde Caja, muestra la contingencia y preserva borradores; reconectar no duplica órdenes ni pagos. |
| **Cierre económico** | Turno, cuentas, pagos, movimientos de inventario y reportes concilian por el mismo día de negocio. Toda diferencia se explica mediante registros, pendientes o ajustes identificados. |
| **Producto repetible** | Otro restaurante se configura, opera y se recupera con el mismo paquete y procedimientos, con datos y credenciales aislados. |

**R1:** servicio completo aceptado en AMALAY, incluidos los módulos habilitados. **R2:** repetirlo en un restaurante nuevo de una sucursal. **R2b:** dos sucursales simultáneas sin cruzar órdenes, turnos, permisos o integraciones; obligatorio antes de vender ese perfil.

Fullsite v1 queda cerrado para un perfil cuando pasa todos sus criterios. Un módulo ofrecido a ese cliente forma parte de la aceptación; un módulo no certificado debe estar fuera de ese perfil y deshabilitado explícitamente. No es necesario terminar todas las ideas del backlog para cerrar esta versión.

## 2. Decisiones de producto que guían el trabajo

Las dos primeras están aprobadas y registradas en [ADR-005](adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md):

1. **Internet caído, Caja y LAN funcionando:** servicio completo desde los POS autorizados. **Sin contacto con Caja:** lectura con antigüedad visible y borradores durables; sin cobro, división, traslado, fusión ni confirmación a cocina.
2. **Pago y entrega independientes:** pagar no retira comida pendiente del KDS; entregar no oculta una cuenta que todavía debe dinero.
3. **Propuesta técnica de ejecución:** Caja/Pedro confirma las operaciones de la sucursal tanto online como offline. La nube recibe esos resultados y las entradas de canales externos llegan a Caja para su aceptación. No se habilita un segundo escritor silencioso.
4. **Propuesta de captura:** abrir/reservar una cuenta y guardar cambios confirmados los comparte con otras terminales; «Enviar a cocina» sigue siendo una acción separada. El borrador aislado se conserva con dueño y estado pendiente, y se reconcilia al volver. Ajustar la interacción al probar el flujo del mesero, sin reabrir D1/D2.
5. **Perfil inicial de laboratorio:** Caja + POS2 + POS3 + KDS en procesos y perfiles independientes. Antes de certificar AMALAY se registrarán los dispositivos reales, impresoras, acceso, medios y módulos usados. Si se usan navegador, iPad o móvil como POS, su transporte y arranque offline son parte obligatoria de esa aceptación.

La autorización bancaria, el timbrado y la recepción de información nueva de un proveedor siguen dependiendo de ese proveedor. Fullsite debe distinguir pendiente, confirmado y resultado desconocido. Una respuesta desconocida no permite volver a cobrar automáticamente.

## 3. Los seis hitos, en orden de integración

### H1 — Caja confirma y conserva lo que acepta

**Entrega:** una base común para recibir operaciones autorizadas, guardarlas y recuperar su resultado. Desde el inicio existe un laboratorio con la interfaz real y datos sintéticos.

- Fijar una base de integración e inventario de clientes/funciones. Incorporar las correcciones vigentes sin duplicar trabajo: la auditoría parte de `de904d71`; `5bb3a811` ya corrige una parte de la recuperación de snapshot y requiere integración/verificación.
- Cerrar autenticación y enrolamiento de POS/KDS por HTTP y WebSocket, incluidos secretos iniciales, reenvío y compatibilidad del motor Electron.
- Persistir como una unidad la operación, su resultado, el cambio de estado y las tareas pendientes antes de responder éxito. Conservar el mismo resultado ante reintentos.
- Recuperar snapshots y secuencias coherentes; identificar Caja y su generación para rechazar reintentos de una autoridad retirada.
- Reutilizar el adaptador de almacenamiento de Pedro. Probar una implementación transaccional local —SQLite es la candidata— con crash, disco lleno y empaquetado Windows antes de extenderla a dinero.
- Preparar UI local, identidades sintéticas y bloqueo selectivo de internet que mantenga la LAN. Evitar las configuraciones de pruebas que apuntan a la aplicación productiva.

**Cierra cuando:** un POS y KDS legítimos se conectan; uno no enrolado no modifica datos; reiniciar tras perder una respuesta conserva una sola operación; disco lleno nunca produce un éxito sin registro. La prueba se ejecuta con la UI real, además de las pruebas del motor.

**Paquetes:** T1, T2, T3, parte local de T4 y preparación de T10. **Dependencia:** ninguna fase anterior; D1/D2 ya están resueltas.

### H2 — Una misma cuenta en todas las terminales

**Entrega visible prioritaria:** se puede crear, descubrir, abrir, agregar y enviar una cuenta desde distintas terminales sin depender de la caché privada de quien la creó.

- Salón y editor consultan órdenes completas por ID y revisión; el salón deja de usar la lista de pendientes de cocina como lista de cuentas.
- Conservar productos, cantidades, modificadores, precios, impuestos, descuentos, nombre, personas y turno. Cambiar de mesa no cambia la identidad del consumo.
- Actualizar una cuenta ya abierta cuando otra terminal confirma cambios. Ante ediciones simultáneas, conservar ambas operaciones compatibles o presentar un conflicto recuperable.
- Obtener el turno y las cuentas desde Caja en una terminal enrolada sin caché previa. Una lectura fallida de una mesa ocupada no crea otra cuenta vacía.
- En las operaciones migradas, todas las terminales usan la autoridad de Caja; un snapshot cloud atrasado no retira una orden local pendiente.

**Cierra cuando:** sin WAN, A crea una cuenta; B sin caché la abre con el mismo ID, productos e importe; C agrega una ronda; A y B se actualizan y KDS recibe el lote correcto. Reiniciar B conserva la cuenta. La misma prueba también pasa con internet disponible y con cuentas por nombre.

**Paquetes:** T5, turno/edición/envío de T6 y proyecciones de T8. **Dependencia:** H1 para el recorrido ejercitado.

**Límite:** H2 resuelve la primera entrega de orden compartida; la certificación de todas las acciones y el dinero corresponde a H3. El cambio completo de escritor en producción espera H4/H5.

### H3 — Un turno completo por LAN

**Entrega:** toda acción necesaria durante el servicio utiliza la misma cuenta y autoridad; acceso, dinero y cocina funcionan sin WAN.

- Apertura única de turno; abrir cuenta, rondas, descuentos autorizados, cancelación, traslado, transferencia, fusión y división consistentes en todas las terminales. Aplicar permisos en Caja, además de la UI.
- Persistir cuentas, intentos/resultados de pago y saldos reales. Conectar el módulo de liquidación del candidato y su migración a los lectores/escritores reales; incluir aislamiento de datos, integridad y recuperación. Aplicar el SQL por sí solo no completa la persistencia monetaria.
- Evitar doble cobro por simultaneidad, doble clic o reintento. Recuperar un pago parcial desde otra terminal después de reiniciar. El cierre financiero sigue el saldo real y el contrato de turno vigente.
- Separar cuentas abiertas de lotes pendientes de cocina; cancelaciones y rondas conservan identidad por producto y estación. Preservar trabajo de impresión y mostrar resultado incierto cuando pudo salir papel.
- Arrancar una terminal previamente enrolada sin WAN con aplicación íntegra, menú, configuración y permisos válidos. Una descarga incompleta conserva la versión anterior operable.
- Implementar la contingencia aprobada al perder Caja, incluida conservación y reconciliación de borradores. Ofrecer comprobación de preparación offline antes del turno.

**Cierra cuando:** desde terminales alternadas se completa apertura → pedidos → rondas → cocina → split → pago parcial → reinicio → liquidación → X/Z → siguiente turno. Se intercalan cancelación, movimiento y competencia entre cajeros. Pagar antes de preparar conserva cocina; servir antes de pagar conserva deuda. Al apagar Caja se bloquean las acciones aprobadas y al recuperarla no se repiten cobros ni envíos.

**Paquetes:** T6, T7, T8, T9. **Dependencia:** H1/H2; el diseño de cuentas y del paquete offline puede prepararse antes en paralelo.

### H4 — La nube y los números reflejan lo que ocurrió

**Entrega:** volver a internet completa la sincronización de negocio, y el gerente puede explicar cada cifra desde sus operaciones de origen.

- Materializar operaciones de Caja en órdenes, cuentas, pagos y turnos cloud, con recibo por operación y reintento idempotente. Una cola vacía sólo es evidencia suficiente si existe el resultado de negocio correspondiente.
- Reconciliar las colas antiguas, controlar versiones y generación de autoridad, y ensayar la transición de escritor por sucursal. Un cliente viejo no puede reintroducir otra escritura autoritativa.
- Unificar día de negocio, zona horaria, descuentos, impuestos, propinas, pagos y saldos entre X/Z, dashboard e informes. Mostrar cuándo se actualizaron y qué está pendiente.
- Cerrar los recorridos de inventario del perfil: receta, venta, cancelación/devolución y recepción afectan ledger, existencias y costo de manera recuperable. Las reglas de reconocimiento deben estar definidas por operación.
- Para funciones IA habilitadas, probar que sus cifras y respuestas consultan esos datos conciliados, identifican su procedencia y reconocen información atrasada.
- Cerrar cada integración habilitada con credenciales por restaurante, permisos, idempotencia y recuperación: pagos, CFDI, delivery/QR u otros canales. Distinguir «recibido por Fullsite» de «aceptado por el restaurante» cuando Caja aún no pudo recibirlo.

**Cierra cuando:** el servicio de H3 se sincroniza después de una interrupción prolongada y nuevas interrupciones durante la recuperación, sin borrar órdenes locales ni duplicar efectos. Cada operación tiene recibo o pendiente accionable. Los totales concilian con un conjunto de resultados esperados, incluidos medianoche, descuentos, propinas, saldos anteriores y cancelaciones. Venta y cobro no se fuerzan a ser iguales si existen saldos o fechas diferentes; la diferencia queda explicada.

**Paquetes:** cierre de T4 y T11; seguridad/credenciales de T12. **Dependencia:** contrato H1 y recorridos H3; receptores cloud, aislamiento y pruebas de proveedores se preparan antes en paralelo.

### H5 — Offline certificado en AMALAY

**Entrega:** un candidato identificable, probado en equipos reales y operable por el personal.

- Ejecutar la [matriz de 16 escenarios de la auditoría](audit/FULLSITE-CIERRE-PUNTA-A-PUNTA-2026-09-04.md#8-matriz-que-realmente-cierra-offline) con UI real, Windows y el hardware/perfil de AMALAY. Cubrir PIN/huella e impresión donde se utilicen.
- Ensayar reinicio de Caja y secundarios, impresora caída, respuesta perdida, disco lleno, WAN intermitente y actualización incompleta. Probar restauración y retorno a una versión compatible preservando pendientes, sin dos Cajas autoritativas.
- Definir y medir recuperación: qué backup existe, cuánto dato cubre, cuánto tarda restaurar y cuál es la pérdida máxima aceptada ante destrucción del disco. Un reinicio recuperable no acredita recuperación ante pérdida física.
- Registrar un manifiesto de versión web, Electron, esquema, configuración, dispositivos y evidencia. Una corrección posterior exige repetir los escenarios afectados y el recorrido principal.
- Medir propagación con carga representativa. Metas iniciales propuestas: cambios confirmados visibles en ≤1 s p95 y ≤3 s p99; pérdida de Caja visible en ≤5 s. Registrar resultados y condiciones, no asumir que están logrados.
- Preparar instrucciones breves para el personal: listo para offline, borrador pendiente, Caja inaccesible, pago/impresión inciertos y recuperación. Ensayar antes de la ventana de campo.

**Cierra cuando:** H1–H4 pasan en el perfil real, el personal termina un servicio completo de AMALAY con caída y recuperación de internet, y el cierre concilia. Queda evidencia y un procedimiento de recuperación que otra persona puede ejecutar. Esto cierra **R1**.

**Paquete:** T10. **Dependencia:** H1–H4; laboratorio, hardware y logística se preparan desde H1. Campo, migración y publicación son pasos de entrega posteriores a revisar el candidato concreto; no ocurren por aprobar este plan.

### H6 — Instalable, aislado y mantenible en otro restaurante

**Entrega:** Fullsite se entrega como producto repetible y se puede sostener después de instalarlo.

- Alta reanudable con verificación de dueño, membresías, roles, sucursal, menú, configuración y dispositivos. No activar un cliente cuyo aprovisionamiento quedó incompleto.
- Probar aislamiento entre restaurantes en lecturas, comandos, reportes e integraciones. Impedir cambiar identidad de restaurante/sucursal mediante campos arbitrarios o credenciales compartidas de plataforma.
- Repetir instalación, servicio, desconexión, cierre y recuperación desde un restaurante vacío usando procedimientos y configuración, sin excepciones de código.
- Dar diagnóstico por terminal: versión, última conexión a Caja/nube, operaciones pendientes, impresión y errores accionables. Una acción de soporte declarada ejecutada debe tener resultado verificable.
- Probar actualización compatible y recuperación sin perder pendientes de pago, impresión o sincronización. Definir responsable, señal y procedimiento para cada fallo de servicio.
- Ejecutar R2b antes de habilitar multisucursal: mismo número de mesa y turnos simultáneos en dos sucursales sin cruzar órdenes, cocina, dinero o permisos.

**Cierra cuando:** una persona siguiendo el procedimiento instala el segundo restaurante y completa R1 sin intervención de desarrollo para arreglar configuración o datos; los intentos entre tenants fallan y el soporte puede diagnosticar y recuperar los fallos ensayados. Esto cierra **R2**, y R2b cuando ese perfil se ofrece.

**Paquete:** T12 y operación de T10/T11. **Dependencia:** R1; aislamiento, provisionamiento y soporte se construyen en paralelo cuando sus contratos estén definidos, no se descubren al final.

## 4. Primer paquete ejecutable

**Nombre:** cuenta compartida desde la UI con WAN cortada. **Alcance:** H1 necesario para ese recorrido + H2. Es la primera entrega revisable porque ataca directamente el problema reportado.

1. Fijar el candidato de integración y registrar qué hallazgos siguen vigentes, incluida la corrección parcial `5bb3a811`.
2. Reproducir en el laboratorio UI «A crea, B ve ocupada, B abre vacío», usando una terminal enrolada con caché de órdenes vacía.
3. Completar autenticación POS/KDS y la operación durable mínima; exponer la misma cuenta completa a salón y editor.
4. Conectar crear/abrir/agregar/enviar y actualizaciones remotas a ese contrato. Conservar los nombres, cantidades, precios y turno.
5. Ejecutar A/B/C/KDS con y sin WAN, edición concurrente y reinicio de B; guardar evidencia del mismo ID/revisión y ausencia de duplicados.
6. Entregar un cambio revisable con su prueba y lista de brechas H3–H6 aún abiertas. No presentarlo como certificación offline completa.

**Trabajo paralelo:** motor/almacenamiento; enrolamiento y transporte; fixture UI. La UI y los contratos se integran de forma coordinada. Preparar a la vez esquemas de dinero y receptores cloud, sin activar escritores alternativos.

## 5. Cómo controlar avance y entrega

| Estado de un paquete | Evidencia necesaria |
|---|---|
| Pendiente | Alcance, dependencia y criterio de salida identificados. |
| Implementado | Cambio revisable y pruebas del comportamiento afectado; no implica campo. |
| Verificado en laboratorio | Recorrido integrado con UI y fallos, candidato identificado y evidencia reproducible. |
| Verificado en campo | Mismo manifiesto aceptado en dispositivos y servicio reales. |
| Entregado | Versión habilitada para el perfil correspondiente, operación y recuperación documentadas. |

- **Ingeniería/Codex:** implementación, revisión, laboratorio, migraciones ensayadas, manifiesto, evidencia y procedimientos. Coordinar cambios del motor y de `pos/page.tsx` para evitar integraciones contradictorias.
- **Daniel y operación:** enumerar el perfil realmente utilizado, validar interacción de captura con el mesero y aportar ventana/equipos para aceptación de campo. No se vuelven a pedir D1/D2 ni se bloquea el laboratorio esperando logística.
- **Para cada entrega:** registrar defectos abiertos y aceptar sólo cuando no queda ninguno que viole su criterio. Una prueba de HTTP o un total de tests verdes no sustituye la prueba del flujo de usuario.
- **Calendario:** estimar el primer paquete tras fijar la base y reproducir su recorrido UI; ajustar las siguientes estimaciones con ese resultado. Windows, campo y proveedores tienen disponibilidad propia. Este plan no asigna fechas sin conocer esas condiciones.

## 6. Alcance que no debe absorber el cierre

No se propone reemplazar Next.js, Electron o Supabase; añadir elección automática de Caja; permitir cobros entre terminales aisladas; ni abrir nuevas capacidades IA antes de certificar las que se habiliten. Nuevos canales y funciones pueden tener su propio ciclo. Toda función ya incluida en el perfil de un cliente mantiene su obligación de aceptación.

**Situación al escribir:** auditoría y decisiones documentadas; seis hitos pendientes de demostrar. Se identificaron fallos reproducibles y una corrección parcial posterior. El laboratorio anterior de procesos es evidencia útil, pero aún faltan UI integrada, persistencia monetaria conectada, conciliación y aceptación del perfil real.

## Referencias

- [Auditoría y fuentes de código](audit/FULLSITE-CIERRE-PUNTA-A-PUNTA-2026-09-04.md).
- [Anexo de plataforma](audit/FULLSITE-PLATAFORMA-ANEXO-2026-09-04.md).
- [Decisiones D1/D2](adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md).
- [Paquetes T1–T12](audit/FULLSITE-IMPLEMENTATION-TASKS-20260904.jsonl).
- [Contrato de ciclo de turno](adr/ADR-003-TURNO-LIFECYCLE.md).
- [Alcance revisado de 5bb3a811](audit/evidence-20260904/5bb3a811-review.md).
