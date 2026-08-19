# KDS de Eduardo — build + install (jueves 20-ago @ AMALAY)

> **Objetivo:** dejar corriendo el **KDS rediseñado (estilo Eduardo)** en la terminal de cocina (**PDV2**).
> El código ya está listo (`electron-app/local-server/kds-ui.html`); esto es **build + instalar + provisionar**.
> P0-2 del `PIPELINE-POS-KDS-OFFLINE`.

## Cómo está cableado (para entender qué se ve)

- La terminal de cocina corre en modo **`kds_only`** (se activa solo porque el build se llama **"Fullsite KDS"**, `main.js:936`).
- En ese modo, la ventana carga el **local** `http://127.0.0.1:7717/kds` → el Local Server sirve **`kds-ui.html`** = **el rediseño de Eduardo** (tarjeta por envío, filtro por estación, toque por item, alertas por tiempo, barra del Experto).
- Los **datos** (órdenes) llegan de la **caja** por LAN (`pos_server_ip = 192.168.1.71`). Funciona **offline**: si la caja manda una orden sin internet, sale en el KDS.
- El remoto `app.fullsite.mx/pos/cocina` es **solo fallback** — NO es lo que se ve en la terminal dedicada.

## Paso 1 — Build (en una Windows x64)

Desde `electron-app/` (con `npm install` hecho):

```
npm run build:kds
```

→ produce **`dist-kds/Fullsite KDS Setup 1.3.6.exe`**.
*(El build empaqueta `local-server/kds-ui.html` vía `files: **/*` → el rediseño va dentro.)*

> El build de Windows se hace **en Windows** (nsis). Desde Mac no cross-compila limpio.
> Para el POS (caja) el comando gemelo es `npm run build:pos` → `dist-pos/Fullsite POS Setup 1.3.6.exe`
> (ese sí trae la huella empaquetada, ver `FINGERPRINT-RESTORE`).

## Paso 2 — Instalar en PDV2

1. **Desinstalar el KDS/POS viejo (1.3.5)** de PDV2 — pelea el puerto 7717 al reiniciar (bug conocido). Panel de control → Desinstalar.
2. Copiar `Fullsite KDS Setup 1.3.6.exe` a PDV2 y ejecutarlo (instala per-machine, one-click).
3. Conectar PDV2 a la **misma LAN** que la caja (192.168.1.x).

## Paso 3 — Provisionar

Al primer arranque sale la pantalla de provisión. Poner:
- **restaurant_id:** `amalay`
- **pos_server_ip:** `192.168.1.71`  (la caja / SERVER1)
- **terminal_id:** `kds-cocina` (o el que uses)

Se guarda en `%APPDATA%\Fullsite KDS\config.json` (o legacy `C:\fullsite\config.json`). `kds_only` se activa solo.

> Config equivalente si lo pones a mano:
> ```json
> { "restaurant_id": "amalay", "pos_server_ip": "192.168.1.71", "terminal_id": "kds-cocina" }
> ```

## Paso 4 — Verificar (el golazo del demo)

1. En la caja, manda una orden con items de **cocina** → debe salir en el KDS como **tarjeta del envío** (solo lo nuevo, no toda la mesa).
2. El filtro de estación muestra **solo cocina** (no bebidas/barra).
3. Toque por item: nueva → preparando → listo.
4. **Offline:** desconecta el WiFi de la caja, manda otra orden → **debe salir igual** en el KDS (LAN local).
5. Barra "👁 Experto" arriba (si hay alertas del agente de borde).

## Checklist 1 minuto antes del demo
- `http://192.168.1.71:7717/health` → `clients_connected > 0` (el KDS está conectado a la caja).
- `http://192.168.1.71:7717/state` → `kds_orders` poblado.
- KDS en pantalla completa, sin botón Salir visible (terminal dedicada).

## Token de cocina (endurecimiento, opcional — no bloquea el jueves)

El endpoint `/api/pos/kitchen` sirve las órdenes a la pantalla. Por defecto opera **abierto**
(igual que hoy). Para cerrarlo contra enumeración entre tenants, es **opt-in**:

1. **Vercel:** setear env `KITCHEN_TOKEN_SECRET` (≥16 chars, aleatorio).
2. **Generar el token del cliente:**
   ```
   KITCHEN_TOKEN_SECRET="<secreto>" node print-bridge/gen-kitchen-token.js amalay
   ```
3. **Config del KDS/caja:** agregar `"kitchen_token": "<lo que imprimió>"` al `config.json`.
   El Electron lo inyecta en el KDS; `pos-data.ts` lo manda en el header `x-kitchen-token`.

Sin el env → todo sigue igual (cero riesgo). Con el env pero sin el token en config → el KDS
recibiría 401; por eso se activan juntos. Recomendado hacerlo **después** del jueves.

## Riesgos / notas
- **No reiniciar sin internet** durante el demo (arranque en frío puede quedar en negro).
- Si el KDS marca 0 órdenes: revisar que `restaurant_id` coincida (caja y KDS mismo `amalay`) y que el 7717 de la caja responda.
- El rediseño se ve **solo en modo kds_only** (terminal dedicada). En una ventana secundaria del POS carga el remoto.
