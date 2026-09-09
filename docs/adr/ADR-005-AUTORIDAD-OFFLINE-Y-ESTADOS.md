# ADR-005 — Autoridad offline y separación de cobro/entrega

**Estado:** ACTIVE como decisión de producto; implementación pendiente.  
**Fecha:** 2026-09-04 Monterrey / 2026-09-05 UTC.  
**Decisor:** Daniel, confirmación explícita en esta revisión.  
**Supersede:** prevalece sobre cualquier interpretación anterior que confunda internet caído con Caja inaccesible, o pago con entrega. No modifica por sí solo las reglas de turno, permisos ni facturación.

## Contexto

Daniel solicita cerrar Fullsite de punta a punta y priorizar que una orden se vea y pueda operarse en todos los puntos de venta. Se revisaron main 4fa12e6f y candidato de904d71. Las reproducciones muestran que mapa/editor usan fuentes distintas, la proyección KDS oculta órdenes entregadas aún deudoras, y el estado de dinero no es durable/compartido de punta a punta.

## Decisiones aprobadas

### D1 — WAN, LAN y Caja son condiciones distintas

- Con Caja y LAN disponibles, Fullsite debe ofrecer operación completa desde los POS autorizados, haya o no internet.
- Si una terminal pierde contacto con Caja, conserva lectura con antigüedad visible y permite borradores pendientes; bloquea cobros, divisiones y transferencias hasta reconectar.
- Los borradores aislados no se presentan como órdenes enviadas o aceptadas por cocina. El alcance aprobado no incluye cobro desde una Caja alternativa ni elección automática de líder.
- La autorización bancaria, timbrado y nueva información de proveedores externos conservan sus requisitos de conectividad. La operación local no debe inventar su confirmación.

Confirmación de Daniel: **«Sí: operar por LAN; sin Caja, borradores y sin cobro (recomendado)».**

### D2 — Cobro y preparación tienen estados independientes

- Una comanda pendiente permanece en KDS aunque ya esté pagada.
- Una orden entregada sigue ocupando su mesa mientras deba dinero.
- La liquidación de todas las cuentas de una madre no significa que todos sus productos estén preparados o entregados.
- Las proyecciones de salón, editor y cocina usan el mismo estado operacional con filtros propios. La cola de cocina no es la lista de cuentas abiertas.

Confirmación de Daniel: **«Sí, separar cobro y entrega (recomendado)».**

## Opciones consideradas y consecuencias

1. **Política aprobada:** servicio compartido por LAN y degradación explícita al perder Caja. Evita autorizar pagos sobre saldos que una terminal no puede conocer. Su costo es detener esas acciones en una partición, conservando capturas pendientes.
2. **Cobrar también sin Caja:** necesitaría autoridad alternativa, traspaso controlado, recuperación y protección contra dos escritores. No forma parte de la política inicial aprobada.
3. **Retirar de cocina al pagar:** rechazado por D2. Confunde dinero con preparación y falla en pedidos pagados antes de cocinar.

## Arquitectura recomendada para implementar estas decisiones

Una autoridad operacional de sucursal en Caja/Pedro con comandos por ID/revisión, estado durable y proyecciones distintas. Cloud recibe y materializa resultados con recibos idempotentes; clientes cloud/delivery pasan por un inbox hacia la autoridad. Esta es la propuesta técnica de la revisión, no una migración ya ejecutada ni una aprobación específica de librería.

Reutilizar las fronteras de CoreEventStore y sus adaptadores. El almacenamiento debe confirmar comando, resultado, evento y tareas pendientes de forma atómica antes del ACK. La elección final del adaptador y el procedimiento de transición requieren su prueba de ingeniería. Nunca activar dos escritores para resolver un fallo de conectividad.

## Aceptación obligatoria

- WAN cortada con LAN viva: A crea, B abre el mismo ID/ítems/saldo sin caché anterior, C modifica, todos convergen; KDS recibe sus lotes.
- Caja inaccesible: borrador pendiente visible y cobro/split/traslado bloqueados; reconectar conserva identidad y no duplica.
- Pagar antes de preparar: KDS conserva lo pendiente. Entregar antes de pagar: salón conserva deuda y ocupación.
- Split parcial y reinicio: otra terminal recupera cuentas/saldos; se liquida sólo lo realmente pagado.
- Permisos, hardware, pago integrado y funciones externas se certifican por el perfil de dispositivos y medios habilitados.

## Referencias

- [Auditoría y plan de cierre](../audit/FULLSITE-CIERRE-PUNTA-A-PUNTA-2026-09-04.md).
- [Reproducciones de proyección](../audit/evidence-20260904/pos-projection-output.txt).
- [Reproducciones de autoridad y recuperación](../audit/evidence-20260904/offline-authority-output.txt).
- [ADR-001: concurrencia](ADR-001-CONCURRENCY.md), [ADR-003: turno](ADR-003-TURNO-LIFECYCLE.md).
