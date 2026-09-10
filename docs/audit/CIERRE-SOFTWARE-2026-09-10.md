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
