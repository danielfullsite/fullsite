# PIPELINE MAESTRO — Fullsite (todo lo que falta)

> **Documento vivo · única fuente de "qué falta".** Consolidamos aquí todo lo pendiente para
> avanzar **paso a paso**. El detalle por área vive en los docs enlazados; esto es el mapa.
> Actualizar incrementalmente (no regenerar). Última actualización: **2026-08-18**.
>
> **Norte:** cerrar el producto *de esquina a esquina* → tracción (20–50 clientes) → aceleradora → escalar a miles.
> **Dirección:** `docs/product/DIRECTION-EXPERTO-EN-TU-RESTAURANTE.md` — el experto de IA que vive en tu restaurante.
> **Offline (detalle):** `docs/pos/PIPELINE-POS-KDS-OFFLINE.md`.
> **Filosofía (Daniel):** cero features nuevos por gusto → **cerrar y clonar.** Todo lo de abajo debe empujar a eso.

---

## Estado rápido

| Área | Estado |
|---|---|
| Offline (caja + cocina) | ✅ Verificado en campo |
| Velocidad offline | 🟡 Código listo — falta prueba física + deploy |
| KDS diseño Eduardo | 🟡 Código listo — falta build + instalar PDV2 |
| Agente de borde (el experto) | 🟡 v0 listo — falta v1 (nube/Telegram) |
| Huellas + PIN 10 díg. | 🔴 **URGENTE — por hacer** |
| Auditoría de seguridad | 🔴 Pendiente (antes de vender) |
| Escondite | 🔴 Config BOM — sin cerrar |
| UX facelift | 🔴 Pendiente |
| Landing / redes | ✅ Landing viva; redes parcial |
| Tracción comercial | 🟡 LOI (Dunkin'/Carl's Jr./BWW/IHOP) + demos en curso |

---

## 🔴 P0 — AHORA (cerrar el producto + urgentes)

### P0-A · Huellas + PIN de 10 dígitos + separación de usuarios `[URGENTE]`
**Qué:** conectar el lector de **huella (HID / DigitalPersona)** a Fullsite como login principal del POS, para que **nunca se pasen el PIN**. (Antes las huellas HID sí estaban conectadas — en Wansoft.)
- **PIN de 10 dígitos**, **generado aleatoriamente por el sistema** para el personal del POS — nadie lo memoriza ni lo comparte; la **huella** es lo que usan a diario.
- **Separación de usuarios:** los usuarios del **POS** se crean **en el POS** (pos_staff, huella + PIN); los de **dashboard** se crean **en el dashboard** (client_users, correo/contraseña).
- **Contraseñas del POS aleatorias** del sistema (no elegidas por el staff) → la huella es el acceso real; el PIN largo es respaldo que nadie trae en la cabeza.

**Por qué:** matar el "se pasan el PIN" = accountability + anti-fraude real. Es lo que un restaurante serio espera.

**Diseño (borrador):**
- El servicio de huella corre local (DigitalPersona, se vio en el puerto **7718**). Integrar vía el local server (Pedro) o módulo nativo de Electron.
- **Enrolamiento:** capturar template de huella → guardar cifrado, ligado al `pos_staff.id` / usuario.
- **Login:** scan → match local → autentica. **Offline-capable** (templates en caché local).
- **Multi-tenant:** template + PIN scoped por `client_id`.

**Riesgos/notas:** biométrico = dato sensible → cifrar el template, nunca exponerlo; consentimiento del empleado. Confirmar SDK de DigitalPersona/HID disponible en las cajas.
**Estado:** 🔴 por hacer. **Esfuerzo:** medio-alto (integración hardware + auth). **Depende de:** acceso a una caja con lector.

### P0-B · Velocidad offline del POS
`fetchWithTimeout(3.5s)` + guard `navigator.onLine` en rutas calientes (menú, modificadores, pagos, meseros). **NO rompe offline** — va a caché más rápido. tsc+eslint limpios (`0175454b`).
**Falta:** prueba física (cortar WiFi → abrir mesa instantáneo) + deploy a prod (app.fullsite.mx = `origin/main`). **Estado:** 🟡 código listo.

### P0-C · KDS con diseño de Eduardo
`kds-ui.html` reescrito: tarjeta por envío, filtro cocina, toque por item, folio/nº orden, nota de orden, rail de demanda, ajustes, barra del Experto. Vista previa: artifact `18a0a38a`.
**Falta:** revisar diseño → build KDS x64 → reinstalar PDV2. **Estado:** 🟡 código listo (`6eeccd26`, `57bd5e95`, `a2941b58`).

### P0-D · Cerrar Escondite + prueba offline física en secundarios
Escondite: import limpio del config por **asistente** (el BOM lo rompe), `pos_server_ip` de la caja; requiere acceso (TeamViewer/físico). Probar offline físicamente **Entrada + Escondite** (cortar internet → orden → imprime + KDS). **Estado:** 🔴.

### P0-E · Auditoría de seguridad REAL (antes de vender)
No se puede salir a vender sin auditoría real — y **Claude no se autoaudita** (dirá "todo bien"). Un tercero (Hugo, si entra) o un pentest: RLS multi-tenant, auth, rutas sin guard, secretos. Liga con el blindaje (abajo) y con el founding sprint de Hugo. **Estado:** 🔴.

---

## 🟠 P1 — Endurecer para clonar (esquina a esquina)

| # | Tarea | Detalle | Estado |
|---|---|---|---|
| P1-1 | **Auto-inyección del bridge** | Rol pos: bridge `127.0.0.1` solo desde config (hoy manual). Causa raíz diagnosticada (server-discovery lee `pos_bridge_host` viejo); fix = inyección en preload. Ver PIPELINE-POS-KDS-OFFLINE §P1-1. | 🔴 |
| P1-2 | **Empaquetar a binario / tienda** | El POS/KDS en Electron; subir a **Google Play / tienda** para que el cliente baje binarios → arranque en frío y velocidad ya no dependen de la web. (Insight de la plática con Hugo.) | 🔴 |
| P1-3 | **Super-admin centralizado** | Un usuario admin que controle **todos los clientes / POS / terminales** desde un solo lugar. Requisito para operar a escala. | 🔴 |
| P1-4 | **Agente de borde v1** | Baselines desde la nube (ritmo de venta), regla print-falló, push a Telegram cuando hay internet, enriquecimiento LLM online. (v0 ya corre local: `f0b42f4d`.) | 🟡 |
| P1-5 | **KDS status → Supabase** | Avanzar status en el KDS offline actualiza Pedro, no Supabase. Diseñar sync. | 🔴 |
| P1-6 | **Full-screen Entrada** | Kiosko sin barra de Windows. | 🔴 |
| P1-7 | **Limpiar apps viejas 1.3.5** | Pelean el puerto 7717 al reiniciar. Desinstalar. | 🔴 |

---

## 🟡 P2 — Producto / UX

| # | Tarea | Detalle |
|---|---|---|
| P2-1 | **Facelift visual** | Que **no se vea "hecho con IA"** (se parece a todos los productos IA). Solo piel, cero cambios de transacción/operación. Tendencia US: menos dashboards, más **widget/copilot en grande** (estilo ChatGPT). El dueño elige si su landing es el dashboard o el chat. |
| P2-2 | **Flujo de usuario / identificación de cliente (CRM)** | Cliente llega = identificado (nuevo o cautivo) antes de la mesa. Vía **OpenTable/reservas/WhatsApp** → mete al historial cómo pide esa persona. QR con incentivo (café/descuento) para captar. Base para upselling personalizado por IA. |
| P2-3 | **Auto-config completo** | La caja **ya anuncia por mDNS** (`_fullsite-pos._tcp`) → media hecha. Falta: lado POS/KDS descubre la caja + auto-detect de impresoras + confirmar con un toque + fallback. Desbloquea instalar "donde sea". |
| P2-4 | **Un POS configurable + IA personaliza** | Principio: un solo núcleo, jamás forkear por cliente; la IA aprende TU restaurante. (ADR en DIRECTION §4.) |
| P2-5 | **Personas al sentar (paridad Polo) + covers** | Tocar mesa → "¿cuántas personas?" → sentar (hoy no se pide primero). Cambio chico de UI que además alimenta ticket-por-persona, ocupación y forecast — combustible del experto. Idea #1 del teardown de PoloTab. |
| P2-6 | **Paridad operativa POS (teardown Polo)** | Asiento por ítem (A1/A2) para split limpio, rail de categorías por color, modificadores con cantidad + precio abierto, timer visible por mesa. Base operativa; encima va la capa AI-native (experto lee el piso, upsell en el punto, margen/inventario en vivo). Ver artifact teardown PoloTab. |

---

## 🟢 P3 — Comercial / tracción

| # | Tarea | Detalle |
|---|---|---|
| P3-1 | **Demo Eduardo (jueves 20-ago @ AMALAY)** | Velocidad + KDS + install. Ángulo: "apagué el internet y el experto sigue vivo". |
| P3-2 | **Demo Boruca (Monclova)** | Cuenta demo con datos ficticios + agentes + chat. (Pausado en el esquema de prod; SQL a un paso.) |
| P3-3 | **Storytelling vs Wansoft** | Con datos reales de AMALAY (1 mes): "con Wansoft costaba X, con nosotros Y, + forecasting/predictivo". Por qué cambiar. El purpose: "tu experto en tu propio restaurante por $500 más/mes". |
| P3-4 | **Redes / marketing** | LinkedIn, Instagram/Facebook, posts, waiting list. Landing ya viva. |
| P3-5 | **Meta de tracción** | 20–50 clientes este año (200 con las LOI). Con 20–50 → reaplicar a Y Combinator. Franquicias grandes requieren certificación de marca para el POS. |

---

## 🔵 P4 — Revenue engine (futuro, cuando el núcleo esté cerrado)

| # | Idea | Nota |
|---|---|---|
| P4-1 | **% por transacción** | Terminales white-label (tipo Clip/Toast) → % de cada transacción. El 80% del revenue de Toast US viene de esto. También transacciones proveedor↔restaurante (tickets más grandes). |
| P4-2 | **Voice-AI** | Agente de llamadas (ElevenLabs, ~1.4 MXN/min) para reservas/soporte/proveedores. Colaboración posible con "diálogos" (Domino's/KFC/Papa John's MX). Hugo ya lo tiene funcionando. |
| P4-3 | **WhatsApp payments** | Llega el otro año; que el cliente pague por WhatsApp. |
| P4-4 | **Proveedores / compras** | Marketplace de materia prima (aguacate, chile, etc.) — otra entrada de dinero. |
| P4-5 | **Integraciones delivery** | Uber Eats/Rappi ya llegan al KDS; DiDi Food falta. |

---

## 🛡️ Deuda de seguridad (blindaje — liga con P0-E)

| # | Tarea | Estado |
|---|---|---|
| SEC-1 | 2FA super-admin (daniel@fullsite.mx) | pendiente |
| SEC-2 | Cookie `fs-at` httpOnly (anti-robo XSS) | pendiente |
| SEC-3 | Invitación + reset por correo (SMTP) | pendiente |
| SEC-4 | Endurecer `/api/pos/kitchen` con token de cocina | pendiente |
| SEC-5 | RLS multi-tenant (aislamiento) — validar en prod | pendiente |
| B1 | Cerrar puertas abiertas (guards aditivos) | en curso |

Ref: `docs/…` blindaje / auditoría de seguridad 2026-08-17.

---

## Cómo avanzamos (paso a paso)
1. **Esta semana:** P0-B (velocidad, probar+deploy) + P0-C (KDS build) para el **jueves**; arrancar **P0-A (huellas/PIN)** en cuanto haya caja con lector.
2. **Siguiente:** P0-D (Escondite), P0-E (auditoría — con Hugo en el founding sprint).
3. **Luego:** P1 (endurecer para clonar) → P2 (UX/CRM) en paralelo al comercial (P3).
4. **Regla:** cada item empuja a *cerrar y clonar*. Nada de features nuevos que no sirvan a eso.

*Detalle offline: `docs/pos/PIPELINE-POS-KDS-OFFLINE.md`. Dirección: `docs/product/DIRECTION-EXPERTO-EN-TU-RESTAURANTE.md`.*
