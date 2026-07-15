# PUBLIC CLAIMS EVIDENCE REGISTER
> Maps important Fullsite public-facing claims to evidence classification.
> Updated: 2026-07-15

## Classification

| Class | Meaning |
|---|---|
| HECHO | Directly supported by production, customer, repository, or database evidence |
| INFERENCIA | Strongest interpretation of available evidence |
| HIPOTESIS | Testable belief not yet proven |

## Claims Register

| Claim | Class | Evidence | Public-safe? | Where used |
|---|---|---|---|---|
| "30+ agentes autonomos" | HECHO | 30 agent_ids with executions in agent_runs. 27 actively scheduled. | YES | Landing, producto, caso-amalay, solutions |
| "522 platillos activos" | HECHO | pos_menu_items count, verified from Wansoft migration | YES | caso-amalay, comparar |
| "178 recetas canonicas" | HECHO | pos_recipe_versions (activated), R1 field cert CASE A | YES | caso-amalay, servicio-completo |
| "708 lineas de ingredientes" | HECHO | pos_recipe_lines count from canonical migration | YES | caso-amalay |
| "40 empleados" | HECHO | pos_staff count from migration | YES | caso-amalay, servicio-completo |
| "915 dias de datos historicos" | HECHO | wansoft_daily row count (2024-01-02 to 2026-07-10) | YES | caso-amalay, comparar |
| "En produccion desde julio 2026" | HECHO | Fullsite POS live at AMALAY since Jul 8, 2026 | YES | All pages |
| "Funciona sin internet" | HECHO | Case K offline certification PASS, R2D idempotency | YES | comparar, servicio-completo |
| "Control de recetas e inventario" | HECHO | R1 field cert 12/12 PASS, conservation audit PASS | YES | comparar, servicio-completo |
| "Corre en cualquier dispositivo" | HECHO | PWA + Electron, runs on Windows/Android/tablet/browser | YES | comparar, servicio-completo |
| "$0 de hardware" | HECHO | BYOD architecture, no proprietary hardware | YES | comparar |
| "Wansoft cobra $130K+ de instalacion" | HECHO | Public Wansoft pricing, cotizacion real Apr 2026 | YES (public info) | comparar |
| "4,800+ ejecuciones autonomas" | HECHO | agent_runs cumulative count | YES | caso-amalay |
| "Autenticacion biometrica" | HECHO | WebAuthn + DigitalPersona fingerprint, field tested | YES | servicio-completo |
| "Agentes analizan patrones de fraude" | HECHO | antifraud_agent.py runs weekly, analyzes cancel/discount patterns | YES | caso-amalay, solutions |
| "Prediccion de cierre" | HECHO | close_predictor.py runs 3x/day | YES | solutions |
| "Cruza clima con historial de ventas" | HECHO | climate_events_agent.py with OpenWeatherMap, daily | YES | solutions |
| **REMOVED CLAIMS** | | | | |
| "$8,400 en fraude detectado" | HIPOTESIS | Specific amount not verified from current production evidence | REMOVED | Was in caso-amalay |
| "554 acciones autonomas" | HIPOTESIS | Specific count from prior agent run window, not current verified | REMOVED | Was in caso-amalay |
| "98.2% uptime" | HIPOTESIS | Specific metric not independently verified | REMOVED | Was in caso-amalay |
| "Operado por IA" | HIPOTESIS | Agents recommend, do not operate autonomously | CORRECTED to "inteligencia operativa" | Was in caso-amalay |
| "24/7 monitoring" | INFERENCIA | Agents run on scheduled cadence (1-6x/day), not continuously | CORRECTED to "autonomos" | Was across site |
| "Restaurantes se cambian a Fullsite" | HIPOTESIS | Only one restaurant (AMALAY, founder's) | REMOVED | Was in comparar |
| **UNRESOLVED** | | | | |
| Canonical pricing ($1,999 or $4,999) | UNRESOLVED | Two conflicting prices across surfaces. PENDING DANIEL. | DO NOT PUBLISH | precios.html vs deck |
