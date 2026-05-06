# Fullsite / AMALAY — Contexto para Claude Code

## Security Rules

- Nunca imprimir el contenido de `.mcp.json`, `.env`, `~/.zshrc` en el chat ni en logs.
- Nunca escribir tokens reales en diffs visibles — redactar como `***REDACTED***`.
- Al editar archivos que contienen secretos, confirmar solo con "actualizado", sin mostrar el contenido completo.
- Estos archivos nunca deben trackearse en git (ya están en `.gitignore`).

## Proyecto

Restaurante AMALAY (Monterrey, MX). Este proyecto conecta Claude Code a los datos operativos del restaurante vía MCP de Supabase en modo read-only.

- **MCP:** `supabase-amalay` (read-only)
- **Proyecto Supabase:** `qjiomlvudfmzuvqvhwpk`
- **URL:** `https://qjiomlvudfmzuvqvhwpk.supabase.co`
- **Token:** variable de entorno `SUPABASE_ACCESS_TOKEN` (en `~/.zshrc`)

## Convenciones de output

- Respuestas en **español**
- Fechas en formato **YYYY-MM-DD**
- Montos en **MXN** con símbolo `$` y dos decimales (ej. `$1,234.56`)
- Formato **markdown** para reportes
- Tablas para rankings y comparativos
- Sin emojis salvo que se pidan explícitamente

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

Omar Aguilera, Hector Enrique Rodriguez Lopez, Brayan Berlanga Solis, Daniela Edith Rico Segura, Julio Cesar Hernández Hernández, Mauricio Rodriguez Rodriguez, Oscar Rios Alvarado, Alexis Alejandro Ocampo Vera, MESERO EVENTO

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

## Slash commands disponibles

| Comando | Descripción |
|---|---|
| `/morning-briefing [fecha]` | Briefing matutino: calendario, reservaciones, KPI Wansoft y 3 acciones del día (default: hoy) |
| `/reporte-amalay [fecha]` | KPIs del día (default: hoy) |
| `/top-meseros [dias]` | Ranking de meseros (default: 7 días) |
| `/proximas-reservas [dias]` | Próximas reservaciones (default: 14 días) |

## GitHub Actions Workflows

Workflows en `.github/workflows/`. Stack: **GitHub Actions (gratis) + Groq + Supabase REST + Telegram**.

### Workflows activos

| Workflow | Archivo | Cron | Descripción |
|---|---|---|---|
| Daily Briefing | `daily-briefing.yml` | `0 13 * * *` (7am MX) | Supabase → Groq llama-3.3-70b → Telegram → log agent_runs |

### Secrets requeridos en GitHub (Settings → Secrets → Actions)

| Secret | Descripción |
|---|---|
| `SUPABASE_URL` | `https://qjiomlvudfmzuvqvhwpk.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key (desde Supabase Dashboard → Settings → API) |
| `GROQ_API_KEY` | API key de Groq Cloud |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID_DANIEL` | Chat ID del destinatario |

### Script principal

`.github/scripts/daily_briefing.py` — self-contained, sin dependencias externas salvo `requests`.

Flujo interno:
1. Fetch Supabase REST API: `amalay_reservaciones` (hoy + 7 días), `calendar_sync_log` (hoy), `wansoft_kpis`
2. Formatea bloque de datos estructurado
3. Llama Groq con system prompt del briefing + datos → texto del briefing
4. Envía a Telegram (split automático si >4000 chars)
5. Inserta log en tabla `agent_runs` (non-blocking si falla)

### Tabla agent_runs (crear una vez en Supabase SQL Editor)

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id BIGSERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INT,
  output_summary TEXT,
  error_message TEXT,
  tokens_in INT,
  tokens_out INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Cómo agregar un nuevo workflow autónomo

1. Crea `.github/scripts/nombre_script.py` siguiendo el patrón de `daily_briefing.py`:
   - Leer config desde `os.environ`
   - Usar `sb_get()` / `sb_post()` para Supabase REST
   - Loguear en `agent_runs` al final
2. Crea `.github/workflows/nombre-workflow.yml` con:
   - `schedule` cron en UTC (MX = UTC-6, entonces 7am MX = `0 13 * * *`)
   - `workflow_dispatch` para testing manual
   - `env:` con todos los secrets necesarios
   - `TRIGGER_TYPE: ${{ github.event_name }}`
3. Setea cualquier secret nuevo: `gh secret set NOMBRE --repo ramonfaurdaniel-png/fullsite --body "valor"`
4. Test: `gh workflow run nombre-workflow.yml --repo ramonfaurdaniel-png/fullsite`
5. Watch: `gh run watch <run_id> --repo ramonfaurdaniel-png/fullsite`

### Comandos útiles

```bash
# Trigger manual
gh workflow run daily-briefing.yml --repo ramonfaurdaniel-png/fullsite

# Ver último run
gh run list --repo ramonfaurdaniel-png/fullsite --workflow=daily-briefing.yml --limit=5

# Ver logs completos
gh run view <run_id> --repo ramonfaurdaniel-png/fullsite --log

# Ver/editar secrets
gh secret list --repo ramonfaurdaniel-png/fullsite
gh secret set NOMBRE --repo ramonfaurdaniel-png/fullsite
```

## Cómo agregar nuevas routines

1. Crea un archivo `.md` en `.claude/commands/nombre-comando.md`
2. El archivo debe contener las instrucciones en lenguaje natural para Claude
3. Usa `$ARGUMENTS` para recibir parámetros del usuario
4. Referencia las tablas y columnas de este CLAUDE.md para construir queries correctos
5. Invoca el comando con `/nombre-comando [argumentos opcionales]`

**Ejemplo mínimo:**

```markdown
Consulta la tabla wansoft_daily vía MCP supabase-amalay y responde: $ARGUMENTS
```

**Patrón recomendado:**

```markdown
Usando el MCP supabase-amalay, ejecuta el siguiente análisis y presenta los resultados en markdown en español:

[descripción de lo que debe hacer]

Argumentos opcionales: $ARGUMENTS
Si no se proporcionan argumentos, usa [valor default].
```

## Notas operativas

- `wansoft_daily` es la fuente para reportes históricos (tiene columna `fecha`)
- `wansoft_kpis` es el estado en tiempo real (fila única, sin historial por fecha)
- Los JSONB de meseros usan `nombre` y `total` como keys
- `platillos_top` en la BD actual mezcla platillos, meseros y grupos — filtrar con cuidado
- El MCP es **read-only**: no hacer INSERT, UPDATE ni DELETE
