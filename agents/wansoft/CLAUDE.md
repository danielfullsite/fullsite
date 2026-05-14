# Wansoft Persistence — Brief para Claude Code

> **Para Claude Code:** Lee este archivo completo ANTES de tocar nada.
>
> **Lección crítica de sesiones anteriores:** NO cambies decisiones de diseño documentadas. NO toques archivos fuera del scope explícito. NO commitees hasta validar. Si tienes duda, PREGUNTA primero.

---

## OBJETIVO ÚNICO

Agregar persistencia a Supabase al pipeline existente del agent de Wansoft. Después de que `run.py` manda exitosamente el reporte (avance o cierre) a Telegram, hacer UPSERT de los datos a la tabla `wansoft_daily` en Supabase.

Eso es todo. No es un rewrite. Es **una sola adición** al final del flow exitoso.

---

## NO TOQUES

- ❌ `agents/wansoft/parser.py` — el parser ya funciona, no lo cambies
- ❌ `agents/wansoft/scraper.py` — Playwright, no lo cambies
- ❌ La lógica de envío a Telegram en `sender.py` — funciona, no lo cambies
- ❌ `.github/workflows/wansoft-daily-mesero.yml` — solo agregas 2 secrets nuevos (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`), nada más
- ❌ NO cambies el formato del mensaje Telegram
- ❌ NO cambies los crons ni el dispatch
- ❌ NO toques otros agents (reviews-manager, orquestador, etc)

---

## QUÉ AGREGAR (lo único)

**En `agents/wansoft/run.py` (o `sender.py`, donde aplique):**

Después del punto donde se confirma que Telegram fue exitoso (return code 200 o similar), agregar:

1. Importar Supabase Python SDK (verificar si ya está en requirements.txt, sino agregar)
2. Función `upsert_to_supabase(parsed_data, report_type, fecha)` que:
   - Construye el row con el schema correcto (ver abajo)
   - Hace UPSERT a `wansoft_daily` con `on_conflict='client_slug,fecha,report_type'`
   - Try/except amplio: si falla, log el error pero NO bloquear ni hacer sys.exit
3. Llamada a `upsert_to_supabase(...)` después de send Telegram exitoso

---

## Schema real de wansoft_daily

Ya tiene PK compuesta `(client_slug, fecha, report_type)` con CHECK constraint en report_type.

| # | Columna | Tipo | Cómo poblar |
|---|---|---|---|
| 1 | fecha | date | `target_date` del run.py |
| 2 | ventas_brutas | numeric | Parser output si existe, else NULL |
| 3 | ventas_dia | numeric | Total de ventas del día |
| 4 | descuentos | numeric | Parser output si existe, else NULL |
| 5 | devoluciones | numeric | Parser output si existe, else NULL |
| 6 | efectivo | numeric | Parser output si existe, else NULL |
| 7 | tarjeta | numeric | Parser output si existe, else NULL |
| 8 | chilaquiles_total | numeric | Si parser lo tiene, sino NULL |
| 9 | half_half_total | numeric | Si parser lo tiene, sino NULL |
| 10 | meseros | jsonb | Array de top meseros con stats — json.dumps() |
| 11 | platillos_top | jsonb | Array de platillos top — json.dumps() |
| 12 | ventas_por_grupo | jsonb | NULL por ahora si no existe |
| 13 | pago_metodos | jsonb | NULL por ahora si no existe |
| 14 | updated_at | timestamptz | `datetime.now(timezone.utc).isoformat()` |
| 15 | propinas_total | numeric | Suma de propinas si parser lo tiene |
| 16 | mesas_atendidas | integer | Total mesas |
| 17 | ordenes_llevar | integer | Si parser lo tiene |
| 18 | tickets_count | integer | Total tickets |
| 19 | personas_restaurant | integer | Total personas |
| 20 | cuentas_restaurant | integer | Total cuentas |
| 21 | ticket_promedio_restaurant | numeric | Calculado o del parser |
| 22 | client_slug | text | `'amalay'` hardcoded por ahora |
| 23 | report_type | text | `'avance'` o `'cierre'` según el argumento |

**Regla simple:** todo lo que el parser ya extrae, se persiste. Lo que NO extrae, se manda como NULL. NO modifiques el parser para extraer más cosas en esta sesión.

---

## Variables de entorno nuevas

En `.github/workflows/wansoft-daily-mesero.yml`, agregar al bloque `env:` del job:

```yaml
SUPABASE_URL:         ${{ secrets.SUPABASE_URL }}
SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

El founder agrega los secrets manualmente en GitHub. Tú NO toques el yml todavía — lo hacemos al final juntos.

---

## Implementación sugerida

**Archivo nuevo: `agents/wansoft/supabase_client.py`**

```python
"""
Persistencia a Supabase para reportes de Wansoft.
NO bloquea el envío de Telegram si falla.
"""
import os
import sys
import json
from datetime import datetime, timezone
from typing import Dict, Any, Optional

try:
    from supabase import create_client, Client
except ImportError:
    print("[supabase_client] supabase SDK no instalado, persistencia deshabilitada", file=sys.stderr)
    create_client = None


def get_supabase() -> Optional["Client"]:
    """Retorna cliente Supabase o None si no está configurado."""
    if create_client is None:
        return None
    
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    
    if not url or not key:
        print("[supabase_client] SUPABASE_URL o SUPABASE_SERVICE_KEY no configurado", file=sys.stderr)
        return None
    
    return create_client(url, key)


def upsert_daily_report(
    fecha: str,
    report_type: str,
    parsed_data: Dict[str, Any],
    client_slug: str = "amalay"
) -> bool:
    """
    UPSERT del reporte diario a wansoft_daily.
    Retorna True si exitoso, False si hubo error.
    NO levanta excepción.
    """
    supabase = get_supabase()
    if supabase is None:
        return False
    
    # Construir el row con los campos disponibles del parser
    row = {
        "client_slug": client_slug,
        "fecha": fecha,
        "report_type": report_type,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        # Numéricos
        "ventas_dia": parsed_data.get("ventas_dia"),
        "ventas_brutas": parsed_data.get("ventas_brutas"),
        "descuentos": parsed_data.get("descuentos"),
        "devoluciones": parsed_data.get("devoluciones"),
        "efectivo": parsed_data.get("efectivo"),
        "tarjeta": parsed_data.get("tarjeta"),
        "chilaquiles_total": parsed_data.get("chilaquiles_total"),
        "half_half_total": parsed_data.get("half_half_total"),
        "propinas_total": parsed_data.get("propinas_total"),
        "ticket_promedio_restaurant": parsed_data.get("ticket_promedio"),
        # Integers
        "mesas_atendidas": parsed_data.get("mesas_atendidas"),
        "ordenes_llevar": parsed_data.get("ordenes_llevar"),
        "tickets_count": parsed_data.get("tickets_count"),
        "personas_restaurant": parsed_data.get("personas"),
        "cuentas_restaurant": parsed_data.get("cuentas"),
        # JSONB
        "meseros": parsed_data.get("meseros_top"),
        "platillos_top": parsed_data.get("platillos_top"),
        "ventas_por_grupo": parsed_data.get("ventas_por_grupo"),
        "pago_metodos": parsed_data.get("pago_metodos"),
    }
    
    # Limpiar None values explícitamente — Supabase los maneja, pero más limpio enviar solo lo que hay
    row_clean = {k: v for k, v in row.items() if v is not None}
    # Asegurar que las PK siempre están
    row_clean["client_slug"] = client_slug
    row_clean["fecha"] = fecha
    row_clean["report_type"] = report_type
    
    try:
        response = supabase.table("wansoft_daily").upsert(
            row_clean,
            on_conflict="client_slug,fecha,report_type"
        ).execute()
        print(f"[supabase_client] UPSERT OK: {fecha} {report_type}")
        return True
    except Exception as e:
        print(f"[supabase_client] UPSERT FAIL: {e}", file=sys.stderr)
        return False
```

**Modificación a `agents/wansoft/run.py`:**

Buscar el punto donde se confirma Telegram exitoso. Después de eso (y solo si exitoso), agregar:

```python
from supabase_client import upsert_daily_report

# ... código existente que manda a Telegram ...

# Después de Telegram exitoso:
try:
    upsert_daily_report(
        fecha=target_date,
        report_type=report_type,  # 'avance' o 'cierre'
        parsed_data=parsed_kpis,  # el dict que tiene los datos del parser
    )
except Exception as e:
    print(f"[run.py] Persistencia falló pero Telegram fue OK: {e}", file=sys.stderr)
    # NO sys.exit, NO raise — el día está logueado en Telegram
```

---

## Dependencies

Verificar y agregar a `agents/wansoft/requirements.txt` si falta:

```
supabase>=2.0.0
```

Si ya está, no toques.

---

## Plan de pasos (NO los hagas todos seguidos)

### Paso 1 — Exploración (no modificar nada)
1. Lee `agents/wansoft/run.py` y `agents/wansoft/sender.py` completos
2. Identifica DÓNDE termina el envío de Telegram exitoso
3. Identifica el shape del dict `parsed_data` que produce el parser (los keys reales)
4. Lista qué keys de mi tabla de mapeo NO existen en el parser
5. STOP. Lista hallazgos al founder. Espera OK.

### Paso 2 — Crear supabase_client.py
1. Crea el archivo con el código de arriba
2. Ajusta los `parsed_data.get(...)` con los keys REALES que descubriste en paso 1
3. NO toques run.py ni sender.py todavía
4. STOP. Lista archivos creados. Espera OK.

### Paso 3 — Integrar en run.py
1. Agregar import y la llamada de upsert después de Telegram exitoso
2. Verifica que el flow normal de errores no cambia
3. STOP. Diff del cambio. Espera OK.

### Paso 4 — Verificar requirements.txt
1. Si supabase no está, agregar
2. STOP. Confirmar a founder que necesita correr `pip install -r requirements.txt` localmente. Espera OK.

### Paso 5 — Test local sin push
1. Crear test simple que importe `upsert_daily_report` y verifique que la función existe
2. Correr `python3 -c "from supabase_client import upsert_daily_report; print('OK')"`
3. Si imports OK pero faltan secrets locales, esperado
4. STOP. Reporta resultado. Espera OK.

### Paso 6 — Workflow yml
1. Modifica `.github/workflows/wansoft-daily-mesero.yml`:
   - Agrega 2 líneas a la sección `env:` del job
   - NADA MÁS (no tocar crons, dispatch, ni nada)
2. STOP. Diff del yml. Espera OK.

### Paso 7 — Commit + push
SOLO después de que el founder dé OK explícito en TODOS los pasos anteriores:
```bash
git add agents/wansoft/supabase_client.py agents/wansoft/run.py agents/wansoft/requirements.txt .github/workflows/wansoft-daily-mesero.yml
git commit -m "feat(wansoft): persistir cierres en Supabase wansoft_daily

- Nuevo agents/wansoft/supabase_client.py con upsert_daily_report()
- Llamada después de Telegram exitoso en run.py
- Try/except amplio: si Supabase falla, NO bloquea el flow
- Multi-tenant ready con client_slug
- PK compuesta: (client_slug, fecha, report_type)
- Persistir tanto avances (3pm) como cierres (8:30pm/11pm)"
git push
```

### Paso 8 — Validación post-push
1. Founder agrega `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` como secrets en GitHub
2. Dispatch manual del workflow: `gh workflow run wansoft-daily-mesero.yml -f target_date=2026-05-12 -f report_type=avance`
3. Esperar 5-7 min
4. Verificar en Supabase: `SELECT * FROM wansoft_daily WHERE fecha = '2026-05-12';`
5. Si hay row → ÉXITO
6. Si no → debug

---

## Estructura de errores y logging

Todos los prints/logs van a stderr para que aparezcan en GitHub Actions logs:

```
[supabase_client] OK: 2026-05-12 cierre              ← persistencia exitosa
[supabase_client] FAIL: connection timeout            ← persistencia falló
[supabase_client] SUPABASE_URL no configurado         ← faltan secrets
[run.py] Persistencia falló pero Telegram fue OK      ← graceful degradation
```

---

## Lessons aplicadas

1. **No cambies el parser ni el formato de Telegram.** Solo agregas persistencia.
2. **Verifica el código real antes de implementar.** El paso 1 (exploración) es crítico.
3. **Si Supabase falla, Telegram tiene prioridad.** Nunca interrumpas el envío al usuario por un fallo de persistencia.
4. **Localmente: testea que el import funciona antes de push.** Bug f-string de ayer nos enseñó a no asumir.
5. **PK compuesta es crítica.** Sin `report_type`, el cierre overwrite-ría el avance del mismo día.
6. **Logging en stderr.** Para que aparezca en Actions logs sin afectar stdout del script.

---

## Si encuentras blockers

Si algo en este brief no encaja con el código real:
1. STOP
2. Avísale al founder con: qué encontraste vs qué esperabas
3. Propón tu approach
4. Espera OK explícito antes de seguir

NO improvises decisiones de diseño.
