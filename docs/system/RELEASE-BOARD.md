# RELEASE BOARD — qué candidato existe y en qué estado

> **INTERNO — no publicar.** Contiene bloqueadores de release y estado de fallo vivo.
> Ver [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md) §4.
>
> **Corte:** 2026-09-18, **21:30** (segunda foto del día). Este tablero es una **foto**, no un
> documento vivo: cada línea lleva el SHA con el que se tomó. Si no coincide con `git rev-parse`, el
> tablero está viejo y gana el SHA.
>
> ```
> RELEASE_BOARD_AUTHORITY = MANUAL_SNAPSHOT / SIN_ARTEFACTO_COMPLETO
> ```
>
> **Este documento NO es fuente de verdad.** La primera foto de hoy quedó obsoleta en horas: decía
> `P0A = FAIL por D2-E` y para la tarde ya era `PASS` con dos candidatos nuevos. No fue un error del
> tablero, es la propiedad de cualquier tablero mantenido a mano. La autoridad futura está en
> [`EVIDENCE-PIPELINE-SPEC.md`](EVIDENCE-PIPELINE-SPEC.md) §2: contrato + `candidate_sha` + `rig_sha`
> + `run.json` → tablero **generado**. Hasta que exista ese artefacto, esto es una nota fechada.

---

## 1 · SHAs

| Clave | Valor | Estado |
|---|---|---|
| `MAIN_SHA` | `10017cf91a9c46db8bfbebe339d626111be0e868` | publicado · PR #417 mergeado 2026-09-15 |
| `GOLDEN_BASE_SHA` | `2f68beba` (`golden/candidate-20260914`) | publicado · base común del linaje |
| `CERT_RIG_SHA` | `7e6d77f0` (`cert/rig-v1-pr1`, **PR #418 OPEN**) → `9e6fe715` (`cert/rig-v1-pr2`) | pr1 publicado y sin mergear · pr2 publicado sólo para preservación |
| **`P0A_FINAL_SHA`** | **`8d8c20d832a9be1f4bb78edaf917d2dfc3861d85`** (`p0a/recepcion-transaccional`) | **el SHA certificado de P0A.** Publicado por Fork |
| **`CURRENT_INTEGRATION_HEAD`** | **`21d66e413663b4e78d244d5c6fcc7c8a521897c5`** (`p0a/recepcion-sin-fail-open`) | hijo **directo** de `8d8c20d8`, verificado con `git rev-parse ^`. Cierra el fail-open de recepción. **NO es todavía `FINAL_RELEASE_CANDIDATE`** |
| `p0a/append-idempotency` | `bb0464268fc3721a4b3463d18324f9bda12b220b` | ancestro de los dos anteriores · publicado para preservación, sin PR |

**Linaje verificado con `git`:**

```
golden/candidate-20260914 (2f68beba)
   ├── cert/rig-v1-pr1 (7e6d77f0, PR #418) ── cert/rig-v1-pr2 (9e6fe715)
   └── p0a/append-idempotency (bb046426)
          └── 8d8c20d8   ← P0A_FINAL_SHA, certificado
                 └── 21d66e4   ← CURRENT_INTEGRATION_HEAD
```

`p0a/append-idempotency` es **hermano** de `cert/rig-v1-pr2`, no descendiente.

---

## 2 · ESTADO DE LOS TRACKS

| Track | Estado | Evidencia |
|---|---|---|
| `P0A_STATUS` | **PASS** sobre `8d8c20d8` | Reportado por Fork el 2026-09-18. **No verificable desde el repo:** no hay `run.json` publicado y las compuertas no tienen definición — §3 |
| `P0_PO_RECEPTION_FAIL_OPEN` | **CLOSED** en `21d66e4` | El commit existe y trae `recepcion-oc-sin-fail-open.test.ts` (+204). **No se leyó ni se evaluó**: es territorio de Fork |
| `PO_CHILD_POST_409_RACE` | **UNKNOWN** · `OWNER = FORK` | **No investigado, no reproducido, sin hipótesis.** Se registra y nada más, hasta que Fork lo cierre |
| `P0B_STATUS` | **CONTRATO ESCRITO · implementación NO autorizada** | `docs/architecture/OPERATION-IDENTITY-AND-RECEIPTS.md`, PR #422 abierto. `P0B_IMPLEMENTATION_ALLOWED = false` hasta `P0A_STATUS = PASS` |
| `P0C_STATUS` | **NO INICIADO** | La secuencia es `P0A → certificar → P0B → P0C`. Nada a la derecha empieza antes |

---

## 3 · LAS COMPUERTAS — y el problema de que no estén escritas

| Compuerta | Resultado reportado | `GATE_DEFINITION_SOURCE` |
|---|---|---|
| `G01` | — | **`cert/rig-v1-pr2:.../cert/objetivo-g01.mjs`** — la única definida |
| `D0` | no reportado | **`MISSING`** |
| `D1` | no reportado | **`MISSING`** |
| `D2-A` | **PASS** | **`MISSING`** |
| `D2-B` | **NOT_RUN** | **`MISSING`** |
| `D2-C` | **NOT_RUN** | **`MISSING`** |
| `D2-D` | **PASS** | **`MISSING`** |
| `D2-E` | **PASS** — oráculo de negocio observado | **`MISSING`** |

**Los resultados son de Fork; las definiciones no existen.** Se registran como reportados, no como
verificados: sin definición escrita, un `PASS` no se puede volver a correr.

> **Hallazgo del tablero, y es el más importante de esta sección:** `D0`, `D1` y `D2-*` **no aparecen
> en ninguna rama del repositorio.** Se barrieron las ~420 referencias (`refs/heads` + `refs/remotes`)
> y el disco del proyecto: **cero coincidencias fuera de los documentos escritos en esta sesión para
> señalar su ausencia**.
>
> Existen sólo en la conversación. Eso significa que **el criterio de aceptación de P0A no es
> auditable**: nadie fuera de la sesión puede decir qué se probó, qué pasó ni qué falta. Hoy hay tres
> `PASS` reportados sobre compuertas sin documento detrás.
>
> **Acción recomendada (no ejecutada):** que Fork escriba la definición de D0–D2_E en
> `dashboard-app/e2e/paridad/cert/`, junto a `CONTRATO-v1.md`, antes de declarar `PASS`. Una
> compuerta que no está escrita no se puede volver a correr.

---

## 4 · CLASIFICACIÓN DE HALLAZGOS

El rig ya define seis clases, y son las que manda usar
(`cert/rig-v1-pr2:.../cert/CONTRATO-v1.md`). Se adoptan tal cual:

| Clase | Cuándo |
|---|---|
| `EXPECTED_BEHAVIOR` | el oráculo confirma la expectativa |
| `PRECONDITION_FAILURE` | una compuerta de L0 falló, o el dato no estaba sembrado |
| `ENVIRONMENT_ERROR` | Pedro, LAN, CDP, disco, dependencia ausente |
| `HARNESS_ERROR` | selector ausente, timeout del guion, paso desconocido |
| `NOT_OBSERVED` | el paso corrió y el oráculo **no se pudo leer** |
| `PRODUCT_DEFECT` | L0 verde + paso ejecutado + oráculo **contradice** |

**La regla de veredicto:** `PASS` sólo si **todas** las observaciones son `EXPECTED_BEHAVIOR`.
Cualquier `PRECONDITION_FAILURE` domina. **No hay mayoría, ni ponderación, ni «100 % con reservas».**

`UNKNOWN` no es una clase del rig: es lo que se dice cuando ni siquiera se sabe en qué clase cae.

---

## 5 · TABLERO DE ABIERTOS

### 5.1 `OPEN_PRODUCT_DEFECTS`

**Ninguno confirmado por este track.** Ningún hallazgo de esta sesión se reprodujo en runtime, y
`STATIC FINDING ≠ PRODUCT DEFECT`.

`PO_CHILD_POST_409_RACE` está **abierto y es de Fork**. Este track no lo investigó, no lo reprodujo,
no leyó resultados intermedios y no propone arreglo. `STATUS = UNKNOWN · OWNER = FORK`.

### 5.2 `OPEN_PRECONDITION_DRIFT` — 14 objetos en deriva

**Ahora medido, no estimado.** El guardián corrió en seco contra el repo (`21d66e4`), el ledger
(54 filas) y la introspección real: `tools/schema-drift/drift-report.json`. Resultado:
**0 bloqueantes · 14 avisos · 15 correctos**, sobre 29 objetos verificados.

| Estado | Objetos | Qué significa |
|---|---:|---|
| `FILE_AND_EFFECT_NO_LEDGER` | **7** | las 3 columnas y los 3 índices de P0A, más `pos_scoped_child`: vivos en la base, sin fila en el ledger |
| `FILE_ONLY` sin `PENDIENTE_` | **7** | migraciones que alguien esperaba aplicadas y no lo están: `client_locations.timezone`, `pos_turnos.location_id`/`status`, dos índices de turno, `pos_terminals`, `pos_terminal_enrollments` |
| `FILE_ONLY` con `PENDIENTE_` | 6 | correcto: pendiente por diseño |
| `MATCH` | 9 | archivo + ledger + efecto |

Detalle narrativo en [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md) §2. Por impacto sobre una corrida:

| # | Deriva | Clase probable si tumba una prueba |
|---|---|---|
| **D-01** | DDL de P0A aplicado en AMALAY sin registrar | `PRECONDITION_FAILURE` — el entorno no es el que el repo describe |
| **D-03** | `client_locations.timezone` no existe y el código la lee | `PRECONDITION_FAILURE` / `ENVIRONMENT_ERROR` — día de venta y cortes en zona equivocada |
| **D-04** | `pos_turnos.location_id` no existe | `PRECONDITION_FAILURE` — es la causa raíz del incidente del 2026-08-31 |
| **D-05** | Sin índice de «un turno abierto por restaurante» | `PRECONDITION_FAILURE` — turnos duplicados posibles |
| **D-06** | `pos_terminals` no existe, y está en el `ALLOW` del proxy | `ENVIRONMENT_ERROR` — no hay registro de terminal en la nube |
| **D-02** | `pos_scoped_child` viva, su hermana `pos_scoped_upsert` no | `HARNESS_ERROR` o `ENVIRONMENT_ERROR` según el paso |
| **D-07** | `tenant_provisioning_atomic` aplicada pero el archivo sigue `PENDIENTE_` | riesgo de lectura, no de corrida |

**Ninguna de estas siete se corrigió.** Este track es de sólo lectura.

### 5.3 `OPEN_UNKNOWN_RUNTIME_FINDINGS`

| # | Hallazgo estático | Se resuelve | Si sale mal |
|---|---|---|---|
| **U1** | `pos_save_operations` —el libro de recibos— es escribible por el proxy con cualquier rol | POST autenticado en **staging** | Supresión silenciosa de órdenes. Sube a P0 |
| **U2** | `PATCH` REST a `pos_inventory` con rol gerente salta el RPC | `PATCH` en staging | `INV-07` roto en inventario, confirmado |
| **U3** | Ventana máxima real de replay en campo | Antigüedad de la cola en una terminal real | Fija la retención de recibos |
| **U4** | ¿Existe un hecho que dos terminales puedan originar en AMALAY? | Recorrer flujos con Eduardo | Decide si la familia `BUSINESS_FACT` es urgente |
| **U5** | ¿Quién aplicó el DDL de P0A fuera del mecanismo de migraciones? | Preguntar | Si el esquema puede adelantarse sin rastro, ninguna auditoría vale |

**Ninguna se probó. Ninguna se prueba en AMALAY.**

---

## 6 · PRs ABIERTOS RELEVANTES AL RELEASE

| PR | Rama | Desde | Qué bloquea |
|---|---|---|---|
| **#418** | `cert/rig-v1-pr1` | 2026-09-15 | El rig de certificación etapa 1. Sin él, no hay acta reproducible |
| **#406** | `fix/telemetria-que-se-oye` | 2026-09-14 | Que el apagón de flota se pueda oír. Mientras siga abierto, `local_server_heartbeats` sigue en 0 |
| **#422** | `docs/operation-identity-contract` | 2026-09-18 | Ninguno: es el contrato, sólo documentación |
| **#420 · #421** | investigación | 2026-09-18 | Ninguno: preservación |

`cert/rig-v1-pr2` y `p0a/append-idempotency` están **publicadas sin PR**, a propósito: preservación,
no propuesta de merge.

---

## 7 · CÓMO SE ACTUALIZA ESTE TABLERO

1. Se vuelve a tomar la foto con los SHAs del día. **Nunca se edita una línea sin cambiar su SHA.**
2. Un estado sólo cambia con evidencia citable: un acta del rig, una consulta a la base, un SHA.
3. `PASS` no se escribe sin acta. `NOT_OBSERVED` nunca se promueve a `PASS`.
4. Una compuerta sin definición escrita se reporta `UNKNOWN`, aunque alguien sepa su estado de
   memoria. §3.
