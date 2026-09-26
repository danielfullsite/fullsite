# Integración del rediseño POS v1.2

## Decisión

El prototipo visual v1.2 no se incorpora mientras P19 permanezca en `HOLD`.
Su integración será una capa de presentación con bandera de función: no puede
modificar contratos P17/P19, pagos, impresión, KDS, almacenamiento local ni
la semántica de los recibos.

Esto evita que una mejora de interfaz esconda o altere una transición durable
que aún está en certificación.

## Fuente y alcance

- Fuente: exportación estática `pos-rediseno-export-2026-09-25-v1.2`.
- Alcance visual aprobado: avisos globales sobre overlays, errores locales en
  Cobro/Modificadores y listas de sincronización que muestran filas completas.
- No es una especificación de negocio ni evidencia de compatibilidad con POS.

## Orden de integración

1. **Cerrar admisión GUI P19.** Sólo perfiles sintéticos; conservar `HOLD`.
2. **Mapa de componentes.** Relacionar cada región visual del prototipo con un
   componente existente del POS, sin reemplazar handlers ni modelos de estado.
3. **Bandera desactivada por defecto.** La bandera cubre exclusivamente el
   layout/tokens nuevos y se evalúa en el renderer; no llega a main/preload.
4. **Adaptación por escenas.** Implementar Cobro, Modificadores, avisos y cola
   una a una. Cada escena conserva sus acciones, IDs, foco y accesibilidad.
5. **QA visual y funcional separado.** Comparar 1440×900, 1366×768 y 1280×800;
   después ejecutar el flujo POS→ORDER_SEND→KDS sobre la interfaz candidata.
6. **Canary sintético.** Habilitar sólo en laboratorio, no en cajas ni tenants
   productivos. La activación real exige validación física y rollback probado.

## Guardas obligatorias

- Ningún handler de Cobro, Enviar, Cancelar, Deshacer o Modificadores cambia
  durante una tarea visual.
- Los mensajes siguen teniendo un origen tipado; la UI no inventa errores.
- La bandera se retira si la pantalla no puede renderizar una escena completa.
- No hay cambios de esquema, migraciones ni acceso a redes para el rediseño.
- La misma versión conserva una ruta de regreso al diseño anterior.

## Criterios de salida

- P19 GUI/CDP obtiene su propio resultado positivo antes de fusionar UI.
- Cada escena visual tiene prueba de layout, teclado/foco y acción funcional.
- No hay nuevos errores de consola ni peticiones externas en las tres
  resoluciones objetivo.
- Una desactivación de la bandera restaura el diseño anterior sin tocar datos.
- La validación física se registra aparte del resultado de laboratorio.

