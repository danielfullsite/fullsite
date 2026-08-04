# 14 — Unknowns

> Todo lo que requiere observación en campo, revisión de código, o entrevista antes de poder clasificar como MATCH / SURPASS / WANSOFT-ONLY.  
> Al cerrar un UNKNOWN: actualizar este archivo + PATTERN-REGISTER.md + el archivo de categoría.

---

| ID | Pregunta | Requiere | Relacionado |
|---|---|---|---|
| UNK-001 | ¿Puede el gerente cambiar el monto del fondo de caja sin deploy? ¿Dónde está almacenado el valor $1,700? | Revisión de código + entrevista AMALAY | OP-013, CJ-001 |
| UNK-002 | ¿Qué acción toma el gerente cuando ve un turno en estado "stale"? ¿Puede cerrarlo sin perder las órdenes? | Observación de campo | OP-007 |
| UNK-003 | ¿Permite el sistema cerrar turno con órdenes abiertas? ¿Advierte, bloquea, o permite forzar? | Revisión de código | OP-008, EC-007 |
| UNK-004 | ¿Cómo se calcula `hora_pico` en wansoft_kpis? ¿Ventana deslizante? ¿Histórico de días anteriores? | Revisión de código | OP-009 |
| UNK-005 | ¿Puede el mesero bloquear manualmente la terminal sin cerrar la sesión? ¿Hay "lock screen"? | Revisión de código + observación de campo | OP-010 |
| UNK-006 | ¿Cada cuánto se actualiza el snapshot del menú en IDB? ¿El mesero sabe si el menú que ve es del día anterior? | Revisión de código | OP-012 |
| UNK-007 | ¿Cómo resuelve AMALAY el cambio de turno de cajero (mañana/tarde)? ¿Qué pasa con las órdenes activas? | Entrevista AMALAY / observación de campo | OP-014 |
| UNK-008 | ¿Soporta Fullsite cobro mixto (efectivo + tarjeta en una sola cuenta)? | Revisión de código + prueba de campo | CJ-004 |
| UNK-009 | ¿Fullsite calcula el tip-out automáticamente? ¿O el gerente lo hace manualmente? | Revisión de código + entrevista AMALAY | CJ-006 |
| UNK-010 | ¿El valor CORTESIA_POR_PERSONA = $480 es configurable por cliente? ¿El gerente puede sobrepasarlo? | Revisión de código | CJ-010 |
| UNK-011 | ¿Cuántos tipos de descuento soporta Fullsite? ¿Porcentaje, monto fijo, ambos? | Revisión de código | CJ-012 |
| UNK-012 | ¿Existe flujo de devolución post-cobro en Fullsite? ¿Cómo se registra una devolución? | Revisión de código | CJ-014 |
| UNK-013 | ¿El bug CJ-015 (Corte X payment classification) fue corregido después de BREAK-THE-RESTAURANT.md? | git log + revisión de código | CJ-015, EC-003 |
| UNK-014 | ¿El flujo CFDI está completamente operativo en AMALAY? ¿El QR funciona end-to-end? | Observación de campo | CJ-017, CJ-019 |
| UNK-015 | ¿Cuántas horas de umbral para que un turno pase a estado "stale"? | Revisión de código | OP-007 |
| UNK-016 | ¿Rappi aparece como método de pago en AMALAY además de UberEats? | Observación de campo | CJ-003 |
| UNK-017 | ¿El agente antifraud_agent.py detecta diferencias de caja consistentes? | Revisión de código del agente | CJ-016 |
| UNK-018 | ¿El horario pico real de AMALAY es conocido? ¿Cuándo es y cuánto dura? | Observación de campo (datos wansoft_daily) | AM-010, OP-009 |
| UNK-019 | ¿Puede el gerente de AMALAY configurar el routing de ítems sin deploy? | Revisión de código + entrevista | CB-003, CF-004 |
| UNK-020 | ¿Qué tan frecuentes son los errores de monto en MP Point en AMALAY? ¿Hay registro de diferencias? | Entrevista con cajero AMALAY | CJ-018 |
| UNK-021 | ¿El OC-10 (menú offline en IDB) fue verificado físicamente en AMALAY o solo en código? | Fase 5 certificación offline | OP-012, OF-007 |
| UNK-022 | ¿Cómo resuelve AMALAY el cierre contable si hay múltiples terminales sin corte Global? | Entrevista AMALAY | OP-003, CJ-009 |
| UNK-023 | ¿Cuándo se implementa la integración directa MP Point API? ¿Está en el roadmap activo? | Revisión de roadmap | CJ-018 |
| UNK-024 | ¿La báscula COM1 de AMALAY tiene algún caso de uso activo? ¿Qué se pesa? | Entrevista AMALAY | AM-003 |
| UNK-025 | ¿El agente close_predictor.py usa datos de hora_pico o solo histórico de ventas? | Revisión de código del agente | OP-009 |
| UNK-026 | ¿Cuál es el tiempo promedio de preparación de una orden de Barra en AMALAY? ¿El umbral de 10 min es correcto? | Observación de campo | CB-012 |
| UNK-027 | ¿Tiene Wansoft notificación al mesero cuando cocina cancela un ítem? ¿Cómo se entera el mesero actualmente en AMALAY? | Entrevista AMALAY + revisión Wansoft | CB-018 |
| UNK-028 | ¿Cuándo fue la última vez que AMALAY tuvo stock negativo en Wansoft? ¿Qué ingrediente y cuál fue la causa? | Revisión wansoft_existencias.json + entrevista | IN-001 |
| UNK-029 | ¿Están sincronizadas las recetas de wansoft_recetas.json con pos_recipes en Fullsite? ¿Cuántas difieren? | Comparación directa de archivos | IN-002 |
| UNK-030 | ¿Cuántos ingredientes de AMALAY tienen yield < 100% en Wansoft? ¿Fullsite implementa el campo yield en pos_recipes? | Revisión wansoft_recetas.json + código pos_recipes | IN-003 |
| UNK-031 | ¿Fullsite implementa múltiples almacenes equivalentes a los 6 de Wansoft-AMALAY? | Revisión de código | IN-004 |
| UNK-032 | ¿Fullsite tiene un equivalente al cardex de Wansoft integrado en el dashboard? | Revisión de código | IN-005 |
| UNK-033 | ¿Fullsite usa datos de ventas históricas para sugerir puntos de reorden dinámicos? | Revisión de código | IN-006 |
| UNK-034 | ¿Fullsite tiene módulo de transferencias entre almacenes? ¿Con qué frecuencia ocurren en AMALAY? | Revisión de código + entrevista AMALAY | IN-007 |
| UNK-035 | ¿Fullsite tiene módulo de producción/subproductos equivalente? ¿Cuántas plantillas activas tiene AMALAY? | Revisión de código + revisión wansoft_produccion_plantillas.json | IN-008 |
| UNK-036 | ¿Con qué frecuencia hace AMALAY conteo físico de inventario? ¿Qué ingredientes muestran mayor variación? | Entrevista AMALAY + revisión wansoft_variacion_costos.json | IN-009 |
| UNK-037 | ¿Cuándo fue la última actualización de precios de ingredientes en pos_recipes? ¿Se ha validado el 27.6% con auditoría física? | Entrevista AMALAY + revisión BD | IN-010 |
| UNK-038 | ¿Existe log de auditoría por mesero en Fullsite? ¿Se registra qué acción realizó cada PIN y cuándo? | Revisión de código | MS-001 |
| UNK-039 | ¿Puede el gerente resetear el PIN de un mesero desde la terminal o requiere acceso al panel admin (deploy/Supabase)? | Revisión de código + entrevista AMALAY | MS-001, MS-003 |
| UNK-040 | ¿El cache de PIN en Fullsite sobrevive un refresh de página (localStorage) o vive solo en memoria de sesión? | Revisión de código | MS-002 |
| UNK-041 | ¿Cuántos de los 50 staff de AMALAY tienen turno activo en promedio por semana? ¿Cuántos son registros históricos no dados de baja? | Entrevista AMALAY | MS-003 |
| UNK-042 | ¿Usa AMALAY lectores de huella dactilar en alguna terminal? ¿El hardware existe físicamente en las instalaciones? | Observación de campo | MS-004 |
| UNK-043 | ¿Puede el cajero corregir una propina después de cerrar el cobro en Fullsite? ¿Qué sucede con la diferencia en efectivo? | Revisión de código + prueba de campo | MS-005 |
| UNK-044 | ¿Cómo se gestiona el PIN de MESERO EVENTO en AMALAY? ¿Es un PIN compartido entre el personal de evento o tiene un solo responsable? | Entrevista AMALAY | MS-007 |
| UNK-045 | ¿El ranking de meseros mostrado en Fullsite POS está basado en datos en tiempo real o solo en wansoft_daily (scraper)? | Revisión de código | MS-008 |
| UNK-046 | ¿Usa AMALAY el permiso "¿Se preparó?" en Wansoft? Si existe, ¿Fullsite necesita un equivalente? | Entrevista AMALAY + observación de campo | MS-009 |
| UNK-047 | ¿Fullsite soporta autorización remota de gerente (el gerente aprueba desde su propia terminal sin estar en la del mesero)? | Revisión de código | MS-010 |
| UNK-048 | ¿Cuántas órdenes de UberEats/Rappi recibe AMALAY al día en promedio? ¿Cuánto tarda el capturista en ingresar una orden manualmente en Wansoft? | Entrevista AMALAY + observación de campo | DL-001 |
| UNK-049 | ¿Cuántas plataformas de delivery están configuradas en el webhook de Fullsite en AMALAY? ¿Hay fallback si el webhook falla? | Revisión de código + entrevista AMALAY | DL-002 |
| UNK-050 | ¿Fullsite recibe confirmación de entrega desde la plataforma? ¿Cierra automáticamente el ciclo de la orden o queda en "lista" indefinidamente? | Revisión de código | DL-003 |
| UNK-051 | ¿Existe roadmap en Fullsite para recibir estados post-restaurante (en_ruta, entregada) desde las plataformas de delivery? | Revisión de roadmap + entrevista | DL-004 |
| UNK-052 | ¿Cuál es el endpoint exacto del webhook de delivery en Fullsite? ¿Tiene validación de firma HMAC? | Revisión de código | DL-005 |

---

## Unknowns de campo (requieren visita física a AMALAY)

- UNK-002, UNK-007, UNK-014, UNK-016, UNK-018, UNK-020, UNK-021, UNK-022, UNK-024
- UNK-026, UNK-027, UNK-028, UNK-036, UNK-037
- UNK-041, UNK-042, UNK-043, UNK-044, UNK-046, UNK-048, UNK-049

## Unknowns de código (requieren leer source o comparar archivos)

- UNK-001, UNK-003, UNK-004, UNK-005, UNK-006, UNK-008, UNK-009, UNK-010, UNK-011, UNK-012, UNK-013, UNK-015, UNK-017, UNK-019, UNK-025
- UNK-029, UNK-030, UNK-031, UNK-032, UNK-033, UNK-034, UNK-035
- UNK-038, UNK-039, UNK-040, UNK-045, UNK-047, UNK-050, UNK-052

## Unknowns de roadmap/entrevista

- UNK-023, UNK-051

---

## Contradicciones detectadas

| ID | Descripción | Fuente A | Fuente B | Resuelve con |
|---|---|---|---|---|
| CONTRA-001 | Cobro clasificado como "INFERIOR" en FULLSITE-POS-OPERATIONAL-BIBLE.md §veredicto pero sin detalle de qué aspecto específico falla. Puede referirse al cobro mixto, al flujo de pago, o a ambos. | FULLSITE-POS-OPERATIONAL-BIBLE.md §tabla-veredicto | FULLSITE-POS-BIBLE.md (no lista limitaciones de cobro) | Leer §veredicto completo + prueba de campo cobro mixto → CJ-004 |
| CONTRA-002 | pos_recipes (Fullsite) y wansoft_food_cost coexisten como fuentes de costo para AMALAY. FULLSITE-OPERATIONS-BIBLE.md establece que wansoft_food_cost está stale pero no cuantifica la diferencia. El 27.6% debe tratarse como aproximación hasta auditoría. | FULLSITE-OPERATIONS-BIBLE.md §food-cost | agents/wansoft/wansoft_costos.json | Comparación directa por platillo + auditoría física → IN-002, IN-010 |
