# La curva intradía está construida y apagada

**Medido el 2026-08-26.** Salió de minar las sesiones de Codex de tu máquina — 9 días,
756 MB, que hasta hoy nadie había leído salvo la del 23-24 de agosto.

---

## La decisión, textual, del 2026-08-10

> *"Apruebo la dirección arquitectónica de `ops_daily` y la decisión de no revivir event
> store ahorita, pero **NO crees la tabla todavía**. Hay 4 problemas que quiero corregir en
> el diseño mínimo.*
>
> *1. Tu PK actual hace que cada intraday UPSERT reemplace el snapshot anterior. Eso
> significa que correr cada 15 minutos no conserva la curva intradía histórica.*
>
> ***Quiero conservar cada snapshot.** Son ~56 filas/día por restaurante, costo
> irrelevante, y esos puntos nos permitirán **reemplazar después el `HOURLY_DISTRIBUTION`
> hardcoded de close-predictor por curvas reales de Fullsite**."*

Daniel también cachó un error de SQL en el esquema propuesto: PostgreSQL no admite
`COALESCE(bucket_start, …)` dentro de una PRIMARY KEY declarativa.

Nada de esto estaba en `docs/`. Vivía en un rollout de Codex.

---

## Qué se construyó — todo

| | |
|---|---|
| `ops_daily.bucket_start` | ✅ existe, y el `record_type` distingue `snapshot` de `cierre` |
| `.github/scripts/pos_intraday_snapshot.py` | ✅ existe |
| `close_predictor.build_snapshot_distribution()` | ✅ existe — arma la curva desde snapshots reales |
| `HOURLY_DISTRIBUTION` como **respaldo** | ✅ el hardcode dejó de ser la fuente primaria |

El código hace exactamente lo que la decisión pedía. `build_snapshot_distribution` devuelve
`None` con menos de 2 snapshots, y ahí es donde el predictor cae a la curva fija.

---

## Qué está corriendo — nada

```sql
select record_type, count(*), min(fecha), max(fecha) from ops_daily group by record_type;
```

| `record_type` | Filas | Rango |
|---|---:|---|
| `cierre_wansoft` | 915 | 2024-01-02 → 2026-07-10 |
| `cierre` | 365 | 2025-08-14 → 2026-08-13 |
| **`snapshot`** | **2** | **2026-07-12 → 2026-07-12** |

El diseño pedía **~56 filas al día por restaurante**. Hay **dos**, del mismo día, de hace
seis semanas.

### Por qué — y no es un bug

`.github/workflows/pos-intraday-snapshot.yml` figura como **`active`** en GitHub, pero su
agenda está comentada, y el propio archivo dice por qué:

```yaml
# ACTIVATION STATUS: MANUAL ONLY
# Schedule lines are commented out until controlled activation review.
# To activate: uncomment the schedule block and commit.
```

Y `POS Daily Aggregator` está **`disabled_manually`** — apagado a propósito, junto con otros
16 workflows, casi todos del bloque Wansoft que se retiró en julio.

**Nada se rompió. Todo fue una decisión.** Lo que no quedó registrado es la consecuencia:
desde el 2026-07-13, `close_predictor` predice el cierre del día con una curva escrita a
mano — que es exactamente lo que la decisión del 10 de agosto quería eliminar.

---

## Lo que hay que decidir antes de encenderlo

**No es sólo descomentar.** El propio archivo señala el problema, y es el de siempre:

```yaml
#   # AMALAY-specific: 10:00 AM - 10:45 PM America/Monterrey (UTC-6)
#   # For additional tenants, either:
#   #   A. Add tenant-specific cron lines, or
#   #   B. Migrate to neutral cadence (*/15 * * * *) with per-client
```

La agenda está escrita **para el horario de AMALAY**. Encenderla así hornea un cliente en
la infraestructura, que es justo lo que CLAUDE.md §12 prohíbe: *"una solución para AMALAY
debe poder configurarse para otro restaurante sin modificar código"*.

Con `lab-resto` y `demo` produciendo órdenes todos los días, la opción B —cadencia neutra
cada 15 min, y que cada cliente declare su horario— ya no es teórica.

> **Costo de dejarlo apagado:** el predictor de cierre sigue adivinando con una curva
> inventada mientras existe el mecanismo para usar la real. No rompe nada; simplemente
> predice peor de lo que podría, y nadie lo nota porque falla en silencio hacia el respaldo.

---

## El patrón, que es lo que más vale

Tercera vez en el mismo día:

| | Construido | Encendido |
|---|---|---|
| `KITCHEN_TOKEN_SECRET` | ✅ los dos lados | ❌ |
| Protocolo `F5-28` (órdenes en Supabase) | ✅ correcto desde julio | ❌ la prueba de campo no lo usó |
| Curva intradía real | ✅ script + consumidor | ❌ agenda comentada |

> **La pregunta que hay que hacerle a este repo no es "¿está implementado?" sino
> "¿está corriendo?".** Las tres cosas de arriba pasan la primera y fallan la segunda, y
> desde el código se ven idénticas a algo que funciona.

---

## Cómo se midió

```bash
# los mensajes de Daniel en las sesiones de Codex, en streaming
python3 - <<'PY'   # ~/.codex/sessions/2026/08/*/*.jsonl → response_item, role=user
PY

# estado real de los workflows agendados
gh workflow list --all --limit 60          # active vs disabled_manually
gh run list --workflow=<archivo> --limit 1 # última corrida real
```

Las 9 sesiones dieron **7,309 mensajes únicos** de Daniel, de los cuales **17 son decisiones
ratificadas** (`Acepto…`, `Apruebo…`, `Confirmo…`). Ésta es una de ellas. Las otras 16 sí
están reflejadas en el repositorio — los cuatro dominios de `docs/` (`feos/`, `platform/`,
`ai/`, `customers/`) que pidió el 10 de agosto, por ejemplo, existen los cuatro.
