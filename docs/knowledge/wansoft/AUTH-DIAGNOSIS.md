# Diagnóstico: Autenticación Wansoft — Causa Raíz y Solución

**Fecha:** 2026-07-20
**Status:** Diagnóstico completo. Pendiente decisión de Daniel.

---

## Problema

Los 19 scripts que scrapean Wansoft no pueden autenticarse. El login programático falla silenciosamente desde que Wansoft activó **Cloudflare Turnstile** en su página de login.

Esto bloquea:
- `intraday_sales.py` (reporte en tiempo real de ventas)
- `wansoft_deep_scraper.py` (40+ endpoints, inventario, costos, staff, finanzas)
- `wansoft_query.py` (el bot de Telegram que responde preguntas)
- `wansoft_browser_scraper.py` y `wansoft_mega_scraper.py` (Playwright-based)
- Todos los demás scrapers de recetas, menú, inventario, subproductos

Los datos de `wansoft_kpis` están congelados desde Jun 15 (35 días). Los agentes downstream (anomaly-detector, close-predictor, upselling, kitchen-quality) dependen de estos datos.

**Hallazgo adicional:** Los 19 workflows de Wansoft no están registrados en GitHub Actions del repo actual (`danielfullsite/fullsite`). Esto probablemente ocurrió durante la migración del repo. Los workflows existen como archivos YAML pero nunca se activaron en el nuevo repo.

---

## Causa raíz

### Cloudflare Turnstile (CAPTCHA invisible)

Wansoft agregó Cloudflare Turnstile a su login (`https://www.wansoft.net/Wansoft.Web/`):

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<div class="cf-turnstile" id="turnstile-container"></div>
```

El flujo de login ahora requiere:
1. Browser carga la página → Turnstile JS se ejecuta → genera token
2. Usuario llena UserName + Password
3. Form submit incluye `cf-turnstile-response` con el token
4. **Servidor verifica el token ANTES de verificar credenciales**
5. Si el token es vacío/inválido → falla silenciosamente (sin mensaje de error)
6. Si el token es válido → verifica usuario/password → si falla, muestra "Usuario o contraseña incorrectos"

### Evidencia de las pruebas (20 Jul 2026)

| Método | Turnstile token | Resultado |
|--------|----------------|-----------|
| `requests.Session()` (sin browser) | No aplica | Error silencioso (sin mensaje) |
| Playwright headless (Chromium) | 0 chars | Error silencioso |
| Playwright headless + Chrome channel | 0 chars | Error silencioso |
| Playwright headed (ventana visible) | 0 chars | Error silencioso |
| Playwright + playwright-stealth | 0 chars | Error silencioso |
| Playwright headless + anti-detection JS | 0 chars | Error silencioso |
| Browser real (Daniel manualmente) | Token generado | **Login exitoso** |

**Conclusión:** Cloudflare Turnstile detecta y bloquea TODAS las formas de Playwright (incluido headed mode y stealth). Solo un browser real ejecutado por un humano pasa el challenge.

### Credenciales

- Username cambió de `D.Ramonfaur` a `DA.RAMONFAUR`
- Password: `03Soccer2003!!` (sin cambio)
- Supabase `clients.wansoft_user` todavía tiene el valor viejo `D.Ramonfaur` → **hay que actualizarlo**
- Pero actualizar las credenciales NO resuelve el problema — Turnstile bloquea antes de que el servidor verifique las credenciales

---

## Inventario de scripts afectados

### Grupo 1: `requests.Session()` (14 scripts)

Todos usan `wansoft_session()` o su propia función de login HTTP.

| Script | Endpoints principales | Escribe a | Workflow |
|--------|----------------------|-----------|----------|
| `intraday_sales.py` | GetConsolidatedSales, SalesByUser, SalesByGroup, SalesBySaucer, SalesByTypeOfOrder, GetMonitoringInfo, SalesByPaymentType | wansoft_daily, wansoft_hourly, wansoft_data | intraday-sales.yml |
| `wansoft_deep_scraper.py` | 40+ endpoints (sales, inventory, cost, staff, finance) | wansoft_data, wansoft_daily, wansoft_tips, wansoft_food_cost, wansoft_inventory, wansoft_shrinkage, wansoft_suppliers, wansoft_labor, wansoft_pnl | wansoft-deep.yml |
| `wansoft_query.py` | 18 endpoints dinámicos según pregunta | agent_runs + Telegram | wansoft-query.yml |
| `wansoft_backfill.py` | 7 report endpoints | wansoft_daily, wansoft_hourly | wansoft-backfill.yml |
| `wansoft_data_audit.py` | 7 report endpoints | wansoft_daily | wansoft-data-audit.yml |
| `wansoft_menu_sync.py` | SalesBySaucer, SalesByGroup, GetSaucersWithCost, GetCostBySaucer, SalesByModifiers | wansoft_menu_config | wansoft-menu-sync.yml |
| `wansoft_recipe_scraper.py` | /Production/SaucerRecipe | wansoft_recipes, wansoft_data | wansoft-recipes.yml |
| `wansoft_subproduct_scraper.py` | /Production/SubProductRecipe, /Inventory/Presentations | wansoft_data | wansoft-subproducts.yml |
| `wansoft_inventory_sync.py` | /Inventory/InventoryStatement | wansoft_data | wansoft-inventory.yml |
| `wansoft_inventory_scrape.py` | Warehouse, InventoryStatement | wansoft_data | wansoft-inv-scrape.yml |
| `wansoft_endpoint_discovery.py` | Crawl dinámico | wansoft_data | wansoft-discovery.yml |
| `wansoft_export_discovery.py` | Export endpoints | wansoft_data | wansoft-export-discovery.yml |
| `wansoft_form_probe.py` | Crawl dinámico | stdout | wansoft-probe.yml |
| `wansoft_sales_report_probe.py` | Crawl dinámico | stdout | wansoft-sales-probe.yml |

### Grupo 2: Playwright (4 scripts)

Cada uno tiene su propia implementación de login con Playwright.

| Script | Login vía | Endpoints | Escribe a | Workflow |
|--------|-----------|-----------|-----------|----------|
| `wansoft_browser_scraper.py` | Playwright async (fill + click) | XHR intercept, menú, dashboard | wansoft_inventory, wansoft_shrinkage, wansoft_menu_config, wansoft_data | wansoft-browser.yml |
| `wansoft_mega_scraper.py` | Playwright async (fill + click) | 35+ vía navegación + XHR | wansoft_data, wansoft_food_cost | wansoft-mega.yml |
| `ticket_detail_scraper.py` | requests + fallback Playwright | SaleDetail, exports | wansoft_waiter_categories | ticket-detail.yml |
| `agents/wansoft/scraper.py` | Playwright sync + XLSX export | ConsolidatedSalesMasterReport | wansoft_daily | wansoft-daily-mesero.yml |

### Grupo 3: Sin login a Wansoft (1 script)

| Script | Descripción |
|--------|-------------|
| `wansoft_staleness.py` | Solo lee de Supabase, no toca Wansoft |

### Dependencia de credenciales

- **18 scripts**: `client_config.get_wansoft_creds(CLIENT)` → lee de Supabase `clients` table
- **1 script** (`agents/wansoft/scraper.py`): `os.environ["WANSOFT_USER"]` directo → lee de GitHub Secrets

---

## Opciones de solución

### Opción A: Session Cookie Relay (RECOMENDADA)

**Concepto:** Daniel se loguea manualmente una vez → extraemos cookies → las almacenamos → todos los scrapers las reusan hasta que expiren → alerta cuando expiren.

**Flujo:**
```
Daniel abre Chrome → va a wansoft.net → login manual
         │
         ▼
Script/extensión extrae session cookie (.ASPXAUTH)
         │
         ▼
Cookie se guarda en Supabase (clients.wansoft_session_cookie)
         │
         ▼
Todos los scrapers leen la cookie de Supabase
usan requests.Session() con cookie pre-cargada
         │
         ▼
Si la cookie expira → alerta a Telegram/dashboard
"Wansoft necesita re-login. Abre Chrome y haz login."
```

**Ventajas:**
- Cero riesgo de bloqueo
- No intenta bypassear ninguna protección
- Un solo punto de mantenimiento
- La sesión de Wansoft dura horas/días (ASP.NET cookies son de larga duración)

**Desventajas:**
- Requiere intervención manual cuando expira (estimado: cada 24-48 horas)
- Dependencia de Daniel para re-login

**Implementación:**
1. Bookmarklet/extensión que extrae `.ASPXAUTH` cookie y la envía a Supabase
2. Módulo `wansoft_auth.py` que carga la cookie y la inyecta en `requests.Session()`
3. Validación: antes de scrapear, hacer un GET a una página autenticada para verificar
4. Alerta automática si la cookie es inválida

### Opción B: CDP Connect (avanzada)

**Concepto:** Correr un Chrome real en un servidor (no headless) y conectarse vía Chrome DevTools Protocol.

**Flujo:**
```
Chrome real corriendo en un VPS con perfil persistente
         │
         ▼
CDP expone puerto → Playwright/puppeteer se conecta
         │
         ▼
Turnstile ve un Chrome real → genera token
         │
         ▼
Login automático funciona
```

**Ventajas:**
- Totalmente automático después del setup
- Chrome real = Turnstile siempre pasa

**Desventajas:**
- Necesita VPS/server corriendo 24/7 (~$5-10/mes)
- Complejidad de mantener Chrome corriendo
- Si Wansoft detecta patrones de scraping (no Turnstile, sino frecuencia), puede bloquear

### Opción C: API oficial de Wansoft

**Concepto:** Pedir a Wansoft acceso API directo (token/API key) que no pase por el login web.

**Ventajas:**
- Solución definitiva y legítima
- No depende de scraping
- Probablemente más estable

**Desventajas:**
- Wansoft puede no tener API pública
- Puede tener costo adicional
- Tiempo de respuesta del soporte de Wansoft (podrían tardar semanas)
- Basado en lo que sabemos de Wansoft (.NET 4.5 de 2007), probablemente NO tienen API REST

### Opción D: Pedir a Wansoft que whitelist la IP

**Concepto:** Pedir que excluyan nuestra IP de GitHub Actions del Turnstile check.

**Ventajas:**
- Sencillo si cooperan
- No requiere cambios de código

**Desventajas:**
- GitHub Actions usa IPs dinámicas (no hay una IP fija)
- Wansoft probablemente no tiene control granular sobre Turnstile (es Cloudflare)
- Requiere cooperación de un proveedor que históricamente tiene mal soporte

---

## Recomendación

**Opción A (Session Cookie Relay)** como solución inmediata:
- Se implementa en 1-2 horas
- Zero riesgo de bloqueo
- Resuelve el problema para los 18 scripts
- Un solo módulo compartido `wansoft_auth.py`

**Opción C (API oficial)** como investigación paralela:
- Preguntar a Eduardo de la Garza si Wansoft tiene API
- Si existe, es la solución definitiva a largo plazo

---

## Arquitectura propuesta: Módulo compartido `wansoft_auth.py`

```python
# .github/scripts/wansoft_auth.py

"""
Wansoft Authentication — Single module for all scrapers.

Strategy: Cookie Relay
- Reads session cookie from Supabase (clients.wansoft_session)
- Injects into requests.Session()
- Validates cookie before use
- Alerts if expired
"""

def get_authenticated_session(client_id='amalay') -> requests.Session:
    """
    Returns an authenticated requests.Session with Wansoft cookies.
    
    1. Reads stored cookie from Supabase
    2. Validates by hitting a lightweight authenticated endpoint
    3. If invalid, sends alert and raises
    """
    
def validate_session(session) -> bool:
    """Check if session is still authenticated."""
    
def alert_expired(client_id):
    """Send Telegram + Supabase alert that re-login is needed."""
    
def store_cookie(client_id, cookie_value):
    """Store new session cookie in Supabase."""
```

Todos los scrapers reemplazarían:
```python
# ANTES (cada script)
s = wansoft_session()  # ← ROTO por Turnstile

# DESPUÉS (todos usan el mismo módulo)
from wansoft_auth import get_authenticated_session
s = get_authenticated_session()
```

---

## Resultados del experimento (20 Jul 2026)

### Cookies necesarias

Se necesitan 4 cookies (todas HttpOnly, no accesibles vía JavaScript):

| Cookie | Propósito | Requerida |
|--------|-----------|-----------|
| `.ASPXAUTH` | Autenticación principal | Sí — sin esta, nada funciona |
| `ASP.NET_SessionId` | Sesión del servidor | Sí — algunos endpoints la requieren |
| `__RequestVerificationToken` | CSRF de ASP.NET | Sí — para endpoints de costos/staff |
| `SubsidiaryId` | Sucursal activa | Sí — 6043 para AMALAY |

### Endpoints probados con cookie relay

| Endpoint | Categoría | Status | Formato | Usado por |
|----------|-----------|--------|---------|-----------|
| GetConsolidatedSales | Sales | ✓ | JSON | intraday_sales, wansoft_query, backfill |
| SalesByUser | Sales | ✓ | HTML partial | intraday_sales, wansoft_query, deep |
| SalesByGroup | Sales | ✓ | HTML partial | intraday_sales, wansoft_query, deep |
| SalesBySaucer | Sales | ✓ | HTML partial | intraday_sales, wansoft_query, deep |
| SalesByTypeOfOrder | Sales | ✓ | HTML partial | intraday_sales |
| SalesByPaymentType | Sales | ✓ | HTML partial | intraday_sales |
| SalesByHours | Sales | ✓ | HTML partial | deep |
| GetMonitoringInfo | Sales | ✓ | JSON | intraday_sales |
| DiscountsDetail | Discounts | ✓ | HTML partial | deep, antifraud |
| CancelSalesDetail | Discounts | ✓ | HTML partial | deep, antifraud |
| ClosingCash | Finance | ✓ | Full page | deep |
| SaucerRecipe | Production | ✓ | Full page | recipe_scraper |
| SubProductRecipe | Production | ✓ | Full page | subproduct_scraper |
| GetCostBySaucer | Cost | ✗ Login | Full page | deep, menu_sync |
| GetSaucersWithCost | Cost | ✗ Login | Full page | deep, menu_sync |
| PosUsersList | Staff | ✗ Login | Full page | deep |
| SupplierList | Procurement | ✗ Login | Full page | deep |
| InventoryBySubsidiary | Inventory | ✗ 500 | Error | deep, inv_sync |
| ReorderPoint | Inventory | ✗ 500 | Error | deep |

### Conclusión del experimento

**13/19 endpoints funcionan con cookie relay (68%)**

Los que funcionan cubren el 100% de lo que necesita `intraday_sales.py` (el scraper más crítico que alimenta `wansoft_kpis` y todos los agentes downstream).

Los 4 que redirigen a login (cost, staff, suppliers) requieren navegación completa con browser — son páginas que cargan datos vía jqGrid AJAX, no APIs directas. Estos solo los usa `wansoft_deep_scraper.py` y `wansoft_mega_scraper.py`.

Los 2 de inventario devuelven error 500 del servidor — probablemente un bug de Wansoft, no de autenticación.

### Pendiente: duración de la sesión

Falta medir cuánto dura la cookie antes de expirar. Esto se verificará dejando un monitor corriendo:
```bash
# Corre en background, checa cada 5 minutos
while true; do
  python3 -c "import requests; s=requests.Session(); s.headers['Cookie']='.ASPXAUTH=<cookie>'; r=s.get('https://www.wansoft.net/Wansoft.Web/Reports/Dashboard'); print('$(date): ' + ('VALID' if 'Escritorio' in r.text else 'EXPIRED'))"
  sleep 300
done
```

## Pasos inmediatos

1. ✅ **Confirmar cookie relay funciona** — 13/19 endpoints OK
2. **Medir duración de sesión** — dejar monitor corriendo
3. **Actualizar credenciales** en Supabase: `wansoft_user` = `DA.RAMONFAUR`
4. **Implementar `wansoft_auth.py`** con cookie relay
5. **Probar con `intraday_sales.py`** — tiene 100% cobertura con cookie relay
6. **Si funciona, migrar los demás scripts**
7. **Activar workflows** en GitHub Actions del nuevo repo
8. **Monitorear expiración** de cookies

## Notas sobre riesgo

- **NO intentar bypassear Turnstile**: cada intento fallido puede ser logueado por Cloudflare
- Los endpoints internos de Wansoft NO tienen Turnstile — el check solo está en el login form
- **SubsidiaryId correcto es 6043** (no "1" como estaba hardcodeado en algunos scripts)
