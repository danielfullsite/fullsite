# Fullsite: arquitectura y cierre de punta a punta

**Revisión:** 4 de septiembre de 2026, Monterrey / 5 de septiembre UTC. **Estado:** auditoría terminada con bloqueantes; propuesta de implementación; D1 y D2 aprobadas por Daniel, desarrollo pendiente. No es certificación offline ni autorización para producción.

**Bases inspeccionadas:** main remoto **4fa12e6f9e4224dd46b1d5e3520d521074dba4e0**, en esta copia aislada; candidato **de904d71ed0288375bd3a752579d2e2929df61c0**, preservado en el worktree detached architecture-source-de904d71. Esta revisión no editó el candidato. No se aplicaron migraciones, no se corrieron escenarios contra AMALAY y no se invocaron cobros ni timbres. Los documentos de agosto se usaron como contexto, contrastándolos con código; no como certificado vigente.

**Actualización al cierre:** la rama original avanzó en paralelo a **5bb3a811**. Se revisó ese diff y su suite nueva pasó **3/3**: corrige la hidratación al reconectar con Caja disponible. **O4 queda parcialmente resuelto**; persisten la recuperación sin Caja, durabilidad del snapshot/cursor y prueba UI. [Detalle y límites de la actualización](evidence-20260904/5bb3a811-review.md). Las reproducciones originales permanecen fijadas a de904d71; no mezclar sus fallos con el alcance corregido.

## 1. Conclusión de producto

Fullsite ya tiene gran parte de sus componentes. **No tiene cerrado el contrato que hace que una misma orden sea operable desde todos los POS durante todo su ciclo de vida.** Hay transporte de eventos, pero salón, editor, cocina, pagos, turnos y nube todavía mantienen representaciones con reglas diferentes.

El caso que resume el problema se reprodujo con código real aislado: **A crea una orden; B ve la mesa ocupada con $713; B la abre sin WAN y sin caché previa; el editor queda vacío y genera otro ID.** H3 conectó el mapa a Pedro, pero no el editor de la cuenta. Otro caso: una orden entregada, aún sin pagar, desaparece del salón porque éste utiliza la proyección filtrada de cocina.

El laboratorio 16/16 aportado por Daniel sigue siendo evidencia útil de procesos y HTTP. No se vuelve falso por estos hallazgos; simplemente no ejecuta las pantallas y condiciones que aquí fallan. Los conteos de suites del reporte anterior no se reejecutaron ni se presentan como validación nueva.

**Dos cierres distintos:**

- **R1 / AMALAY:** un turno completo con todas las terminales, caída de internet, recuperación y cierre; misma orden, revisiones, cantidades y saldos en cada superficie que corresponda.
- **R2 / producto clonable:** repetir R1 desde un restaurante vacío, con otro dueño, menú, configuración, credenciales y terminales, sin una excepción de código. Una sucursal primero; la prueba de dos sucursales simultáneas es otro gate explícito.

Nuevos agentes de IA y aprobación comercial de marketplaces pueden avanzar por su cuenta. No sustituyen el cierre operativo. Cada integración habilitada en el perfil que se venda sí debe tener aceptación propia.

## 2. Arquitectura observada

~~~text
Mesero / cajero
  └─ POS Next.js dentro de Electron
       ├─ escritura online → API Next.js → Supabase pos_orders / turnos
       ├─ fallo de red → cola IndexedDB o localStorage de ESA terminal
       └─ aviso de comanda → Pedro local → Pedro de Caja
                                             ├─ eventos NDJSON / proyección parcial
                                             ├─ cocina y trabajos de impresión
                                             └─ DELTA → secundarios, réplica en memoria

Mapa de mesas nuevo → GET /state de Caja → kds_orders
Editor de cuenta    → Supabase o localStorage propio
Pedro               ← poll de Supabase, incluso en secundarios
Outbox Pedro        → pos_local_events, shadow opt-in; no sustituye save-order

Supabase → inventario / agregados → dashboard / chat / agentes
Proveedores ↔ delivery / pago bancario / Facturama ↔ API nube
~~~

El encabezado «authoritative» sólo demuestra que contestó la Caja. No demuestra que el conjunto consultado contenga todas las órdenes, que sea durable o que el editor vaya a consumirlo. La autoridad debe ser un contrato validado, no una etiqueta de la respuesta.

**Lo que ya existe y se debe reutilizar:** Pedro y su interfaz de almacenamiento; deduplicación por command_id; reenvío HTTP; protocolo de eventos; comanda_batches; módulo de liquidación; cola de impresión; handlers y RPC idempotentes de guardado cloud; enrolamiento y dispositivos; instaladores, canales piloto/estable y freno de actualización. No propongo reemplazar Next.js, Electron ni Supabase.

## 3. Hallazgos que bloquean el cierre offline

Las referencias O1–O10 son al candidato **de904d71**. «Reproducido» significa prueba aislada o loopback adjunta, no incidente confirmado en AMALAY. P1 = impide certificar el perfil offline completo; P2 = falla funcional que debe cerrarse en ese perfil. Confianza 9–10 indica fuente concreta y, donde se señala, reproducción.

| ID | Impacto y evidencia | Qué debe cambiar |
|---|---|---|
| **O1 · P1 · 10/10** | **Salón ocupado, editor vacío.** mesas/page.tsx:293 adopta leerSalon; :621 sólo transmite mesa. pos/page.tsx:2096 consulta nube y :2190 cae a localStorage. Reproducción A→B sin WAN con caché B vacía: items=[], orderId nuevo. | Mapa y editor consumen el mismo repositorio de órdenes completas por ID/revisión. Abrir una mesa ocupada jamás crea otra orden por fallo de lectura. Una lectura indeterminada debe bloquear esa apertura y permitir reintento. |
| **O2 · P1 · 10/10** | **Salón derivado de cocina.** pedro-cliente.ts:91 lee cuerpo.kds_orders; state.js:304 excluye entregada. Repro: mesa ocupada y deuda viva, pero salón vacío. STATE_SYNC también puede poblar mesas/kds_queue sin poblar kds_orders. | Proyección propia de cuentas abiertas, independiente de las comandas pendientes. Separar deuda, ocupación y preparación. Importar estado inicial completo antes de declararse listo. |
| **O3 · P1 · 9/10** | **La nube aún puede retirar una orden local pendiente.** state.js:249 ejecuta `if (belongsToAnotherTurno || absentAndPastGrace) this._orders.delete(orderId)`; gracia de 45 s en :329. Repro con orden local de 46 s y snapshot cloud vacío: desaparece de proyección. No se borró su evento del log. | Durante autoridad local, sólo una transición confirmada cierra/cancela; ausencia en un poll no equivale a cierre. Definir la transición de autoridad por sucursal y retirar el segundo escritor, con reconciliación previa. |
| **O4 · P1 · 10/10** | **Cursor sin réplica.** enlace-con-caja.js:123–130 ignora SNAPSHOT.state; index.js:869–876 persiste cursor pero aplica DELTA sólo a memoria. Repro reinicio: cursor 11, dos órdenes en Caja, cero en réplica. | Snapshot + secuencia + identidad/generación de Caja deben instalarse coherentemente. Persistir/aplicar antes de avanzar cursor. Recuperar gaps, reinicios y restauración de una Caja con historial diferente. |
| **O5 · P1 · 10/10** | **Autenticación incompleta y clientes legítimos rotos.** HTTP exige secreto pero ws-hub.js:115–125 ejecuta COMMAND sin autenticar: loopback obtuvo ACK e insertó orden sin secreto ni SUBSCRIBE. KDS kds-ui.html:465/542 no envía la nueva credencial y obtiene 401. local-network-fetch.ts:145 reintenta `fetch(input, init)` y pierde los headers agregados a localInit. | Un mismo contrato de dispositivo/tenant/sucursal para HTTP y WS; credenciales entregadas antes del primer fetch a POS y KDS, preservadas en fallback/forward. Probar terminal legítima y terminal no emparejada con motor Electron real. No usar secretos globales de plataforma en renderers. |
| **O6 · P1 · 10/10** | **H6 no está conectado a persistencia ni cubre split offline.** pos/page.tsx:3528 avisa cierre de madre en OFFLINE_QUEUED, antes de terminar otras cuentas. :3615–3625 evalúa cuentas con total 0 y pagos aceptados de 0; la prueba aislada confirma cierre sobre esos ceros. Las tres tablas nuevas no tienen consumidores runtime encontrados; puedeCobrar sólo se llama desde tests. | Persistir definición de cuentas e intentos/resultados de pago; cobrar sobre saldos reales y versión autoritativa. Recuperar desde otra terminal. Aplicar SQL por sí solo no activa nada. No retirar deuda ni comida pendiente por contador React. |
| **O7 · P1 · 10/10** | **ACK sin hecho durable o duplicación tras reinicio.** event-store.js:43–46 absorbe el fallo original y devuelve duplicate:true al concurrente. Repro ENOSPC: cero eventos y retry satisfecho. :76–78 escribe evento e índice por separado; fallo entre ambos produce dos eventos con mismo ID al reintentar. | Resultado de comando, evento e idempotencia deben confirmarse como una unidad. Todos los reintentos reciben el mismo resultado persistido o el mismo error; nunca éxito fabricado. Validar disco lleno, corte y recuperación. |
| **O8 · P1 · 9/10** | **Impresión queda indeterminada tras caída.** print-queue.js:191–193 reintenta pending/retrying, mientras :218 restaura printing tal cual. Repro disco: printing con 0 pendientes y 0 recuperables. command-handler.js:79–86 además difiere la creación del efecto tras aceptar evento. | Trabajo de impresión durable junto con la decisión que lo genera. Tras reinicio clasificar printing como resultado incierto y ofrecer recuperación/reimpresión identificada. Un ACK de red no demuestra que salió papel. |
| **O9 · P1/P2 · 9/10** | **Acciones de cuenta y acceso siguen por rutas separadas.** Unir mesas (:541 de mesas/page), transferir ítem (:2711 de pos/page), mover mesa (:4488), cancelar (:2633) y turno (pos-data.ts:425/608) no usan un contrato completo de Caja. El editor tampoco se suscribe a revisiones remotas. El adaptador H3 descarta customer_name/personas: cuentas por nombre invisibles, reproducido. | Inventariar y migrar cada comando; mantener nombres, personas, precios, modificadores, impuestos, descuentos y origen. Permisos y turno deben ser consultables por LAN tras enrolamiento, sin exigir que cada empleado haya iniciado online en cada terminal. |
| **O10 · P1 · 9/10** | **Outbox existente no cierra la sincronización de negocio.** index.js:797–805 está apagado por defecto y describe shadow; outbox.js:122 publica a pos_local_events. No se identificó consumidor que materialice esos eventos como orden/pago/turno ni conmutación runtime de pos_write_authority. | Consumidor cloud idempotente que actualice tablas canónicas y deje recibo verificable por operación. Subir un evento no equivale a que corte, inventario y dashboard ya lo reflejen. |

**Alcance de O4:** GET /state de un secundario se reenvía a Caja mientras ésta está disponible; esa lectura no depende de su réplica vacía. El defecto sí afecta WS y recuperación/fallback local. No confundirlo con O1/O2.

**SQL H6:** el archivo PENDIENTE_20260904000000_cuentas_divididas_modelo_durable.sql declara explícitamente ausencia de RLS (:172–174), y ADD CONSTRAINT (:57–59) no tiene guard de repetición. Antes de usarlo hacen falta aislamiento, validación de relaciones tenant/orden/cuenta, repetibilidad, escritor/lector y política de rollback. La PK de cierres no vuelve atómica la emisión externa; se necesita una tarea durable de publicación. Un rollback destructivo deja de ser seguro una vez que existen pagos nuevos.

## 4. Contrato de producto propuesto

### Identidad y estados

| Concepto | Qué representa y regla |
|---|---|
| Orden | Consumo compartido con ID estable; mesa es ubicación, no identidad. Mantiene revisión. |
| Cuenta | Parte del saldo a liquidar; dividir no inventa otra orden de cocina. |
| Pago | Intento y resultado durable. Pendiente/resultado incierto no equivale a rechazado ni autoriza cobrar otra vez. |
| Comanda | Envío de productos a estación; nuevas rondas/cancelaciones conservan identidad de ítem y lote. |
| Mesa | Ocupación y asociación con orden(es). Mostrar explícitamente cuentas múltiples cuando existan; nunca esconder saldo. |
| Turno | Sesión operacional de sucursal, compartida; apertura y Z únicos conforme a su contrato. |

**Tres estados independientes:** financiero (pendiente/parcial/pagado), preparación (pendiente/preparando/listo/entregado/cancelado) y réplica (pendiente local/confirmada por Caja/confirmada por nube). Pagar no prueba entrega; entregar no prueba pago. Esta separación fue aprobada por Daniel en D2 y queda registrada en ADR-005; todavía no está implementada.

**Guardar y enviar también son distintos:** reservar/abrir y los cambios confirmados de una cuenta deben compartirse por Caja. Enviar decide qué lote sale a cocina. Borradores aún no confirmados conservan estado pendiente y dueño; no se anuncian como consumo confirmado ni como enviados. El momento exacto de compartir cambios mientras se captura se debe validar con el flujo del mesero antes de implementar UI.

### Autoridad y desconexión

~~~text
POS A / B / C autorizados
     │ comandos (ID de operación + revisión esperada + actor + scope)
     ▼
Pedro de CAJA / autoridad de SUCURSAL, con y sin internet
     ├─ transacción: orden/cuenta/pago + evento + recibo + tareas pendientes
     ├─ proyecciones distintas → salón / editor / KDS / corte
     ├─ cola durable → impresión
     └─ outbox → API cloud → tablas canónicas → inventario / informes / IA

Delivery / QR / operador cloud → inbox durable → aceptación por Caja
                                         └─ estado pendiente visible si no hay WAN
~~~

No debe existir conmutación silenciosa al escritor cloud cuando una terminal pierde a Caja. Antes del cambio se deben drenar/reconciliar las colas browser existentes y asignar una generación de autoridad que las versiones viejas deban respetar. Comparar expected_revision y deduplicar son problemas distintos: ID evita repetir una operación; revisión evita sobrescribir otra operación válida concurrente.

| Situación | Comportamiento aprobado por Daniel en D1 |
|---|---|
| WAN disponible, LAN/Caja disponibles | Operación local compartida; nube se actualiza sin cambiar de autoridad. |
| Sin WAN, LAN/Caja disponibles | Abrir/continuar/cancelar con permiso, enviar, cobrar en medios disponibles e imprimir desde todos los POS autorizados; X/Z conforme contrato local. |
| POS aislado de Caja | Última vista con antigüedad explícita; borradores durables pendientes. Bloquear cobro, split, fusión, traslado y edición autoritativa hasta recuperar contacto. Nunca mostrar «enviada» sin aceptación de Caja. |
| Caja fuera de servicio | Modo de contingencia visible; recuperación del servidor y sus datos. Cobrar desde respaldo requiere diseñar traspaso de autoridad, no sólo cambiar IP. Sin elección automática de otra Caja en la primera entrega propuesta. |
| Proveedor bancario/PAC/delivery inaccesible | Distinguir función local de función externa: no inventar autorización, timbre ni aceptación. Resultado incierto se reconcilia por ID antes de reintentar; medio alternativo según proceso del negocio. |

### Almacenamiento: extender la frontera existente

Para arreglar réplica, es posible endurecer NDJSON: reconstruir deduplicación desde eventos, persistir snapshot/cursor juntos y propagar errores. **Para trasladar dinero a Caja recomiendo completar el adaptador transaccional local previsto por storage/base.js**, evaluando SQLite con pruebas de Windows y recuperación. El contrato existente ya exige append+idempotencia atómicos, durabilidad y snapshots antes de migrar pagos/turnos.

Es una sustitución del adaptador y la unidad transaccional, no una reescritura de todo Fullsite. Una única conexión/escritor en Caja; los demás dispositivos usan la API, no un archivo DB compartido en red. El gate es comportamiento durable demostrado, no elegir una marca de base de datos.

SQLite documenta transacciones y el alcance de synchronous=FULL en WAL; la durabilidad ante corte depende también del almacenamiento y de su configuración. Se probará explícitamente en Windows y en hardware. [Documentación SQLite](https://www.sqlite.org/wal.html), [synchronous](https://sqlite.org/pragma.html#pragma_synchronous).

## 5. Cierre del resto de Fullsite

Estas referencias son a main **4fa12e6f**. Detalle de fuentes y límites en [anexo de plataforma](FULLSITE-PLATAFORMA-ANEXO-2026-09-04.md). Son hallazgos de lectura; no se comprobó su explotación ni configuración remota.

| Frontera | Hallazgo confirmado / riesgo inferido | Prueba de cierre |
|---|---|---|
| Identidad/onboarding | API puede terminar ok:true aunque falle membresía; cliente se activa antes de completar pasos. | Alta interrumpida en cada etapa, reanudación sin duplicados/configuración pisada; dueño entra y primer turno/venta funcionan antes de marcar activo. |
| Tenant/sucursal/rol | kitchen/route.ts:62 selecciona último turno de todo el tenant, sin location_id. Proxy catch-all :116–127 sólo fuerza tenant en POST, deja body PATCH crudo con service role; autorización por tablas no cubre todas las acciones. | Dos tenants y dos sucursales con mesa 7 y turno abierto simultáneo: cero cruces. Pruebas negativas de tenant inmutable y permisos por comando/campo, preservando operación legítima. |
| Pago integrado y CFDI | MP/Clip eligen credenciales globales o suministradas por cliente; Facturama productivo usa emisor global. Reserva de timbrado y confirmación local de resultado no son atómicas. | Dos comercios sandbox; credencial/emisor correcto. Doble solicitud y caída después de aceptación externa: un efecto y recuperación desde otro dispositivo. Sin timbres/cobros reales en prueba. |
| Inventario y recetas | recordMovement inserta ledger, luego PATCH stock/costo; devuelve success por movements_created aunque PATCH falle. Retry puede salir como duplicate sin reparar. Motor de derivación recetas existe sin wiring productivo encontrado. | Recibir → vender → cancelar → reintentar/reconectar; mismo saldo/costo y un movimiento por operación. Escribir ledger/materialización transaccionalmente; receta usada por costeo y depleción coherente. |
| Corte/dashboard/IA | Dashboard agrupa por fecha calendario; agregador Python respeta hora de inicio del día de negocio. Posible divergencia en medianoche; consulta dashboard limitada a 5000 filas. | Turno que cruza medianoche y volumen superior al límite: neto/impuestos/propina/formas de pago iguales en corte, dashboard e IA; fuente y pendientes de sync visibles. |
| Delivery | Mapping y cuarentena existen; aceptación de proveedor puede informarse aunque falle PATCH local. | Webhook duplicado, cancelación, ACK perdido, reconexión y estado de tienda: orden única en sucursal correcta, KDS y proveedor coherentes. Certificación externa separada por integración. |
| Instalación/soporte | Auto-update existe; gate comprueba turno/KDS/mesas pero no todas las colas de dinero/sync. Soporte puede responder queued sin acreditar ejecución de Pedro. Health global no demuestra cada terminal. | Manifiesto del servicio; actualización y rollback con pendientes; comando de soporte sólo concluido tras resultado durable; salud y versión por terminal. |

## 6. Calidad de código, pruebas y rendimiento

**Calidad:** la deuda principal es de fronteras: lógica de pagos/turnos/traslados en páginas, duplicación de decisiones cloud/local y adaptadores que descartan información. Crear un repositorio/contrato de operación común sobre los componentes existentes y migrar una acción por vez. No añadir otro caché que compita con los actuales. Errores de lectura/persistencia nunca se traducen en vacío/éxito. Cada consumidor debe interpretar explícitamente origen, preparación y revisión.

**Pruebas existentes:** Vitest para módulos del dashboard, node:test en Pedro, laboratorio multi-Electron y Playwright. La suite playwright.config.multiterminal.ts usa app.fullsite.mx por defecto; no se ejecutó. context.setOffline() tampoco representa por sí solo «cayó WAN y LAN sigue viva». El nuevo fixture debe negar únicamente conexiones externas y mantener localhost/LAN, apuntar build de UI a sandbox o backend de prueba y usar perfiles independientes.

~~~text
Recorrido                                  Evidencia actual de esta revisión
HTTP/WS/Persistencia → proyección           Repros loopback/in-memory de fallos
Código salón → apertura editor offline     Closure real ejecutado en VM: falla
KDS entregada → salón deudor                Estado/adaptador reales: falla
Pago real UI → cuentas durables → otra POS  PENDIENTE, no cubierto por helper puro
Boot Electron → PIN → menú → cuenta         PENDIENTE UI con build/versiones reales
Windows → impresión/huella → energía        PENDIENTE físico
Outbox → órdenes/pagos/stock/reportes       PENDIENTE E2E sandbox
~~~

**Rendimiento:** readAfter de NDJSON relee todo el archivo (ndjson.js:93) y markSynced lo reescribe (:134–151); poll y replay pueden crecer con el historial. Son costos observados en código, no una latencia medida en restaurante. Medir con 30 mesas activas, varias rondas y reinicios, además del historial esperado, antes de optimizar. Cursor indexado, snapshots consistentes y lotes acotados evitan trabajo proporcional a todo el log en cada actualización.

SLO propuesto para validar con negocio: cambio confirmado por Caja visible en cada POS/KDS en **≤1 s p95 y ≤3 s p99** en la LAN acordada; pérdida de autoridad indicada en **≤5 s**. Son metas, no cifras logradas. Medir aceptación, proyección por terminal y papel por separado. El usuario no debe esperar un timeout cloud para una operación LAN.

El estado de WAN no se puede inferir únicamente de navigator.onLine: Electron documenta sus límites. Medir por separado Caja, LAN, nube y proveedores. [Electron: detección online/offline](https://www.electronjs.org/docs/latest/tutorial/online-offline-events).

## 7. Implementation Tasks — secuencia propuesta

Todo lo siguiente está **propuesto**, no desplegado ni marcado como completado. Daniel aprobó D1/D2 y están registradas en [ADR-005](../adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md). No son nuevas autorizaciones para producir efectos remotos.

| ID | Prioridad / módulo | Entregable concreto | Depende de / verificación |
|---|---|---|---|
| T1 | P1 · contrato de operación | Documentar orden/cuenta/pago/comanda/turno, scope, fuente por campo, ACK y degradación. Definir qué lee/escribe cada cliente Electron/PWA/mobile/QR/delivery. | D1/D2 aprobadas; completar ejemplos de servicio y matriz de permisos. |
| T2 | P1 · transporte y enrolamiento | Cerrar auth HTTP+WS, secreto inicial, inyección POS/KDS, fallback Chromium y reenvío. | O5; legítimos funcionan, intrusos fallan antes de mutar. Puede prepararse independientemente. |
| T3 | P1 · almacenamiento y réplica | Corregir ACK falso, atomicidad/idempotencia, snapshots/cursor/generación, recuperación y tareas durables. Implementar adaptador requerido para dinero. | O4/O7/O8; crash/disk-full/retry/restore, pruebas de distribución Windows. |
| T4 | P1 · autoridad de sucursal y nube | Ruta de comandos versionados, único escritor, materializador cloud con recibos, corte de polls destructivos; transición y compatibilidad de clientes viejos. | T1/T3; reconciliar colas previas y ensayar rollback sin dos escritores. |
| T5 | P1 · salón y editor | Proyección completa de órdenes separada KDS; ambos leen mismo ID/revisión, nombres/personas/saldo; refresh de cuenta abierta. | T1/T2/T3; A crea/B abre/C agrega sin WAN, B sin caché previa. |
| T6 | P1 · turno y acciones | Abrir turno/cuenta, agregar, cancelar, mover, transferir, unir y enviar como comandos con permisos; conflictos visibles. | T4/T5; misma revisión y cantidades en todas POS, no sólo mapas iguales. |
| T7 | P1 · dinero/H6 | Conectar cuentas/pagos/cierre a estado durable local y cloud; completar migración y aislamiento; recovery de split y doble cobro. | T1/T3/T4; pagar parcial, reiniciar, continuar en otra POS; X/Z concilian. |
| T8 | P1 · cocina/impresión | Estado de preparación separado de pago, batch/ítem estable, cancelación coherente, cola de impresión recuperable y resultado incierto visible. | T1/T3/T6; una ronda, actualizaciones por estación, caída imprimiendo y reimpresión identificada. |
| T9 | P1 · acceso y paquete offline | Build completo versionado, caché anterior conservado hasta completar nuevo, menú/modificadores y acceso offline por LAN, preflight por terminal. | T2; arranque sin WAN en terminal enrolada, actualizaciones parciales, PIN/huella en perfil habilitado. |
| T10 | P1 · UI/hardware/aceptación R1 | Fixture UI Electron real aislado + matriz de abajo + manifiesto y rollback/restore. | T2–T9; prueba de Windows y servicio AMALAY sobre el mismo candidato. |
| T11 | P1 · cierre contable/datos | Inventario transaccional/recetas, día de negocio común y conciliación corte/dashboard. Medios integrados y CFDI sólo con su aceptación de tenant/recovery. | Contratos T1/T7; fixtures de venta/cancelación/medianoche/resultado externo incierto. |
| T12 | P1 · clonabilidad R2 | Alta reanudable y activación comprobada; configurar dispositivos/roles/merchant/emisor; repetir servicio con restaurante vacío. | R1/T11 y seguridad de plataforma; segunda sucursal necesita prueba adicional de aislamiento. |

**Plan de trabajo paralelo:** transporte/enrolamiento (T2), diseño/migración cloud de cuentas (parte de T7) y fixture UI con denegación de red externa (preparación T10) pueden prepararse por separado. Almacenamiento/réplica/autoridad comparten electron-app/local-server y deben coordinarse secuencialmente; salón/editor/acciones/pagos comparten pos/page.tsx y tampoco conviene editarlos a ciegas en paralelo. Integración final y certificación siempre sobre un único SHA/manifiesto.

No se asignan horas ficticias a «cerrar Fullsite». El tiempo de campo y de proveedores no se comprime por tener más agentes. Estimar cada paquete después de reproducir sus gates, y registrar implementación, verificación local, staging y campo como estados separados.

## 8. Matriz que realmente cierra offline

Usar Caja + POS2 + POS3 + KDS, perfiles independientes enrolados, fixtures sintéticos y build de UI real. Cada fila conserva order/command/payment/turno ID, secuencia/revisión, timestamps y evidencia de pantalla. Aplicar a caja y secundarios alternando el origen de la orden.

| Prueba | Resultado necesario |
|---|---|
| WAN cortada, LAN viva | A crea y confirma; B descubre y abre mismo ID/ítems/importe; C agrega; A/B se actualizan; cocina recibe lote correcto. |
| Cuenta abierta simultáneamente | Dos cambios distintos conservan ambas intenciones o uno muestra conflicto recuperable; nunca se pierde silenciosamente un producto. |
| Comida entregada y deuda pendiente | Sale de pendientes de cocina, sigue la deuda/ocupación en salón. Pago anticipado no borra preparación pendiente según D2 aprobada. |
| B sin caché de órdenes | Obtiene turno, salón y detalle desde Caja; no requiere haber abierto esa mesa antes. |
| Reinicio secundario | Recupera snapshot/cursor coherentes y luego cambios nuevos, sin perder anteriores ni inventar orden. |
| Reinicio/caída Caja | Estado no autoritativo visible; restricciones D1; restauración y replay preservan órdenes, cuentas, pagos y trabajos. |
| ACK perdido y disco lleno | Mismo ID retorna resultado confirmado o error; cero éxito sin persistencia y cero duplicación por retry. |
| Cobro simultáneo / doble tap | Un solo resultado monetario; segundo operador ve saldo y respuesta correcta antes de aceptar otro cobro. |
| Split parcial y cambio de terminal | Pagar cuenta 1; reiniciar; pagar restante desde otra POS. Se conserva madre y saldo; no libera antes. |
| Cancelar/transferir/unir | Mismos ítems, lotes, permisos, revisión y saldo en salón/editor/KDS; orden no cambia de identidad por ubicación. |
| Impresora caída o crash imprimiendo | Trabajo pendiente o incierto explícito; recuperación/reimpresión auditada sin afirmar que salió papel sólo por un ACK. |
| Vuelve WAN con nube atrasada | Ninguna orden local desaparece por poll. Cada operación tiene recibo cloud; colas drenan o muestran conflicto accionable. |
| Inicio de turno y X/Z | Un mismo turno en todas las POS; cierre concilia ventas/pagos/propinas/efectivo y no oculta pendientes de otra terminal. |
| Seguridad y plataforma real | POS/KDS emparejados funcionan con credenciales; HTTP/WS ajenos fallan. Electron soportado, SW activo, puertos distintos. |
| Boot y actualización incompleta | Terminal enrolada abre sin WAN con permisos/catálogos vigentes; descarga parcial conserva versión íntegra anterior. |
| Servicio y datos posteriores | Operación por LAN + recuperación terminan con igualdad de saldos, corte, stock y dashboard conforme perfil; repetir en campo y luego en tenant nuevo. |

**R1 cerrado:** todas las filas aplicables pasan en UI real y Windows/hardware, más servicio completo de AMALAY con manifiesto identificado y restore/rollback practicados. **R2 cerrado:** mismo criterio en tenant nuevo sin tocar código y con aislamiento. No usar porcentaje de código ni total de unit tests como sustituto.

## 9. Alcance diferido y límites honestos

- Elección automática de Caja y operación monetaria concurrente en particiones: requiere otro diseño de autoridad; D1 aprobada excluye ese cobro en la política inicial; cambiarla requerirá una decisión nueva.
- Nuevos frameworks, microservicios o reemplazo de toda la base de datos: no se justifican para cerrar la orden compartida.
- Nuevas capacidades IA: primero cifras con procedencia y conciliación; después certificar recomendaciones sobre esos datos.
- Bancos, CFDI y marketplaces: pruebas sandbox y activación de cada perfil; esta auditoría no confirma sus aprobaciones ni configuración real.
- Internet offline no significa poder autorizar una tarjeta, timbrar o recibir información nueva de un proveedor inaccesible.
- No se inspeccionó exhaustivamente cada archivo/ruta del repositorio ni el estado vivo de DB, dispositivos o producción. La revisión cubre fronteras y recorridos críticos; el anexo marca inferencias.
- Los scripts adjuntos son reproducciones diagnósticas del código congelado. Se conservan fuera del candidato y no se ofrecen como suite de aceptación de UI.

## 10. Evidencia y trazabilidad

**Decisiones registradas:** [ADR-005](../adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md). D1 y D2 confirmadas por Daniel durante esta revisión. La revisión crítica adicional señaló perfiles web/mobile, inbox cloud, traspaso de autoridad y límites de impresión/pago externo; se incorporaron como condiciones técnicas, sin efectos remotos.

- [Cinco reproducciones de proyección/UI aislada](evidence-20260904/pos-projection-repro.cjs) · [salida](evidence-20260904/pos-projection-output.txt).
- [Ocho reproducciones de autoridad, recuperación, auth e impresión](evidence-20260904/offline-authority-repro.cjs) · [salida](evidence-20260904/offline-authority-output.txt).
- [Contraste de liquidación y atomicidad](evidence-20260904/durability-payment-repro.cjs) · [salida](evidence-20260904/durability-payment-output.txt). La atomicidad también aparece en la serie anterior; no contar dos veces.
- [Anexo de plataforma, fuentes y límites](FULLSITE-PLATAFORMA-ANEXO-2026-09-04.md).
- [Doce paquetes propuestos, formato JSONL](FULLSITE-IMPLEMENTATION-TASKS-20260904.jsonl).

Los scripts leen fuentes del candidato por ruta absoluta, verificable contra su SHA, y usan datos sintéticos. Requieren las dependencias locales indicadas; si se mueve el worktree hay que actualizar SOURCE. Las pruebas de servidor se limitan a loopback y deshabilitan credenciales cloud. Ningún resultado aquí acredita producción.

## GSTACK REVIEW REPORT

| Revisión | Runs | Status | Findings |
|---|---:|---|---|
| Arquitectura y producto | 1 | Auditoría completa; D1/D2 aprobadas | Autoridad, proyecciones, pagos, identidad/sucursal y sincronización requieren integración. |
| Calidad de código | 1 | Con hallazgos | Fronteras fragmentadas, campos descartados, errores convertidos en éxito/vacío. |
| Pruebas | 1 | Repros ejecutadas; E2E pendiente | Lógica real y loopback confirman fallos; UI Windows/hardware/staging no certificados. |
| Rendimiento | 1 | Lectura de hot paths; medición pendiente | Lectura/rewrite de log completo y polling; SLOs propuestos sin atribuir mediciones. |
| Revisión paralela | 3 | Completada | Motor local, consumidores POS y plataforma; mismo modelo, no consenso entre modelos distintos. |
| Cambio concurrente 5bb3a811 | 1 | Parcialmente resuelve O4; 3/3 pruebas nuevas | Recupera snapshot al reconectar con Caja; no certifica copia durable sin Caja ni UI. |

**VERDICT:** DONE_WITH_CONCERNS para la auditoría. Candidato offline y producto punta a punta **no certificados para producción**. Este documento propone trabajo y no constituye autorización de merge, migración o deploy.

**UNRESOLVED DECISIONS:**
- D3: concretar flujo de captura compartida/borrador y perfil de terminales en campo; incidencia relatada aún sin atribución a un defecto específico de esta revisión.
