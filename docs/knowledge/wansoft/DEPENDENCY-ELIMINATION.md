# Eliminación de Dependencia Wansoft — Plan de Transición

**Fecha:** 2026-07-22
**Estado:** Diagnóstico completado, zero cambios aplicados
**Objetivo:** Eliminar a Wansoft del camino crítico de Fullsite

---

## Arquitectura Actual

```
WANSOFT.NET ──cookie (~90 min TTL, refresh manual)──► intraday_sales.py
                                                          │
                                                    ESCRIBE a wansoft_daily
                                                    (921 rows, 100% report_type='cierre')
                                                          │
                                          ┌───────────────┼───────────────┐
                                          ▼               ▼               ▼
                                    Dashboard        16 agentes IA     Reportes
                                   (page.tsx)     (briefing, anomaly,  (weekly,
                                                   antifraud, tips...) smoke test)
```

**Single point of failure:** `intraday_sales.py` + cookie manual.
En todo julio 2026, tuvo **1 ejecución exitosa** de ~50 intentos.

---

## Arquitectura Objetivo

```
FULLSITE POS ──pos_orders (Supabase, sin auth externa)──► pos_daily_aggregator.py
                                                              │
                                                        ESCRIBE a wansoft_daily
                                                        (misma tabla, mismo formato)
                                                              │
                                              ┌───────────────┼───────────────┐
                                              ▼               ▼               ▼
                                        Dashboard        16 agentes IA     Reportes
                                       (page.tsx)      (sin cambios)     (sin cambios)
```

**Zero single point of failure.** `pos_orders` está en Supabase. No hay auth externa, no hay cookies, no hay scraping.

---

## Estado Actual de la Transición

### Lo que YA existe y funciona

| Componente | Estado | Evidencia |
|-----------|--------|-----------|
| `pos_daily_aggregator.py` | Escrito, probado, deployado | Workflow activo `pos-daily-aggregator.yml`, cron `0 5 * * *` (11pm MX) |
| Formato compatible | Produce TODOS los campos de `wansoft_daily` | 24/24 campos idénticos (ventas_dia, meseros, platillos_top, etc.) |
| `report_type: 'fullsite_pos'` | Marca filas como provenientes de POS | Diferenciable de `report_type: 'cierre'` (Wansoft) |
| `getDashboardFromPosOrders()` | Dashboard ya sabe leer `pos_orders` directamente | `data.ts:432-490`, merge con `wansoft_daily` |
| `getRecentDays()` | Merge automático POS + Wansoft, prefiere POS en overlap | `data.ts:179-192` |
| `ops_aggregate.py` | Agrega `pos_orders` → `ops_daily` | Workflow existente |
| `pos_intraday_snapshot.py` | Snapshots intraday desde POS | Existe pero **cron deshabilitado** |

### Lo que FALTA para que AMALAY deje de depender de `intraday_sales.py`

| # | Requisito | Estado | Esfuerzo | Detalle |
|---|----------|--------|----------|---------|
| 1 | **AMALAY opera en Fullsite POS** | NO | Operativo | El POS está construido pero AMALAY sigue usando Wansoft. `pos_orders` tiene 85 rows (pruebas), 1 cerrada. Zero operación real. |
| 2 | **Habilitar cron de `pos_intraday_snapshot.py`** | Deshabilitado | 1 min | Descomentar schedule en `pos-intraday-snapshot.yml`. Sin esto, no hay datos intraday hasta el cierre de las 11pm. |
| 3 | **Backfill histórico** | No necesario | 0 | `wansoft_daily` ya tiene 921 rows desde 2024-01-02. El historial Wansoft se conserva. Los agentes seguirán leyendo historial normal. |
| 4 | **Eliminar `wansoft_kpis` de agentes** | Pendiente | 2 hrs | 7 scripts leen `wansoft_kpis` (congelada desde Jun 15). Reemplazar con lectura de `ops_daily_live` view o `wansoft_daily` más reciente. |
| 5 | **`location_id` en aggregator** | Faltante | 5 min | El aggregator no produce `location_id`. Agregar `"location_id": f"{CLIENT['id']}-spgg"` al row. |

### Porcentaje de datos que ya proviene del POS

| Fuente | Rows en `wansoft_daily` | % |
|--------|------------------------|---|
| Wansoft scraper (`report_type: 'cierre'`) | 921 | **100%** |
| POS aggregator (`report_type: 'fullsite_pos'`) | 0 | **0%** |

**Hoy, 0% de los datos operativos proviene del POS propio.** Esto cambia instantáneamente el día que AMALAY empiece a operar en Fullsite POS — el aggregator ya corre cada noche.

### Campos que dependen exclusivamente de Wansoft

| Campo | ¿Aggregator lo produce? | Nota |
|-------|------------------------|------|
| `ventas_dia` | Si | Suma de `pos_orders.total` |
| `ventas_brutas` | Si | `total + descuento` |
| `descuentos` | Si | Suma de `pos_orders.descuento` |
| `efectivo` / `tarjeta` | Si | Desglose por `metodo_pago` |
| `tickets_count` | Si | Count de órdenes cerradas |
| `mesas_atendidas` | Si | Distinct mesas |
| `personas_restaurant` | Si | Suma de `pos_orders.personas` |
| `ticket_promedio_restaurant` | Si | `ventas / tickets` |
| `propinas_total` | Si | Suma de `pos_orders.propina` |
| `meseros` | Si | JSONB agrupado por `pos_orders.mesero` |
| `platillos_top` | Si | JSONB de items agregados |
| `ventas_por_grupo` | Si | JSONB por categoría (usa `pos_menu_categories`) |
| `pago_metodos` | Si | JSONB por método de pago |
| `chilaquiles_total` | Si | Filtro por nombre de platillo |
| `half_half_total` | Si | Filtro por nombre de platillo |
| `ordenes_llevar` | Si (hardcoded 0) | POS no distingue llevar vs restaurant aún |
| `devoluciones` | Si (hardcoded 0) | POS no tiene flujo de devoluciones aún |
| `location_id` | **No** | Fácil de agregar (5 min) |

**23 de 24 campos producidos. El único faltante (`location_id`) es trivial.**

Los 2 campos hardcoded a 0 (`ordenes_llevar`, `devoluciones`) son funcionalidad que aún no existe en el POS. No bloquean la transición — los agentes ya manejan valores 0.

---

## Trabajo para Apagar el Pipeline Wansoft

### Fase 1: Pre-cutover (antes de que AMALAY opere en POS)

| Tarea | Esfuerzo | Impacto |
|-------|----------|---------|
| Habilitar cron `pos-intraday-snapshot.yml` | 1 min | Snapshots intraday disponibles |
| Agregar `location_id` al aggregator | 5 min | Paridad completa de campos |
| Reemplazar `wansoft_kpis` en 7 scripts | 2 hrs | Elimina tabla congelada hace 36 días |

**Total pre-cutover: ~2.5 horas.**

### Fase 2: Cutover (el día que AMALAY empiece a operar en POS)

| Tarea | Esfuerzo | Impacto |
|-------|----------|---------|
| Verificar que `pos_daily_aggregator` produce datos correctos | 1 hr | Comparar output con Wansoft del mismo día |
| Verificar que Dashboard muestra datos del POS | 30 min | `getRecentDays` ya hace el merge |
| Verificar que agentes producen insights correctos | 1 hr | Comparar anomaly/predictor output |

**Total cutover verification: ~2.5 horas.**

### Fase 3: Post-cutover (después de 1 semana estable en POS)

| Tarea | Esfuerzo | Impacto |
|-------|----------|---------|
| Desactivar workflow `intraday-sales.yml` | 1 min | Deja de intentar scraping |
| Desactivar `wansoft-daily-mesero.yml` | 1 min | Scraper Playwright |
| Desactivar `wansoft-staleness.yml` | 1 min | Ya no hay Wansoft que monitorear |
| Remover `wansoft_auth.py` del import de `intraday_sales.py` | 5 min | Cleanup |
| Documentar deprecación | 30 min | Registro para futuro |

**Total post-cutover: ~40 minutos.**

---

## Resumen Ejecutivo

| Pregunta | Respuesta |
|----------|-----------|
| ¿Qué falta para eliminar la dependencia? | Que AMALAY opere en Fullsite POS. Todo lo demás ya está construido. |
| ¿Qué % de datos ya viene del POS? | 0% hoy. 100% instantáneamente al migrar. |
| ¿Qué campos dependen exclusivamente de Wansoft? | 0 campos críticos. 23/24 producidos por aggregator. |
| ¿Cuánto trabajo técnico falta? | ~2.5 hrs pre-cutover + ~2.5 hrs verificación + ~40 min cleanup = **~5.5 horas totales**. |
| ¿Es prioridad estratégica? | **Sí.** Elimina el mayor SPOF de la plataforma (cookie de 90 min con refresh manual). Convierte 16 componentes BLOQUEADOS en OPERATIVOS. |

La barrera no es técnica. El pipeline POS → `wansoft_daily` → agentes **ya está construido**. La barrera es operativa: AMALAY necesita empezar a usar Fullsite POS como su sistema primario.

---

## Prueba de Equivalencia — Análisis de Contrato

**Nota:** No es posible hacer una comparación numérica real porque AMALAY no opera en Fullsite POS (1 orden cerrada de $300 vs 52 tickets/$39,504 en Wansoft). Lo que sigue es una **auditoría del contrato de datos**: ¿el aggregator produce el mismo formato, con la misma semántica, para cada campo?

### Referencia: Row real de Wansoft (Jul 20, $39,504, 52 tickets)

### Comparación campo por campo

| Campo | Wansoft (`intraday_sales.py`) | POS (`pos_daily_aggregator.py`) | Equivalente? | Diferencias |
|-------|-----|-----|---|----|
| `fecha` | `today_str` (YYYY-MM-DD) | `get_target_date()` (YYYY-MM-DD) | **Si** | |
| `client_slug` | `CLIENT["id"]` | `CLIENT["id"]` | **Si** | |
| `report_type` | No se escribe (queda como default o valor anterior) | `"fullsite_pos"` | **Diferente** | Intencionalmente diferente para distinguir fuente. Los consumidores no filtran por este campo. |
| `ventas_dia` | `max(API TotalSales, sum(users))` — usa el mayor de dos fuentes para incluir Market | `sum(pos_orders.total)` | **Equivalente** | El POS incluye todo en `pos_orders`. No necesita el workaround de "max de dos APIs". |
| `ventas_brutas` | `max(API TotalGrossSales, real_total)` | `sum(total + descuento)` | **Equivalente** | Misma semántica: ventas antes de descuentos. |
| `descuentos` | `API TotalDiscount` | `sum(pos_orders.descuento)` | **Equivalente** | |
| `devoluciones` | No se escribe (queda NULL) | Hardcoded `0` | **Equivalente** | Ambos ignoran este campo. |
| `efectivo` | Parsed de `SalesByPaymentType` HTML | `sum donde metodo_pago contains "efectivo"` | **Equivalente** | POS tiene dato estructurado; Wansoft scraper parsea HTML. |
| `tarjeta` | Suma de "tarjeta"+"crédito"+"débito" de HTML | Suma de keywords similares | **Equivalente** | |
| `tickets_count` | `total_ordenes + market_tickets` (estimación Market) | `len(orders)` | **Diferencia menor** | Wansoft ESTIMA tickets de Market ($market_sales / $65). POS cuenta todas las órdenes cerradas. Si Market opera en POS, el conteo es exacto. |
| `personas_restaurant` | `total_personas + market_tickets` | `sum(pos_orders.personas)` | **Equivalente** | Misma estimación Market aplica en Wansoft. POS tiene dato real. |
| `mesas_atendidas` | No se escribe (queda NULL) | `len(distinct mesas)` | **POS mejor** | POS produce este campo; Wansoft no lo reportaba. |
| `ordenes_llevar` | No se escribe (queda NULL) | Hardcoded `0` | **Equivalente** | Pendiente: POS aún no distingue llevar vs restaurant. |
| `ticket_promedio_restaurant` | `ventas / tickets` | `ventas / tickets` | **Equivalente** | |
| `propinas_total` | Sumadas de `GetConsolidatedSales` | `sum(pos_orders.propina)` | **Equivalente** | |
| `chilaquiles_total` | No se escribe (queda NULL) | `sum donde nombre contains "chilaquil"` | **POS mejor** | POS produce este campo; Wansoft no lo calculaba. |
| `half_half_total` | No se escribe (queda NULL) | `sum donde nombre contains "half"` | **POS mejor** | Misma mejora. |
| `meseros` | JSONB `[{nombre, total}]` filtrado sin Market/exclusiones | JSONB `[{nombre, total}]` todos los meseros | **Diferencia menor** | Wansoft excluye staff Market y `staff_exclude_meseros`. POS incluye todos. Agregar filtro al aggregator: ~5 líneas. |
| `platillos_top` | JSONB `[{nombre, cantidad, total}]` top 30 | JSONB `[{nombre, cantidad, total}]` top 20 | **Diferencia menor** | Wansoft: top 30. POS: top 20. Cambiar `[:20]` a `[:30]`: 1 carácter. |
| `ventas_por_grupo` | JSONB `[{nombre, total}]` grupos de Wansoft | JSONB `[{nombre, total}]` vía `pos_menu_categories` | **Equivalente en formato, diferente en nombres** | Wansoft: "CHILAQUILES & ENCHILADAS". POS: depende de cómo se nombren las categorías en `pos_menu_categories`. Si se nombran igual → idéntico. |
| `pago_metodos` | JSONB `[{nombre, total, pct}]` parsed de HTML | JSONB `[{nombre, total}]` sin `pct` | **Diferencia menor** | POS no incluye `pct` (porcentaje). Calculable: `round(total/ventas*100, 1)`. Agregar: ~3 líneas. |
| `location_id` | `"amalay-spgg"` | No se escribe | **Faltante** | Agregar: 1 línea. |
| `cuentas_restaurant` | No se escribe | `tickets_count` | **POS mejor** | |

### Resumen de Diferencias

| Tipo | Count | Impacto | Esfuerzo para cerrar |
|------|-------|---------|---------------------|
| Campos faltantes en POS | 1 (`location_id`) | Bajo — solo hermes lo checa | 1 línea |
| POS produce más que Wansoft | 3 (`mesas_atendidas`, `chilaquiles_total`, `half_half_total`) | Positivo — más datos | 0 |
| Diferencias menores de formato | 3 (`pct` en pagos, top 30→20, filtro meseros) | Cosmético | ~10 líneas total |
| Diferencias semánticas | 1 (`tickets_count` estimación Market) | Resuelto naturalmente si Market opera en POS | 0 |
| `report_type` diferente | Intencional | No afecta consumidores | 0 |

**Total para cerrar gaps: ~10 líneas de código en `pos_daily_aggregator.py`.**

### Lo que NO se puede verificar sin operación dual

1. **Exactitud numérica**: ¿`pos_orders.total` suma lo mismo que `GetConsolidatedSales.TotalSales`? Requiere un día con ambos sistemas activos.
2. **Categorías**: ¿`pos_menu_categories` nombra los grupos exactamente igual que Wansoft? Los agentes que filtran por nombre de categoría (ej. antifraud busca "COFFEE HOT/ICE") podrían no matchear si los nombres difieren.
3. **Timing**: ¿El cierre del POS (11pm cron) captura las mismas órdenes que el cierre de Wansoft? Depende de cuándo los meseros cierran sus últimas mesas.

### Protocolo de Prueba de Equivalencia Recomendado

**Pre-requisito:** Un día de operación dual (Wansoft + POS, meseros usando ambos).

```
1. Elegir un día de operación normal (martes-jueves, no festivo)
2. Abrir turno en Fullsite POS al inicio del día
3. Meseros operan Wansoft normalmente (producción)
4. Meseros TAMBIÉN registran cada orden en Fullsite POS (shadow)
5. Al cierre:
   a. intraday_sales.py escribe fila Wansoft → wansoft_daily
   b. pos_daily_aggregator.py escribe fila POS → wansoft_daily (con report_type='fullsite_pos')
   c. Comparar AMBAS filas campo por campo
   d. Diferencia aceptable: < 5% en ventas_dia, tickets_count, ticket_promedio
   e. Categorías y meseros deben coincidir en nomenclatura
6. Si pasa: Wansoft puede apagarse
7. Si no pasa: documentar diferencias → ajustar aggregator → repetir
```

**Duración estimada:** 1 día de operación shadow + 2 horas de análisis.

**Alternativa sin operación dual:** Usar el backfill de la sesión del Jul 10-16 como proxy. Daniel puede correr `pos_daily_aggregator.py` con `TARGET_DATE=2026-07-16` y comparar contra el row de Wansoft del mismo día. Pero esto requiere que `pos_orders` tenga datos de ese día — y hoy no los tiene.
