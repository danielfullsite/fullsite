# Corte y proyección de cobros de Caja

Estado: implementación local en revisión; no habilita AMALAY ni cambia el origen Wansoft antes del corte de escritor.

`dashboard-app/src/lib/caja-reportes.ts` es el contrato de lectura financiera compartido. Valida identidad de orden/turno, moneda MXN, centavos enteros seguros, cuentas únicas, pagos únicos y concordancia de las sumas. Una reserva `pending`/`unknown` no es dinero cobrado. `accepted.amount_cents` es venta; `tip_cents` es propina separada. La caja física suma venta más propina recibidas en efectivo; tarjeta manual y transferencia manual nunca se clasifican como efectivo ni como autorización de un banco.

## Corte local

`pedro-reportes.ts` consulta únicamente el `/state` confirmado de Caja. Exige autoridad Caja, snapshot completo y datos financieros válidos; no usa nube ni IndexedDB como reemplazo. Selecciona un solo turno activo o cerrado, incorpora deuda guardada que todavía no tenga apertura financiera y presenta cocina pendiente por separado.

`CorteDeCaja.tsx` pide PIN de gerente validado por Caja y conserva esa sesión sólo durante la consulta. No reemplaza al operador del POS ni reutiliza `corte_access` del flujo anterior. Ante caída de Caja elimina los importes mostrados y presenta reporte no disponible. Una respuesta tardía de otro turno no sustituye el turno elegido. Corte X sólo lee; el enlace Z abre el flujo durable de `/pos/turno` y no cierra por consultar.

Los retiros, depósitos, descuentos y reembolsos necesitan sus respectivos comandos y proyecciones antes de integrarse en este reporte. El esperado de efectivo actual es fondo más cobros en efectivo, incluidas propinas. Los cierres conservan el efectivo contado y la diferencia guardados por Caja.

## Reportes en nube

`caja-reporte-cloud.ts` interpreta `caja_financial_snapshot`, comprueba identidad/turno, total, revisión y `payment_status`. Conserva `status` de preparación; nunca lo cambia artificialmente a `cerrada`. El adaptador produce una entrada de dinero por orden y fecha, agrupando pagos parciales del mismo día, y separa propinas.

`data.ts` pagina la consulta de órdenes sin filtrar por `status=cerrada`. Consulta `created_at` o `updated_at` dentro del período: el materializador financiero debe mantener `updated_at` con la fecha confirmada del evento. Agrupa por `accepted_at` cuando existe; snapshots anteriores sin esa fecha usan explícitamente la fecha de orden y exponen `reporting.historical_date_fallback`. No se inventa un momento de cobro. Rangos históricos se calculan desde su fecha inicial hasta hoy y luego se filtran al intervalo solicitado.

Los datos legacy conservan su regla de orden cerrada. Al activar `data_source=fullsite`, las funciones de reporte no anteponen ni sustituyen el resultado con Wansoft. Los errores de consulta se propagan como datos no disponibles; dashboard y Ventas muestran aviso y retiran los indicadores monetarios, con reintento.

## Límites de interpretación

- Esto presenta cobros aceptados, no ingresos devengados ni autorización bancaria. El dashboard en nube sólo conoce lo materializado; la prueba de campo debe comparar con Caja tras terminar sincronización.
- Los pagos no asignan importes a platillos. El adaptador no duplica cantidades de toda la orden en cada pago parcial; deja ese detalle sin asignación y lo anuncia mediante `reporting.item_allocation_available=false` y un aviso visible. Costo, inventario y desglose por platillo requieren su propia proyección.
- Las fechas de pago usan la zona activa del restaurante. Un calendario de día de negocio con hora de corte distinta sigue requiriendo contrato de negocio uniforme.
- Cobros, propinas y reservas tienen sumas independientes; los perfiles actuales y el alcance de cierre/impresión no se amplían mediante este reporte.

Pruebas específicas: `caja-reportes.test.ts`, `caja-dashboard-data.test.ts`, `corte-caja.dom.test.ts` y `reportes-error.dom.test.ts`. Cubren parciales, preparación separada, turno actual/anterior, datos inválidos, método manual/propinas, paginación, fecha histórica, autorización gerente, caída de Caja y error visible en dashboard.
