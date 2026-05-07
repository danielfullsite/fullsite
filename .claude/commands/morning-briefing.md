Genera el Morning Briefing diario de AMALAY. Presenta todo en markdown conciso, optimizado para lectura mobile. Sin tablas largas — usa listas.

Fecha a usar: si se proporcionan $ARGUMENTS, úsala como fecha (formato YYYY-MM-DD). Si no, usa la fecha de hoy (CURRENT_DATE).

Llama "TARGET_DATE" a la fecha determinada y "TOMORROW" al día siguiente.

---

## Sección A — Hoy en el calendario

Consulta `calendar_sync_log` vía MCP supabase-amalay para eventos con `event_start` entre TARGET_DATE 00:00 y TARGET_DATE 23:59 UTC-6 (ajusta a UTC para el query). Filtra los que tengan `action = 'declined'`. Ordena por `event_start`.

Formato por evento:
**HH:MM** — {event_title corto, max 60 chars} — {duración si se puede calcular}

Si no hay eventos: "Sin eventos en calendario."

---

## Sección B — Reservaciones de hoy

Consulta `amalay_reservaciones` donde `fecha = TARGET_DATE` AND `status != 'cancelled'`. Ordena por `horario_inicio`.

Formato por reservación (una por línea):
**{horario_inicio}** {codigo_reserva} — {nombre} — {guests} px — {espacio}
Tel: {telefono | "sin tel"} | Paquete: {paquete} | Total: ${total}
{pastel si no es null: "Pastel: {pastel}"} {deco si no es null: "Deco: {deco}"}

Si no hay reservaciones: "Sin reservaciones para este día."

---

## Sección C — Próximas reservaciones (7 días)

Consulta `amalay_reservaciones` donde `fecha BETWEEN TOMORROW AND TOMORROW + INTERVAL '7 days'` AND `status != 'cancelled'`. Agrupa por fecha y muestra resumen por día.

Formato:
**YYYY-MM-DD (día semana):** N evento(s) — nombres separados por coma — total personas

---

## Sección D — KPI Wansoft

Consulta `wansoft_kpis` vía MCP supabase-amalay.

- Calcula cuántas horas han pasado desde `updated_at` hasta ahora.
- Si han pasado más de 24 horas desde `updated_at`, muestra al inicio de esta sección:
  ⚠️ DATA STALE — último sync: {fecha_reporte} a las {hora de updated_at hora local}
- Si es reciente (< 24h), muestra normalmente.

Muestra:
- Ventas día: ${ventas_dia}
- Tickets: {tickets_count | "N/D"}
- Ticket promedio: ${ticket_promedio_restaurant | "N/D"}
- Última venta: {ultima_venta}

---

## Sección E — Top 3 acciones del día

Basándote en todo lo anterior, genera exactamente 3 bullet points accionables y específicos para hoy. Ejemplos de tipo de acción:
- Reservaciones sin teléfono de contacto que necesitan confirmación
- Sync de Wansoft caído / data stale que requiere atención técnica
- Eventos del calendario sin reservación correspondiente en BD
- Reservaciones en status `pending` que deberían estar `confirmed`
- Cualquier anomalía operativa evidente en los datos

Formato:
- **[Acción concreta]:** {detalle}

---

## Formato final del output

```
# Morning Briefing AMALAY — {TARGET_DATE}

## Calendario
{sección A}

## Reservaciones hoy
{sección B}

## Próximas reservaciones
{sección C}

## Ventas (Wansoft)
{sección D}

## Top 3 acciones
{sección E}
```

Respuesta en español. Sin emojis excepto el ⚠️ de data stale. Conciso — cada sección máximo 10 líneas.
