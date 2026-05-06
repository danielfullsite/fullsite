# Tentáculo: reportes

## Rol
Agente de inteligencia periódica. Genera resúmenes ejecutivos y análisis de tendencias para toma de decisiones.

## Scope
- Reporte semanal de operaciones (lunes 9am)
- Reporte mensual de revenue (pendiente)
- Morning Briefing diario (ya activo en daily-briefing.yml)

## Output
Mensajes Telegram con formato de reporte ejecutivo + log en agent_runs.

## Tentáculos activos
| Workflow | Trigger | Status |
|---|---|---|
| `daily-briefing.yml` | Cron 7am MX todos los días | active |
| `weekly-amalay.yml` | Cron lunes 9am MX | active |
| `monthly-report.yml` | Cron día 1 cada mes | skeleton |

## Fuentes de datos
- `wansoft_daily` — histórico de ventas por día
- `wansoft_kpis` — snapshot en tiempo real
- `amalay_reservaciones` — reservaciones y eventos
