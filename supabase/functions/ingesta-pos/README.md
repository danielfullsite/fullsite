# `ingesta-pos`: contrato de recepción y proyección directa

Esta función recibe lotes de un lector local autorizado y conserva el espejo
histórico (`historico_*`). La recepción histórica es el paso durable; la proyección
inmediata a `pos_orders` es secundaria y no debe hacer que un lector reintente un
lote ya aceptado.

## Activación segura

1. Aplicar primero `PENDIENTE_20261001090000_proyeccion_directa_lector_externo.sql`
   en un laboratorio aislado.
2. Verificar que el cliente no contiene órdenes nativas. La función de base lo
   bloquea de todos modos; esta verificación evita usar ese bloqueo como flujo normal.
3. Crear explícitamente una fila habilitada en
   `ingesta_pos_projection_configs` para el par `client_id` + `fuente` que se desea
   proyectar. La migración no habilita ningún cliente.
4. Desplegar esta función sólo después de la migración. Si el RPC no está disponible,
   el lote histórico sigue respondiendo éxito y el resultado reporta
   `pendiente_reconciliacion`.
5. Mantener `fs_sync_pos_orders_desde_historico` activo hasta que una conciliación
   independiente demuestre que ambas rutas coinciden durante el periodo acordado.

## Límites conocidos

- Proyecta únicamente tickets cerrados; no es aún un stream de comanda/KDS durante
  la operación.
- Conserva el formato actual de `items` y `pagos` para no cambiar métricas del
  dashboard en el mismo despliegue.
- La fuente externa no puede reemplazar órdenes nativas.
- La proyección detecta cambios en los campos proyectados y puede reflejar una
  cancelación posterior. Todavía no registra una revisión de origen criptográfica
  ni sustituye la conciliación del corte.

## Evidencia local de la primera validación

En una base PostgreSQL 17 temporal, creada y destruida localmente, se comprobó:

- sin configuración habilitada, `0` proyecciones;
- con la configuración habilitada, una venta se insertó una vez;
- una repetición idéntica devolvió `0` cambios;
- una cancelación posterior actualizó el espejo a `cancelada`;
- una orden nativa existente bloqueó la proyección externa.

Esto no acredita integración con la caja, Supabase compartido ni comportamiento de
red. Es una validación de contrato SQL aislada.
