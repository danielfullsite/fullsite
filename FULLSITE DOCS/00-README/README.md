# FULLSITE DOCS

Documentación técnica y operativa del sistema Fullsite POS.

## Estructura

| Directorio | Contenido |
|---|---|
| `00-README/` | Este índice |
| `01-VISION/` | Visión del producto y principios |
| `02-ARCHITECTURE/` | Diagramas y decisiones de arquitectura |
| `03-LOCAL-FIRST/` | Arquitectura offline-first, principios LAN |
| `04-POS/` | Sistema POS — órdenes, mesas, cobro |
| `05-KDS/` | Kitchen Display System |
| `06-PRINTING/` | Print bridge, estaciones, comandas |
| `07-INVENTORY/` | Inventario, recetas, food cost |
| `08-SYNC/` | SyncQueue, EventStore, reconciliación |
| `09-ELECTRON/` | Electron app, configuración, modos |
| `10-INSTALLATION/` | Guías de instalación step-by-step |
| `11-VALIDATION/` | Smoke tests, certificación, QA |
| `12-RUNBOOKS/` | Runbooks operativos |
| `13-TROUBLESHOOTING/` | Diagnóstico y solución de problemas |
| `14-ADR/` | Architecture Decision Records |
| `15-AMALAY/` | Documentación específica de AMALAY |
| `16-DEMO/` | Guías de demo y onboarding |
| `17-ROADMAP/` | Roadmap técnico y producto |
| `18-HANDOFFS/` | Handoffs de sesión — estado del sistema |
| `19-ARCHIVE/` | Documentos históricos archivados |
| `20-STRATEGY/` | Estrategia y decisiones de producto |
| `21-OPERATIONS/` | Operaciones diarias, checklists |
| `22-GUIDES/` | Guías para el equipo |

## Documentos clave

- [`03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md`](../03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md) — Arquitectura completa (15 secciones)
- [`18-HANDOFFS/2026-07-27-OFFLINE-LOCAL-FIRST-MASTER-HANDOFF.md`](../18-HANDOFFS/2026-07-27-OFFLINE-LOCAL-FIRST-MASTER-HANDOFF.md) — Estado del sistema al 2026-07-27

## Fuentes de verdad

| Qué | Dónde |
|---|---|
| Código fuente POS | `dashboard-app/src/app/pos/` |
| Lib offline | `dashboard-app/src/lib/pos-offline-db.ts` |
| Lib datos | `dashboard-app/src/lib/pos-data.ts` |
| Electron | `electron-app/main.js` |
| Schema Supabase | `supabase-amalay` MCP (read-only) |
| Build actual | `electron-app/dist/Fullsite POS Setup 1.2.0.exe` |
