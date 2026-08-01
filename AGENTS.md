# AGENTS.md — Fullsite Platform

> Este archivo lo lee Claude Code automáticamente al iniciar sesión.
> Actualizar en el mismo commit cuando cambie la arquitectura.

Fullsite es una plataforma SaaS multi-restaurante: POS local-first (Electron), dashboard en la nube (Next.js), y 26+ agentes IA autónomos. Este repositorio contiene todo: el dashboard, el POS, los agentes, y el knowledge base completo.

---

## Knowledge Base

**Punto de entrada único:** [`docs/README.md`](docs/README.md)

El directorio `docs/` es la única fuente de verdad para arquitectura, decisiones, certificaciones, playbooks y estrategia. Leer `docs/README.md` antes de navegar el código.

---

## Estructura del repo

```
dashboard-app/        Next.js dashboard (app.fullsite.mx)
electron-app/         Electron POS (local-first, corre en la terminal del restaurante)
agents/               Configuración de tentáculos del War Room multi-agente
.github/scripts/      Scripts Python de los agentes (daily_briefing.py, etc.)
.github/workflows/    GitHub Actions workflows (crons, webhooks, on-demand)
cloudflare/           Cloudflare Workers (orquestador de Telegram)
migration-engine/     TypeScript pipeline de migración desde Wansoft
scripts/sql/          Migrations SQL de Supabase
docs/                 Knowledge base completo
```

---

## Proyectos Supabase

| Proyecto | Ref | Regla |
|---|---|---|
| `fullsite-amalay` | `qjiomlvudfmzuvqvhwpk` | **NUNCA tocar** — producción AMALAY |
| `fullsite-warroom-staging` | `jkcnxfbbuyyfhwfjizgw` | Sandbox seguro — VANTARA, NÓMADA-MINI, PRUEBA-3 |

---

## Reglas de seguridad

- Nunca imprimir el contenido de `.mcp.json`, `.env`, `~/.zshrc` en el chat ni en logs.
- Nunca escribir tokens reales en diffs visibles.
- El proyecto `fullsite-amalay` es producción — no modificar directamente.

---

## Flujo permanente de documentación

```
Artifact → Revisión → Consolidación → docs/ → Commit
```

Los artifacts de Claude no son documentación permanente. Todo conocimiento crítico termina en `docs/`.

---

## Comandos clave

```bash
# Dashboard local
cd dashboard-app && bun dev

# Tests
cd dashboard-app && bun test

# Trigger manual de workflow
gh workflow run daily-briefing.yml --repo ramonfaurdaniel-png/fullsite

# Ver últimos runs
gh run list --repo ramonfaurdaniel-png/fullsite --limit=10

# Aprovisionar nuevo cliente (sandbox)
python scripts/onboard_client.py --client-id nombre --confirm-ref jkcnxfbb...
```

---

Ver [`docs/ai/OVERVIEW.md`](docs/ai/OVERVIEW.md) para el mapa del War Room multi-agente.
Ver [`docs/feos/OVERVIEW.md`](docs/feos/OVERVIEW.md) para las 9 iniciativas FEOS.
Ver [`docs/state/CERTIFICATIONS.md`](docs/state/CERTIFICATIONS.md) para el estado actual de certificaciones.
