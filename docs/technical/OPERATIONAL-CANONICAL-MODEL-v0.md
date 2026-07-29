# Operational Canonical Model (OCM) — Propuesta v0

**Fecha:** 2026-07-28
**Estado:** Propuesta — sin implementación.
**Contexto:** Los agentes de IA y el dashboard de analytics leen `wansoft_daily` directamente.
Esto impide que funcionen para clientes con `data_source='fullsite'` (POS propio, sin Wansoft).
El OCM es la capa de abstracción que resuelve esto.

**Regla:** No copiar datos a `wansoft_daily`. Nunca. El OCM es la respuesta correcta.

---

## El problema

```
Fuentes de datos actuales:
  Wansoft (AMALAY)    ──→  wansoft_daily (Supabase)  ──→  AI Agents
  POS Fullsite (new)  ──→  pos_orders     (Supabase)  ──→  ❌ (no conectado)
  Delivery/Rappi      ──→  ?                           ──→  ❌
```

Los agentes hablan directamente con `wansoft_daily`. Si la tabla está vacía, no saben qué hacer.

---

## La solución: OCM como contrato

El OCM es una capa de vistas o funciones Postgres que normalizan todas las fuentes de datos en una estructura canónica. Los agentes consultan el OCM — nunca la fuente directamente.

```
Fuentes de datos:
  Wansoft             ──→  wansoft_daily
  POS Fullsite        ──→  pos_orders, pos_menu_items
  Delivery/Rappi      ──→  (futura tabla delivery_orders)
                              ↓
                   ┌─────────────────────┐
                   │  OCM (vistas SQL)   │
                   │  client_id-aware    │
                   └─────────────────────┘
                              ↓
              AI Agents / Analytics / Dashboard
```

---

## Contrato de datos propuesto

Cinco vistas o funciones:

### 1. `ocm_daily_sales(client_id TEXT, fecha DATE)`

Ventas del día: total bruto, neto, descuentos, ticket promedio, conteo de tickets.

```sql
-- Para AMALAY (Wansoft):  lee wansoft_daily WHERE fecha = $2
-- Para otros (Fullsite):  agrega pos_orders WHERE DATE(created_at) = $2 AND client_id = $1 AND status = 'closed'
-- Output:
--   fecha, ventas_brutas, ventas_netas, descuentos, tickets, ticket_promedio,
--   efectivo, tarjeta, transferencia, source ('wansoft' | 'fullsite' | 'mixed')
```

### 2. `ocm_orders(client_id TEXT, desde DATE, hasta DATE)`

Órdenes individuales normalizadas — para análisis por turno, mesa, mesero.

```sql
-- Para AMALAY:  puede incluir pos_orders si están siendo registradas
-- Para Fullsite: lee pos_orders WHERE created_at BETWEEN $2 AND $3
-- Output:
--   order_id, client_id, fecha, hora, mesa, mesero_nombre,
--   subtotal, total, metodo_pago, status, items JSONB
```

### 3. `ocm_products(client_id TEXT, desde DATE, hasta DATE)`

Ventas por platillo — para ranking, popularidad, análisis de menú.

```sql
-- Para AMALAY:  lee platillos_top de wansoft_daily (JSONB)
-- Para Fullsite: desglosa pos_orders.items JSONB
-- Output:
--   producto_nombre, categoria, unidades_vendidas, ingresos, cliente_promedio
```

### 4. `ocm_inventory_snapshot(client_id TEXT)`

Niveles de inventario actuales — para alertas de reorden y predicción.

```sql
-- Para AMALAY:  wansoft_existencias (si importado)
-- Para Fullsite: pos_recipes + pos_ingredients (cuando existan)
-- Output:
--   ingrediente, unidad, stock_actual, stock_minimo, dias_restantes
-- Nota: esta vista puede retornar vacío para clientes sin inventario configurado
```

### 5. `ocm_operations(client_id TEXT, fecha DATE)`

Métricas operativas del día: meseros, mesas, propinas, hora pico.

```sql
-- Para AMALAY:  lee columnas de wansoft_daily (meseros JSONB, propinas_total, etc.)
-- Para Fullsite: agrega pos_orders por mesero, hora, mesa
-- Output:
--   meseros[{nombre, ventas, propinas}], mesas_atendidas,
--   hora_pico, ordenes_abiertas, ticket_promedio
```

---

## Cómo lo consumiría un agente

**Hoy (hardcodeado):**
```python
# daily_briefing.py
rows = sb_get("wansoft_daily?fecha=eq.2026-07-28&limit=1")  # solo AMALAY
```

**Con OCM:**
```python
# daily_briefing.py (multi-tenant)
client_id = get_client_config()["id"]
sales = sb_rpc("ocm_daily_sales", {"client_id": client_id, "fecha": today})
ops   = sb_rpc("ocm_operations",  {"client_id": client_id, "fecha": today})
```

El agente no sabe si el cliente usa Wansoft o POS propio. El OCM lo resuelve.

---

## Implementación por fases

### Fase 1 — Solo lectura, datos que ya existen (antes de siguiente demo)
- Crear vista `ocm_daily_sales` con rama `data_source = 'wansoft'` → `wansoft_daily` y rama `data_source = 'fullsite'` → `pos_orders`
- Crear vista `ocm_operations` con misma lógica
- Migrar `daily_briefing.py` y `wansoft_query.py` a leer del OCM
- **Resultado:** chat IA funciona para VANTARA con datos reales de `pos_orders`

### Fase 2 — Productos y personal
- Crear vista `ocm_products`
- Crear vista `ocm_orders` (histórico granular)
- Migrar dashboard de ventas por platillo
- **Resultado:** "¿qué platillo vendió más?" funciona para VANTARA

### Fase 3 — Inventario
- Crear vista `ocm_inventory_snapshot` (requiere `pos_ingredients` poblado)
- Migrar predictor de inventario
- **Resultado:** alertas de stock funcionan para VANTARA

---

## Lo que NO es el OCM

- No es una copia de datos. Nunca escribir en `wansoft_daily` para "simular" un cliente nuevo.
- No es un ETL. Las vistas son lazy — calculan al consultar, no procesan en batch.
- No es una API separada. Vive en Postgres, expuesta vía Supabase PostgREST como cualquier otra vista.
- No reemplaza la fuente de verdad. `pos_orders` y `wansoft_daily` siguen existiendo; el OCM solo normaliza.

---

## Criterios de éxito para Fase 1

```
✓ ocm_daily_sales('vantara', '2026-08-01') retorna datos de pos_orders (no vacío)
✓ ocm_daily_sales('amalay', '2026-08-01')  retorna datos de wansoft_daily (sin cambio)
✓ Chat IA responde "¿cuánto vendiste hoy?" correctamente para VANTARA
✓ Chat IA responde "¿cuánto vendiste hoy?" correctamente para AMALAY (sin regresión)
✓ daily_briefing.py genera brief correcto para ambos clientes desde el mismo código
```

---

## Próximos pasos

1. Aprobar este contrato (5 vistas, nombres, campos)
2. Escribir SQL de la Fase 1 como migración (`020_ocm_views.sql`)
3. Migrar 2 agentes de Python a leer del OCM
4. Validar en AMALAY (no regresión) y en fullsite-sandbox (nuevo funcionamiento)
5. Reportar en Cloneability Report v2

**No implementar hasta que este documento esté aprobado.**
