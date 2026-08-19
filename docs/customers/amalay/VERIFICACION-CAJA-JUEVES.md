# Verificación de la caja — antes del demo (jueves 20-ago @ AMALAY)

> **Objetivo:** confirmar que la caja corre **el prod actual (SW `v38`)**, no un build/SW viejo cacheado.
> **Por qué:** prod YA tiene las protecciones de velocidad (fetchWithTimeout, caché offline, guards
> `navigator.onLine`, timeouts). Si el POS se siente lento, casi seguro es **un Service Worker viejo
> cacheado en la caja**, no código faltante. Esta verificación lo descarta en 5 minutos.
> Regla: **DevTools ANTES de probar** (evita falsos negativos por SW/caché desincronizados).

---

## Objetivo concreto (contra qué comparas)

| Cosa | Valor esperado (prod hoy) |
|---|---|
| `CACHE_VERSION` del Service Worker | **`v38`** |
| Cachés en Cache Storage | **`fullsite-static-v38`**, **`fullsite-dynamic-v38`**, **`fullsite-api-v38`** |
| Estado del SW | `activated and running` |

Si ves **v37 o menor** (o cachés `...-v2x`) → **SW viejo** → sección "Forzar actualización".

---

## Cómo abrir DevTools en la caja

El POS corre en Electron a pantalla completa (kiosk). Para abrir DevTools:
- **Presiona `F12`** (registrado en la app: abre/cierra DevTools de la ventana activa).
- Alternativa dev: cerrar la app y relanzar con `FULLSITE_DEV=1` (abre en ventana, no kiosk).

> El SW de la app de Electron es **independiente** del navegador del sistema (Chrome/Edge).
> Hay que inspeccionar **dentro del POS (Electron)**, no en un Chrome aparte.

---

## Paso 1 — Versión del Service Worker (lo más importante)

1. `F12` → pestaña **Application** (Aplicación).
2. **Service Workers**: debe decir `activated and running`. Anota la URL de origen (`app.fullsite.mx`).
3. **Cache Storage** (Almacenamiento en caché): expande y confirma que existen
   **`fullsite-static-v38` / `fullsite-dynamic-v38` / `fullsite-api-v38`**.
4. **Console**: al recargar, busca el log de activación del SW con la versión.

- ✅ **v38** → la caja está al día. Salta al Paso 3.
- ❌ **menor a v38** → SW viejo cacheado (esta es la causa típica de "lento"). Ve al Paso 2.

---

## Paso 2 — Forzar actualización (solo si el SW está viejo)

**Con internet conectado** (para que baje el SW nuevo y re-prefetch de caché):

1. Application → **Service Workers** → marca **"Update on reload"** y click **"Update"**.
   Si sigue viejo: click **"Unregister"**.
2. **Hard reload**: `Ctrl+Shift+R` (o cierra y reabre la app de Electron).
3. Vuelve al Paso 1 y confirma **v38** + cachés `-v38`.
4. Si aun así no cambia: Application → **Storage** → **Clear site data**
   (⚠ borra la caché offline — hay que dejar el POS unos segundos **con internet** para que
   `prefetchOfflineData` vuelva a llenar menú/modificadores antes de probar offline).

> Si tras esto sigue viejo, el problema es de despliegue (Vercel), no de la caja — avísame.

---

## Paso 3 — Sanity de velocidad (online, con v38 confirmado)

Cronometra a mano (deben sentirse rápidos):
- **Abrir una mesa** → carga en ~1 s (menú viene de caché).
- **Agregar un item + Enviar** → responde de inmediato; el ticket sale.
- Network: los fetches de `pos_menu_*` / modifiers resuelven rápido o salen de **(from ServiceWorker)** / caché.

---

## Paso 4 — Prueba offline (el momento del demo)

1. Con el POS **ya abierto** y una mesa cargada, **desconecta el WiFi**.
2. **Abrir mesa** → debe ser **instantáneo** (no espera red; guard `navigator.onLine`).
3. **Agregar item + Enviar** → encola sin colgarse; imprime en la caja + sale en el KDS.
4. **Console**: no debe haber fetches colgados; deben verse logs de caché/offline.
5. **Reconecta WiFi** → la orden sincroniza (revisar que suba).

> ⚠ **No reinicies las máquinas sin internet** durante el demo: el arranque en frío sin WAN puede
> dejar la ventana en negro (Electron carga la UI remota). Mantenlas prendidas.

---

## Tabla diagnóstica

| Síntoma | Causa probable | Acción |
|---|---|---|
| POS lento **online** con SW **< v38** | build/SW viejo cacheado | Paso 2 (forzar update) |
| POS lento **online** con SW **v38** | no es el SW — red/BD o algo puntual | Revisar Network; avísame |
| Offline **se cuelga** al abrir/enviar | SW viejo (pre-v38, sin guards) | Paso 2 |
| Offline instantáneo pero **no imprime** | bridge/impresora, no velocidad | Ver `PIPELINE-POS-KDS-OFFLINE` (print) |

---

## Contexto: qué llega por dónde (para no confundir)

- **Velocidad + offline del POS web** (`pos-data.ts`, `page.tsx`): llega por **Vercel/prod** → esto es
  lo que verifica este documento (SW v38). **NO se necesita deploy nuevo** — prod ya lo tiene.
- **KDS rediseñado (Eduardo) + huella**: son de **`electron-app`** → llegan por el **build+install de
  Electron** en la caja/PDV2, **no** por Vercel. Ver `PIPELINE-POS-KDS-OFFLINE` (P0-2) y `FINGERPRINT-RESTORE`.
- ⚠ La rama `feat/pos-ui-kit` está en **SW v21** (17 versiones atrás de prod). **No mezclar su POS web
  con prod** sin reconciliar — regresaría el offline. Su valor para el jueves es el `electron-app`.

---

## Verificación de 1 minuto, justo antes del demo

En la caja (o desde otra terminal en la LAN):
- `http://‹ip-caja›:7717/health` → `clients_connected > 0` (KDS/terminales conectadas).
- `http://‹ip-caja›:7717/state` → `kds_orders` poblado.
- SW **v38** confirmado en la caja y en Entrada.
