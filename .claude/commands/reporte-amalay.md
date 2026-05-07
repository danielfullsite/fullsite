Usando el MCP supabase-amalay, genera el reporte de KPIs del día para el restaurante AMALAY.

Argumentos: $ARGUMENTS
- Si se proporciona una fecha (YYYY-MM-DD), úsala como fecha del reporte
- Si no se proporciona, usa la fecha de hoy

Pasos:

1. Consulta `wansoft_daily` donde `fecha = '[fecha]'`
2. Consulta `amalay_reservaciones` donde `fecha = '[fecha]'`
3. Si no hay datos en `wansoft_daily` para esa fecha, consulta `wansoft_kpis` (estado en tiempo real) e indica que son datos parciales del día en curso

Presenta el resultado en markdown con esta estructura:

---

## Reporte AMALAY — [fecha]

### Ventas
| Métrica | Valor |
|---|---|
| Ventas netas | $X,XXX.XX |
| Ventas brutas | $X,XXX.XX |
| Descuentos | $X,XXX.XX |
| Tickets | N |
| Ticket promedio | $X,XXX.XX |

### Métodos de pago
(tabla con nombre y total de pago_metodos JSONB)

### Top 3 categorías de menú
(top 3 de ventas_por_grupo JSONB, ordenado por total desc)

### Reservaciones del día
| Código | Cliente | Espacio | Horario | Guests | Total | Status |
|---|---|---|---|---|---|---|
(filas de amalay_reservaciones para esa fecha, o "Sin reservaciones" si no hay)

---

Todo en español, montos en MXN con formato $X,XXX.XX, sin emojis.
