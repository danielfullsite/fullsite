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
- Transporte de Pedro: HTTP y WebSocket exigen credencial de instalación antes de operar o entregar estado. Contrato y enrolamiento: [`docs/architecture/LAN-TRANSPORT-AUTH.md`](docs/architecture/LAN-TRANSPORT-AUTH.md).
- Autoridad de empleado en Caja: [`docs/architecture/ACTOR-AUTHORITY-2026-09-05.md`](docs/architecture/ACTOR-AUTHORITY-2026-09-05.md). PIN se valida en Caja; los roles del navegador no autorizan dinero. Perfiles compartidos: `electron-app/local-server/core/permission-profiles.json`.

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
python3 scripts/sql/sandbox/onboard_client.py \
  --client-id nombre \
  --name "Nombre del cliente" \
  --owner-email owner@example.com \
  --template cafe \
  --confirm-ref jkcnxfbbuyyfhwfjizgw \
  --dry-run
```

---

Ver [`docs/ai/OVERVIEW.md`](docs/ai/OVERVIEW.md) para el mapa del War Room multi-agente.
Ver [`docs/feos/OVERVIEW.md`](docs/feos/OVERVIEW.md) para las 9 iniciativas FEOS.
Ver [`docs/state/CERTIFICATIONS.md`](docs/state/CERTIFICATIONS.md) para el estado actual de certificaciones.

## Comandos locales durables (candidato septiembre)

Antes de modificar almacenamiento o impresión de Pedro, leer [`docs/architecture/DURABLE-COMMANDS-2026-09-05.md`](docs/architecture/DURABLE-COMMANDS-2026-09-05.md). Un ACK exige commit durable; impresión incierta exige verificación del operador. El nuevo formato de log requiere una migración validada para downgrade.

Dinero usa [`docs/architecture/FINANCIAL-COMMANDS-2026-09-05.md`](docs/architecture/FINANCIAL-COMMANDS-2026-09-05.md): centavos, reservas y resultados durables con actor verificado. Liquidación no significa entrega. UI de efectivo/split y materializador integrados en laboratorio; el candidato no está habilitado para producción.

Consumo adicional con cuentas financieras abiertas exige revisión operacional y financiera, cuenta destino y un único commit con ambas proyecciones. Pagos y reservas se conservan. Una ronda pendiente bloquea nuevos cobros, pero permite resolver intentos previos. Reducir consumo o devolver dinero requiere su propio ajuste autorizado; no borrar las cuentas financieras para desbloquear la orden.

Operaciones autorizadas, rutas de cocina, impresión y cierre contado: [`docs/architecture/OPERATIONAL-COMMANDS-2026-09-05.md`](docs/architecture/OPERATIONAL-COMMANDS-2026-09-05.md). Interacción y límites de botones: [`docs/architecture/OPERATIONAL-UI-CAJA-2026-09-05.md`](docs/architecture/OPERATIONAL-UI-CAJA-2026-09-05.md). La autoridad es opt-in; no reenviar colas cloud legacy ni activar módulos sin comandos locales.

Código de interfaz instalado y recuperación: [`docs/architecture/OFFLINE-UI-PACKAGE-2026-09-05.md`](docs/architecture/OFFLINE-UI-PACKAGE-2026-09-05.md). Recibos de negocio, barrera cloud y transición por sucursal: [`docs/architecture/CAJA-CLOUD-MATERIALIZATION-2026-09-05.md`](docs/architecture/CAJA-CLOUD-MATERIALIZATION-2026-09-05.md). Instalar un binario no activa una sucursal; el downgrade del log exige migración validada.

Inventario del candidato: [`docs/architecture/INVENTORY-CONFIRMED-2026-09-10.md`](docs/architecture/INVENTORY-CONFIRMED-2026-09-10.md). Movimiento manual usa recibo/stock/costo en una transacción. Venta y cancelación se concilian desde la orden confirmada; no devolver existencias por un borrador o una cancelación preparada.
