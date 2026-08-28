# PR-12 — Métricas de latencia offline (POS→KDS→impresión, p50/p95)

## Qué entrega

El motor y el harness para medir latencia offline, sobre el harness soak/twin existente:

- `electron-app/local-server/telemetry/latency-metrics.js` — motor PURO (sin deps): registra
  muestras de `pos_to_kds`, `kds_to_print`, `pos_to_print`, cuenta desconexiones/reconexiones,
  y calcula **p50/p95/p99** por rango-más-cercano, determinista.
- `electron-app/local-server/telemetry/latency-harness.js` — lee un JSONL de muestras y emite el
  reporte en el formato de `soak-report.json` (bajo la llave `latency`). CLI + módulo.
- `electron-app/local-server/tests/latency-metrics.test.js` — 9 pruebas `node --test`.

## Sin inventar números

Los percentiles salen de **muestras reales**. Sin muestras, el resumen devuelve `count: 0` y
percentiles `null` — nunca 0 ni un valor plausible. El harness sobre un archivo ausente reporta
`sample_count: 0`. Reproducible: mismas muestras → mismo reporte (probado).

## Cómo se corre (reproducible)

```bash
# El soak/twin instrumentado escribe muestras.jsonl (una muestra por línea):
#   {"stage":"pos_to_print","ms":180}
#   {"event":"reconnect","gapMs":5300}
node electron-app/local-server/telemetry/latency-harness.js muestras.jsonl reporte.json
```

## Feature flag

`FACTORY_OFFLINE_METRICS=1` (env) enciende la recolección. Apagado (default) = cero overhead y
cero cambio de comportamiento.

## Dependencia declarada — el wiring en campo necesita instalador nuevo

Instrumentar el hot path de Pedro (`core/command-handler.js` al procesar el comando y hacer
broadcast; `core/ws-hub.js` en connect/disconnect; el encolado de impresión) **NO viaja por
Vercel: requiere INSTALADOR NUEVO y reinstalar en la caja** (regla dura de OFFLINE-LAN). Por eso
este PR entrega el motor + harness + el enganche opt-in (`recordStage`, `markDisconnect`,
`markReconnect`) **sin tocar el hot path**. Los tres puntos de enganche (una línea cada uno,
detrás del flag) van en un PR de local-server aparte, agrupado con el instalador.

## Desconexión/reconexión

El motor cuenta `disconnects`/`reconnects` y registra el hueco (`reconnect_gap`) como un tramo
más, con su p50/p95. El soak instrumentado emite `{"event":"disconnect"}` /
`{"event":"reconnect","gapMs":N}` en el JSONL.

## Rollback

`git revert`. Son archivos nuevos bajo `telemetry/` + un test; nada del hot path se toca, así
que revertir no cambia el comportamiento de Pedro.

## Dependencias

Consume el envelope de PR-0 (#197) sólo conceptualmente (tenant+location+device+shift viajarían
en las muestras si se quiere desglosar por sucursal). No depende de #195 ni de otros PRs del lote.
