# Fullsite Factory — documentación viva

> Hub de la documentación del programa. Organizada con **Diátaxis** (tutorial · how-to ·
> referencia · explicación). Descubrible desde [`docs/README.md`](../README.md).
>
> Levantado el 2026-08-27. La verdad es el código y los PRs; este índice cita rama y PR para
> cada afirmación. Si algo aquí contradice al código, gana el código.

## Empieza según lo que necesites (Diátaxis)

| Necesito… | Documento | Cuadrante |
|---|---|---|
| Instalar de cero hasta operación básica | [`tutorial-instalacion.md`](tutorial-instalacion.md) | Tutorial |
| Hacer una tarea concreta (crear cliente, enrolar, KDS, rollback) | [`howto.md`](howto.md) | How-to |
| Consultar contratos, APIs, flags, schemas | [`referencia.md`](referencia.md) | Referencia |
| Entender por qué se decidió algo | [`adr.md`](adr.md) | Explicación / ADRs |
| Operar staging→piloto→prod, incidentes | [`runbooks.md`](runbooks.md) | How-to (ops) |
| Ver requisito→código→test→PR→estado | [`trazabilidad.md`](trazabilidad.md) | Referencia |
| Ver qué cambió y cuándo | [`CHANGELOG.md`](CHANGELOG.md) | Log |
| El plan original con DAG y criterio 10/10 | [`FULLSITE-FACTORY.md`](FULLSITE-FACTORY.md) | Explicación |
| Abrir un PR del programa | [`PLANTILLA-PR.md`](PLANTILLA-PR.md) | Plantilla |

## Vocabulario de estado (no intercambiable)

Un ítem sólo avanza cuando cumple lo de su columna. **Un PR abierto NO es "terminado".**

| Estado | Qué exige |
|---|---|
| **Diseñado** | Contrato/ADR escrito, sin código |
| **Implementado** | Existe código en una rama |
| **Probado localmente** | tsc + lint + suite + build verdes en clon limpio |
| **Validado en staging** | Migración aplicada y probada en staging `<STAGING_PROJECT_REF>` |
| **Desplegado** | Mergeado y en el entorno indicado |
| **Verificado en campo** | Ejecutado físicamente sobre el mismo commit/instalador |

> **Estado global hoy: todo el programa está en `Implementado · Probado localmente`.**
> Cero merges, cero migraciones aplicadas a staging o producción, cero validación de campo.

## Estado vivo del programa

Camino crítico apilado: **#197 → #195 → #198 → #199**. El resto es paralelo. Todos consumen el
envelope de #197.

```
#197 contratos (envelope v2)  ─┬─────────────────────────────────────────────┐
   (base origin/main)          │  lo consumen todos                          │
                               ▼                                             │
#195 modelo de dispositivos ── #198 estaciones/routing ── #199 KDS aislado   │
   (base origin/main)             (base #195)                (base #198)      │
                                                                             │
paralelos desde origin/main, consumen #197:                                  │
   #200 turnos/corte-z · #201 offline-métricas · #202 wizard ·               │
   #203 soporte · #204 autoconfig · #205 IQ  ◄─────────────────────────────── ┘
```

### Tablero (verificado 2026-08-27 · `gh pr view`)

| PR | Capacidad | Rama | Base | Estado PR | Estado programa | Feature flag | Migración (no aplicada) | Verificación local |
|---|---|---|---|---|---|---|---|---|
| [#197](https://github.com/danielfullsite/fullsite/pull/197) | Contratos + envelope v2 | `factory/contratos-y-plan` | `main` | OPEN | Impl · Probado local | — (contrato) | — | tsc·lint · 10 tests |
| [#195](https://github.com/danielfullsite/fullsite/pull/195) | Modelo de dispositivos | `feat/modelo-dispositivos-por-sucursal` | `main` | OPEN | Impl · Probado local | (device_id server-gen) | `pos_terminals`, `pos_terminal_enrollments` | tsc·lint · 2,465 · build |
| [#198](https://github.com/danielfullsite/fullsite/pull/198) | Estaciones/routing por sucursal | `factory/estaciones-routing` | #195 | OPEN | Impl · Probado local | `factory.stations_per_location` | `pos_location_stations` | tsc·lint · 2,482 · build |
| [#199](https://github.com/danielfullsite/fullsite/pull/199) | KDS aislado (location+shift) | `factory/kds-aislamiento` | #198 | OPEN | Impl · Probado local | `factory.kds_location_scope` | — (usa columnas existentes) | tsc·lint · 2,491 · build |
| [#200](https://github.com/danielfullsite/fullsite/pull/200) | Turnos por sucursal + corte Z | `factory/turnos-corte-z` | `main` | OPEN | Impl · Probado local | — | `pos_turnos` (ALTER aditivo) | tsc·lint · 2,426 |
| [#201](https://github.com/danielfullsite/fullsite/pull/201) | Offline métricas p50/p95 | `factory/offline-metricas-soak` | `main` | OPEN | Impl · Probado local | `FACTORY_OFFLINE_METRICS` (env) | — | `node --test` 9/9 |
| [#202](https://github.com/danielfullsite/fullsite/pull/202) | Wizard reanudable | `factory/wizard-reanudable` | `main` | OPEN | Impl · Probado local | `factory.wizard_resumable` | — (usa `pos_settings`) | tsc·lint · 2,428 · build |
| [#203](https://github.com/danielfullsite/fullsite/pull/203) | Soporte con consentimiento | `factory/soporte-interfaz` | `main` | OPEN | Impl · Probado local | `factory.support_console` | — (usa `pos_settings`) | tsc·lint · 2,424 · build |
| [#204](https://github.com/danielfullsite/fullsite/pull/204) | Autoconfig capabilities | `factory/autoconfig-interfaz` | `main` | OPEN | Impl · Probado local | `factory.autoconfig` | — (stateless) | tsc·lint · 2,426 · build |
| [#205](https://github.com/danielfullsite/fullsite/pull/205) | Fullsite IQ read-only | `factory/iq-preview-diff` | `main` | OPEN | Impl · Probado local | `factory.iq_proposals` | — (stateless) | tsc·lint · 2,425 · build |

**Owner:** todo el programa es del track "Factory" (este agente). Dominio compartido con Codex:
`data.ts`, `seeds/`, negocio de `client_locations`, worktree `.codex/worktrees/electron-amalay-qa`
(**intocable**). Los conteos de la suite difieren por rama porque cada una parte de una base
distinta (algunas apiladas sobre #195).

### Migraciones — ninguna aplicada a remoto

| Migración | Rama/PR | Tipo | Aplicada en staging | Aplicada en prod |
|---|---|---|---|---|
| `20260827120000_pos_terminals_por_sucursal.sql` | #195 | Aditiva/idempotente | No | No |
| `20260827130000_pos_terminal_enrollments.sql` | #195 | Aditiva | No | No |
| `20260827140000_pos_location_stations.sql` | #198 | Aditiva | No | No |
| `20260827150000_pos_turnos_por_sucursal.sql` | #200 | Aditiva/idempotente | No | No |

Endurecimiento posterior documentado en `supabase/migrations/README-pos-terminals-endurecimiento.md`
(vive en la rama de #195; llega a `main` cuando #195 se integre).

## Lo que aún requiere wiring de Electron (frontera offline)

No viaja por Vercel; requiere **instalador nuevo** y reinstalar en la caja. Documentado en cada PR:

- Instrumentar el hot path de Pedro para emitir muestras de latencia (#201 entrega el motor + enganche).
- Escaneo real LAN/USB/HID para autoconfig (#204 entrega el motor; la caja recolecta la evidencia).
- Exigir `location_id` en `config-schema.js` del Electron (hoy viaja como campo adicional, compatible).
