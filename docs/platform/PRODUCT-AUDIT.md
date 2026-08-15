# Fullsite — Auditoría integral de producto (de pies a cabeza)

> Fecha: 2026-08-15. Autor: auditoría multi-agente (10 dimensiones, cada hallazgo aterrizado en código/DB).
> Objetivo: radiografía honesta para hacer de Fullsite **el siguiente POS para restaurantes (MX)**.
> Método: 6 auditores de producto + 4 de riesgo (seguridad, integridad de onboarding, dinero/offline, gaps), leyendo código real, la DB de prod y de staging, y los docs de estrategia.

---

## 0. Veredicto ejecutivo

**Fullsite NO es "solo un POS" — es un OS de inteligencia operacional que incluye un POS.** Y esa es su fortaleza real y rara: un back-office MX-nativo profundo (CFDI 4.0 real, ledger de inventario de ciclo cerrado, food-cost, recetas) + IA tejida en la operación + un core clonable multi-tenant. Los incumbentes (Wansoft, Soft Restaurant, SICAR) no tienen nada cercano; Toast/Square/Clip no tienen esta profundidad en español con CFDI.

**Pero tres cosas separan "un POS muy bueno para AMALAY" de "el siguiente POS":**
1. El **offline no arranca sin internet** (la promesa #1 al restaurante) — el motor está construido, el *boot* no.
2. La **IA es 100% consejo, 0% acción** (ningún agente escribe de vuelta al POS) y depende de un scraper muerto.
3. El **onboarding requiere a Daniel** y el motor de clonación es spec + hardcodes de AMALAY.

Madurez por capa: **POS core ~70%** de un Toast/Parrot · **Ecosistema MX ~80%** (mejor de lo que se cree) · **Readiness de escala/equipo ~4/10** · **Validación de mercado: 1 piloto, 0 clientes pagando.**

**El foco de más leverage:** hacer que el offline arranque de verdad + empaquetar el loop de food-cost/anti-fraude en un reporte "cuánto dinero te ahorramos" → cerrar 5–10 restaurantes de Monterrey que se queden. Todo lo demás (pagos, flywheel, 10k) es downstream de probar ese loop con dinero real.

---

## 1. Los 6 temas transversales (aparecen en varias auditorías = máxima señal)

Estos son los que más importan, porque los cazaron auditores independientes por separado:

### T1 · El "local-master" offline no está cableado — el offline es por-terminal, no compartido 🔴
Aparece en **4 auditorías** (POS core, integraciones, arquitectura, estrategia). El `electron-app/local-server/` es un bridge event-sourced real (event-store, ws-hub, mDNS, `MESA_LOCK`), pero está en **Fase 1 observe-only**: *"Supabase sigue siendo la autoridad de escritura (Fase 2 lo cambia)"*. Solo observa Supabase (poll 5s) y rebroadcast. Cada POS tiene su propio IndexedDB. **Con internet caído, dos terminales no ven las mesas del otro** → doble-sentado/tickets perdidos. Y el `/pos` ni usa el bridge (solo el KDS). **Es el gap #1 de producto y de la promesa "funciona sin internet".**

### T2 · Aislamiento entre tenants por service-key + ~293 filtros a mano 🔴
Aparece en la auditoría de arquitectura + la de seguridad de anoche. **44 de 71 rutas** usan la SERVICE KEY (que brinca RLS); el aislamiento depende de `.eq('client_id')` escrito a mano 293× en 45 rutas. **Un filtro olvidado = fuga cross-tenant** — exactamente el P0 recurrente (BUG-019). Anoche confirmé y **sellé 17 rutas** que confiaban en un header manipulable (PR #31), pero la solución sistémica es: **una capa de query tenant-scoped que SIEMPRE inyecte client_id + RLS como defensa + un test de aislamiento en CI** (hoy no existe).

### T3 · Hardcodes de AMALAY + motor de migración spec-only 🟠
Aparece en arquitectura, onboarding, estrategia. **176 refs a `amalay`** en el código, 29 workflows con `CLIENT_ID` default a amalay, la URL de Supabase de amalay como fallback. El `migrate-wansoft-to-supabase.py` tiene **`CLIENT_ID='amalay'` hardcodeado** (migrar un cliente #2 **contamina AMALAY**). El motor de migración es contrato + `FakeConnector`; el import real es scrapers ad-hoc. **Onboardear el tenant #2 es un ejercicio manual de des-hardcodeo, no un botón.**

### T4 · La IA es advisory-only, sobre datos muertos, y su mejor output no lo lee nadie 🟠
Auditoría de IA. Los 19 agentes analíticos son **reales** (analítica determinista, no teatro de LLM) y el copiloto de chat es **genuinamente bueno** (RAG paralelo). PERO: (a) **100% consejo, 0% acción** — ningún agente escribe de vuelta al POS; `auto86_agent` calcula qué platillos no se pueden servir y solo **manda un Telegram**; (b) dependen del scraper de Wansoft, **muerto en prod** (`wansoft_daily` 26 días stale, `wansoft_kpis` ~2 meses); (c) **804 insights/mes** ricos en `agent_insights` que **ninguna pantalla lee** (leen `agent_results`, más pobre).

### T5 · Daniel es el cuello de botella del onboarding 🟠
Estrategia + arquitectura + los docs de escala. Onboarding-en-semanas + Daniel-corre-cada-alta **te topa estructuralmente en ~10 restaurantes.** El wizard self-serve (`/platform` selector de fuente → connector → provisionTenant) es la diferencia entre una consultoría y una empresa. La base existe (`provisionTenant`, imports); falta la **capa de orquestación + UI**.

### T6 · Caos de proceso de ingeniería — un equipo no sobrevive así 🟠
Arquitectura. **28 worktrees, 61 ramas (47 sin mergear a main), main sin tocar desde ago 5**, el working tree en `offline-shell/local-load` no en main, deploy por "git push a main" sin gate. **Superficie de conflicto enorme, sin trunk.** Un 2do/3er ingeniero no puede integrar aquí de forma segura.

---

## 2. Fortalezas reales (verificadas en código, no asumidas)

Fullsite tiene activos que los incumbentes **no pueden copiar fácil**:

- **Back-office MX-nativo profundo.** 189 páginas: ledger de inventario de ciclo cerrado (`recordMovement()`), food-cost, sub-recetas, conversiones de unidad, órdenes de compra, merma, conteos físicos. Cerca de *Soft Restaurant en profundidad + MarginEdge en back-office + UI moderna*. Raro y real.
- **CFDI 4.0 REAL.** Facturama con CSD de producción vigente (a 2028), timbrado→UUID SAT, factura global, complemento de pago, PDF/XML/email, multi-RFC, y export de pólizas compatible CONTPAQi. Moat contra Toast/Square (no tienen), paridad+ vs Soft Restaurant.
- **Pagos con tarjeta REALES.** Mercado Pago Point (SMART/MINI) con máquina de recuperación: si la terminal cobra pero la DB falla, un banner persistente permite reintentar idempotente. No es cash-only.
- **Uber Eats production-ready.** OAuth dual, webhooks HMAC deduplicados con DLQ+audit, ciclo completo de orden, menu sync, 30 test suites.
- **POS core serio.** Offline-first con clasificación tipada de conflictos (OCC + idempotencia exactly-once), grupos de modificadores con min/max, 3 modos de split + mixto, impresión ESC/POS con fallback, gobernanza de cancelaciones con **PIN de gerente + biométrico WebAuthn**, arqueo correcto turno-scoped, RBAC de ~50 permisos.
- **Cultura de test profunda para la etapa.** 2,128 bloques de test (57 archivos vitest), CI real (tsc strict + vitest + build, **sin suprimir errores**), + un **harness de digital-twin offline** que probó exactly-once y no-pérdida-de-impresión bajo caos de red.
- **IA tejida en la operación, no bolt-on.** Copiloto de chat data-grounded (Groq→Claude fallback), 19 agentes analíticos deterministas, orquestador de Telegram. Ningún incumbente MX tiene algo cercano.
- **Core clonable multi-tenant diseñado desde día 0.** `/platform`, `provisionTenant`, `data_source` fallback (lee `pos_orders` cuando `wansoft_daily` está vacío). El cloneability report prueba el flujo completo para un 2do tenant sin cambios de código.

---

## 3. Áreas de oportunidad por dimensión (top, con esfuerzo)

### POS core
1. Cablear el local-master LAN (T1) · **L**
2. Locking de mesas real + floor en realtime (hoy: sin lock, poll 5s; el `MESA_LOCK` ya existe sin cablear) · **M**
3. Unificar los 3 KDS (`kds`/`cocina`/`barra` divergentes; tiran `__tiempo__` y `silla`) + hacerlos course/seat-aware · **M**
4. **Reembolsos post-pago** (NO existen — solo void de orden no-pagada) · **M**
5. 🐞 **Transferencia de mesa completa SIN auth** (`page.tsx:4126` — cualquier mesero mueve cualquier mesa, sin PIN, y colisiona órdenes) · **S**
6. Conteo por denominación real + corte ciego + cashout por mesero (el array de billetes es dead code) · **M**
7. Lealtad / recibos digitales / CFDI-QR en el ticket (greenfield) · **L**
8. Matar drags de throughput: `sleep(15000)` bloqueante tras cada envío/pago, modificadores como strings regex-parseados, y 🐞 un **toast que miente** ("ingredientes devueltos al inventario" cuando el reverso está deshabilitado) · **S**

### Dashboard del dueño
- Reporting real y data-grounded, pero: 🐞 bug de parseo **`<100` (% vs MXN)** que puede mostrar números mal (`data.ts:287`, ecommerce), patrón de timezone `T12:00:00`, y riesgo de **"NaN"** en mission-control con `duration_ms` nulo.
- Oportunidad: pasar de "datos" a "decisiones" — labor %, prime cost, menu engineering accionable, forecast, retención.

### IA / automatización
1. **Cerrar UN loop:** auto-86 que de verdad 86'ea vía `/api/pos/menu` (con undo + audit) · **M** — el mayor moat
2. **Matar la dependencia de Wansoft:** que el POS propio de Fullsite sea la fuente de verdad (computar los agregados de `pos_orders`) · **L**
3. **Mostrar `agent_insights`** (804/mes ya escritos, nadie los lee) · **S** — máximo valor/hora
4. Insights accionables en un tap (cada uno ya tiene `recommended_action` + `deep_link`) · **M**
5. Dedup + gating de confianza (654 críticos de 16 acciones distintas = alert fatigue) · **S**
6. Agentes **event-driven, no cron** (fraude en la transacción, no horas después) · **M**
7. Baselines aprendidos por-tenant (hoy thresholds hardcodeados a AMALAY) · **L**

### Integraciones / ecosistema / offline
1. **Probar el loop offline completo en hardware** (nunca se corrió end-to-end; el test físico es de esta semana, sin pasar aún) · **M**
2. Cablear el local-master (T1) · **L**
3. Auto-facturación al cierre (QR self-serve; hoy CFDI es 100% manual) · **M**
4. Endurecer o retirar el connector de Wansoft (cookie 7-14 días, CAPTCHA) · **M**
5. Corte offline (el cierre lee Supabase sin fallback IDB) · **M**
6. Ampliar aceptación de tarjeta (Clip/Conekta — hoy solo MP; lock-in de adquirente es sell-blocker en MX) · **M**
7. Rappi (código completo, fail-closed esperando el contrato de firma de Rappi) · **M, externo**

### Arquitectura / escala
1. Capa de query tenant-scoped centralizada + RLS defensa (T2) · **L**
2. Test de RLS/aislamiento real en CI (hoy solo FakeEngine) · **M**
3. Canal de update OTA (hoy: instalación por USB manual, sin auto-update) · **L**
4. Flujo trunk-based, matar worktrees/ramas stale, deploy con gate (T6) · **M**
5. Descomponer god-components (`pos/page.tsx` 5,768 líneas) · **L**
6. Capa de caché frontend (React Query — hoy 423 `useEffect` fetch sin dedup) · **M**
7. Consolidar superficie Electron duplicada (colisión de puerto 7717) · **M**
8. Des-hardcodear AMALAY + terminar el motor clonable (T3) · **M**

---

## 4. La cuña estratégica (para ser "el siguiente POS")

**Gana primero esto:** *control operacional AI-native + food-cost/anti-fraude en tiempo real, para independientes full-service de dueño-operador en Monterrey/Noreste que están en Wansoft o Soft Restaurant — vendido como "el sistema que atrapa el dinero que se te fuga de la cocina", con offline a prueba de balas como ancla de confianza.*

Por qué esta cuña:
- **Segmento validado** en tus propios docs: full-service, dueño-operador, $850K–$3M MXN/mes, 15–60 staff, 2–4 terminales, en tu patio (Noreste, donde Wansoft es más fuerte). El dueño decide solo → ciclo corto. AMALAY es tu prueba de existencia.
- **Lo que gana es Tier 2, no Tier 1.** POS/KDS/CFDI es "el derecho a jugar". Lo diferenciado es **food-cost real-time + anti-fraude automático** — que ya construiste (ledger de ciclo cerrado + agente de fraude). El pitch se escribe solo: atrapar un error de 3% de food-cost ≈ decenas de miles MXN/mes = el SaaS se paga 30–40×.
- **Offline es el ancla de confianza** que neutraliza el miedo #1 ("perder ventas en la transición / que se caiga"). "Funciona sin internet, verificable" es LA claim — **una vez que el boot arranque de verdad.**

**No es** "AI-native para todos los que migran de Wansoft". La migración de Wansoft es un *connector concierge* para un segmento, no el motor de crecimiento (el CAPTCHA cookie-por-cliente es techo duro). La cuña es una *capacidad* (detección de fugas + confiabilidad) vendida a un *segmento denso, alcanzable, dueño-operador* — con la salida de Wansoft/Soft Restaurant como *trigger*, no como *mecanismo*.

---

## 5. Los riesgos estratégicos más grandes

1. **Un piloto. Cero clientes pagando.** Toda la tesis descansa en AMALAY. Parrot tiene 1,500 clientes probando PMF; tú tienes una hipótesis. Nada importa hasta tener 5–10 restaurantes que paguen y **se queden**.
2. **El offline es tu mayor activo Y tu mayor exposición.** Estás vendiendo "funciona sin internet" con el boot roto. Si a un prospecto se le pone pantalla negra offline en un trial, pierdes el deal Y tu diferenciación en un momento. Arréglalo antes de venderlo.
3. **Clip es dueño de Wansoft — y de los pagos en MX.** "Wansoft + Clip Capital + pagos embebidos" es el vector competitivo real (el playbook de Toast). Debes ganar en *inteligencia + confiabilidad + UX fiscal* antes de que el bundling de pagos sea el eje.
4. **Sprawl de superficie vs un usuario no validado.** 189 páginas, 62 workflows — mucho construido para la forma específica de AMALAY. Amplitud adelantada a la demanda = impuesto de mantenimiento + landmine por-cliente.
5. **Fudo y OlaClick atacan el piso** ($360/mo con IA real de WhatsApp; gratis). Pueden comoditizar "IA" antes de que establezcas que IA *operacional* a $1,999 es otra cosa. Tu defensa es profundidad — lidera con ella, nunca con "tenemos IA".

---

## 6. Roadmap priorizado (síntesis de las 10 auditorías)

### 🔴 P0 — Antes de un 2do cliente (bloquean todo)
1. **Sellar el aislamiento sistémico (T2):** mergear el PR #31 (17 rutas, ya listo) + capa de query tenant-scoped + test de RLS en CI. *El riesgo company-ending.*
2. **Des-hardcodear AMALAY + parametrizar la migración (T3):** `CLIENT_ID` fuera del migrador, `staff_import` por `id`, gate de rechazo si orphan-rate alto. *Migrar un cliente hoy contamina AMALAY.*
3. **Arreglar los bugs de correctness cazados:** transferencia de mesa sin auth, el toast que miente, el parseo `<100`.

### 🔴 P0 — La cuña (gana el derecho a vender)
4. **Hacer que el offline BOOT arranque sin internet** (bundle local + local-master, T1). *Convierte tu mayor inversión de ingeniería de liability a arma de ventas.*
5. **Validar CFDI real en producción** (timbrar de verdad para AMALAY; IEPS/retenciones). *Code built ≠ validated.*

### 🟠 P1 — El moat (cierra el cheque)
6. **Cerrar UN loop de IA** (auto-86 real vía `/api/pos/menu`) + **mostrar `agent_insights`** + **matar la dependencia de Wansoft** (POS propio como fuente).
7. **Empaquetar el reporte "cuánto dinero te ahorramos"** (food-cost + anti-fraude dolarizado) → el ROI que cierra deals y el motor de referidos.
8. **Agentes event-driven** (fraude en la transacción).

### 🟠 P1 — Escala (deja de ser consultoría)
9. **Wizard de onboarding self-serve en `/platform`** (selector de fuente → connector → provisionTenant, T5) + resolver el 65% de rechazo en la capa canónica.
10. **Canal OTA** + **flujo trunk-based** (T6) + **capa de caché frontend**.

### 🟡 P2 — Ampliar el embudo
11. Reembolsos post-pago · lealtad/recibos digitales · Clip/Conekta · auto-facturación QR · Rappi (externo) · unificar KDS · descomponer god-components · export "los datos son tuyos".

---

## 7. La única frase

> **"El siguiente POS para restaurantes" es creíble — pero no como POS, sino como el *OS de inteligencia operacional* que incluye un POS, para independientes MX de dueño-operador.** Tienes activos raros que los incumbentes no copian (back-office MX profundo con CFDI real, offline serio, IA operacional, core clonable). El foco de más leverage: **haz que el offline arranque de verdad + empaqueta el loop de food-cost/anti-fraude en un "cuánto dinero te ahorramos" — y con eso cierra 5–10 restaurantes de Monterrey que se queden.** Gana la cuña antes de ampliar la misión.

---

*Apéndice — dimensiones auditadas: (1) POS core & UX, (2) dashboard del dueño & analítica, (3) IA & automatización, (4) arquitectura & deuda técnica, (5) integraciones & offline/hardware, (6) estrategia & posicionamiento, (7) aislamiento cross-tenant, (8) integridad de onboarding/migración, (9) dinero/offline del POS, (10) reconciliación de "qué falta". Cada hallazgo con evidencia en código/DB; transcripciones completas en la sesión.*
