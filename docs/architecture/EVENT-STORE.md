# EVENT STORE — Referencia Técnica Canónica

> La tesis de IA de Fullsite vive aquí. No en el POS, no en el dashboard.
> En el historial completo y confiable de todo lo que pasó en cada restaurante.
> Última actualización: 2026-07-02

---

## Por qué existe el Event Store

Fullsite no es un POS. Es un Restaurant Operating System cuya inteligencia
depende de datos históricos confiables. El Event Store es la fundación.

El POS de Wansoft guarda estado final: cuánto se vendió, qué se cobró.
No guarda historia: cómo llegó ahí, qué cambió en el camino, quién lo modificó, cuándo.

Los agentes de IA no pueden razonar sobre estado final.
Necesitan la historia completa: orden creada → item agregado → item modificado →
descuento aplicado → mesa cambiada → pagado → cerrado.

Sin esa historia, no hay inteligencia — solo reportes.

---

## Arquitectura actual (Shadow Mode)

Desde 2026-06-12, el Event Store corre en paralelo a Wansoft.

```
Wansoft (fuente de verdad operativa)
    ↓
Bridge (captura eventos en tiempo real)
    ↓
Event Store en Supabase (append-only)
    ↓
Dashboard / Agentes de IA (consumen el Event Store)
```

**Shadow Mode significa:** Wansoft sigue siendo la fuente de verdad.
Fullsite lee de Wansoft via bridge y escribe en el Event Store.
El restaurante no depende del Event Store para operar — todavía.

Post-cutover, la dirección se invierte: Fullsite POS es la fuente de verdad
y el Event Store captura directamente desde el POS.

---

## Schema del Event Store

```sql
-- Tabla principal de eventos (append-only, no updates, no deletes)
pos_events (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT UNIQUE,        -- ID único del evento (para idempotencia)
  stream_id   TEXT NOT NULL,      -- order_id o turno_id o ticket_id
  event_type  TEXT NOT NULL,      -- ver tipos de eventos abajo
  version     INTEGER,            -- número secuencial por stream
  payload     JSONB NOT NULL,     -- datos del evento
  actor       TEXT,               -- quien lo generó (mesero, cajero, gerente, sistema)
  device_id   TEXT,               -- desde dónde se generó
  source      TEXT DEFAULT 'wansoft',  -- 'wansoft' | 'fullsite'
  created_at  TIMESTAMPTZ DEFAULT NOW()
)

-- Índices para queries comunes
CREATE INDEX ON pos_events (stream_id, version);
CREATE INDEX ON pos_events (event_type, created_at);
CREATE INDEX ON pos_events (created_at);
CREATE UNIQUE INDEX ON pos_events (event_id);  -- garantiza idempotencia
```

---

## Tipos de eventos

### Orden
| Tipo | Descripción |
|---|---|
| `order.created` | Orden nueva abierta |
| `order.item_added` | Producto agregado a la orden |
| `order.item_modified` | Producto modificado (cantidad, modificadores, notas) |
| `order.item_removed` | Producto eliminado de la orden |
| `order.item_cancelled` | Producto cancelado con razón y aprobador |
| `order.table_changed` | Mesa cambiada |
| `order.mesero_changed` | Mesero reasignado |
| `order.discount_applied` | Descuento aplicado con tipo y aprobador |
| `order.courtesy_applied` | Cortesía aplicada |
| `order.sent_to_kitchen` | Orden enviada a cocina |
| `order.payment_processed` | Pago procesado |
| `order.closed` | Orden cerrada |
| `order.reopened` | Orden reabierta (con PIN y razón) |

### Turno
| Tipo | Descripción |
|---|---|
| `shift.opened` | Turno abierto con fondo inicial |
| `shift.cash_deposit` | Depósito de efectivo en turno |
| `shift.cash_withdrawal` | Retiro de efectivo en turno |
| `shift.closed` | Turno cerrado con arqueo |

### Sistema
| Tipo | Descripción |
|---|---|
| `bridge.connected` | Bridge conectado a Wansoft |
| `bridge.disconnected` | Bridge desconectado |
| `bridge.reconnected` | Bridge reconectado después de interrupción |
| `printer.error` | Error de impresión |
| `printer.retry` | Reintento de impresión |

---

## Idempotencia

**El requisito:** Cada evento se procesa exactamente una vez, sin importar
cuántas veces el bridge intente insertarlo.

**El mecanismo:** El campo `event_id` tiene un `UNIQUE INDEX` en la base de datos.
Un intento de insertar un evento con el mismo `event_id` falla silenciosamente (ON CONFLICT DO NOTHING).

**La implicación:** Si el bridge se cae y se reconecta, puede reenviar los últimos
N eventos sin riesgo de duplicación. El Event Store siempre termina con exactamente
un registro por evento real.

**La validación esta noche (AMALAY):**
```sql
-- Debe retornar 0 filas (cero duplicados)
SELECT event_id, COUNT(*)
FROM pos_events
WHERE created_at > '[inicio_turno]'
GROUP BY event_id
HAVING COUNT(*) > 1;
```

---

## Integridad del historial

El estado final de una orden no es suficiente. Se necesita la secuencia completa.

**Ejemplo de historial correcto para una orden con modificación:**
```
1. order.created     { mesa: 10, mesero: "Oscar" }
2. order.item_added  { item: "Chilaquiles", precio: 189 }
3. order.item_added  { item: "Café americano", precio: 65 }
4. order.item_removed { item_id: "item-2", reason: "cliente cambió" }
5. order.item_added  { item: "Agua mineral", precio: 35 }
6. order.discount_applied { tipo: "cortesía", valor: 189, approved_by: "gerente" }
7. order.payment_processed { metodo: "Efectivo", monto: 100 }
8. order.closed
```

**El problema si el bridge solo captura estado final:**
El Event Store tendría solo eventos 1, 2, 3, 7, y 8.
Los eventos 4, 5, y 6 (la historia real) se perderían.
Los agentes de IA que analicen esto verían una orden que parece no tener modificaciones,
cuando en realidad tuvo 3.

**Validación esta noche:** Para 3 tickets con modificaciones, comparar
el número de eventos en el Event Store vs. el número de acciones en Wansoft.

---

## Recovery: qué pasa cuando algo falla

### Bridge desconectado (internet caído)

**Escenario:** Internet se cae 3 minutos durante el servicio.

**Comportamiento esperado si hay buffer local:**
- El bridge guarda eventos en un buffer local mientras no hay conexión.
- Al reconectar, los eventos se insertan en orden cronológico.
- El Event Store tiene todos los eventos sin gaps.

**Comportamiento si NO hay buffer local:**
- Los eventos generados durante los 3 minutos se pierden para siempre.
- El Event Store tiene un gap temporal.
- Los agentes de IA ven una hora sin actividad cuando en realidad hubo 20 tickets.

**Estado actual:** ⚠️ Por validar esta noche en AMALAY.

### Bridge reiniciado

**Escenario:** El proceso del bridge se reinicia (manual o por crash).

**Preguntas críticas a responder:**
- ¿El bridge sabe desde dónde continuar? ¿Tiene un cursor de "último evento procesado"?
- Si empieza desde el inicio: riesgo de duplicados (mitigado por idempotencia).
- Si empieza desde "ahora": riesgo de gaps permanentes.
- Si empieza desde el último evento conocido: comportamiento correcto.

**Estado actual:** ⚠️ Por validar. Idempotencia protege contra duplicados.
El gap por "empezar desde ahora" es el riesgo real.

---

## La tesis de IA y su dependencia del Event Store

Los 13 agentes de IA de Fullsite (anomaly detector, close predictor, antifraud, etc.)
usan datos históricos para hacer predicciones y detectar patrones.

**La cadena de dependencia:**
```
Event Store confiable
    → Historial completo y correcto
    → Patrones detectables
    → Predicciones confiables
    → Decisiones mejores
```

Si el Event Store tiene gaps, duplicados, o historial incompleto:
- Las predicciones son incorrectas.
- Las alertas de fraude disparan falsos positivos.
- El análisis de meseros compara datos incompletos.
- La inteligencia operativa no funciona.

**El estándar de confiabilidad requerido:**
Antes de decir que los agentes de IA son confiables, el Event Store debe demostrar:
1. Cero duplicados bajo reconexión.
2. Cero gaps bajo desconexión (con buffer) o gaps documentados (sin buffer).
3. Secuencia de eventos completa, no solo estado final.
4. Timestamps consistentes con Wansoft (delta < 30 segundos).

---

## Reconciliación contra Wansoft

El Event Store es una representación de Wansoft. Deben coincidir exactamente.

### Métricas de reconciliación (al final de cada turno)

| Métrica | Método |
|---|---|
| Número de tickets | COUNT de events ORDER_CREATED vs tickets en Wansoft |
| Total de ventas | SUM de payments en eventos vs ventas_dia en Wansoft |
| Número de cancelaciones | COUNT de events ITEM_CANCELLED vs cancelaciones en Wansoft |
| Discrepancias de timestamp | MAX(ABS(evento_created_at - wansoft_timestamp)) por ticket |

### Alerta de divergencia

Si cualquier métrica tiene una discrepancia > 0.1%, hay un problema de integridad.
No es "una pequeña diferencia" — es evidencia de que el Event Store no es confiable.

---

## Riesgos conocidos

| Riesgo | Severidad | Mitigación actual | Estado |
|---|---|---|---|
| Gap por desconexión sin buffer | Crítico | Buffer local en bridge | Por validar |
| Duplicados por reconexión | Alto | Idempotencia (event_id UNIQUE) | Implementado |
| Inferencia incorrecta de deltas | Alto | Validación spot-check | Por implementar |
| Drift de reloj entre sistemas | Medio | Comparar timestamps | Por medir |
| Eventos fuera de orden | Medio | Ordenar por version, no created_at | Por implementar |
| Eventos de estado, no de delta | Crítico para IA | Validación de historial completo | Por validar |

---

> Este documento debe actualizarse después de cada validación en producción.
> El estado "Por validar" debe convertirse en "Validado" o "Blocker encontrado".
>
> Fullsite — Restaurant Operating System
