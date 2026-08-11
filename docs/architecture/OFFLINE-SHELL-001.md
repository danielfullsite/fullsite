# OFFLINE-SHELL-001 — Cargar la UI local (la pieza que falta para offline 100%)

> Versión: 2026-08-10 · Rama: `offline-shell/local-load` · Autor: field/eng
> Piloto: AMALAY (2 terminales en 1.3.4, imprimiendo online).
> Depende de: Fase 1 offline (IndexedDB local, event store, WS hub — ya VERIFIED).
> NO reemplaza: OFFLINE-GAP-001 (Outbox Fase 2) ni OFFLINE-GAP-002 (state sync). Es ortogonal.

---

## 1. El problema en una línea

`electron-app/main.js:8` define `POS_URL = 'https://app.fullsite.mx/pos'` y `main.js:625` hace `mainWindow.loadURL(POS_URL)`. **La UI se carga siempre desde la nube por HTTPS.** De ese único hecho salen las 3 fallas de campo:

| Falla en AMALAY (2026-08-10) | Causa raíz |
|---|---|
| Pantalla **negra** al cortar el módem | Sin internet y sin caché de Service Worker tibio, no hay UI que cargar. `offline.html` es solo un shell de reintento. |
| **KDS** (.4) no recibe comandas offline | La página HTTPS no puede abrir `ws://SERVER1:7717/ws` (WebSocket a IP de LAN) → *mixed-content*. |
| Terminales secundarias no alcanzan el bridge de la caja | Igual: `http://192.168.1.71:7717` desde HTTPS = *mixed-content* bloqueado. Solo `127.0.0.1` está exento. |

**Corolario:** arreglar la carga local arregla las 3 de un solo golpe, porque el origen de la página deja de ser HTTPS-nube y pasa a ser HTTP-local (loopback o LAN), donde `http://` y `ws://` al LAN **sí** están permitidos.

---

## 2. La pieza angular (Offline Shell)

**El bridge de SERVER1 sirve la UI estática, y la app se carga desde ahí — no desde la nube.**

```
ANTES:  Electron  ──loadURL──▶  https://app.fullsite.mx/pos   (nube, HTTPS)
AHORA:  Electron  ──loadURL──▶  http://127.0.0.1:7717/pos     (bridge local sirve el estático)
        Terminal  ──loadURL──▶  http://192.168.1.71:7717/pos  (mismo bridge, por LAN)
```

Con la página servida en `http://…:7717`, el fetch a `…:7717/print` y el `ws://…:7717/ws` son **mismo origen** → sin mixed-content, funciona online y offline. El KDS y las terminales secundarias apuntan al `:7717` de SERVER1 y reciben las comandas por el LAN. Reusa **todo** lo de Fase 1 (IndexedDB local, event store, WS hub).

---

## 3. Cambios concretos (ordenados, cada uno testeable)

### 3.1 Build estático para Windows — ✅ VALIDADO (2026-08-11)
- Ya existe `CAPACITOR_OFFLINE=1 → output:'export'` en `dashboard-app/next.config.ts:65-72`.
- **Spike ejecutado:** `CAPACITOR_OFFLINE=1 next build` **falla** en su forma cruda porque `output:'export'` no soporta:
  1. Las **59 rutas `src/app/api/*`** (endpoints de servidor). Primer error: `/api/backup`.
  2. **3 rutas dinámicas fuera del POS** sin `generateStaticParams()`: `demo/[...slug]`, `menu/[mesa]`, `encuesta/[id]`.
- **Ninguna ruta de `/pos/*` es dinámica** → el POS es 100% exportable.
- **Receta que compila verde** (probada, 43s, `build_exit=0`): excluir del árbol de build `api`, `demo`, `menu`, `encuesta` → produce `dashboard-app/out/` con `pos.html`, `pos/kds.html`, `pos/cocina.html`, `_next/`. **Bundle total: 19 MB.**
- **Implementación:** script `build:offline` que scopea a la superficie POS (excluye api + no-POS dinámicas). El bundle offline debe ser **solo `/pos/*` + login** — no toda la plataforma (agentes, CRM, contabilidad, etc. quedan cloud-only). Beneficio extra: instalador chico + menos superficie de código en la terminal.

### 3.2 El bridge sirve el estático
- En `electron-app/local-server/index.js` (router), agregar un handler para rutas NO-API (`/pos`, `/kds`, assets `/_next/*`):
  - Servir archivos desde la carpeta `out/` empaquetada.
  - **SPA fallback:** cualquier ruta de app sin archivo → devolver `out/pos/index.html` (client-side routing de Next export).
  - Content-Type correcto + cache headers para assets con hash.
- El `/fp/*`, `/print`, `/health`, `/ws` existentes NO se tocan.

### 3.3 Empaquetar `out/` en el instalador
- `electron-app/package.json` → `build.extraResources` (o `files`) incluye `out/` (copiado desde `dashboard-app/out`).
- El local-server lee la ruta del bundle vía `process.resourcesPath` en producción / relativa en dev.

### 3.4 Electron carga local (detrás de flag, sin romper online)
- `main.js:8`: `POS_URL` pasa a resolverse:
  - `LOCAL_UI` activo (env o `config.json`) → `http://127.0.0.1:7717/pos`.
  - default (hoy) → `https://app.fullsite.mx/pos` (se mantiene hasta validar).
- El `did-fail-load`/`offline.html` fallback se mantiene como red de seguridad.

### 3.5 Terminales y KDS apuntan al bridge de SERVER1
- Terminal secundaria / KDS: `pos_server_ip` (ya existe en config, `main.js:858`) → cargan `http://<SERVER1>:7717/pos` (o `/kds`).
- Elimina la necesidad de `pos_bridge_host` / `FULLSITE_BRIDGE_URL` por mixed-content: al ser mismo origen, el bridge se resuelve solo.

### 3.6 OTA del bundle (se conecta con la capa de flota)
- Actualizar la UI = reemplazar `out/` empaquetado, por canal (stable) con rollback. Ver arquitectura de flota (provisioning + OTA).

---

## 4. Matriz de prueba (gate para mergear)

| # | Escenario | PASS =|
|---|---|---|
| 1 | Cold-start **sin internet** (módem apagado desde el arranque) | La app abre y pide PIN (no pantalla negra) |
| 2 | Orden en CAJA offline → imprime | Comanda sale en cocina/barra |
| 3 | Orden en ENTRADA offline → llega a CAJA | Se ve en el estado de SERVER1 |
| 4 | KDS (.4) offline recibe comanda | Aparece en la pantalla de cocina |
| 5 | Cobro offline → ticket | Imprime |
| 6 | Vuelve internet | Checkpoint sube todo, **cero duplicados** |
| 7 | Online sigue igual que hoy | Sin regresión en el flujo con nube |

---

## 5. Guardas / no romper lo que jala

- **Default = nube** hasta que la matriz de §4 pase en un equipo de campo. `LOCAL_UI` es opt-in por config.
- El sistema **Wansoft sigue siendo el fallback vivo** — no se corta nada por que pasen los tests.
- Sin deploy a prod ni cambios de DB sin autorización explícita del fundador.
- Trabajo en rama `offline-shell/local-load`; PR con la matriz de §4 documentada.

---

## 6. Lo que esto NO hace (para no confundir alcance)

- **No** implementa el Outbox Fase 2 (OFFLINE-GAP-001) — eso es que el Local Server sincronice a Supabase él mismo. Sigue vigente y es siguiente.
- **No** resuelve el clobber de state-sync (OFFLINE-GAP-002).
- **No** toca la huella (ya es local, ver arquitectura) más allá de que al servir local el `/fp` queda mismo-origen (bonus).

---

## 7. Secuencia de ejecución

1. `build:offline` + verificar que el export compila (spike). ← **empezar aquí**
2. Bridge sirve `out/` con SPA fallback (local-server).
3. Empaquetar `out/` en el instalador.
4. `main.js` carga local detrás de `LOCAL_UI`.
5. Terminales/KDS → `http://<SERVER1>:7717`.
6. Correr matriz §4 en campo (vía TeamViewer + corte físico de módem).
7. PR + gate. Después: Outbox Fase 2.
