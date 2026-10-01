# Fullsite Architecture & Industry Intelligence Lab — Research Plan

> Sprint de investigación (solo lectura). Inicio: 2026-09-17. Sin código, sin commits, sin PRs.
> Pregunta central: **¿qué sabe ya la industria que Fullsite no debería redescubrir desde cero?**
> y **¿qué sí vale la pena construir como propiedad intelectual?**

## Método
- Fuentes primarias primero: docs oficiales, engineering blogs, talks, patentes, repos con adopción real.
- Cada hallazgo marcado **FACT / INFERENCE / RECOMMENDATION**, con URL.
- Si dos fuentes se contradicen, se dice. No se rellenan huecos.
- Distinguir **feature** vs **patrón arquitectónico**.
- Punto de partida interno (no repetir): `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md` (🏆),
  `docs/architecture/PER-02-RESEARCH.md`, `OFFLINE-IMPL-001-OUTBOX-v2.2.md`,
  `docs/knowledge/competitive/LANDSCAPE-MEXICO.md`, `COMPETITIVE-INTELLIGENCE.md`.

## Tracks y orden
| Prioridad | Track | Archivo |
|---|---|---|
| P0 | A. Offline-first / sync / reconciliación | `A-offline-sync.md` |
| P0 | B. Edge local + hardware + matriz de certificación | `B-edge-hardware.md` |
| P0 | C. Payments (México primero) | `C-payments.md` |
| P0 | I. Fleet / observabilidad / soporte remoto | `I-fleet-observability.md` |
| P1 | E. CrunchTime / back-of-house | `E-back-of-house.md` |
| P1 | D. KDS / kitchen OS | `D-kds.md` |
| P1 | F. Delivery / agregación | `F-delivery.md` |
| P1 | G. AI voice ordering | `G-voice.md` |
| P2 | H. Agentic restaurant OS | `H-agentic-os.md` |
| P2 | J. Modelo de negocio | `J-business-model.md` |
| P2 | Mapa competitivo | `K-competitive-map.md` |
| P2 | Open-source treasure hunt | `L-open-source.md` |
| Síntesis | Executive summary, treasure map, build/buy, target arch v0, what-not-to-build, roadmap 12m, fastest wins, moat map | `SYNTHESIS.md` |

## Estado (actualizado 2026-09-17)

**Ejecución revisada por Daniel el 2026-09-17:** un solo track activo a la vez, sin agentes en paralelo.
Se termina, sintetiza y guarda un track antes de empezar el siguiente. P1 y P2 **no** se lanzan.

- [x] **Track A — Offline / sync / reconciliación** → [`OFFLINE-IDEMPOTENCY.md`](OFFLINE-IDEMPOTENCY.md).
      Backlog derivado (registrado, sin autorización de implementar): [`BACKLOG-P0.md`](BACKLOG-P0.md).
- [ ] Resto de P0 (B hardware, C payments, I fleet) — **no iniciados, en espera de instrucción explícita**
- [ ] P1 — no lanzar
- [ ] P2 — no lanzar
- [ ] Síntesis — requiere más de un track cerrado
