# PIPELINE — POS / KDS / Offline (AMALAY → clonable)

> **Sesión 2026-08-17→18 (noche).** Se resolvió el **offline** que no jalaba en meses:
> caja imprime sin internet + KDS recibe órdenes por LAN + POS secundarios reenvían a
> la caja. Todo con causa raíz encontrada y documentado. Ver
> **`docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`** (arquitectura + receta clonable).
> Artifact resumen (biblia del offline): https://claude.ai/code/artifact/d01f9a90-4fcd-4196-a9de-9ddd49927b87
>
> Este doc = **dónde quedamos** + **el pipeline de lo que falta**, priorizado.
>
> 🎯 **META INMEDIATA: JUEVES 2026-08-20 — demo con Eduardo en AMALAY.** Todo lo marcado
> `[JUEVES]` abajo es lo que hay que tener listo para enseñarle. El golazo = su propio
> diseño de KDS (tarjeta por envío) corriendo, y el offline imprimiendo en vivo. Lo que
> más molesta en uso real (palabras de Daniel) = **la lentitud** → es la P0 #1.
>
> 🌙 **AVANCE NOCTURNO (2026-08-18, mientras Daniel dormía):**
> - ✅ **P0-1 Velocidad — CÓDIGO LISTO** (`0175454b`): `fetchWithTimeout` + guard `navigator.onLine`
>   en rutas calientes (menú, modificadores, formas de pago, meseros). tsc+eslint limpios.
>   **Falta:** probar offline físicamente + decidir deploy a prod (app.fullsite.mx = origin/main).
> - ✅ **P0-2 KDS Eduardo — CÓDIGO LISTO** (`6eeccd26`): `kds-ui.html` reescrito (tarjeta por envío,
>   filtro cocina, toque por item, rail de demanda, alerta de tiempo). Vista previa navegable con
>   datos de ejemplo: artifact `kds-eduardo-preview`. **Falta:** revisar diseño → build KDS x64 → reinstalar PDV2.
> - ✅ **Configs verificados** (CAJA/ENTRADA/ESCONDITE/POS2/POS3/KDS): todos sin BOM, JSON válido,
>   roles/IPs correctos → listos para enviar. (El BOM solo se metió al editar a mano en Notepad.)
> - 🔎 **P1-1 (auto-inject bridge)** en diagnóstico: `local_server_host` de los configs pos = `192.168.1.71`
>   (caja) en vez de `127.0.0.1` — sospechoso de por qué el bridge se puso a mano. Ver hallazgo abajo.

---

## 1. Dónde quedamos (estado actual)

> ⚠️ **HONESTIDAD (corrección Daniel 2026-08-18):** OFFLINE **VERIFICADO en 2 terminales: CAJA +
> COCINA/KDS** (la caja imprimió sin internet: "por fin imprimió todo"; y **el KDS recibió órdenes
> con la caja offline** — confirmado por Daniel). **Entrada** se verificó **ONLINE** (reenvío); su
> offline es **por diseño pero NO probado**. Escondite ni online cierra. **No dar por hecho el
> offline de Entrada/Escondite hasta probarlo físicamente** (desconectar internet → orden → imprime + KDS).

| Terminal | Máquina | ONLINE | OFFLINE |
|---|---|---|---|
| **Caja** (server_pos) | SERVER1 · .71 · v1.3.3 | ✅ guarda + imprime | ✅ **VERIFICADO** (print offline confirmado) |
| **Cocina / KDS** (kds) | PDV2 · v1.3.5 | ✅ recibe órdenes (kds-ui.html por Pedro) | ✅ **VERIFICADO** (recibió órdenes con caja offline) |
| **Entrada** (pos) | PDV3 · .69 · v1.3.6 | ✅ imprime en caja + KDS (reenvío) | ⚠️ por diseño, **NO probado** |
| **Escondite** (pos) | PDV1 · .68 · v1.3.6 | ❌ config BOM → sin `pos_server_ip` → no reenvía | ❌ ni online |

**Pendiente de prueba (P0):** validar OFFLINE físicamente en **Entrada** (y Escondite cuando cierre):
desconectar internet **con el POS ya abierto** → orden → debe imprimir en la caja + salir en KDS.
Escondite: config BOM → import limpio por **asistente**. Bloqueado además por **licencia TeamViewer**.

### ⚠️ Deuda técnica crítica
- ✅ **electron-app COMMITEADO** (`0924b5d5` en `feat/pos-ui-kit`, local) — main.js, local-server/index.js, kds-ui.html, electron-builder-pos/kds.json, configs + docs. **PENDIENTE: push de respaldo a remoto** (rama backup, no toca prod).
- Los cambios **web SÍ** están en `origin/main` (danielfullsite): commits 8ec06a04, ec42d34d, a93cd358, 12bce59a, 1a26fb62 (endpoint /api/pos/kitchen, saveOrder offline, beep por ID).

---

## 1.5 Estado EXACTO para el jueves (demo Eduardo @ AMALAY)

**Qué SÍ enseñar (funciona hoy):**
- **Caja:** guarda + imprime **online y offline** (verificado desconectando internet).
- **Cocina/KDS:** recibe órdenes **online y offline** (verificado con la caja offline).
- **Entrada:** imprime en la caja + sale en KDS **online** (reenvío por su Pedro local).
- **El corte de internet en vivo:** desconectar el WiFi con el POS abierto → tomar orden → imprime + sale en KDS. **Este es el momento que impresiona.**

**Qué NO tocar / riesgos en el demo:**
- **Lentitud** (P0 #1): abrir mesa y enviar tardan mucho offline → se ve mal en vivo. **Arreglar ANTES del jueves.**
- **Arranque en frío sin internet:** si una máquina se apaga y prende sin WAN, la ventana POS puede quedar en negro. → **Mantener las máquinas prendidas** durante el demo; no reiniciarlas sin internet.
- **Escondite:** no cierra (config BOM). No incluir en el demo hasta arreglar.
- **KDS diseño:** hoy es UI básica (muestra todo incl. bebidas, la orden completa). El golazo es ponerle el diseño de Eduardo (tarjeta por envío) → ver P0 #2.
- **Entrada offline:** no probado físicamente. Si se va a demostrar offline, probarlo antes (miércoles).

**Topología del demo:** caja=SERVER1(.71) · KDS=PDV2 · Entrada=PDV3(.69) · Escondite=PDV1(.68, fuera).
**Verificación 1 min antes:** `‹caja›:7717/health` → `clients_connected>0`; `/state` → `kds_orders` poblado.

---

## 2. Pipeline priorizado

### 🔴 P0 — `[JUEVES]` listo para el demo con Eduardo (20-ago)
| # | Tarea | Detalle | Esfuerzo |
|---|---|---|---|
| **P0-1** | **⚡ VELOCIDAD offline del POS** `[JUEVES]` | **Lo que MÁS molesta en uso real** (Daniel: "se tarda mucho en abrir, mucho en enviar"). Offline el POS se cuelga porque los fetches no tienen timeout y esperan a un internet que no está. Fix: `fetchWithTimeout` + guard `navigator.onLine` en rutas calientes: **abrir mesa**, **cargar menú**, **enviar orden**, ready-orders poll (`pos/page.tsx:2337`). En vivo frente a Eduardo un POS lento se ve pésimo → **es la #1**. | 1-2 h |
| **P0-2** | **🍳 KDS diseño de Eduardo (el golazo)** `[JUEVES]` | Rediseñar `electron-app/local-server/kds-ui.html` (el motor offline ya jala; esto es piel + render). Es SU diseño, enseñárselo corriendo = el momento del demo. Requisitos EXPLÍCITOS: **(1) Filtrar por estación** — Cocina muestra SOLO items de cocina, NO bebidas/barra (hoy muestra todo); configurable por estación. **(2) Tarjeta por envío, no por orden** — mostrar SOLO los productos NUEVOS del `comanda_batch` recién enviado, NO toda la mesa cada vez (agregas un bowl → sale SOLO el bowl). **(3) Look Eduardo** — cascada, toque por item para marcar listo, alertas por tiempo, botón salida/config. Ver `EDUARDO-SESSION-JUL21.md` / [[project_kds_variants]]. | 3-5 h |
| **P0-3** | **Terminar Escondite + probar offline Entrada/Escondite** `[JUEVES]` | Escondite: import limpio del config por **asistente** (no a mano — el BOM lo rompe), `pos_server_ip: 192.168.1.71`; requiere acceso (TeamViewer licencia o físico el jueves). Y probar offline físicamente Entrada + Escondite (desconectar internet → orden → imprime + KDS). | 20-40 min |
| P0-4 | **Push de respaldo del electron-app** | `0924b5d5` está local. Empujar a rama backup remota (no toca prod) para no perderlo. | 5 min |

> **Datos para el KDS (P0-2):** `/state.kds_orders` — cada item trae `station` + `comanda_batch_id` + `comanda_batch_seq`; `comanda_batches` trae status por batch. → filtrar items por `station`, agrupar/renderizar por `comanda_batch_seq` como tarjetas independientes.
> **Iterar el KDS** = rebuild Electron + reinstalar PDV2 (~3-4 min/vuelta, más lento que web) → dejar el diseño casi listo en la Mac antes de subir a la máquina.

### 🟠 P1 — robustez (post-demo, para clonar sin fricción)
| # | Tarea | Detalle |
|---|---|---|
| P1-1 | **Auto-inyección del bridge** | **CAUSA RAÍZ DIAGNOSTICADA** (ver bloque abajo). Fix documentado, sin aplicar (cambio en el arranque, requiere prueba física). No bloquea el demo: el bridge se pone a mano en 10s. |
| P1-2 | **KDS status → Supabase** | Avanzar status en el KDS offline actualiza Pedro pero NO Supabase. Diseñar sync KDS→Supabase (o dejar que el online lo maneje). |
| P1-3 | **Full-screen Entrada** | Entrada no abre en kiosko full-screen (sale la barra de Windows). Flag de kiosko. |
| P1-4 | **Arranque en frío sin internet** | La ventana POS carga de `app.fullsite.mx`; si prende de cero sin WAN queda en negro. Evaluar servir un shell mínimo por Pedro (como el KDS) para blindar el cold-boot. |

#### 🔎 Diagnóstico P1-1 — por qué el bridge se puso a mano (2026-08-18)

**Hay DOS rutas de bridge que no se sincronizan:**
- **Impresión** (`printer.ts` → `getBridgeUrl()` en `lib/bridge-url.ts`): lee `FULLSITE_BRIDGE_URL`. ✅ Correcta (main.js la inyecta = `127.0.0.1`).
- **WebSocket / estado** (`bridge-client.ts` → `server-discovery.ts:345-355`): lee **`pos_bridge_host`**, NO `FULLSITE_BRIDGE_URL`. Si quedó un `pos_bridge_host` viejo = IP de la caja (de una config/entrada manual previa), discovery intenta `ws://‹caja›` PRIMERO → **mixed-content bloqueado** → "print bridge offline".

**El anti-fix parcial que ya existe:** `main.js:661-667` (rol `pos`) hace `setItem('FULLSITE_BRIDGE_URL','http://127.0.0.1:7717')` + `removeItem('pos_bridge_host')` — **pero corre en `did-finish-load`**, que puede ejecutarse DESPUÉS de que React montó `useBridgeClient` y ya leyó el `pos_bridge_host` viejo. Timing → la limpieza llega tarde.

**Fix recomendado (Opción A+C, bajo riesgo, espeja el patrón probado del KDS):**
1. `main.js` — cargar el POS secundario con el rol en la URL: `mainWindow.loadURL(POS_URL + '?terminal_role=pos')` (solo cuando `terminal_role==='pos'`).
2. `preload.js` — al inicio (antes de que corra cualquier script de página, como hace `preload-kds.js:11-17`):
   ```js
   try {
     const role = new URLSearchParams(location.search).get('terminal_role')
     if (role === 'pos') {
       localStorage.setItem('FULLSITE_BRIDGE_URL','http://127.0.0.1:7717')
       localStorage.removeItem('pos_bridge_host')
     }
   } catch(e){}
   ```
   Así el valor correcto ya está en localStorage ANTES de que monte React → discovery nunca ve el `pos_bridge_host` viejo.

**Alternativa (Opción B, riesgo medio):** en `server-discovery.ts:345-355` priorizar `FULLSITE_BRIDGE_URL` sobre `pos_bridge_host` y poner `127.0.0.1` siempre primero para rol pos. Cambia la precedencia de discovery globalmente (afecta KDS/barra) → menos preferible.

**También (cosmético, correcto):** en los configs de POS secundario, `local_server_host` debería ser `127.0.0.1` (su propio Pedro), no la IP de la caja — hoy dice `192.168.1.71`. No causa el bug directamente (no se inyecta al renderer), pero confunde y pre-llena mal el asistente.

> ⚠️ **NO aplicado esta noche:** es el path de arranque; requiere prueba física (reiniciar el POS, verificar que conecta al bridge solo). Recipe lista arriba para aplicar+probar el jueves.

### 🟢 P3 — limpieza y seguridad
| # | Tarea | Detalle |
|---|---|---|
| P3-1 | **Limpiar apps viejos 1.3.5 LOCAL_UI** | En las máquinas quedaron instalaciones viejas que pueden pelear el puerto 7717 al reiniciar. Desinstalar. |
| P3-2 | **Endurecer `/api/pos/kitchen`** | Hoy gateado solo por `client_id` (como get_public_menu). Bindear a token de cocina por tenant para que no se enumere cross-tenant. |
| P3-3 | **Limpiar órdenes de prueba viejas** | `pos_orders` tiene muchas órdenes `enviada` de prueba que nunca se cerraron → ensucian el KDS. Cerrarlas. |
| P3-4 | **Verificar sonido del KDS** | Se bajó el volumen de PDV2 para callar el beep espurio (ya arreglado por ID). Subir volumen y confirmar que suena solo con orden nueva real. |

### 🔵 P4 — el objetivo mayor: CLONABLE (esqueleton)
| # | Tarea | Detalle |
|---|---|---|
| P4-1 | **Cablear la receta offline al esqueleton** | "Crear cliente nuevo" → auto-generar `config.json` por rol (server_pos/pos/kds) con `pos_server_ip`=IP de la caja + empaquetar instaladores. Conecta con `terminal-config.ts` (F1, generateTerminalConfig). Ver `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md §5`. |
| P4-2 | **Generador de config sin fricción** | Que el config nunca se edite a mano (el BOM rompe). Descarga desde el dashboard, o el asistente lo genera. |

---

## 3. Deuda de sesiones previas (no de esta noche, pero abiertas)
- **BLINDAJE** (tasks #8-11, #16): 2FA super-admin (SEC-1), cookie httpOnly (SEC-2), invitación/reset por correo, B1 guards. Migraciones RLS B2/B3 validadas en staging, **sin aplicar a prod** (Daniel aplica). Ver [[project_blindaje_security_audit]].

---

## 4. Archivos clave (mapa rápido)
| Qué | Dónde |
|---|---|
| Motor KDS offline | `electron-app/local-server/kds-ui.html` + ruta `/kds` en `index.js` |
| Reenvío POS→caja | `index.js` (intercept `forwardPost`) + `main.js` (inyección role pos) |
| Print/save offline | `dashboard-app/src/lib/pos-data.ts` (`saveOrder`) + `pos/page.tsx` |
| Endpoint KDS online | `dashboard-app/src/app/api/pos/kitchen/route.ts` |
| Instaladores | `electron-app/dist-pos/` (POS 1.3.6) · `dist-kds/` (KDS 1.3.5) |
| Configs | `dist-pos/config-{CAJA,ENTRADA,ESCONDITE,POS2,POS3}.json` |
| Arquitectura + clone | `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md` |

---

*Retomar leyendo: este doc + `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`. Empezar por P0-1 (commitear electron-app).*
