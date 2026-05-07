Usando el MCP supabase-amalay, lista las próximas reservaciones de eventos del restaurante AMALAY.

Argumentos: $ARGUMENTS
- Si se proporciona un número, úsalo como cantidad de días hacia adelante (ej. "30" = próximos 30 días)
- Si no se proporciona, muestra los próximos 14 días

Consulta `amalay_reservaciones` donde:
- `fecha >= CURRENT_DATE`
- `fecha <= CURRENT_DATE + INTERVAL '[N] days'`
- `status != 'cancelled'`
- Ordenado por `fecha ASC, horario_inicio ASC`

Presenta en markdown:

---

## Próximas Reservaciones AMALAY
**Período:** hoy al [fecha_fin]

Si no hay reservaciones: "Sin reservaciones en los próximos [N] días."

Si hay reservaciones, agrúpalas por fecha:

### [Día de semana], [YYYY-MM-DD]
| Código | Cliente | Espacio | Horario | Guests | Paquete | Total | Status |
|---|---|---|---|---|---|---|---|
| AMA-XXXX | Nombre | jardín | 08:30 – 11:30 | 27 | Merienda / Cena | $15,293.00 | pending |

(repetir para cada fecha)

**Total reservaciones:** N  
**Total guests confirmados:** N personas  
**Total facturación esperada:** $X,XXX.XX

---

Todo en español, montos en MXN con formato $X,XXX.XX.
Status en español: pending → Pendiente, confirmed → Confirmado, cancelled → Cancelado.
