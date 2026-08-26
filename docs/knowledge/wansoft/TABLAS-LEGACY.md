# Tablas legacy de Wansoft — referencia de esquema

> **⚠️ Estas tablas están MUERTAS.** `wansoft_daily` no recibe datos desde
> **2026-07-20** y `ops_daily` desde **2026-07-12** (verificado en la revisión OCM,
> commit `33fe933e`). Se conservan como referencia histórica del esquema.
>
> **La fuente viva son las vistas OCM por-tenant:** `ocm_daily`, `ocm_waiter_rankings`,
> `ocm_menu_groups`, `ocm_menu_items` — migraciones `014`/`015`/`016`, aplicadas a
> producción el 2026-08-19.
>
> Movido desde `CLAUDE.md` el 2026-08-24: vivía en el contexto de cada sesión y
> describía estas tablas como "fuente principal" y "actualizada continuamente",
> lo cual llevaba a cada sesión a consultar datos muertos.

## Tablas principales

### `amalay_reservaciones` — Reservaciones de eventos

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | uuid | PK |
| `codigo_reserva` | text | Ej. `AMA-5096` |
| `nombre` | text | Nombre del cliente |
| `telefono` | text | Teléfono (nullable) |
| `fecha` | date | Fecha del evento |
| `espacio` | text | Espacio reservado (ej. `jardin`) |
| `horario_inicio` | time | Hora de inicio |
| `horario_fin` | time | Hora de fin |
| `guests` | integer | Número de personas |
| `paquete` | text | Paquete contratado |
| `pastel` | text | Tipo de pastel (nullable) |
| `entradas` | ARRAY | Entradas seleccionadas |
| `deco` | text | Decoración (nullable) |
| `total` | numeric | Monto total MXN |
| `status` | text | Estado: `pending`, `confirmed`, `cancelled` |
| `created_at` | timestamptz | Fecha de creación |
| `updated_at` | timestamptz | Última actualización |

### `wansoft_daily` — Histórico diario de ventas (fuente principal para reportes históricos)

| Columna | Tipo | Descripción |
|---|---|---|
| `fecha` | date | PK funcional — fecha del reporte |
| `ventas_brutas` | numeric | Ventas antes de descuentos |
| `ventas_dia` | numeric | Ventas netas del día |
| `descuentos` | numeric | Total descuentos |
| `devoluciones` | numeric | Total devoluciones |
| `efectivo` | numeric | Cobrado en efectivo |
| `tarjeta` | numeric | Cobrado en tarjeta |
| `tickets_count` | integer | Número de tickets |
| `mesas_atendidas` | integer | Mesas atendidas |
| `ordenes_llevar` | integer | Órdenes para llevar |
| `personas_restaurant` | integer | Personas en restaurante |
| `ticket_promedio_restaurant` | numeric | Ticket promedio restaurante |
| `propinas_total` | numeric | Total propinas |
| `chilaquiles_total` | numeric | Ventas de chilaquiles |
| `half_half_total` | numeric | Ventas half & half |
| `meseros` | jsonb | `[{nombre, total}]` — ventas por mesero |
| `platillos_top` | jsonb | `[{nombre, total}]` — top platillos |
| `ventas_por_grupo` | jsonb | `[{nombre, total}]` — ventas por categoría de menú |
| `pago_metodos` | jsonb | `[{nombre, total}]` — desglose por método de pago |
| `updated_at` | timestamptz | Última actualización |

### `wansoft_kpis` — Estado en tiempo real (fila única, actualizada continuamente)

Misma estructura que `wansoft_daily` más:

| Columna extra | Tipo | Descripción |
|---|---|---|
| `id` | text | Identificador de fila |
| `ordenes_abiertas` | integer | Órdenes abiertas ahora |
| `total_ordenes_mxn` | numeric | Total órdenes abiertas MXN |
| `ultima_venta` | text | Hora de última venta |
| `facturas` | integer | Facturas emitidas |
| `hora_pico` | text | Hora pico del día |
| `inventario_critico` | text | Alertas de inventario |
| `fecha_reporte` | text | Fecha del reporte en curso |
| `propinas_meseros` | jsonb | `[{nombre, total}]` — propinas por mesero |

### Categorías de menú (ventas_por_grupo)

CHILAQUILES & ENCHILADAS, EGGS & KETO, COFFEE HOT/ICE, TOAST & BAGELS, PANINIS, BOWLS, EVERYDAY SPECIALS, FRESH DRINKS, SIGNATURE, JUGOS, CROISSANTS BREAKFAST, SMOOTHIES, PANCAKES & WAFFLES, FRAPPES, BAKERY, HEALTHY SNACKS & MARKET, DESSERTS, SODAS, TEA & TISANAS, EXTRAS, CEVICHE, BEBIDAS OH, PIZZAS & PASTAS, SEMILLAS Y DULCES AMALAY, MUNCHIES, LA NONNA Gorditas Keto, VARIOS, HEALTHY SNACKS, ICE CREAM

### Métodos de pago (pago_metodos)

Tarjeta de crédito, Tarjeta de débito, Efectivo, Transferencia electrónica, Ubereats

### Meseros activos

Omar Aguilera, Hector Enrique Rodriguez Lopez, Brayan Berlanga Solis, Daniela Edith Rico Segura, Julio Cesar Hernández Hernández, Mauricio Rodriguez Rodriguez, Oscar Rios Alvarado, Alexis Alejandro Ocampo Vera, Aldo Ruiz Ramirez, Mariana Carolina Salas Alva, Mario García Ramírez, MESERO EVENTO

### Otras tablas

| Tabla | Descripción |
|---|---|
| `clients` | Clientes del restaurante |
| `reviews` | Reseñas |
| `tasks` | Tareas internas |
| `memories` | Memoria del agente IA |
| `content` | Contenido editorial |
| `calendar_sync_log` | Log de sincronización con Google Calendar |
| `whatsapp_conversations` | Conversaciones de WhatsApp |
| `whatsapp_messages_log` | Log de mensajes de WhatsApp |
| `whatsapp_whitelist` | Whitelist de números de WhatsApp |
