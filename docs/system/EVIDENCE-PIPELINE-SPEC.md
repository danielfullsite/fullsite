# EVIDENCE PIPELINE — spec de diseño

> **INTERNO.** §1, §2 y §5 son diseño sin implementar. **§3 sí se construyó y corrió en seco**:
> `tools/schema-drift/`, con autoprueba 11/11 y artefacto real contra la base.
> **Fecha:** 2026-09-18 · `origin/main` = `10017cf9` · arnés leído en `cert/rig-v1-pr2` (`9e6fe715`).
>
> Cubre cuatro piezas que tienen que existir antes de que el tablero de release signifique algo: el
> **artefacto de resultado**, el **tablero derivado**, el **oráculo de check** y el **guardián de
> deriva de migraciones** — este último ya corrió en seco (§3).

---

## 0 · La evidencia que motiva todo esto

El 2026-09-18, a las pocas horas de escribir [`RELEASE-BOARD.md`](RELEASE-BOARD.md), ya estaba
equivocado: decía `P0A = FAIL por D2-E` y Fork reportó `D2-E = PASS`, `D2-A = PASS`, `D2-D = PASS`,
`D2-B` y `D2-C` sin correr, con un candidato nuevo (`8d8c20d8`, rama `p0a/recepcion-transaccional`,
que sí existe y está publicada).

**No es un error del tablero: es la propiedad de cualquier tablero mantenido a mano.** La conclusión
de diseño es una sola:

> **El tablero no puede ser autoridad. Tiene que ser una proyección de un artefacto que produce la
> corrida.** Un agente no debe poder cambiar un `PASS` editando Markdown.

El arnés ya tomó esta decisión para su propio reporte: *«`run.json` es la fuente; `REPORT.md` es una
proyección generada desde él. Nunca se escribe el reporte a mano: si se redactara aparte, tarde o
temprano diría algo que el JSON no dice y no habría forma de saber cuál de los dos mintió.»*
Lo único que falta es **subir esa misma regla un nivel**, del journey al track.

---

## 1 · ARTEFACTO DE RESULTADO — extensión, no invención

`run.json` ya existe con `contract_version 1.0`, sus secciones, sus seis clases y su validador
`V-1…V-11`. **No se diseña un esquema nuevo.** Lo que falta es una capa de compuertas por encima del
journey.

### 1.1 Qué se agrega en `contract_version 1.1`

```jsonc
{
  "contract_version": "1.1",

  // ── NUEVO: identidad del track, no del journey ──────────────────────
  "track": "P0A",
  "p0a_contract_version": "1.0",          // el contrato que se está certificando
  "candidate_sha": "<40 hex>",            // == CERTIFICATION_TARGET_SHA de L0
  "rig_sha": "<40 hex>",                  // el SHA del arnés que corrió
  "tenant_class": "CERT",                 // CERT | SANDBOX | PROD. Nunca el slug del cliente
  "amalay_writes": 0,                     // invariante dura: si no es 0, el veredicto es inválido

  // ── NUEVO: una entrada por compuerta ────────────────────────────────
  "gates": {
    "D0":   { "state": "PASS",       "run_id": "cert-…", "observations": 6, "reason": null },
    "D2_B": { "state": "NOT_RUN",    "run_id": null,     "observations": 0,
              "reason": "sin definición escrita en P0A-CONTRACT-v1" }
  },

  // ── YA EXISTEN en 1.0, se conservan tal cual ────────────────────────
  "run_id": "…", "started_at": "…", "finished_at": "…",
  "identity": { }, "preconditions_satisfied": true,
  "correlation": { }, "steps": [ ], "oracles": { },
  "parity": { }, "mutation": { }, "manifest_effects": { },
  "observations": [ ], "summary": { }, "artifacts_dir": "…",

  "findings": [ ],                         // NUEVO: hallazgos clasificados, sin payloads
  "final_verdict": "INCOMPLETE"            // NUEVO: veredicto del TRACK
}
```

### 1.2 Estados de compuerta — alineados con lo que ya existe

El arnés distingue dos niveles y hay que respetarlos: **veredicto** (`PASS` · `FAIL` ·
`PRECONDITION_FAILURE`) y **clase de observación** (las seis). Los estados de compuerta que se
pidieron mezclan los dos niveles. La alineación limpia:

| Estado de compuerta | De dónde sale | Regla |
|---|---|---|
| `PASS` | veredicto de la corrida | **todas** las observaciones `EXPECTED_BEHAVIOR` |
| `FAIL` | veredicto | ≥1 observación `PRODUCT_DEFECT` |
| `NOT_RUN` | no hubo corrida | ya usado por el arnés cuando falta el paso productor |
| `NOT_OBSERVED` | clase dominante | el paso corrió y el oráculo no se pudo leer. **Nunca promueve a `PASS`** |
| `PRECONDITION_FAILURE` | clase dominante | L0 falló o el dato no estaba sembrado. **Domina sobre todo lo demás** |
| `ENVIRONMENT_ERROR` | clase dominante | Pedro, LAN, CDP, disco, dependencia ausente |
| `HARNESS_ERROR` | clase dominante | selector ausente, timeout, paso desconocido |

**Precedencia, de mayor a menor:** `PRECONDITION_FAILURE` > `ENVIRONMENT_ERROR` > `HARNESS_ERROR` >
`NOT_OBSERVED` > `FAIL` > `PASS`. Es la regla que el arnés ya aplica dentro de una corrida, aplicada
ahora entre compuertas.

**Veredicto del track:** `PASS` sólo si **todas** las compuertas del contrato están en `PASS`.
Si alguna está en `NOT_RUN` y ninguna falló → `INCOMPLETE`. Cualquier otra cosa → el estado de mayor
precedencia.

### 1.3 Qué NUNCA entra al artefacto

Tokens · PINs · `SUPABASE_SERVICE_KEY` · cookies · payloads crudos de negocio · nombres de clientes ·
nombres de empleados · el slug del tenant real. El arnés ya tiene la disciplina: *«no maneja
`SUPABASE_SERVICE_KEY` ni ninguna credencial de servicio… el PIN entra por `FULLSITE_PIN` y no se
imprime.»* El artefacto hereda esa regla y añade `tenant_class` en vez del slug.

**`findings[]`** lleva `{gate, class, summary, evidence_ref}` — una referencia a `artifacts_dir`,
nunca el contenido.

---

## 2 · TABLERO DERIVADO

### 2.1 La cadena de autoridad

```
P0A-CONTRACT-v<N>        ← qué se certifica        (público, versionado)
      +
candidate_sha            ← qué código
      +
rig_sha                  ← con qué arnés
      +
run.json (1.1)           ← qué pasó                (artefacto, no editable)
      ↓
   RELEASE-BOARD.md      ← proyección generada     (interno, NO editable a mano)
```

### 2.2 Las reglas

1. **`RELEASE-BOARD.md` se genera.** Lleva en la cabecera el hash del artefacto del que salió.
2. **Un `PASS` no se puede escribir a mano.** Si alguien edita el Markdown, el hash de cabecera deja
   de cuadrar y el documento se marca como no confiable.
3. **Un tablero sin artefacto no es un tablero**, es una nota. Se permite —hay que poder anotar algo
   antes de que exista el pipeline— pero se marca `SIN ARTEFACTO` en la cabecera.
4. **El tablero nunca inventa una compuerta.** Sólo proyecta las que el contrato define. Una
   compuerta que el contrato no define aparece como `UNKNOWN`, no como fila ausente.

### 2.3 Qué pasa con el tablero de hoy

`RELEASE-BOARD.md` lleva `RELEASE_BOARD_AUTHORITY = MANUAL_SNAPSHOT / SIN_ARTEFACTO_COMPLETO` en la
cabecera y una hora de corte, no sólo una fecha. Se actualizó a mano una segunda vez el mismo día
—SHAs nuevos y resultados reportados por Fork— y **eso es exactamente la razón por la que no puede
ser autoridad**. Se reemplaza por una proyección generada cuando exista el artefacto, no antes.

Regla provisional mientras tanto: **el tablero registra lo que Fork reporta, marcado como
reportado, nunca como verificado.** Un `PASS` sin `run.json` publicado y sin definición de compuerta
es una afirmación, no una certificación.

---

## 3 · GUARDIÁN DE DERIVA DE MIGRACIONES — spec

**Sólo lectura. No corrige nada.**

### 3.1 Las tres fuentes

| | Fuente | Cómo se lee |
|---|---|---|
| **A** | archivos en `supabase/migrations/` de `origin/main` | `git ls-tree` — nunca el working tree |
| **B** | ledger `supabase_migrations.schema_migrations` | `SELECT version, name` |
| **C** | objetos reales de PostgreSQL | `information_schema`, `pg_class`, `pg_proc`, `pg_index` |

**La lección que obliga a las tres:** `FILE ≠ LEDGER ≠ EFFECT`. Se encontraron los tres desacuerdos
posibles el mismo día (§4 de [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md)).

### 3.2 Estados

| Estado | A | B | C | Significa |
|---|:--:|:--:|:--:|---|
| `MATCH` | ✓ | ✓ | ✓ | lo normal |
| `FILE_ONLY` | ✓ | ✗ | ✗ | escrita y no aplicada. Puede ser correcto (`PENDIENTE_`) o ser deuda |
| `LEDGER_ONLY` | ✗ | ✓ | ✗ | registrada sin efecto: **corrupción del ledger** |
| `EFFECT_ONLY` | ✗ | ✗ | ✓ | objeto en la base sin origen conocido |
| `FILE_AND_EFFECT_NO_LEDGER` | ✓ | ✗ | ✓ | **la deriva D-01**: aplicada por fuera del mecanismo |
| `LEDGER_AND_EFFECT_NO_FILE` | ✗ | ✓ | ✓ | aplicada desde otra fuente; el repo no la gobierna |
| `MISMATCH` | ✓ | ✓ | parcial | registrada pero el efecto no corresponde al archivo |
| `UNKNOWN` | — | — | — | el archivo no declara un objeto verificable |

### 3.3 La regla que lo hace útil

> **El guardián no puede concluir que una migración está aplicada porque el archivo exista o porque
> el ledger tenga una fila. Sólo la introspección de C decide.**

Para cada archivo, el guardián extrae los objetos verificables —tablas, funciones, vistas, índices,
columnas— y comprueba **el efecto**, no el nombre. Un archivo cuyo efecto no se puede expresar como
objeto (sólo `GRANT`, sólo `UPDATE` de datos) se reporta `UNKNOWN`, **nunca `MATCH`**.

### 3.4 Alcance mínimo de la primera versión

No hace falta cubrir 44 archivos para que sirva. La lista corta de objetos cuya ausencia ya causó
daño:

```
columnas   pos_turnos.location_id · client_locations.timezone
           pos_cash_movements.client_op_id · pos_audit_log.client_op_id
           pos_staff.pin_hash
índices    un turno abierto por restaurante
           pos_*_client_op_id (los tres parciales)
           pos_inventory_movement_operation_line
funciones  r1_save_order_idempotent · pos_record_inventory_movement
           r1_transfer_item_atomic · pos_scoped_upsert · pos_scoped_child
tablas     pos_terminals · pos_save_operations
           pos_inventory_movement_operations · pos_transfer_operations
```

### 3.5 Cómo se comporta

- Corre en CI, sólo lectura, con credencial de sólo lectura.
- **Falla el build ante `LEDGER_ONLY` o `MISMATCH`** — son corrupción.
- **Avisa sin fallar ante `FILE_AND_EFFECT_NO_LEDGER` y `EFFECT_ONLY`** — pueden ser una corrida de
  certificación legítima, como D-01.
- **Nunca falla por `FILE_ONLY`** — un `PENDIENTE_` sin aplicar es el estado correcto.
- **Alerta por ausencia**: si el guardián deja de reportar, eso es una falla. Una flota que no
  reporta se ve idéntica a una flota sana, y ya costó meses de telemetría muerta.
- **Nunca escribe.** Ni al ledger, ni al esquema, ni a los archivos.

---

## 4 · SEPARACIÓN PÚBLICO / PRIVADO

### 4.1 Repositorio público — `danielfullsite/fullsite`

Código de producto · contratos de arquitectura · **el contrato de certificación** ·
**el arnés de certificación** · definiciones de prueba no sensibles · `COMO-FUNCIONA-TODO.md`.

### 4.2 Repositorio privado — propuesto `danielfullsite/fullsite-internal`

Estado de release vivo · topología de clientes con nombre · evidencia de runtime y actas de corrida ·
incidentes · runbooks · reportes de deriva de migraciones · el mapa operativo interno ·
inteligencia comercial y de precios.

### 4.3 Las excepciones, que son las interesantes

| Caso | Dónde va | Por qué |
|---|---|---|
| **El contrato de certificación** | **público**, aunque gobierne un proceso interno | Describe qué se certifica, no qué está roto. Publicarlo es lo que impide que cada sesión invente compuertas nuevas |
| **El arnés** | **público** | No maneja credenciales de servicio y trae lista de tenants prohibidos. Es prueba de rigor |
| **`run.json`** | **privado** | Aunque no lleve secretos: lleva estado de fallo vivo y el SHA del candidato bajo prueba |
| **Políticas de seguridad** | **ya públicas**, se quedan | Las 13 están en `main` desde antes. Revertirlo no recupera nada; conviene volver explícita la decisión |
| **Postmortems** | **privado mientras el fallo viva**, público al cerrarlo | Un postmortem con la vulnerabilidad abierta es una guía de explotación |
| **Definiciones de compuerta** | **público** | Si una compuerta no se puede escribir sin nombrar a AMALAY, está mal planteada. Es el criterio que el propio `objetivo-g01.mjs` ya aplicó al quitar `HUMMUS` |

### 4.4 La tensión que hay que nombrar

Un repositorio privado nuevo resuelve la exposición y **no** resuelve el respaldo por sí solo: hay
que empujar a él. Los tres documentos de `docs/system/` llevan hoy horas existiendo sólo en un
disco sin Time Machine. **La preservación es urgente; la publicación no lo es.**

---

## 5 · ORÁCULO DE CHECK — el `echo` que mintió

### 5.1 El error real

```bash
npx tsc --noEmit
echo "TSC ok"
```

En una shell, `echo` corre **pase lo que pase** con el comando anterior. `tsc` puede salir con
código 2 y la línea siguiente imprime `TSC ok`. Quien lee la salida —una persona o un agente— ve la
palabra «ok» y la toma como resultado.

> **La regla: un mensaje producido por el arnés nunca es evidencia de que el comando anterior pasó.**
> La evidencia del comando la produce el comando: su código de salida.

Es la misma familia que las tres reglas duras del arnés de certificación: `NOT_OBSERVED` no es
`PASS`, y un 200 vacío no es un recibo. Aquí la variante es peor, porque el arnés **fabrica** la
apariencia de conformidad en vez de sólo no medirla.

### 5.2 Qué se guarda de cada check

Nunca la conclusión. Siempre la medición:

```jsonc
{
  "id": "typescript",
  "command": ["npx", "tsc", "--noEmit"],   // argv, no una cadena de shell
  "exit_code": 2,
  "stdout_sha256": "<64 hex>",
  "stderr_sha256": "<64 hex>",
  "started_at": "2026-09-18T21:40:00.000Z",
  "finished_at": "2026-09-18T21:40:37.412Z",
  "duration_ms": 37412,
  "oracle": "exit_code === 0",
  "state": "FAIL"
}
```

- **`command` es un arreglo**, no una cadena. Sin shell no hay `&&`, `;` ni `echo` que se cuelen.
- **Se guarda el hash de la salida, no la salida.** El hash prueba que no cambió y no arrastra rutas
  locales ni nombres de archivo a un artefacto que puede acabar publicado. La salida completa vive en
  `artifacts_dir`, junto a la traza.
- **`oracle` es explícito y se guarda.** Quien lea el artefacto dentro de un año sabe qué se
  consideró aprobar.
- **`state` lo deriva el pipeline del oráculo**, nunca del texto de la salida.

### 5.3 El oráculo por tipo de check

| Check | Oráculo | Lo que NO cuenta |
|---|---|---|
| TypeScript | `exit_code === 0` | que la salida no diga «error»; que un `echo` posterior diga «ok» |
| ESLint | `exit_code === 0` **contra la línea base acordada** | conteo de advertencias |
| Pruebas | `exit_code === 0` **y** aprobadas ≥ total esperado | «no arrojó error» |
| Build | `exit_code === 0` **y** el artefacto existe en disco | que el log termine sin excepción |
| Guardián de esquema | `summary.blocking === 0` | que el comando no truene |
| Certificación | `verdict === 'PASS'` en `run.json` | el `REPORT.md`, que es proyección |

### 5.4 La regla general, que aplica más allá de `tsc`

> **Un check sin `exit_code` guardado es `NOT_OBSERVED`, no `PASS`.**

Y su corolario, que es lo que hace falta para que esto no se repita: **ningún paso del pipeline se
compone con `&&` o `;` en una cadena de shell.** Cada comando se ejecuta por separado, con su argv,
y su resultado se registra antes de decidir si hay siguiente paso.
