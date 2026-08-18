# PIPELINE — POS / KDS / Offline (AMALAY → clonable)

> **Sesión 2026-08-17→18 (noche).** Se resolvió el **offline** que no jalaba en meses:
> caja imprime sin internet + KDS recibe órdenes por LAN + POS secundarios reenvían a
> la caja. Todo con causa raíz encontrada y documentado. Ver
> **`docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`** (arquitectura + receta clonable).
>
> Este doc = **dónde quedamos** + **el pipeline de lo que falta**, priorizado.

---

## 1. Dónde quedamos (estado actual)

> ⚠️ **HONESTIDAD (corrección Daniel 2026-08-18):** **OFFLINE solo está VERIFICADO en la CAJA**
> (el print offline se confirmó desconectando internet: "por fin imprimió todo"). El KDS y
> Entrada se verificaron **ONLINE**; su offline es **por diseño (debería jalar) pero NO probado**.
> Escondite ni online cierra. **No dar por hecho el offline de KDS/Entrada/Escondite hasta probarlo
> físicamente** (desconectar internet → orden → imprime + KDS).

| Terminal | Máquina | ONLINE | OFFLINE |
|---|---|---|---|
| **Caja** (server_pos) | SERVER1 · .71 · v1.3.3 | ✅ guarda + imprime | ✅ **VERIFICADO** (print offline confirmado) |
| **Cocina / KDS** (kds) | PDV2 · v1.3.5 | ✅ recibe órdenes (kds-ui.html por Pedro) | ⚠️ por diseño, **NO probado** |
| **Entrada** (pos) | PDV3 · .69 · v1.3.6 | ✅ imprime en caja + KDS (reenvío) | ⚠️ por diseño, **NO probado** |
| **Escondite** (pos) | PDV1 · .68 · v1.3.6 | ❌ config BOM → sin `pos_server_ip` → no reenvía | ❌ ni online |

**Pendiente de prueba (P0):** validar OFFLINE físicamente en KDS + Entrada (y Escondite cuando cierre):
desconectar internet **con el POS ya abierto** → orden → debe imprimir en la caja + salir en KDS.
Escondite: config BOM → import limpio por **asistente**. Bloqueado además por **licencia TeamViewer**.

### ⚠️ Deuda técnica crítica
- **El código de `electron-app/` NO está commiteado en git** — main.js, local-server/index.js, kds-ui.html, electron-builder-pos/kds.json, configs. Vive **solo local + dentro de los instaladores** (`dist-pos/`, `dist-kds/`). **PRIMERA TAREA: commitear todo el electron-app** o se pierde.
- Los cambios **web SÍ** están en `origin/main` (danielfullsite): commits 8ec06a04, ec42d34d, a93cd358, 12bce59a, 1a26fb62 (endpoint /api/pos/kitchen, saveOrder offline, beep por ID).

---

## 2. Pipeline priorizado

### 🔴 P0 — cerrar lo abierto
| # | Tarea | Detalle | Esfuerzo |
|---|---|---|---|
| P0-1 | **Commitear electron-app** | main.js + local-server/index.js + kds-ui.html + electron-builder-*.json + configs. Sin esto se pierde el trabajo de la noche. | 15 min |
| P0-2 | **Terminar Escondite** | Import limpio del config por **asistente** (no a mano — el BOM lo rompe). Requiere acceso remoto (TeamViewer licencia) o físico. Config con `pos_server_ip: 192.168.1.71`. | 5-10 min |

### 🟠 P1 — el KDS bonito (lo que pidió Daniel)
**Rediseñar `electron-app/local-server/kds-ui.html`** (el motor offline ya jala; esto es piel + lógica de render). Requisitos EXPLÍCITOS:
1. **Filtrar por estación** — la pantalla de Cocina muestra **SOLO items de cocina**, NO bebidas/barra. (Hoy muestra todo.) Configurable por estación.
2. **Tarjeta por envío, no por orden** — mostrar **solo los productos NUEVOS que se acaban de enviar** (el comanda_batch recién mandado), NO toda la orden de la mesa cada vez. Cada envío = su tarjeta con solo esos items. (Ej: agregas un bowl a una mesa que ya tenía cosas → sale SOLO el bowl, no toda la mesa.) Es el patrón de **Eduardo** (tarjeta por comanda).
3. **Diseño de Eduardo** — cascada, toque por item para marcar listo, alertas por tiempo, botón salida/config. Look pulido. Ver `EDUARDO-SESSION-JUL21.md` / [[project_kds_variants]].

> Datos disponibles en `/state.kds_orders`: cada item trae `station` + `comanda_batch_id` + `comanda_batch_seq`; `comanda_batches` trae status por batch. → filtrar items por `station`, agrupar/renderizar por `comanda_batch_seq` como tarjetas independientes.
>
> Iterar el KDS = rebuild Electron + reinstalar PDV2 (~3-4 min/vuelta, más lento que web).

### 🟡 P2 — robustez y velocidad
| # | Tarea | Detalle |
|---|---|---|
| P2-1 | **Velocidad offline del POS** | Offline el POS está lento (abrir mesa/enviar tardan) — fetches sin timeout se cuelgan esperando internet. Fix: `fetchWithTimeout` + guard `navigator.onLine` en rutas calientes (abrir mesa, cargar menú, ready-orders poll pos/page.tsx:2337). |
| P2-2 | **Auto-inyección del bridge** | En Entrada/Escondite el bridge `127.0.0.1` se puso **manual** en Configuración. La inyección de main.js debería setearlo solo — verificar por qué no tomó (timing? SW?) para que el clonado sea sin pasos manuales. |
| P2-3 | **KDS status → Supabase** | Avanzar status en el KDS offline actualiza Pedro pero NO Supabase. Diseñar sync KDS→Supabase (o dejar que el online lo maneje). |
| P2-4 | **Full-screen Entrada** | Entrada no abre en kiosko full-screen (sale la barra de Windows). Flag de kiosko. |

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
