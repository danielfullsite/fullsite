# Fullsite — 4 apuestas técnicas (research 2026-08-16)

Cuatro herramientas/enfoques evaluados contra los cuellos de botella REALES de
Fullsite. Ranking por leverage. #1 ya tiene spike (PR #40); #2–#4 aquí con plan
concreto.

> **Caveat honesto:** ninguna le gana a **conseguir el cliente #2 pagando**. La
> tecnología solo vale si ayuda a cerrar/retener clientes. Estas 4 se eligen porque
> hacen *vendible/escalable* lo que ya existe.

---

## #1 · Scrapling → blindar el scraper de Wansoft  🟢 lift bajo · SHIPPED (spike)

**Dolor:** la ingesta de Wansoft es la columna vertebral de datos y es frágil
(`wansoft_browser_scraper.py`, 1002 líneas Playwright): cookie que se rompe,
cambios de HTML tumban selectores, detección de bots.

**Scrapling:** selectores auto-reparables (guarda huella del elemento y lo
re-encuentra tras rediseños) + bypass Cloudflare/Turnstile (StealthyFetcher) +
AutoThrottle + MCP server.

**Estado:** spike aislado en `scripts/spikes/scrapling_wansoft_spike.py` (PR #40).
**Siguiente:** Daniel lo corre contra Wansoft real; si aguanta → migrar el scraper
detrás de un flag (login + selectores de datos primero). Sube meta agentes >95% (#26).

---

## #2 · PowerSync → offline REAL  🟢 lift alto · EL win de producto

**Dolor:** el gap #1 del audit — el offline **no está cableado**. Hoy es por-terminal
(2 terminales no comparten mesas offline); `local-server` está en modo observe-only y
"Supabase sigue siendo write authority". El modelo Pedro/SERVER1 (local-master) no existe.

**PowerSync:** motor local-first que sincroniza **Supabase Postgres → SQLite en el
dispositivo** con write-back, battle-tested en producción/móvil. Reemplaza el esfuerzo
custom de local-server con un motor probado.

**Plan de integración:**
1. **Sync rules** (qué sincroniza cada terminal): `pos_orders`, `pos_menu_items`,
   `pos_menu_categories`, `pos_modifiers`, `pos_staff`, `pos_turnos`, `clients.mesas`
   — filtradas por `client_id` (una "bucket" por tenant → aislamiento + tamaño chico).
2. **Write path:** las mutaciones del POS (guardar orden, cobrar) van a SQLite local
   → PowerSync las encola → sube a Supabase al reconectar. Cero pantalla en blanco offline.
3. **Local-master (Pedro):** una terminal ancla corre el sync; las demás leen de ella en
   LAN. PowerSync ya resuelve el conflicto/merge que el local-server custom no tiene.
4. **Costo:** PowerSync Cloud tiene tier gratis; self-host disponible (bootstrap-friendly).

**Esfuerzo:** 1–2 semanas (POC → 1 tenant → rollout). **Decisión de Daniel:** ¿Cloud
o self-host? Es un cambio de arquitectura — hacer POC en `lab-resto` antes de AMALAY.
Alternativa evaluada: ElectricSQL (más potente, menos maduro). **Voto: PowerSync** por
madurez en producción.

---

## #3 · Conector de VOZ/WhatsApp → nueva línea de ingreso  💰 (+ partnership Dialogus)

**Validación de mercado:** los restaurantes pierden **30%+ de llamadas** en hora pico;
**83%** ordenan en otro lado si cae en buzón. En 2026 la voz-IA ya es capacidad core de
POS (integra POS+KDS + links de pago por WhatsApp).

**El unlock de Fullsite:** ya existe el pipeline de ingesta de órdenes de delivery. **El
conector de voz es literalmente otro `platform` en la misma tabla `delivery_orders`.**

**Diseño concreto (calcado del webhook `api/webhook/ubereats/route.ts`):**
```
POST /api/webhook/dialogus            (o /api/integrations/voice/order)
  1. Lee raw body, verifica firma HMAC-SHA256 (fail-closed si no hay secret → 401).
  2. Resuelve client_id vía integration_store_mappings
     (provider='dialogus', provider_store_id = id del agente de voz del restaurante).
  3. Inserta en delivery_orders:
       { platform: 'voice', client_id, platform_order_id, status: 'nueva',
         raw_payload: <orden capturada por el agente de voz> }
  → aparece en /pos/delivery + KDS como cualquier orden. Cero UI nueva para el mesero.
```
**Quién hace qué:** Dialogus (Juberth) captura la orden por voz/WhatsApp y hace POST al
webhook; Fullsite provee el backend de POS/menú/CFDI. Co-selling de restaurantes.
Ver memoria `dialogus-partnership`.

**Esfuerzo Fullsite:** ~2–3 días para el webhook + mapping + status 'voice' en /pos/delivery
(el pipeline ya existe). Bloqueado por: definir el contrato de payload con Dialogus.

---

## #4 · Stagehand / Browser-Use → "conecta CUALQUIER POS"  🚀 el desbloqueo de escala

**Dolor:** para llegar a 10,000 clientes no puedes escribir un scraper a mano por cada
POS legacy (Soft Restaurant, National Soft, etc.). Hoy solo existe el de Wansoft.

**Enfoque:** automatización de browser con **acciones en lenguaje natural que se
auto-reparan** (Stagehand = primitivas IA sobre Playwright; Browser-Use = agente LLM).
Patrón de producción ganador = **híbrido**: Scrapling/Playwright para el 80% predecible
+ IA (Stagehand) para el 20% que necesita "entender" una pantalla nueva.

**Plan:** un "ingestion agent" genérico que, dado un POS web + creds, descubre y extrae
menú/ventas/inventario con instrucciones en lenguaje natural ("encuentra la tabla de
platillos y extrae nombre, precio, costo"). Reusa el flag/adaptador de #1.

**Esfuerzo:** POC 3–5 días sobre 1 POS nuevo (no-Wansoft). **Prematuro hasta tener
varios clientes** — se activa cuando el pipeline de #1 esté probado y haya demanda de un
2º tipo de POS. Es la historia de clonabilidad/escala, no un quick-win de hoy.

---

## Secuencia recomendada

| Orden | Apuesta | Por qué | Quién |
|---|---|---|---|
| **Ahora** | #1 Scrapling (correr spike #40) | de-riesga la columna vertebral, lift bajo | Daniel corre / Claude migra |
| **Sig. producto** | #2 PowerSync (POC en lab-resto) | resuelve el offline, ancla de confianza | Claude POC / Daniel decide infra |
| **Ingreso nuevo** | #3 Conector voz (con Dialogus) | $ nuevo, reusa pipeline existente | Fullsite+Juberth |
| **Escala** | #4 Stagehand | conecta cualquier POS a 10k clientes | cuando haya demanda |

**En paralelo (no-código, mayor leverage):** Conekta/pagos + listar restaurantes + cerrar cliente #2.
