# RELEASE BOARD — qué candidato existe y en qué estado

> **INTERNO — no publicar.** Contiene bloqueadores de release y estado de fallo vivo.
> Ver [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md) §4.
>
> **Corte:** 2026-09-18. Este tablero es una **foto**, no un documento vivo: cada línea lleva el SHA
> con el que se tomó. Si no coincide con `git rev-parse`, el tablero está viejo y gana el SHA.

---

## 1 · SHAs

| Clave | Valor | Estado |
|---|---|---|
| `MAIN_SHA` | `10017cf91a9c46db8bfbebe339d626111be0e868` | publicado · PR #417 mergeado 2026-09-15 |
| `GOLDEN_BASE_SHA` | `2f68beba` (`golden/candidate-20260914`) | publicado · base común del linaje |
| `CERT_RIG_SHA` | `7e6d77f0` (`cert/rig-v1-pr1`, **PR #418 OPEN**) → `9e6fe715` (`cert/rig-v1-pr2`) | pr1 publicado y sin mergear · pr2 publicado sólo para preservación |
| `CURRENT_P0A_CANDIDATE` | `bb0464268fc3721a4b3463d18324f9bda12b220b` (`p0a/append-idempotency`) | publicado sólo para preservación · **sin PR, a propósito** |

**Linaje verificado:** `golden/candidate-20260914` → `cert/rig-v1-pr1` → `cert/rig-v1-pr2`, lineal.
`p0a/append-idempotency` es **hermano** de `cert/rig-v1-pr2`, no descendiente: los dos salen de
`2f68beba`.

---

## 2 · ESTADO DE LOS TRACKS

| Track | Estado | Evidencia |
|---|---|---|
| `P0A_STATUS` | **FAIL en D2-E · en corrección por Fork** | Reportado por Daniel el 2026-09-18. **No verificable desde el repo:** ver §3 |
| `P0B_STATUS` | **CONTRATO ESCRITO · implementación NO autorizada** | `docs/architecture/OPERATION-IDENTITY-AND-RECEIPTS.md`, PR #422 abierto. `P0B_IMPLEMENTATION_ALLOWED = false` hasta `P0A_STATUS = PASS` |
| `P0C_STATUS` | **NO INICIADO** | La secuencia es `P0A → certificar → P0B → P0C`. Nada a la derecha empieza antes |

---

## 3 · LAS COMPUERTAS — y el problema de que no estén escritas

| Compuerta | Estado | Definición en el repo |
|---|---|---|
| `G01` | **DEFINIDA** — flujo de certificación parametrizado (categoría, producto, grupo de modificador, opción, mesa), con tenant prohibido `amalay` por omisión | `cert/rig-v1-pr2:dashboard-app/e2e/paridad/cert/objetivo-g01.mjs` |
| `D0` | **UNKNOWN** | — |
| `D1` | **UNKNOWN** | — |
| `D2_A` · `D2_B` · `D2_C` · `D2_D` | **UNKNOWN** | — |
| `D2_E` | **FAIL** (reportado) | — |

> **Hallazgo del tablero, y es el más importante de esta sección:** `D0`, `D1` y `D2_*` **no aparecen
> en ninguna rama del repositorio.** Se buscó en `cert/rig-v1-pr2`, `p0a/append-idempotency` y
> `golden/candidate-20260914`: cero coincidencias.
>
> Existen sólo en la conversación. Eso significa que **el criterio de aceptación de P0A no es
> auditable**: nadie fuera de la sesión puede decir qué se probó, qué pasó ni qué falta. Un `FAIL de
> D2-E` es hoy una afirmación sin documento detrás.
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
`STATIC FINDING ≠ PRODUCT DEFECT`. El `FAIL de D2-E` es de Fork y no está clasificado en el repo.

### 5.2 `OPEN_PRECONDITION_DRIFT` — 7 derivas de esquema

Detalle en [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md) §2. Resumen, por impacto sobre una corrida:

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
