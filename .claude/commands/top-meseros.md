Usando el MCP supabase-amalay, genera el ranking de meseros por ventas y propinas.

Argumentos: $ARGUMENTS
- Si se proporciona un número, úsalo como cantidad de días hacia atrás (ej. "30" = últimos 30 días)
- Si no se proporciona, usa los últimos 7 días

Pasos:

1. Consulta `wansoft_daily` para las filas donde `fecha >= CURRENT_DATE - INTERVAL '[N] days'`
2. Para cada fila, extrae el JSONB `meseros` (ventas) y `pago_metodos` (para contexto de propinas si `propinas_meseros` está vacío)
3. Agrega los totales por nombre de mesero sumando a través de todos los días

Query de referencia para agregar JSONB across rows:
```sql
SELECT
  m->>'nombre' as mesero,
  SUM((m->>'total')::numeric) as ventas_total
FROM wansoft_daily,
  jsonb_array_elements(meseros) as m
WHERE fecha >= CURRENT_DATE - INTERVAL '[N] days'
  AND m->>'nombre' NOT IN ('SERVER1', 'APLICACIONES')
GROUP BY mesero
ORDER BY ventas_total DESC;
```

Presenta en markdown:

---

## Ranking de Meseros — Últimos [N] días
**Período:** [fecha_inicio] al [fecha_fin]

### Por ventas generadas
| Pos | Mesero | Ventas | % del total |
|---|---|---|---|
| 1 | ... | $X,XXX.XX | XX% |
(todos los meseros reales, excluyendo SERVER1, APLICACIONES, MESERO EVENTO)

### Propinas (si hay datos)
(tabla con propinas por mesero de propinas_meseros JSONB, o "Sin datos de propinas en el período" si está vacío)

### Contexto del período
- Total ventas período: $X,XXX.XX
- Días con datos: N

---

Todo en español, montos en MXN con formato $X,XXX.XX.
