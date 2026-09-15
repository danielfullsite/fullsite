# Evidence Contract v1

> El sobre que acompaña a todo veredicto de certificación. Un veredicto sin
> sobre es una opinión.

`run.json` es la fuente; `REPORT.md` es una proyección generada desde él. Nunca
se escribe el reporte a mano: si se redactara aparte, tarde o temprano diría
algo que el JSON no dice y no habría forma de saber cuál de los dos mintió.

## Las tres reglas duras

1. **`NOT_OBSERVED` nunca es `PASS`.** «No se pudo medir» no es «está bien». El
   tenant demo estuvo 14 días muerto con el CI en verde por tratar la ausencia
   de medición como conformidad.
2. **`PRODUCT_DEFECT` exige L0 verde y paso ejecutado.** Un arnés roto no tiene
   derecho a acusar al producto. El PIN de G01 se leyó como «el POS no deja
   entrar» cuando era la sonda tragándose la autenticación.
3. **Una mutación no aplicable cuenta como fallo.** Categoría vacía = nadie la
   está mirando, y su «cero diferencias» es trivialmente cierto.

## El modelo de correlación

`run_id` es la raíz y existe **antes** que cualquier orden. El journey arranca
en el PIN; ahí todavía no hay `save_operation_id` que usar como llave.

```
run_id = cert-g01-<YYYYMMDDTHHMMSSZ>-<6 hex>
  ├─ save_operation_id     (se enlaza al guardar)
  ├─ order_id
  ├─ turno_id
  └─ pedro_seq_inicial / pedro_seq_final
```

## Las seis clases

| Clase | Cuándo |
|---|---|
| `EXPECTED_BEHAVIOR` | el oráculo confirma la expectativa |
| `PRECONDITION_FAILURE` | una compuerta de L0 falló, o el dato no estaba sembrado |
| `ENVIRONMENT_ERROR` | Pedro, LAN, CDP, disco, dependencia ausente |
| `HARNESS_ERROR` | selector ausente, timeout del guion, paso desconocido |
| `NOT_OBSERVED` | el paso corrió y el oráculo **no se pudo leer** |
| `PRODUCT_DEFECT` | L0 verde + paso ejecutado + oráculo **contradice** |

Veredicto: `PASS` sólo si **todas** las observaciones son `EXPECTED_BEHAVIOR`.
Cualquier `PRECONDITION_FAILURE` domina y el veredicto es
`PRECONDITION_FAILURE`. No hay mayoría, ni ponderación, ni «100% con reservas».

## Secciones de `run.json`

| Sección | Qué sostiene |
|---|---|
| `contract_version` | `1.0` |
| `journey_id`, `journey_nombre` | qué se certificó |
| `run_id`, `started_at`, `finished_at` | la corrida |
| `verdict`, `verdict_razon` | `PASS` · `FAIL` · `PRECONDITION_FAILURE` |
| `identity` | el sello leído de Pedro `/identity` |
| `preconditions_satisfied` | booleano de L0 |
| `fixture` | semilla del laboratorio (PR2) |
| `driver` | `executed`, `steps_total`, `steps_ok` |
| `correlation` | el árbol de ids |
| `steps[]` | un registro por paso, con causa y evidencia |
| `oracles` | DB · Pedro · KDS · API (PR2) |
| `parity` | diferencias V1 vs V1 |
| `mutation` | `total`, `detected`, `no_aplicables`, `detalle` |
| `manifest_effects` | conteo por categoría |
| `observations[]` | **lo único que cuenta para el veredicto** |
| `summary` | conteo por clase |
| `artifacts_dir` | dónde quedaron screenshots y traza |

Nada entra al veredicto si no pasó por `observar()`.

## El validador

`validar(sobre)` devuelve las violaciones. Reglas V-1…V-11; las que importan:

| Regla | Rechaza |
|---|---|
| V-3 | `run_id` mal formado |
| V-5 | `correlation.run_id ≠ run_id` (árbol roto) |
| V-7 | `PASS` con cualquier observación no conforme |
| V-8 | `PASS` sin `driver.executed === true` |
| V-9 | `preconditions_satisfied=false` con veredicto distinto de `PRECONDITION_FAILURE` |
| V-10 | `PASS` sin 5/5 mutaciones, o con alguna no aplicable |
| V-11 | `PASS` con menos de 6/6 pasos |

`cert/probar-clasificacion.mjs` tiene **doce comprobaciones que exigen que el
validador RECHACE**. Un validador que sólo aprueba no valida.

## Identidad de build

No se reimplementa aquí. Pedro la calcula en
`electron-app/local-server/core/identidad-de-terminal.js` y la expone en
`/identity`. Las compuertas exigen:

```
app.git_sha == CERTIFICATION_RUN_SHA
ui.git_sha  == CERTIFICATION_RUN_SHA
app.clean   == true
coherente   == true
```

## Cómo se corre

```bash
npm run certify:selftest    # el arnés se prueba a sí mismo, sin sistema vivo
npm run lab:reset:g01       # siembra el laboratorio (PR2)
npm run certify:g01         # el veredicto
```

Variables: `CERTIFICATION_RUN_SHA`, `FULLSITE_PIN`, `FULLSITE_CDP`,
`CERT_BASE_URL`, `CERT_BRIDGE`, `CERT_CLIENT_ID`, `CERT_OUT`, y el objetivo
(`CERT_CATEGORY`, `CERT_PRODUCT`, `CERT_REQUIRED_MOD_GROUP`,
`CERT_MODIFIER_OPTION`, `CERT_MESA`).

El arnés **no maneja `SUPABASE_SERVICE_KEY`** ni ninguna credencial de servicio.
Lee HTTP de Pedro, `df` y `git`. El PIN entra por `FULLSITE_PIN` y no se imprime.
