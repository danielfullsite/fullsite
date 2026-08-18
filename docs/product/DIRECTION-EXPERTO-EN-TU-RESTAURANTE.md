# Dirección de Fullsite — "El experto de IA que vive en tu restaurante"

> **v1 · 2026-08-18.** Tesis de dirección + plan ejecutable. Hoja tesis (para fijar y
> enseñar a Eduardo/inversionistas): https://claude.ai/code/artifact/a06ddcc3-9fbc-438a-8c42-03c85371ac63
>
> **La frase que ordena todo:** *No vendemos otro POS. Vendemos un experto que nunca duerme
> —y que de paso maneja tu punto de venta.* **El POS es el cómo. La IA es el qué.**
> El POS = el sensor (cómo el experto ve todo lo que pasa). La IA = el producto.

---

## Por qué esta dirección (no es un cambio, es un afilado)

- Ya lo dijo Daniel solo: *"un experto en tu restaurante."* Eso ES la dirección.
- Wansoft y los demás venden cajas registradoras: **manos, no cerebro.** Perdiendo clientes post-Clip. No nos pueden copiar porque no tienen IA.
- Nuestros activos ya en mano: **26 agentes**, el **offline cerrado** (caja + cocina imprimen/reciben sin internet — ver [[OFFLINE-LAN-FIELD-PROVEN-AND-CLONE]]), y **Eduardo** (ex-Wansoft CCO).
- Encaja con el core value prop existente ([[project_core_value_prop]]): *info al segundo → decisiones en tiempo real → más revenue.*

---

## Las 5 jugadas (de la tesis a la ejecución)

### 1. Nombrar la dirección — HECHO
Frase congelada: **"El experto que vive en tu restaurante."** Landing ya reposicionada
(`fullsite-web/index.html`: hero "Un experto de IA en tu restaurante"). Hoja tesis publicada.

### 2. El agente de borde (edge agent) — PLAN
El diferenciador que nadie más tiene: un experto que vigila **en vivo y offline**, dentro de Pedro.

- **Dónde vive:** `electron-app/local-server/` — nuevo módulo (ej. `core/edge-watcher.js`), corriendo DENTRO de Pedro (la caja). No es la nube; es el borde.
- **Qué observa:** el event store local + `/state` (kds_orders, tiempos por orden/batch, cancelaciones, ritmo de venta). Cero dependencia de internet.
- **Reglas v0 (deterministas, locales — sin LLM, baratas y offline):**
  - Mesa/comanda enviada hace > N min sin avanzar de status → "Mesa 12 lleva 14 min".
  - Orden enviada pero print falló (print_jobs_failed) → "no se imprimió la mesa 9".
  - Pico de cancelaciones/descuentos vs. baseline → alerta de fraude.
  - Ritmo de venta de un platillo vs. baseline → "el salmón se acaba a las 2pm".
- **Entrega de alertas:** local primero (toast/panel en el KDS o una vista de alertas) + cuando hay internet, empuja al war room / Telegram (los 26 agentes ya existentes). Offline → encola.
- **Por qué local:** debe funcionar con el internet caído (es el punto). Las reglas deterministas corren en el borde; el **enriquecimiento con LLM** ocurre en los agentes de nube cuando hay conexión.
- **Fases:** v0 reglas locales deterministas → v1 sincronizar baselines desde la nube → v2 enriquecimiento LLM online + acciones sugeridas.
- **Regla de oro (del offline):** el borde nunca depende de la nube para operar; la nube enriquece, no habilita.

### 3. Auto-config (detectar + confirmar + fallback) — PLAN
Desbloquea los 10,000 y el "instálate donde sea". **NO perseguir el 100% autónomo.**

- **Descubrimiento de la caja:** la caja (server_pos) **anuncia** un servicio mDNS/Bonjour (ej. `_fullsite-pos._tcp` en :7717). Los POS/KDS **navegan** la red y la encuentran solos.
- **Impresoras:** enumerar por el SO (Electron `webContents.getPrintersAsync()`) + sondear puertos comunes de impresoras de red.
- **Flujo:** primer arranque → escanea → propone `{IP caja, rol sugerido, impresoras encontradas}` → **un toque para confirmar** → escribe el `config.json` (validado, **sin BOM**) → y **siempre** el asistente manual como fallback.
- **Inferencia de rol:** si encuentra una caja → es secundario (pos/kds); si no encuentra ninguna → ofrece ser la caja (server_pos).
- **Fases:** v0 mDNS descubre la caja + confirmar → v1 auto-detect de impresoras → v2 inferencia de rol / cero-toque.
- **Regla de oro (del offline, la lección del BOM):** **automatiza y valida, nunca teclees a mano.** Auto-config es esa ley aplicada a la instalación. Ver [[OFFLINE-LAN-FIELD-PROVEN-AND-CLONE]] §5.

### 4. Un POS, configurable + IA que personaliza — PRINCIPIO (ADR)
- **Un solo núcleo, config-driven. Jamás forkear por cliente.** La personalización de verdad = **la IA aprende TU restaurante** (menú, meseros, datos), no UI a la medida.
- **Configurable por datos:** menú, estaciones, impresoras, roles, feature-flags, plano de mesas.
- **Prohibido:** ramas de código por cliente, UIs hechas a mano por cliente. Eso se rompe y mata la clonabilidad.
- Ata con [[project_multitenant_architecture_decision]] + [[project_p1_golden_skeleton]].

### 5. La demo con Eduardo (jueves 2026-08-20) — GUION
El ángulo NO es "mira mi POS offline". Es **"apagué el internet y el experto sigue vivo."**

Secuencia sugerida (honesta con lo verificado — caja + KDS offline, ver [[project_amalay_pos_reinstall_20260817]]):
1. Operación normal, con internet: toma orden → imprime → sale en KDS.
2. **Corta el WiFi en vivo.** (El momento.)
3. Toma otra orden offline → **imprime en la caja + sale en el KDS** (los dos verificados offline).
4. Señala el ángulo del experto: "y esto, vigilándote, aunque no haya internet" (edge agent, cuando exista; hoy narrarlo como el siguiente paso).
5. Reconecta → **sincroniza solo** a la nube.
> No sobre-vender: Entrada/Escondite offline aún NO probados; no demostrarlos offline sin probar antes.

---

## Lo que NO haremos (la disciplina)
1. **Perseguir el 100% autónomo** — el último 5% del auto-detect come 3 meses. Auto + confirmar + fallback.
2. **Un POS a la medida por cliente** — se rompe, cada bug se multiplica, mata la clonabilidad.

> *Se ven bonitas. Te matan a escala.*

---

## El foso
El **borde inteligente + el offline + una IA enfocada en plata**, combinados en un solo producto
clonable. Nadie más lo tiene junto. Wansoft tiene manos; nosotros tenemos el experto.
**Fullsite no es donde cobras. Es quien te ayuda a ganar.**

---

## Estado / siguiente
- Jugada 1: HECHO (landing + tesis).
- Jugada 5: guion listo (arriba) — ejecutar el jueves.
- Jugadas 2, 3, 4: PLAN listo aquí. Arranque sugerido: **el agente de borde v0** (reglas
  deterministas locales) — es el más on-brand y encaja con el offline ya cerrado. Esperar go de Daniel para construir.

*Relacionados: `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`, `docs/pos/PIPELINE-POS-KDS-OFFLINE.md`.*
