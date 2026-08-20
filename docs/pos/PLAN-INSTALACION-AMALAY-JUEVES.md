# Plan de instalación AMALAY — Jueves 2026-08-20

> Consolidado de 4 auditorías paralelas (topología, motor offline, clonabilidad, P0s/Eduardo/fraude) + verificación en vivo contra `origin/main` y el código de la cáscara. Fecha: 2026-08-19.

---

## 0. Veredicto en una frase

**No se reinstala todo.** Se reinstala **solo el KDS (PDV2)** a 1.3.8. La **caja y la entrada solo recargan (F5)** — el fix de velocidad vive en la web (Vercel) y ya está en prod. **Escondite** se arregla importando el config **con el asistente, nunca a mano**. Todo lo de fraude ya está desplegado en modo *grace* (observa, no bloquea) — se instala seguro.

---

## 1. Topología, versiones y acción por dispositivo

| Terminal | Máquina / IP | Rol | Instalado hoy | Acción jueves | Por qué |
|---|---|---|---|---|---|
| **Caja** | SERVER1 · .71 | `server_pos` | POS **1.3.3** | **F5, no reinstalar** | Offline (print) probado en campo. Velocidad viene por web. Reinstalar = riesgo de romper lo que ya jala. |
| **Cocina/KDS** | PDV2 · .4 | `kds` (kds_only) | KDS **1.3.5** | **Reinstalar → 1.3.8** | Trae diseño Eduardo + tarjeta completa + orden por mesa + render con try/catch. Verificado que el zip contiene el fix. |
| **Entrada** | PDV3 · .69 | `pos` | POS **1.3.6** | **Probar offline miércoles**; reinstalar a 1.3.7 solo si falla | Online ya jala. Offline nunca se probó. No churnear un terminal que funciona sin evidencia. |
| **Escondite** | PDV1 · .68 | `pos` | ❌ sin instalar | **Instalar 1.3.7 + config por asistente** | Config viejo tenía BOM (editado a mano). Bloqueado por licencia TeamViewer. |

**Artefactos listos (verificados hoy):**
- `electron-app/dist-kds/Fullsite-KDS-1.3.8-x64-CANONICO.zip` — reconstruido y verificado (kds-ui.html idéntico al fuente commiteado).
- `electron-app/dist-pos/Fullsite-POS-1.3.7-x64-portable.zip` — fresco (fuente anterior al build).

---

## 2. Las tres decisiones de fondo (resueltas con evidencia, no supuestos)

### 2.1 ¿La caja necesita reinstalarse por velocidad? → NO
El fix de velocidad (`fetchWithTimeout` + guard `navigator.onLine` + timeout 7s) vive en la **web**: `dashboard-app/src/lib/pos-data.ts` (6 apariciones) y `pos/page.tsx` (12) — **confirmado en `origin/main`**, que auto-deploya a `app.fullsite.mx`. La cáscara Electron solo carga la web; no trae código de velocidad. **La caja lo recibe con recargar (F5).**

### 2.2 ¿Qué KDS ve Eduardo? → `kds-ui.html` local (el que arreglé hoy)
El build dedicado "Fullsite KDS" fuerza `kds_only` (`main.js:945`) → carga `http://127.0.0.1:7717/kds` = `kds-ui.html` servido por su propio Pedro (`main.js:974`). **No** carga `/pos/cocina` (web). El fix de hoy (tarjeta completa + orden por mesa) está en ese archivo y en el zip 1.3.8. La pantalla poll­ea `/state` de la **caja** por LAN para los datos.

### 2.3 ¿La cáscara cambió lo suficiente para reinstalar? → Solo el KDS lo amerita
- La cáscara nueva (~1.3.7) tiene `cff0cb20` (fijar bridge a localhost en preload, rol pos) y `0924b5d5` (KDS offline-native). Están en `feat/pos-ui-kit` + backups `origin/backup/pos-ui-kit-2026081{8,9}`, **no en `origin/main`** (deuda de higiene, no bloquea el jueves — el zip es lo que se instala).
- KDS: 1.3.5 → 1.3.8 sí vale (diseño Eduardo). Caja/entrada: su offline ya funciona en su versión; no reinstalar sin evidencia de que lo necesitan.

---

## 3. Reglas duras — qué NO tocar para no romper offline

De `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`, confirmadas en código:

1. **El KDS se sirve por HTTP local**, nunca `https://app.fullsite.mx/pos/cocina`. Si vuelve a HTTPS, el navegador bloquea el acceso a la IP LAN (mixed-content / Private Network Access) y la cocina se queda en 0 órdenes. El `kds_only` ya lo garantiza — no cambiarlo.
2. **Rol `pos`: `FULLSITE_BRIDGE_URL` debe ser `http://127.0.0.1:7717`** (su propio Pedro), inyectado en el preload antes de montar React. Si apunta a la caja, el satélite se queda sin impresoras.
3. **`saveOrder` necesita AMBOS guards** — `navigator.onLine` + timeout 7s. Quitar uno = el POS se cuelga offline al abrir mesa.
4. **`ORDER_SENT` va por POST HTTP a `/events`**, no por WebSocket. Cambiarlo rompe que el KDS reciba órdenes.
5. **Pedro corre dentro de Electron.** Si se cierra la app, muere el bridge (print + KDS). No sacarlo a proceso aparte sin cuidado. Salida solo con `Ctrl+Shift+Q`.
6. **Desinstalar el "Fullsite" viejo antes de instalar** — libera el puerto 7717. Una instalación a medias deja Pedro en limbo.

---

## 4. Miércoles — prueba de offline (el resolvedor empírico)

Esto elimina las dos incógnitas: **entrada offline** y **qué versión de caja quedó field-proven**.

**Setup:** todas las máquinas prendidas, POS abiertos y logueados, internet presente.

1. **Baseline online:** orden en caja → guarda + imprime + sale en KDS. Orden en entrada → imprime en caja + sale en KDS.
2. **Cortar internet** (WiFi del router OFF — **no** reiniciar máquinas).
3. **Caja offline:** orden → debe imprimir + aparecer en KDS + toast "Sin conexión". → confirma que la versión instalada de la caja sigue field-proven.
4. **Entrada offline (lo no probado):** orden en PDV3 → debe imprimir en caja + salir en KDS. **Si falla → reinstalar entrada a 1.3.7** (trae `cff0cb20`).
5. **KDS 1.3.8:** con la caja offline, el KDS debe seguir mostrando órdenes (poll a `/state`).
6. **Recuperación:** volver internet → las órdenes offline aparecen en Supabase (idempotente por `save_operation_id`).
7. **Verificación de estado** (desde la caja): `http://192.168.1.71:7717/health` → `role:server_pos`, `clients_connected>0`; `http://192.168.1.71:7717/state` → `kds_orders` poblado.

**Huellas:** enrolar cualquier huella nueva **con internet** (el enrolamiento requiere Supabase; la autenticación sí es local/offline). No dejar enrolamientos para el momento sin conexión.

---

## 5. Jueves — orden de instalación

1. **Verificar la caja primero** (no tocarla): `/health` y `/state` OK, F5 en el POS para tomar el fix de velocidad. Abrir Ajustes → anotar la versión real instalada.
2. **KDS PDV2:** desinstalar KDS 1.3.5 → instalar `Fullsite-KDS-1.3.8` → asistente: `kds_only=true`, `pos_server_ip=192.168.1.71` → verificar que carga `http://127.0.0.1:7717/kds` y muestra órdenes de la caja.
3. **Escondite PDV1:** resolver TeamViewer → instalar `Fullsite-POS-1.3.7` → **importar config con el asistente** (`provision:import-config`), nunca editar JSON a mano (fue la causa del BOM) → confirmar `pos_server_ip=192.168.1.71` y reenvío a caja.
4. **Entrada PDV3:** solo si falló la prueba del miércoles → reinstalar a 1.3.7.
5. **Cierre:** repetir la prueba de offline del §4 en vivo como demo.

---

## 6. Fraude — desplegado en grace, no voltear todavía

Todas las correcciones están en `origin/main` (prod), diseñadas con rollout grace → strict:

| Corrección | Estado | Para activar strict |
|---|---|---|
| Detección de skimming (`save-order`) | GRACE (log-only, escribe `skimming_suspect`) | Falta **codificar la Fase 2** (el rechazo aún no existe) |
| Enforcement cancelar (`cancel-item`) | GRACE | `CANCEL_APPROVAL_STRICT=true` |
| Reabrir cuenta pagada (`reopen-order` + `manager-approval`) | GRACE | `POS_APPROVAL_STRICT=true` |
| KDS fan-out retry | ACTIVO | — |
| Agente antifraude consume `skimming_suspect` | ACTIVO (desplegado hoy, `e4d6f77c`) | — |

**Plan de cierre del fraude (post-jueves):** (a) dejar correr tráfico real del jueves con logging; (b) revisar `pos_audit_log` — que `legacy_no_approval` y `skimming_suspect` bajen a cero o sean explicables; (c) voltear los dos flags a `true`; (d) codificar la Fase 2 del skimming.

**Riesgo de gobernanza:** los flags `POS_APPROVAL_STRICT` / `CANCEL_APPROVAL_STRICT` **no están en ningún `.env.example`** ni runbook. Documentarlos para que alguien sepa que existen y cómo voltearlos.

---

## 7. Requisitos de Eduardo — qué falta para el jueves

- **KDS:** cumplidos personas, doble-toque, settings (estación/letra), tarjeta por envío, render robusto. **Falta:** KDS-01 (número de orden secuencial del día), pulido de modo expo, item listo que se tacha/desaparece.
- **POS:** cumplidos la mayoría. **Falta (no bloqueante):** POS-04 (saltar modal sin modificadores), POS-05 (+/- cantidad por modificador). POS-07 (tipos de tarjeta) — AMALAY no lo necesita, diferible.
- **Inventario:** físico y merma ya usan `recordMovement()`. Facturas-proveedor y recepción-factura **aún corrompen el ledger** (PATCH directo) — pase enfocado post-jueves.
- **Diferenciadores IA (DASH-03/04/05):** post-jueves, no bloqueantes.

---

## 8. Riesgos ALTO abiertos que podrían morder el jueves

Ordenados por impacto operativo real:

1. **OFF-01 — ecosistema de impresoras** (`station_id` texto libre, sin validar). **Es exactamente la falla que Eduardo ya vio** (un POS con solo ~3 impresoras ligadas). Alto riesgo de repetirse: un área deja de imprimir en silencio. → Verificar cobertura de impresoras por estación al arranque, antes del servicio.
2. **Local server sin auth en la LAN** (`0.0.0.0:7717` sin token por terminal). Cualquier dispositivo de la red puede cancelar/imprimir/reconfigurar. No bloquea el jueves pero es deuda de seguridad a cerrar pronto. **Cuidado:** toca a Pedro — no meter mano en caliente antes del jueves.
3. **`itemKey` del KDS por índice** — sin confirmar migración a `id` estable; en rondas podría marcar listo el platillo equivocado. Verificar en `kds-ui.html`.

---

## Diagnóstico Escondite — por qué no imprime + fix

> Cerrado con 4 fuentes cruzadas: código (`main.js`, `local-server/index.js`, `printer.js`,
> `config-schema.js`), `PIPELINE-POS-KDS-OFFLINE.md`, notas de campo AMALAY, y una simulación
> con el Pedro real. Escondite = PDV1, `192.168.1.68`, rol `pos`.

**Causa raíz:** el `config.json` de Escondite quedó con un **BOM UTF-8** (3 bytes `EF BB BF`) por
editarlo **a mano en Notepad** (Windows lo mete al guardar como UTF-8). *(PIPELINE L24)*

**Cadena de la falla (citada):**
1. BOM al inicio → `JSON.parse(...'utf8')` tropieza *(main.js:62)* → el `pos_server_ip` no se aplica *(main.js:237: `pos_server_ip || null`)*.
2. Sin `pos_server_ip`, el reenvío a la caja no ocurre *(index.js:185: `if (posServerIp && POST && /print…)`)*.
3. El `/print` cae al handler local *(index.js:319)* → `printToStation` → **Escondite no tiene impresora propia** → `PRINTER_NOT_CONFIGURED`, error 500 *(printer.js:123)* → **no sale nada**.
4. Además, sin `terminal_role='pos'` no se inyecta `FULLSITE_BRIDGE_URL` *(main.js:691-692)* → el POS ni sabe a dónde mandar la impresión.

**Dos firmas posibles (determinan qué verás en sitio):**
- **BOM tumbó el parse completo** → estado `NOT_PROVISIONED` → Escondite arranca en el **wizard de setup** (no abre el POS).
- **Config cargó pero sin `pos_server_ip`** → abre el POS **pero no imprime** (falla silenciosa al enviar).

**Bloqueador secundario:** para arreglarlo hay que correr el asistente, y eso necesita **acceso** (licencia TeamViewer o físico el jueves). *(PIPELINE L47)*

**Cabo viejo a descartar aparte:** el 2026-07-12 (DEBRIEF-JUL12 #10) Escondite falló por `192.168.1.250 unreachable` — esa era la **impresora de tickets de pago** (otra IP, otro problema). Verificar el jueves que esa impresora responda, no vaya a estar tapando otra falla bajo el BOM.

### Fix (paso a paso)

1. Acceso a Escondite (TeamViewer o físico).
2. **Cerrar Fullsite** y **borrar el config viejo** (con BOM): `%APPDATA%\Fullsite POS\config.json` (y `C:\fullsite\config.json` si existe).
3. Desinstalar el Fullsite viejo → instalar **`Fullsite-POS-1.3.7-x64`** (trae el fix P1-1 `cff0cb20` del bridge que Escondite aún no tiene).
4. En el asistente de provisión → **importar config** (NUNCA teclear/editar a mano). Usar el archivo limpio ya validado (abajo).
5. Enviar una orden de prueba → **debe imprimir en la caja**. Verificar en la caja: `http://192.168.1.71:7717/health` → `clients_connected` incluye a Escondite.

### Config limpio (validado contra `config-schema.js`, sin BOM)

```json
{
  "config_version": 1,
  "restaurant_id": "amalay",
  "client_id": "amalay",
  "terminal_id": "amalay-escondite-pdv1",
  "terminal_role": "pos",
  "terminal_name": "Escondite",
  "instance_name": "Escondite (PDV1)",
  "local_server_host": "127.0.0.1",
  "local_server_port": 7717,
  "pos_server_ip": "192.168.1.71",
  "protocol_version": "1.0",
  "channel": "stable",
  "provisioned_at": "2026-08-19T12:00:00-06:00"
}
```

Claves: `pos_server_ip = 192.168.1.71` (la caja → activa el reenvío) y `local_server_host = 127.0.0.1`
(su propio Pedro, NO la caja — ponerlo a la IP de la caja confunde al asistente, PIPELINE L120).
`terminal_id` puede regenerarse como UUID desde el asistente si se prefiere identidad de dispositivo formal.

**Prevención definitiva (post-jueves):** el hueco #1 de clonabilidad (§9) — un generador de config que
nunca se teclea a mano. Escondite es la prueba viviente de por qué importa: la falla no fue de código,
fue de un JSON editado en Notepad.

---

## 9. Clonabilidad — el modelo (post-jueves)

**La arquitectura ya es clonable.** El código soporta: caja como ancla con estado (Local Server), satélites sin estado (POS/KDS apuntando a la caja), config universal sin hardcodes de AMALAY (`config-schema.js`, roles `server_pos/pos/kds`), y UI OTA por web. Lo que falta es **automatización operacional**, no arquitectura:

- **Hueco #1 (P0 de clonabilidad):** generador de `config.json` sin fricción (hoy se edita a mano → causó el BOM de Escondite). Un botón en el dashboard: "Generar config POS Caja/Entrada/KDS" → descarga JSON válido.
- **Hueco #2:** `kds-ui.html` horneado en el .exe — un cambio de UI offline obliga a rebuild+reinstalar (lo que vivimos hoy). Servirlo actualizable desde la caja = cero reinstalación por cambios de UI.
- **Hueco #3:** instaladores pre-empaquetados (exe + config + printers) descargables desde el dashboard. Colapsaría el setup de ~30 min a ~5 min por terminal.
- **HID offline:** falta cache explícito de huellas autorizadas (tipo `pos_staff` en IDB) para que el auth offline sea determinista y el enrolamiento offline tenga flujo claro.

**Regla de oro de clonabilidad:** la caja es el único nodo con estado por restaurante. Clonar = provisionar una caja (client_id + config + snapshot + huellas) y apuntar los satélites a su IP. La velocidad de la caja y la clonabilidad son cosas distintas — no confundirlas.

---

## 10. Guion del demo + qué NO mostrar

**Mostrar:**
1. Orden en caja → guarda + imprime + sale en KDS (online).
2. Cortar internet en vivo.
3. Orden en caja → imprime + sale en KDS + toast "Sin conexión" (esto es lo que impresiona).
4. Volver internet → aparece en Supabase.
5. Si la entrada pasó la prueba del miércoles: mostrarla offline.

**No mostrar:**
- Escondite (config/TeamViewer) si no quedó listo.
- Arranque en frío sin internet (mantener máquinas prendidas).
- Cualquier flujo con impresora no ligada (verificar OFF-01 antes).

---

## Checklist final

**Antes (miércoles):**
- [ ] Prueba de offline completa (§4) — caja, entrada, KDS.
- [ ] Huellas nuevas enroladas con internet.
- [ ] Verificar cobertura de impresoras por estación (OFF-01).
- [ ] Resolver licencia TeamViewer de Escondite.

**Jueves:**
- [ ] Caja: `/health` + `/state` OK, F5. No reinstalar.
- [ ] KDS PDV2: reinstalar 1.3.8, verificar `/kds` local + datos de la caja.
- [ ] Escondite: instalar 1.3.7 + config por asistente.
- [ ] Entrada: reinstalar 1.3.7 solo si falló el miércoles.
- [ ] Demo de offline en vivo.

**Después:**
- [ ] Revisar `pos_audit_log`, voltear flags de fraude a strict.
- [ ] Documentar flags en `.env.example` + runbook.
- [ ] Cerrar facturas-proveedor/recepción al contrato de inventario.
- [ ] Empujar la cáscara (`feat/pos-ui-kit`) a `origin/main`.
