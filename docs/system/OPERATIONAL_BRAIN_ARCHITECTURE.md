# OPERATIONAL BRAIN — arquitectura

> **INTERNO.** Diseño. **Nada de esto se implementó.**
> **Fecha:** 2026-09-18 · evidencia leída de `origin/main` (`10017cf9`), del candidato de Fork
> (`7ae2745b`) y de la base de AMALAY por introspección de sólo lectura.
>
> Hermanos: [`FIELD_CERT_CONTRACT.md`](FIELD_CERT_CONTRACT.md) ·
> [`AGENT_SAFETY_POLICY.md`](AGENT_SAFETY_POLICY.md) ·
> `tools/brain/AGENT_REGISTRY.json` · `tools/brain/SIGNAL_EXPECTATIONS.json`

---

## 1 · Qué es y qué no

El Backlog deja de ser una lista y pasa a ser **la memoria operativa viva de Fullsite**: el lugar
donde una pregunta sobre el estado del sistema se contesta **con evidencia y con fecha**, no de
memoria.

**No es** un dashboard, ni una base de datos nueva, ni un servicio. Es un **conjunto de artefactos
emitidos** más un **índice** que los sabe leer. La regla que lo gobierna ya está escrita en el arnés
de certificación y sólo se generaliza:

> `run.json` es la fuente; `REPORT.md` es una proyección generada. Nunca se escribe el reporte a
> mano: si se redactara aparte, tarde o temprano diría algo que el JSON no dice y no habría forma
> de saber cuál de los dos mintió.

**Nada de lo que el cerebro afirma se edita a mano.** Lo que no tiene artefacto detrás se muestra
como `UNKNOWN`, nunca como `OK`.

---

## 2 · Los dieciséis dominios y quién los contesta hoy

`ARTEFACTO` = existe un archivo emitido · `PARCIAL` = existe la fuente, falta el artefacto ·
`AUSENTE` = no hay ni fuente.

| Dominio | Fuente autoritativa | Estado hoy |
|---|---|---|
| **RELEASES** | `release-artifact.v2.template.json` emitido por paso | **PARCIAL** — plantilla lista, ninguno emitido |
| **DEPLOYMENTS** | id de despliegue de Vercel + SHA servido | **PARCIAL** — no se captura en artefacto |
| **ROLLBACKS** | campo `rollback` del artefacto de release | **PARCIAL** |
| **FIELD CERTS** | `FIELD_CERT_ARTIFACT` por sesión | **AUSENTE** — contrato diseñado, nada emitido |
| **RUNTIME CERTS** | `run.json` del arnés (`contract_version 1.0`) | **PARCIAL** — el arnés existe en `cert/rig-v1-pr2`, sin mergear |
| **SCHEMA DRIFT** | `drift-report.json` v1.1 | **ARTEFACTO** — 29 objetos, 14 derivas, corrió |
| **SYSTEM MAP** | `SYSTEM-MAP.md` | **ARTEFACTO** (manual, fechado) |
| **SOURCE OF TRUTH** | `SOURCE-OF-TRUTH.md` + introspección | **ARTEFACTO** |
| **MIGRATION STATE** | los tres orígenes del guardián | **ARTEFACTO** |
| **KNOWN HAZARDS** | `deployment-sequence.json` → `hazards_registered_not_fixed` | **ARTEFACTO** |
| **OPEN P0/P1** | `RELEASE-BOARD.md` §5 | **PARCIAL** — manual |
| **INCIDENTS** | `lab_issues` (200 filas) + postmortems en `docs/` | **PARCIAL** — dos lugares sin índice común |
| **ADRs** | `docs/adr/` | **PARCIAL** — no indexado por el cerebro |
| **RUNBOOKS** | `docs/offline/RUNBOOK.md`, `docs/playbooks/` | **PARCIAL** |
| **FLEET HEALTH** | `local_server_heartbeats` | **AUSENTE EN LA PRÁCTICA** — 0 filas |
| **CUSTOMER / CUTOVER STATE** | `docs/customers/<tenant>/` + `clients.data_source` | **PARCIAL** |
| **SLOs** | — | **AUSENTE** — no existe ninguno declarado |

**La lectura honesta:** de dieciséis dominios, **tres** tienen artefacto emitido y verificable. El
resto tiene fuente y le falta el acto de emitir.

---

## 3 · Las diez preguntas, y qué hace falta para contestarlas

| Pregunta | Fuente | ¿Contestable hoy? |
|---|---|---|
| ¿Qué SHA está sirviendo AMALAY? | artefacto de release + id de despliegue | **NO** — se sabría preguntando a Vercel, no al cerebro |
| ¿Está field-certified? | `FIELD_CERT_ARTIFACT` | **NO** — no existe el artefacto |
| ¿Qué invariantes están pendientes? | `drift-report.json` + `release-triage.json` | **SÍ** — 1 bloqueador actual, 3 multi-sucursal |
| ¿Cuál fue el último incidente? | `lab_issues` + postmortems | **PARCIAL** — sin índice común |
| ¿Qué migraciones están aplicadas? | ledger + introspección | **SÍ** — y con la advertencia de que el ledger miente |
| ¿Qué tablas tienen drift? | `drift-report.json` | **SÍ** — 14 objetos |
| ¿Qué terminal está muda? | `local_server_heartbeats` | **NO** — 0 filas: la respuesta es «no se sabe», no «ninguna» |
| ¿Qué cola no drenó? | `pos_local_events` + `sync_queue` local | **NO** — 0 filas en nube; la cola vive en la terminal |
| ¿Cuál es la autoridad de ventas hoy? | `clients.pos_write_authority` | **SÍ** — `supabase` para todos |
| ¿Qué P0 están abiertos? | `RELEASE-BOARD.md` | **PARCIAL** — manual, caduca en horas |

**Tres de diez se contestan con evidencia. Cuatro se contestan «no se sabe», y eso es una respuesta
válida que hoy nadie da.**

---

## 4 · Arquitectura

```
          ┌──────────── FUENTES DETERMINISTAS ────────────┐
          │ Postgres (introspección + filas de negocio)   │
          │ Pedro NDJSON + /identity + /health            │
          │ git (SHAs, archivos, fingerprints)            │
          │ Vercel (deployments)                          │
          │ run.json del arnés                            │
          └───────────────────┬──────────────────────────┘
                              │  sólo lectura
          ┌───────────────────▼──────────────────────────┐
          │  EMISORES  — producen artefactos inmutables   │
          │  drift-guard · field-cert · release-emitter   │
          │  cert-rig · absence-watcher                   │
          └───────────────────┬──────────────────────────┘
                              │  artefactos fechados y fijados a un SHA
          ┌───────────────────▼──────────────────────────┐
          │  ÍNDICE DEL CEREBRO                            │
          │  sabe qué artefacto contesta qué pregunta,     │
          │  y cuál es el más reciente por dominio         │
          └───────────────────┬──────────────────────────┘
                   ┌──────────┴──────────┐
        proyecciones generadas      AGENTES (L0/L1)
        (tableros, no autoridad)    leen · explican · recomiendan
```

**Tres reglas de la arquitectura:**

1. **Un artefacto se emite, no se edita.** Lleva su SHA y su hora. Si el mundo cambia, se emite otro;
   el viejo no se reescribe. *(Ya aplicado: `drift-report.json` fijado a `21d66e41`, el deploy pack a
   `9772f164`, aunque el HEAD de Fork se movió cuatro veces el mismo día.)*
2. **El índice no calcula, resuelve.** Dada una pregunta, devuelve el artefacto que la contesta y su
   fecha. Si el artefacto no existe, devuelve `UNKNOWN` con el motivo.
3. **Los agentes no escriben artefactos de verdad.** Escriben *interpretaciones*, que son otro tipo de
   objeto y llevan `confidence`. Un evento no lleva `confidence`; si lo necesita, no es un evento.

---

## 5 · Grafo de correlación — cómo se reconstruye una acción

```
ACCIÓN HUMANA        toque en "Enviar"           actor_id + terminal_id + shift_id
     ↓
COMANDO              client_op_id X              generado y persistido ANTES del primer intento
     ↓
EFECTO LOCAL         order_id Y                  NDJSON de Pedro, o IndexedDB
     ↓
EFECTO KDS/IMPRESIÓN kds_job Z · print_job P      cola durable local
     ↓
COLA OFFLINE         queue item Q                sync_queue, con base_version y error_class
     ↓
SYNC A NUBE          intento n                   ← NO SE REGISTRA HOY
     ↓
RECIBO AUTORITATIVO  receipt R                   pos_save_operations / pos_caja_business_receipts
```

**La arista que une todo es `client_op_id`.** No hace falta almacenar el grafo: con un índice sobre
`client_op_id` en cada tabla, el grafo es un `WHERE`. Lo que falta no es un motor: son las columnas.

### 5.1 · Las nueve anomalías, y con qué se detectan

| Anomalía | Detector | ¿Posible hoy? |
|---|---|---|
| **orden duplicada** | dos `order_id` con el mismo contenido y `client_op_id` distinto en la misma ventana | **NO** — `pos_orders` no tiene `client_op_id` |
| **efecto de caja duplicado** | dos `pos_cash_movements` con el mismo `client_op_id` | **SÍ** — el índice único parcial lo impide, y su violación es la señal |
| **turno fantasma** | turno en caché/cola local sin fila en nube | **NO** — la cola vive en la terminal y no reporta |
| **comanda de KDS perdida** | `ORDER_SENT` sin `KDS_RECEIVED` | **NO** — no existe ack del KDS |
| **impresión perdida** | `print_job` sin `printed_at` pasado el umbral | **PARCIAL** — `pos_print_jobs.printed_at` existe; 0 escrituras desde 2026-09-04 |
| **cola atorada** | `sync_queue_size` creciente en heartbeats consecutivos | **NO** — 0 heartbeats |
| **reintento sin doble efecto** | mismo `client_op_id`, `attempt > 1`, un solo recibo | **NO** — `attempt` no existe en ningún lado |
| **divergencia local/nube** | `local_committed` sin `cloud_materialized` pasado el umbral | **NO** — `pos_local_events` en 0 |
| **acción sin recibo** | comando con efecto local y sin fila de recibo | **PARCIAL** — sólo en el dominio de órdenes |

**Una de nueve es detectable hoy.** Y no por instrumentación: por un índice único que convierte el
error en señal. Es el patrón barato y hay que repetirlo.

---

## 6 · Constitución de arquitectura — las diez casillas

Todo agente, release y field cert declara estas diez. **`UNKNOWN` se muestra como `UNKNOWN` y nunca
se promueve a `PASS`.**

| Casilla | Qué declara |
|---|---|
| `ARCHITECTURE_LAYER` | renderer · Pedro · API/proxy · Postgres · CI |
| `AUTHORITY` | quién manda sobre ese dato: LAN, nube, o ninguno |
| `OPERATION_IDENTITY` | qué identifica la operación y quién la genera |
| `ATOMICITY` | qué entra en la misma transacción y qué no |
| `RETRY_SEMANTICS` | qué pasa al reintentar, y qué garantiza que no se duplique |
| `OFFLINE_BEHAVIOR` | qué hace sin WAN, y qué hace sin LAN |
| `RECEIPT` | qué prueba que ocurrió. Un 200 no es un recibo |
| `BYPASS_PATHS` | qué otro camino llega al mismo efecto. **Casi siempre hay uno** |
| `OBSERVABILITY` | qué evidencia queda, y dónde |
| `AI_ROLE` | qué puede hacer un agente aquí, y en qué nivel |

---

## 7 · Qué se puede construir ya, y qué no

| | |
|---|---|
| **SAFE_TO_BUILD_NOW** | El índice del cerebro y los emisores que sólo leen: `field-cert-session`, `absence-watcher`, el emisor de release. Todos fuera del runtime de producto, todos sólo lectura. |
| **REQUIRES_PRODUCT_CHANGE** | `client_op_id` en `pos_orders`; `attempt` propagado; ack del KDS; `terminal_id` en filas de negocio. |
| **REQUIRES_PEDRO_CHANGE** | Encender el heartbeat (es configuración, PR #406 abierto); exponer `/sync/status` y `getUncertainJobs()` a la nube. |
| **REQUIRES_DB_CHANGE** | Columnas nullable de correlación. Ninguna urgente antes del release actual. |
| **REQUIRES_INFRA_CHANGE** | Un repositorio privado donde vivan los artefactos y corra CI. **Es el cuello de botella real.** |
| **BLOCKED** | Todo lo que dependa de `run.json` publicado: el arnés sigue sin mergear (PR #418). |

---

## 8 · Lo que este documento NO propone

- **Ningún servicio central.** Violaría el principio #7. El cerebro es un esquema de artefactos más
  un índice, no un proceso del que dependa el restaurante.
- **Ninguna base de datos nueva.** Postgres y los artefactos en git bastan hasta ~1 000 restaurantes.
- **Ningún agente en ejecución.** Ver `AGENT_SAFETY_POLICY.md`: todos nacen en L0/L1.
- **Ninguna reescritura de artefactos históricos.** Los ya emitidos quedan fijados a su SHA.
