# Dashboard — Inventario "NO PERDER NADA" (checklist del rediseño)

**Regla:** el rediseño visual debe **re-estilar** cada elemento de esta lista. Si algo no aparece en la versión nueva → NO pasa. Diff antes/después obligatorio.
Fuente: `src/app/page.tsx` + `KPICard.tsx`, `PredictionWidget.tsx`, `RevenueChart.tsx`, `RevenueDistributionChart.tsx`.

## Header (siempre visible) — `page.tsx:389-514`
- [ ] Título dinámico ("Resumen del día / semanal / mensual").
- [ ] Navegador de fecha **3 variantes** (Día / Semana / Mes) con flechas ‹ ›, labels, y selector `<input type=date>` con min/max.
- [ ] Badges: **HOY** (accent), **ÚLTIMO CIERRE** (gris), **ACTUAL** (semana/mes).
- [ ] Botón **Settings** (personalizar) + tooltip.
- [ ] Tabs de período: **Día / Semana / Mes** (activo esmeralda).

## Banners
- [ ] Aviso stale ámbar (Día): "Sin sincronización de hoy todavía…".
- [ ] Nota de sync gris (Día, si == hoy): "Datos de Wansoft actualizados a las {hora}…".

## Panel Settings (`showSettings`) — 13 toggles (Eye/EyeOff), persistido en localStorage
insight · month_progress · kpis · prediction · extra_kpis · agent_status(OFF) · week_comparison · revenue_chart · top_meseros · categories(OFF) · hora_pico · payment_methods(OFF) · quick_actions(OFF)

## Los 13 widgets (cada uno con su render condicional por dato/período)
1. [ ] **Insight del día** — banner púrpura + frase auto (±% vs prom DOW / top mesero %).
2. [ ] **Progreso del mes** — card gradiente: mes/año, badge Día X/Y, ventas acumuladas, Proy./Prom./días restantes, barra de progreso.
3. [ ] **KPI cards ×4** (`KPICard`): Ventas · Órdenes · Personas · Prom/persona. Cada una: label (varía por período), valor, **delta con label por período**, **sparkline 7d**, ícono (azul/verde/ámbar/púrpura), weekChange "vs semana pasada", flecha up/down/neutral, subtitle ("Por orden: $X" en la 4ª). Dos layouts (móvil/desktop).
4. [ ] **Predicción de cierre** (solo Día): barra de color, valor proyectado, delta, barra de progreso del día, 3 mini-stats (Falta / vs ayer / vs 7d). Auto-oculta sin datos horarios.
5. [ ] **Extra KPIs ×3**: Propinas (esmeralda) · Descuentos (rojo) · Brutas (azul).
6. [ ] **Status de agentes** (OFF): header + badge "{n} activos", chips (móvil) / lista con tiempo + summary (desktop), link "Ver los N agentes", 24 nombres mapeados. Empty: "Cargando…".
7. [ ] **Banner vs semana pasada**: ±% (verde/rojo) + monto + fecha + "7d atrás {$}".
8. [ ] **Gráfica de ventas 30d** (`RevenueChart`): total, leyenda min/max, AreaChart recharts (gradiente, ejes, grid, tooltip, activeDot, **ReferenceDot** del día seleccionado).
9. [ ] **Top meseros** (5 filas): rank badge, nombre, monto, barra relativa. Empty: "Sin datos de meseros".
10. [ ] **Distribución por categoría** (OFF): donut top-8 + leyenda con %, 28 nombres mapeados. "Total: {$}".
11. [ ] **Métodos de pago** (OFF): grid por método (punto color, nombre, %, monto MXN, barra). Empty: "Sin datos de pagos…".
12. [ ] **Mejor día** (Clock): día top de últimos 7 + Mesas/día + Para llevar.
13. [ ] **Eficiencia del día** (Activity): 4 filas — Venta/persona · Venta/mesa · Propina prom · Descuento %.
14. [ ] **Acciones rápidas** (OFF): 4 links — Ventas · Meseros · Cortes · Reportes.

## Estados globales (preservar)
- [ ] Loading spinner + "Cargando datos…" (timeout 10s → empty, no spinner infinito).
- [ ] Fallback a `pos_orders` si no hay `wansoft_daily`.
- [ ] Auto-refresh cada 5 min + al recuperar foco.
- [ ] Auto-hide de widgets sin datos (insight, month_progress, prediction, week_comparison, hora_pico).

## Diferencias por período (preservar)
- Navegador cambia forma + badges. Banner de frescura y Predicción **solo en Día**. Labels/deltas de KPI cambian por período. Cálculos: Día (mismo-DOW 4sem) / Semana (Lun-Dom vs previa) / Mes (mes vs previo).

---
**Siguiente:** re-estilar widget por widget contra esta lista → diff → preview → merge. Cero pérdida.
