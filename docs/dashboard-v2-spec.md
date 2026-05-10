# Dashboard v2 — Client Portal Spec

**Fecha:** 2026-05-10
**Status:** Draft
**Reemplaza:** `fullsite.html` (War Room interno)

---

## Resumen ejecutivo

- Dashboard orientado al **dueño del restaurante**, no al equipo de desarrollo. Lenguaje de negocio, cero jerga técnica.
- Aesthetic: fondo blanco, navy primary (#1a2840), cards con sombras sutiles, trend arrows, tipografia limpia. Nada dark-mode/hacker.
- Data sources: `wansoft_kpis` (live), `wansoft_daily` (historico), `amalay_reservaciones`, `agent_runs`, `reviews`. Todo via Supabase REST read-only.
- Wansoft data actualmente stale (ultimo sync: 2026-04-17). Secciones de ventas muestran empty-state con CTA hasta que Clip API este conectada.
- Arquitectura multi-tenant config-driven: un JSON de config por cliente define que secciones mostrar, que tablas consultar, y branding.

---

## 1. KPI Cards — Top Row

8 cards en fila (responsive: 4x2 en tablet, 2x4 en mobile). Cada card tiene:
- Label (texto humano)
- Valor principal (font grande, tabular-nums)
- Trend arrow + delta vs periodo anterior (verde up, rojo down, gris sin data)
- Accent bar color-coded en top de card (2px)

| # | Card | Source | Columna(s) | Accent | Notas |
|---|---|---|---|---|---|
| 1 | **Ventas del dia** | `wansoft_kpis.ventas_dia` | ventas_dia | navy | Formato: $26,290.01. Empty-state si stale >24h |
| 2 | **Ticket promedio** | `wansoft_kpis.ventas_dia / tickets_count` | ventas_dia, tickets_count | navy | Fallback: ventas_dia / mesas_atendidas |
| 3 | **Mesas atendidas** | `wansoft_kpis.mesas_atendidas` | mesas_atendidas | slate | Numero entero |
| 4 | **Ordenes para llevar** | `wansoft_kpis.ordenes_llevar` | ordenes_llevar | slate | Incluye UberEats |
| 5 | **Reservaciones proximas** | `amalay_reservaciones` COUNT WHERE fecha >= today AND status != 'cancelled' | fecha, status | teal | Link a seccion Reservaciones |
| 6 | **Ingresos por eventos** | `amalay_reservaciones` SUM(total) WHERE fecha >= first_day_of_month | total | green | Formato MXN. Solo confirmed+pending |
| 7 | **Rating Google** | `reviews` AVG(rating) | rating | amber | Mostrar estrellas + numero (ej. 4.8). Empty-state si 0 reviews |
| 8 | **Agentes activos** | `agent_runs` COUNT DISTINCT agent_id WHERE created_at >= now()-24h AND status='success' | agent_id, status | green | Label: "Fullsite trabajando". Sin exponer nombres de agentes |

### Trend deltas

Para cards 1-4: comparar valor actual con mismo dia de semana anterior en `wansoft_daily`.
Para cards 5-6: comparar con mismo periodo del mes anterior en `amalay_reservaciones`.
Cards 7-8: sin trend (datos insuficientes por ahora).

---

## 2. Secciones de charts

### 2.1 Ventas por categoria (Horizontal Bar Chart)

- **Source:** `wansoft_kpis.ventas_por_grupo` o `wansoft_daily.ventas_por_grupo`
- **Visualizacion:** Barras horizontales ordenadas de mayor a menor. Top 10 categorias, el resto agrupado como "Otros".
- **Colores:** Degradado navy-to-teal. Barra seleccionada resalta.
- **Interaccion:** Hover muestra monto exacto + % del total.
- **KPIs derivables:** Categoria dominante (hoy: Chilaquiles & Enchiladas = 43% de top), diversificacion de menu, categorias en crecimiento/declive.

### 2.2 Metodos de pago (Donut Chart)

- **Source:** `wansoft_kpis.pago_metodos`
- **Visualizacion:** Donut con centro mostrando total. Segmentos: Tarjeta credito, Tarjeta debito, Efectivo, Transferencia, UberEats.
- **Colores:** Navy, slate, teal, amber, coral (uno por metodo, consistente).
- **KPIs derivables:** % digital vs efectivo (dato util para flujo de caja y conciliacion bancaria), penetracion de delivery (UberEats).

### 2.3 Ventas ultimos 7 dias (Area Chart)

- **Source:** `wansoft_daily.ventas_dia` ultimos 7 registros ORDER BY fecha
- **Visualizacion:** Area chart con fill semi-transparente navy. Linea de promedio punteada.
- **Eje X:** Dia de la semana (Lun, Mar, ...).
- **Eje Y:** MXN con formato corto ($26K).
- **KPIs derivables:** Dia mas fuerte de la semana, tendencia semanal, consistencia de ventas.
- **Nota:** Con solo 3 registros en `wansoft_daily`, chart muestra lo disponible con nota "Datos historicos limitados — se enriquece automaticamente".

### 2.4 Ranking de meseros (Bar Chart + Table hibrido)

- **Source:** `wansoft_kpis.meseros` + `wansoft_kpis.propinas_meseros`
- **Visualizacion:** Barras horizontales con avatar placeholder (inicial del nombre), nombre truncado, monto. Top 5 visibles, "ver todos" expande.
- **Colores:** Barra verde degradado. #1 resaltado con badge dorado sutil.
- **KPIs derivables:** Productividad por mesero, distribucion de carga, identificar top performers para incentivos.

### 2.5 Calendario de eventos (Mini Calendar + List)

- **Source:** `amalay_reservaciones` WHERE fecha >= today ORDER BY fecha
- **Visualizacion:** Calendario compacto del mes actual con dots en dias con evento. Debajo, lista de proximos 5 eventos con: fecha, nombre, espacio, guests, paquete, status badge (verde=confirmed, amber=pending, red=cancelled).
- **Interaccion:** Click en dia filtra lista. Click en evento expande detalle.
- **KPIs derivables:** Ocupacion de espacios, ingreso proyectado del mes, tasa de confirmacion (hoy: 1 confirmed / 23 total = 4.3% — alerta).

### 2.6 Actividad de Fullsite (Timeline)

- **Source:** `agent_runs` ORDER BY created_at DESC LIMIT 20
- **Visualizacion:** Timeline vertical con dots verdes (success) o rojos (error). Cada entry muestra: hora relativa ("hace 2h"), descripcion humanizada del output_summary, duracion.
- **Labels humanizados:** No mostrar `agent_id` raw. Mapeo:
  - `daily-briefing` -> "Reporte del dia enviado"
  - `reservas-pendientes` -> "Revision de reservaciones"
  - `wansoft-staleness` -> "Verificacion de datos"
  - `weekly-amalay` -> "Reporte semanal generado"
- **KPIs derivables:** Uptime del sistema (13/13 runs exitosos = 100%), frecuencia de alertas, ultimo chequeo.
- **Proposito UX:** Demostrar al cliente que "Fullsite esta trabajando 24/7" sin exponer la arquitectura de agentes/tentaculos.

---

## 3. Seccion Wansoft — Empty State Plan

El sync con Wansoft esta stale desde 2026-04-17 (23 dias). Hasta que se conecte la Clip API:

### Estado actual de datos

| Campo | Tiene data | Notas |
|---|---|---|
| ventas_dia | Si | $26,290.01 (del 17 abril) |
| meseros | Si | 9 meseros con montos |
| ventas_por_grupo | Si | 29 categorias |
| pago_metodos | Si | 5 metodos |
| tickets_count | 0 | No se poblo |
| personas_restaurant | 0 | No se poblo |
| propinas_total | 0 / null | Inconsistente entre kpis y daily |
| ticket_promedio | 0 | Derivable de ventas/mesas |

### Comportamiento del empty-state

1. **Cards KPI 1-4:** Mostrar ultimo valor conocido con badge "Actualizado: 17 abr" en gris. Trend arrow deshabilitada.
2. **Charts 2.1, 2.2, 2.4:** Renderizan con la ultima data disponible + banner sutil arriba: "Datos del 17 de abril. Conecta tu punto de venta para datos en tiempo real."
3. **Chart 2.3 (area 7 dias):** Solo 3 puntos. Mensaje: "Necesitamos mas dias de datos para mostrar tendencias."
4. **Toda la seccion si stale >7 dias:** Overlay semi-transparente con CTA: "Conectar punto de venta" + icono de enlace.

### Transicion a live

Cuando `wansoft_kpis.updated_at` < 24h:
- Remover todos los banners/overlays
- Activar auto-refresh cada 5 minutos
- Activar trend arrows con comparativo vs dia anterior

---

## 4. Seccion Agent Activity — "Fullsite trabajando"

### Datos disponibles (agent_runs)

| Campo | Uso en UI |
|---|---|
| agent_id | Mapear a label humano (ver 2.6) |
| trigger_type | "schedule" = automatico, "workflow_dispatch" = manual |
| status | Dot verde/rojo |
| duration_ms | "en 2.3s" |
| output_summary | Parsear para texto humano |
| tokens_in/out | NO mostrar (tecnico) |
| tentacle | NO mostrar (interno) |
| created_at | Tiempo relativo |

### Layout

```
+--------------------------------------------------+
| Fullsite trabajando                    Ultimas 24h |
+--------------------------------------------------+
| o  Reporte del dia enviado              hace 6h   |
|    0 reservas hoy, 3 proximas. Todo OK.           |
|                                                    |
| o  Revision de reservaciones            hace 4h   |
|    1 reserva requiere atencion.                   |
|                                                    |
| o  Verificacion de datos                hace 8h   |
|    Alerta: datos de ventas sin actualizar.         |
+--------------------------------------------------+
| Uptime: 100% (13/13)     Promedio: 2.2s           |
+--------------------------------------------------+
```

### Lo que NO se expone

- Nombres de agentes (`daily-briefing`, `wansoft-staleness`)
- Concepto de "tentaculos"
- Tokens consumidos
- Trigger type
- Tabla `agent_messages` (inter-agente, irrelevante para cliente)

---

## 5. Multi-tenancy — Config-driven

### Estructura del config por cliente

```json
{
  "client_id": "amalay",
  "branding": {
    "name": "AMALAY Coffee & Market",
    "logo_url": "/assets/logos/amalay.svg",
    "primary_color": "#1a2840",
    "accent_color": "#0d9488"
  },
  "supabase": {
    "project_ref": "qjiomlvudfmzuvqvhwpk",
    "tables": {
      "kpis": "wansoft_kpis",
      "daily": "wansoft_daily",
      "reservations": "amalay_reservaciones",
      "reviews": "reviews",
      "agent_runs": "agent_runs"
    }
  },
  "sections": {
    "kpi_cards": true,
    "sales_by_category": true,
    "payment_methods": true,
    "weekly_trend": true,
    "staff_ranking": true,
    "events_calendar": true,
    "agent_activity": true,
    "reviews_summary": true
  },
  "pos_system": "wansoft",
  "currency": "MXN",
  "timezone": "America/Monterrey",
  "locale": "es-MX"
}
```

### Como cambia para Cliente #2

1. **Nuevo proyecto Supabase** (o schema separado) con las mismas tablas estandarizadas.
2. **Config JSON diferente:** distinto `client_id`, `branding`, `supabase.project_ref`, y `sections` segun que datos tiene.
3. **Secciones opcionales:** si no tiene reservaciones, `events_calendar: false`. Si no tiene reviews, `reviews_summary: false`.
4. **Auth:** cada cliente entra con su propia credencial. El dashboard carga su config y consulta su Supabase.

### Lo que ya es multi-tenant

- KPI cards: parametrizados por config (moneda, tablas, campos)
- Charts: renderizan desde config.tables sin hardcodear nombres
- Agent activity: generico — cualquier `agent_runs` con el mismo schema funciona
- Layout/branding: CSS variables inyectadas desde config

---

## 6. AMALAY-specific lock-in — Que bloquea multi-tenant

| Item | Descripcion | Esfuerzo para generalizar |
|---|---|---|
| **Nombres de meseros hardcodeados** | CLAUDE.md lista meseros fijos. Dashboard no los hardcodea, pero si los scripts de sync si. | Bajo — leer de `wansoft_kpis.meseros` dinamicamente |
| **Categorias de menu** | 29 categorias especificas de AMALAY en `ventas_por_grupo`. | Bajo — el chart ya lee del JSONB, no hardcodea |
| **Esquema de reservaciones** | `amalay_reservaciones` tiene campos especificos: `paquete`, `pastel`, `entradas`, `deco`. | Medio — abstraer a esquema generico de eventos con campos custom en JSONB |
| **Metodos de pago** | 5 metodos fijos incluyendo "Ubereats". | Bajo — ya viene del JSONB, se renderiza lo que haya |
| **Tabla `wansoft_kpis`** | Nombre y estructura atada a Wansoft POS. | Alto — necesita capa de abstraccion POS-agnostica |
| **War Room agents** | `agent_runs.agent_id` con valores AMALAY-especificos. | Medio — mapeo de labels por config, no hardcodeado |
| **Google Business Profile** | `reviews.location_id` con Place ID de AMALAY. | Bajo — parametrizar por config |
| **Telegram como canal** | Agentes envian a Telegram. Dashboard no depende de esto, pero cliente podria esperar integracion. | N/A para dashboard |

### Roadmap de desacoplamiento (priorizado)

1. **Config JSON** (ya definido arriba) — semana 1
2. **Abstraccion de tablas** (alias en config) — semana 1
3. **Esquema generico de eventos** — semana 2
4. **Capa POS-agnostica** (adapter pattern: Wansoft, Clip, Square) — semana 3+

---

## 7. Wireframe — Layout

```
+------------------------------------------------------------------------+
| LOGO          [Nombre del negocio]                     [avatar] [gear] |
+------------------------------------------------------------------------+

+--------+-------+-------+-------+-------+-------+-------+-------+------+
| Ventas | Ticket| Mesas |Llevar | Reserv| Eventos| Rating| Full- |
|  dia   | prom. | atend.|       | prox. | mes $  | Google| site  |
| $26.2K | $268  |  98   |  15   |   3   | $48.3K |  5.0  |  3/3  |
|  --    |  --   |  --   |  --   | +2    | +12%   |  --   | 100%  |
+--------+-------+-------+-------+-------+-------+-------+-------+------+

+------------------------------------+  +-------------------------------+
|  Ventas por categoria              |  |  Metodos de pago              |
|                                    |  |                               |
|  Chilaquiles ==========  $11,429   |  |      [  DONUT CHART  ]        |
|  Eggs & Keto ======     $ 6,633   |  |                               |
|  Coffee      =====      $ 6,497   |  |  Tarjeta cred.  43%          |
|  Toast       ===        $ 2,948   |  |  Efectivo        21%          |
|  Paninis     ===        $ 2,883   |  |  Tarjeta deb.   20%          |
|  Bowls       ==         $ 2,658   |  |  Transferencia    9%          |
|  [ver mas...]                      |  |  UberEats         5%          |
+------------------------------------+  +-------------------------------+

+------------------------------------+  +-------------------------------+
|  Tendencia semanal                 |  |  Ranking meseros              |
|                                    |  |                               |
|        /\                          |  |  1. MESERO EVENTO   $1,037    |
|  ___  /  \  ___                    |  |  2. Omar Aguilera   $1,009    |
|     \/    \/                       |  |  3. Hector Enrique    $781    |
|  Lun Mar Mie Jue Vie Sab Dom      |  |  4. Brayan Berlanga   $595    |
|  [Datos limitados — 3 dias]        |  |  5. Daniela Rico      $558    |
+------------------------------------+  +-------------------------------+

+------------------------------------+  +-------------------------------+
|  Calendario de eventos             |  |  Fullsite trabajando          |
|                                    |  |                               |
|  [===== MAYO 2026 =====]          |  |  o Reporte enviado    hace 6h |
|  ...  30* 31*                      |  |  o Reservas revisadas hace 4h |
|  [===== JUNIO 2026 =====]         |  |  o Datos verificados  hace 8h |
|  ...  27*                          |  |                               |
|                                    |  |  Uptime: 100%     Avg: 2.2s  |
|  30 may — Berenice Real            |  +-------------------------------+
|    Jardin | 25 pax | Brunch        |
|    $19,281 | pending               |
|  31 may — Berenice Real            |
|    Jardin | 25 pax | Brunch        |
|    $17,712 | pending               |
|  27 jun — Danna                    |
|    Terraza | 20 pax | Pizza&Pasta  |
|    $11,328 | pending               |
+------------------------------------+
```

### Responsive breakpoints

| Breakpoint | KPI cards | Charts | Calendar + Activity |
|---|---|---|---|
| Desktop (>1200px) | 8 en fila | 2 columnas (50/50) | 2 columnas (60/40) |
| Tablet (768-1200px) | 4x2 grid | 1 columna stacked | 1 columna stacked |
| Mobile (<768px) | 2x4 grid, scroll horizontal | 1 columna, charts full-width | Stacked, calendar colapsado |

---

## 8. Color Palette + Typography

### Palette

| Token | Hex | Uso |
|---|---|---|
| `--primary` | `#1a2840` | Headers, nav, emphasis text |
| `--primary-light` | `#2d4a6f` | Hover states, secondary elements |
| `--accent` | `#0d9488` | CTAs, links, positive trends |
| `--accent-light` | `#14b8a6` | Hover accent |
| `--bg` | `#ffffff` | Page background |
| `--surface` | `#f8fafc` | Card backgrounds |
| `--surface-hover` | `#f1f5f9` | Card hover state |
| `--border` | `#e2e8f0` | Card borders, dividers |
| `--text` | `#1e293b` | Body text |
| `--text-secondary` | `#64748b` | Labels, meta text |
| `--text-muted` | `#94a3b8` | Timestamps, placeholders |
| `--success` | `#16a34a` | Positive trend, confirmed status |
| `--success-bg` | `#f0fdf4` | Success badge background |
| `--warning` | `#d97706` | Pending status, attention needed |
| `--warning-bg` | `#fffbeb` | Warning badge background |
| `--danger` | `#dc2626` | Negative trend, cancelled, errors |
| `--danger-bg` | `#fef2f2` | Danger badge background |
| `--chart-1` | `#1a2840` | Primary chart color |
| `--chart-2` | `#2d4a6f` | Secondary chart |
| `--chart-3` | `#0d9488` | Tertiary chart |
| `--chart-4` | `#d97706` | Quaternary chart |
| `--chart-5` | `#8b5cf6` | Quinary chart |

### Typography

| Element | Font | Weight | Size | Tracking |
|---|---|---|---|---|
| Page title | DM Sans | 700 | 24px | -0.02em |
| Section header | DM Sans | 600 | 16px | -0.01em |
| KPI value | DM Sans | 700 | 28px | -0.02em, tabular-nums |
| KPI label | DM Sans | 500 | 12px | 0.02em, uppercase |
| KPI delta | DM Mono | 500 | 11px | 0 |
| Body text | DM Sans | 400 | 14px | 0 |
| Table header | DM Sans | 500 | 11px | 0.05em, uppercase |
| Table cell | DM Sans | 400 | 13px | 0 |
| Badge/tag | DM Mono | 500 | 11px | 0.02em |
| Timestamp | DM Mono | 400 | 11px | 0 |
| Chart label | DM Sans | 400 | 11px | 0 |
| Chart value | DM Mono | 500 | 12px | 0, tabular-nums |
| Nav item | DM Sans | 500 | 13px | 0.01em |

**Font stack:** `'DM Sans', system-ui, -apple-system, sans-serif` (body) / `'DM Mono', 'SF Mono', monospace` (data).

Google Fonts load: `https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap`

### Shadows

| Token | Value | Uso |
|---|---|---|
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)` | Cards default |
| `--shadow-card-hover` | `0 4px 6px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.06)` | Cards hover |
| `--shadow-dropdown` | `0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04)` | Dropdowns, popovers |

### Border radius

| Token | Value |
|---|---|
| `--radius-card` | `12px` |
| `--radius-badge` | `6px` |
| `--radius-button` | `8px` |
| `--radius-input` | `8px` |

---

## Apendice A — Data Source Inventory

| Tabla | Rows | KPIs derivables para dueño | Freshness |
|---|---|---|---|
| `wansoft_kpis` | 1 | Ventas dia, ticket promedio, mesas, ordenes, meseros, categorias, metodos pago | Stale (2026-04-17) |
| `wansoft_daily` | 3 | Tendencias semanales, comparativos dia-a-dia, promedios historicos | Stale (3 registros) |
| `amalay_reservaciones` | 23 | Reservas proximas, ingreso proyectado eventos, tasa confirmacion, ocupacion espacios | Live |
| `agent_runs` | 13 | Uptime sistema (100%), frecuencia alertas, actividad 24h | Live |
| `reviews` | 5 | Rating promedio (5.0), reviews pendientes de respuesta (5), sentiment | Semi-live |
| `calendar_sync_log` | 5,442 | Frecuencia de sync, health del pipeline | Live |
| `agent_messages` | 0 | (futuro: comunicacion inter-agente) | Empty |

## Apendice B — Decisiones de diseno

1. **DM Sans sobre Inter/Syne:** DM Sans tiene personalidad sin ser extravagante. El pairing con DM Mono mantiene coherencia de familia tipografica. Syne (actual) es demasiado asociada al look dev/hacker del War Room.
2. **White background:** El dark theme actual comunica "herramienta de desarrollo". El fondo blanco comunica "producto profesional para mi negocio".
3. **No tabs/pills de tentaculos:** El War Room actual tiene pills de status por agente (reportes, ops, kb). El cliente no necesita saber que hay 5 subsistemas — solo que "Fullsite esta trabajando".
4. **Horizontal bars sobre pie charts para categorias:** Con 29 categorias, un pie/donut es ilegible. Barras horizontales permiten comparar magnitudes facilmente y escalar a N categorias.
5. **Donut para metodos de pago:** Solo 5 segmentos — tamaño ideal para donut. El centro muestra el total, lo cual es util para el dueño.
6. **Calendario visual sobre tabla para eventos:** El dueño piensa en fechas, no en filas. Un mini-cal con dots da vision instantanea de ocupacion del mes.
