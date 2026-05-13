# Wansoft Explorer Agent · Brief para Claude Code

> **Para Claude Code:** Lee este brief completo antes de hacer nada. Trabajamos paso por paso. NO commitees hasta que el founder dé luz verde explícita. NO hagas pasos no listados.

---

## OBJETIVO

Construir un **agente exploratorio** que:

1. Se autentica en el portal de Wansoft con credenciales del founder
2. Navega sistemáticamente CADA sección/sub-menú del portal
3. Por cada pantalla captura:
   - Screenshot
   - Estructura del menú (selectores)
   - Tráfico HTTP (XHR/Fetch requests que el frontend hace al backend de Wansoft)
   - Si hay export → descarga XLSX y guarda esquema de columnas
4. Genera artifacts en disco con TODO lo descubierto
5. Manda resumen ejecutivo a Telegram (Daniel + Mónica)
6. UPSERT del catálogo a Supabase para que sea consultable por futuros agentes

**Esto se corre UNA VEZ** (o bajo demanda cuando Wansoft cambie). Después, otros agentes especializados usan el output para tareas recurrentes.

---

## CONTEXTO

- Founder: Daniel Ramonfaur (Fullsite)
- Cliente piloto: AMALAY Coffee & Market
- Cuenta a usar: **personal de Daniel** (NO la de AMALAY)
- Repo: `~/fullsite/`
- Carpeta nueva: `agents/wansoft-explorer/`
- Stack: Python 3.11 + Playwright + Supabase + Telegram Bot API
- Bot Telegram: `@fullsite_warroom_bot`
- Supabase project: `qjiomlvudfmzuvqvhwpk`

---

## RESTRICCIONES DE EJECUCIÓN

1. **Playwright en modo `headless=False`** la primera vez — el founder mira lo que hace
2. **Throttle:** mínimo 2 seg entre navegaciones (no hammerar Wansoft)
3. **Timeout global del run:** max 30 min — si tarda más, abort y reporta
4. **NO modificar nada en Wansoft** — solo lectura. Cero clicks en botones de Save/Delete/Edit.
5. **NO commitear credenciales** — usar `.env` y verificar que está en `.gitignore`

---

## STACK Y DEPENDENCIAS

`requirements.txt` para `agents/wansoft-explorer/`:
```
playwright>=1.45.0
supabase>=2.0.0
python-dotenv>=1.0.0
requests>=2.31.0
openpyxl>=3.1.0
```

Setup:
```bash
cd ~/fullsite/agents/wansoft-explorer
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

---

## ESTRUCTURA DEL AGENTE

```
agents/wansoft-explorer/
├── .env.example              # Sin valores reales
├── .gitignore                # Incluye .env, output/, *.png, *.xlsx
├── requirements.txt
├── run.py                    # Entry point
├── src/
│   ├── __init__.py
│   ├── auth.py               # Login a Wansoft
│   ├── crawler.py            # Navegación recursiva
│   ├── http_interceptor.py   # Captura XHR/Fetch
│   ├── screenshot.py         # Capturas
│   ├── export_handler.py     # Descarga XLSX + análisis schema
│   ├── catalog.py            # Genera artifacts finales
│   ├── supabase_client.py    # UPSERT wansoft_catalog
│   └── telegram_reporter.py  # Resumen ejecutivo
└── output/                   # Generated artifacts (gitignored)
    ├── screenshots/
    │   └── *.png
    ├── xlsx_samples/
    │   └── *.xlsx
    ├── portal_map.json
    ├── endpoints.json
    ├── xlsx_schemas.json
    └── exploration_log.txt
```

---

## SCHEMA SUPABASE NUEVA

Tabla `wansoft_catalog` (multi-tenant ready). Va al schema `public`.

```sql
CREATE TABLE IF NOT EXISTS wansoft_catalog (
  id BIGSERIAL PRIMARY KEY,
  explored_at TIMESTAMPTZ DEFAULT NOW(),
  explorer_version TEXT NOT NULL,        -- ej '1.0.0'
  
  -- Identificación del item
  path TEXT NOT NULL,                    -- ej 'Reportes/Ventas/Ventas por mesero'
  parent_path TEXT,                      -- ej 'Reportes/Ventas'
  level INTEGER NOT NULL,                -- 1 = top level, 2 = sub, etc
  
  -- Tipo de item
  item_type TEXT NOT NULL,               -- 'menu','report','form','dashboard'
  
  -- Metadata UI
  ui_label TEXT,                         -- texto visible del link/botón
  ui_selector TEXT,                      -- selector CSS para acceder
  screenshot_path TEXT,                  -- ej 'screenshots/reportes-ventas-mesero.png'
  
  -- Si es report con export
  has_export BOOLEAN DEFAULT FALSE,
  export_format TEXT,                    -- 'xlsx','csv','pdf'
  xlsx_sheets JSONB,                     -- ej [{"name":"Sheet1","cols":["Mesero","Total"]}]
  xlsx_sample_path TEXT,
  
  -- Endpoints HTTP descubiertos en esta pantalla
  endpoints JSONB,                       -- array de {method, url, params, response_keys}
  
  -- Filtros disponibles en la pantalla
  filters JSONB,                         -- array de {name, type, default_value}
  
  -- Notas / observaciones automáticas
  notes TEXT,
  
  UNIQUE (path, explorer_version)
);

CREATE INDEX idx_wansoft_catalog_path ON wansoft_catalog (path);
CREATE INDEX idx_wansoft_catalog_item_type ON wansoft_catalog (item_type);
```

El founder corre el CREATE TABLE manualmente en Supabase SQL Editor antes del primer run.

---

## SECRETS (.env)

```
WANSOFT_PORTAL_URL=https://www.wansoftpos.com
WANSOFT_USER=<credencial de Daniel>
WANSOFT_PASS=<password>

SUPABASE_URL=https://qjiomlvudfmzuvqvhwpk.supabase.co
SUPABASE_SERVICE_KEY=<service_role, NO anon>

TELEGRAM_BOT_TOKEN=<bot token>
TELEGRAM_CHAT_ID_DANIEL=7654040494
TELEGRAM_CHAT_ID_MONICA=<chat_id Mónica>
```

---

## PLAN DE PASOS · ESPERA OK ENTRE CADA UNO

### Paso 1 — Setup base

Crear:
- Estructura de carpetas
- `.gitignore` con: `.env`, `output/`, `__pycache__/`, `.venv/`, `*.pyc`
- `.env.example` con keys vacíos
- `requirements.txt`
- `run.py` skeleton (sin lógica todavía, solo print "wansoft-explorer v0.1")

Verificar:
- `python run.py` imprime el mensaje
- `git status` muestra solo los archivos nuevos en `agents/wansoft-explorer/` y NADA fuera

STOP. Lista qué creaste y espera OK del founder.

### Paso 2 — Login a Wansoft + interceptor HTTP

Implementar `src/auth.py` y `src/http_interceptor.py`:

`auth.py`:
- `async def login(page, user, pass) -> bool`
- Navega a `WANSOFT_PORTAL_URL/login` (verificar URL real)
- Espera input de user/pass (selectors a descubrir)
- Llena credenciales, click submit
- Espera URL post-login o elemento de dashboard
- Retorna True si OK, False si falló

`http_interceptor.py`:
- Class `HTTPInterceptor`
- `setup(page)`: registra event listeners `page.on('request')` y `page.on('response')`
- Almacena en memoria: `{method, url, status, request_body, response_keys}`
- `get_captured()` retorna lista
- `filter_xhr_only()` filtra solo XHR/Fetch (no docs/images/css)

Crear `run.py` mínimo que:
1. Lee .env
2. Lanza Playwright (`headless=False`)
3. Setup HTTPInterceptor en la page
4. Llama `login()`
5. Si éxito: dump `captured.json` con los XHRs vistos durante login
6. Cierra browser

Probar end-to-end con credenciales reales. Founder ve la ventana del browser haciendo login.

STOP. Verificar que login funciona y que `captured.json` tiene los endpoints del login (incluye el endpoint de auth). Espera OK.

### Paso 3 — Crawler básico (un nivel)

Implementar `src/crawler.py`:

```python
async def crawl_menu(page, interceptor) -> list[MenuItem]:
    """
    Detecta los items del menú principal (nav lateral o top),
    para cada uno:
    - Click
    - Espera networkidle
    - Captura screenshot
    - Captura XHRs disparadas
    - Detecta si tiene sub-menú
    Retorna lista de MenuItem con path, screenshot_path, endpoints[]
    """
```

Estructura tentativa de selectores (a confirmar con el portal real):
- Menú principal: `nav a`, `aside a`, o similar
- Buscar elementos clickables con texto

Por cada item:
- Path = label del item
- Click → wait_for_load_state('networkidle')
- Screenshot a `output/screenshots/<sluggified-path>.png`
- Endpoints capturados durante esta navegación
- Si hay sub-menú visible: registrarlos como `level=2` pendientes

NO recursar profundamente todavía. Solo nivel 1 + detectar nivel 2.

STOP. Verificar que crawler:
- Detectó todos los items principales (founder cuenta cuántos hay)
- Generó screenshots correctos
- Capturó endpoints distintos por cada pantalla

Espera OK.

### Paso 4 — Crawler recursivo (todos los niveles)

Extender crawler para que entre a cada sub-menú detectado en Paso 3 y repita.

Heurística de stop:
- Max depth = 5
- Si llega a un mismo path 2x, skip
- Si tarda más de 60 seg en una sola pantalla, abort esa pantalla y continuar

Mantener `path` con / como separador (ej: `Reportes/Ventas/Ventas por mesero`).

STOP. Founder verifica:
- Cuántos paths se crearon en total
- Que los screenshots cubren TODO el portal (sample check)
- Que los endpoints son distintos por path (no duplicados masivos)

Espera OK.

### Paso 5 — Export handler

Implementar `src/export_handler.py`:

Para cada pantalla que el crawler marcó como "tiene botón de export":
- Click en export
- Esperar download (Playwright tiene API: `page.expect_download()`)
- Guardar XLSX a `output/xlsx_samples/<sluggified-path>.xlsx`
- Abrir con openpyxl y extraer:
  - Lista de sheet names
  - Por cada sheet: nombres de columnas (primera fila típicamente)
  - Tipo de data inferido por sample de 3 filas

Output: `output/xlsx_schemas.json`:
```json
{
  "Reportes/Ventas/Ventas por mesero": {
    "file_path": "output/xlsx_samples/reportes-ventas-mesero.xlsx",
    "sheets": [
      {
        "name": "Sheet1",
        "columns": ["Mesero", "Total", "Personas", "Tickets", "Promedio"],
        "sample_row": ["Mario García", 8798, 20, 12, 440]
      }
    ]
  }
}
```

⚠️ Algunos exports requieren filtros de fecha. Default: usar fecha de HOY o "últimos 7 días". Si el filtro es obligatorio, intentar setearlo automáticamente. Si falla, log y skip ese export.

STOP. Founder verifica que los XLSXs descargados tienen contenido real, no errors.

Espera OK.

### Paso 6 — Catalog + Supabase UPSERT

Implementar `src/catalog.py`:

Consolidar todo en `output/portal_map.json` con esta estructura:
```json
{
  "explored_at": "2026-05-13T...",
  "explorer_version": "1.0.0",
  "total_items": 47,
  "items": [
    {
      "path": "Reportes/Ventas/Ventas por mesero",
      "parent_path": "Reportes/Ventas",
      "level": 3,
      "item_type": "report",
      "ui_label": "Ventas por mesero",
      "ui_selector": "a:has-text('Ventas por mesero')",
      "screenshot_path": "screenshots/reportes-ventas-mesero.png",
      "has_export": true,
      "export_format": "xlsx",
      "xlsx_sheets": [...],
      "xlsx_sample_path": "xlsx_samples/reportes-ventas-mesero.xlsx",
      "endpoints": [
        {
          "method": "GET",
          "url": "/api/v2/sales/by-waiter",
          "params": ["date", "branch_id"],
          "response_keys": ["waiters", "total", "summary"]
        }
      ],
      "filters": [
        {"name": "fecha", "type": "date", "default": "today"}
      ],
      "notes": "..."
    },
    ...
  ]
}
```

Implementar `src/supabase_client.py`:
- `upsert_catalog(portal_map: dict)`
- Para cada item: INSERT con `ON CONFLICT (path, explorer_version) UPDATE`
- Si Supabase falla: log error pero NO crashea el run (graceful degradation)

STOP. Verificar:
- portal_map.json tiene todos los items
- Supabase wansoft_catalog tiene N rows = items count
- `SELECT * FROM wansoft_catalog LIMIT 5` muestra data correcta

Espera OK.

### Paso 7 — Telegram reporter

Implementar `src/telegram_reporter.py`:

Después del run completo, manda mensaje a Daniel + Mónica con resumen:

```
🔍 WANSOFT EXPLORER - run completado

⏱ Duración: 18m 32s
📅 Fecha: 13 may 2026 14:23

🗂 ITEMS DESCUBIERTOS
• Total: 47
• Menús: 8
• Reports: 32
• Forms: 4
• Dashboards: 3

📥 EXPORTS CAPTURADOS
• XLSX: 28
• Pendientes (filtro requerido): 4

🌐 ENDPOINTS HTTP
• Únicos: 73
• Auth: 1
• GET reports: 32
• Otros: 40

📊 TOP 5 REPORTS POR DATA RICA
(según número de columnas en XLSX)
1. Reportes/Ventas/Detallado por ticket — 28 cols
2. Reportes/Cortes/Corte general — 22 cols
3. Reportes/Inventarios/Movimientos — 19 cols
4. Reportes/Empleados/Asistencia detallada — 17 cols
5. Reportes/Propinas/Por mesero — 15 cols

✅ Catálogo en Supabase tabla wansoft_catalog
📁 Artifacts en output/

Listo para Fase 2 (especialización de agentes).
```

Mandar a `TELEGRAM_CHAT_ID_DANIEL` y `TELEGRAM_CHAT_ID_MONICA`.

STOP. Founder ve si llegó el mensaje y verifica los conteos contra realidad observada durante el run.

Espera OK.

### Paso 8 — Run completo y commit

Hacer un run end-to-end completo. Si todo OK:

```bash
cd ~/fullsite
git add agents/wansoft-explorer/
git status   # verificar SOLO agents/wansoft-explorer/

git commit -m "feat(wansoft-explorer): agente de exploración del portal

- Login + crawl recursivo del menú
- Captura screenshots, endpoints HTTP, schemas XLSX
- UPSERT catálogo a Supabase wansoft_catalog
- Resumen ejecutivo a Telegram"

git push
```

NO commitees `output/` (debe estar en .gitignore).

STOP. Confirmar al founder que el agente está en main.

---

## DELIVERABLES FINALES

Al terminar este sprint, el founder tiene:

1. ✅ Carpeta `agents/wansoft-explorer/` con código completo
2. ✅ Tabla `wansoft_catalog` en Supabase llena con 30-50+ rows
3. ✅ `output/portal_map.json` con mapa completo
4. ✅ `output/screenshots/` con captura de cada pantalla
5. ✅ `output/xlsx_samples/` con sample de cada export
6. ✅ Mensaje resumen en Telegram
7. ✅ Commit en main

Esto desbloquea:
- Decidir qué reports nuevos persistir (extender `wansoft_daily` o crear tablas nuevas)
- Construir agente Detector de Anomalías Personas (lo de Mónica del 13 may)
- Construir Wansoft SDK con los endpoints documentados

---

## GUARDRAILS PARA CLAUDE CODE

1. Si te desvías del plan, PARA y pregunta antes de actuar
2. NO commitees nada hasta que el founder dé OK
3. NO toques archivos fuera de `agents/wansoft-explorer/`
4. Si encuentras error desconocido, REPORTA — no improvises
5. NO incluyas credenciales en logs, prints, ni commits
6. Después de cada paso: LISTA qué archivos creaste/modificaste antes de continuar
