# Dirección de arquitectura de IA — de enjambre ciego a un experto con herramientas

> Decidido 2026-08-19. Cómo debe evolucionar la capa de IA para ser **precisa** y coherente con el
> producto ("un experto de IA que vive en tu restaurante", no 30 bots). Basado en la auditoría de IA
> (`audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md` §IA) + `OVERVIEW.md` + `AGENT-CERTIFICATION-REGISTRY.md`.

---

## El problema (hoy)

**Puros agentes separados.** ~24 scripts Python independientes (anomaly_detector, close_predictor,
antifraud, upselling…), cada uno corre por cron, saca datos → Groq/Claude → Telegram → log. Un
orquestador solo rutea Telegram inbound. **No hay un cerebro que entienda el restaurante — hay 24
especialistas ciegos que gritan por separado.**

Lo que eso le hace a la precisión (hallazgos de la auditoría):
- **22 de 24 alertan sin contexto** (avisan "ventas 95% abajo" a las 9am con 2 órdenes).
- Ninguno sabe qué hallaron los otros → se contradicen y saturan (fatiga → el operador deja de leer).
- `agent_events` (medir si aciertan) **nunca se escribe** → no sabes en cuál confiar. El registro lo dice literal: *"¿en cuál confiarías mañana? Ninguno."*
- **0 de 24 certificados.**

---

## Estado verificado el 2026-08-26 — tres correcciones a lo de arriba

> Medido contra producción. Cambian el plan, así que van aquí y no en una nota al pie.
> El detalle y la arquitectura del cruce están en [`ARQUITECTURA-CRUCE.md`](ARQUITECTURA-CRUCE.md).

**Los agentes NO usan LLM.** Arriba dice *"saca datos → Groq/Claude → Telegram"*. De 71 scripts
sólo 6 llaman a Groq, y **ninguno de los 6 es un agente** — son el briefing, el router de
Telegram, las alertas y las consultas de Wansoft. Los doce agentes son Python determinista.

Es buena noticia: la **Capa 1 ya existe**. No hay que migrar detectores a código; ya están en
código. La Fase 2 de la migración es más corta de lo que este documento supone.

**`agent_events` no estaba vacía por olvido: la tabla rechazaba los INSERT.** Un
`CHECK (agent_id IN (…5 valores…))` admitía sólo los agentes del motor de TypeScript; los de
Python usan otros siete. Y PostgREST responde 400, que no es excepción para `requests`, así que
`log_event()` fallaba **en silencio**. `antifraud-agent` y `fraud_watcher` llevaban meses
reportando al vacío. Corregido en #144, junto con el resolvedor que faltaba.

**Ocho agentes no producían nada.** 283 corridas en `no_data` en 14 días: `ops_daily_live` y
`ops_daily_history` leían `ops_daily`, congelada. Corregido en #134.

**Y una que este documento no contemplaba:** el modelo de "un día normal" está hardcodeado al
perfil de AMALAY (`agent_common._DAY_PROGRESS`, `close_predictor.HOURLY_DISTRIBUTION`, ambos con
el comentario admitiéndolo). Mientras siga así, la inteligencia no es clonable aunque los agentes
corran para todos.

---

## El objetivo — híbrido de 3 capas

Ni 30 bots ciegos, ni un solo agente gigante que lo hace todo (shallow). **Lo más preciso:**

```
  ┌─────────────────────────────────────────────┐
  │  Capa 3 — VERIFICACIÓN                        │  ¿es real dado el contexto?
  │  monitoring eligibility + incertidumbre       │  (mata falsos positivos)
  └───────────────────▲───────────────────────────┘
  ┌───────────────────┴───────────────────────────┐
  │  Capa 2 — EL EXPERTO (una mente, una voz)      │  contexto compartido + memoria
  │  decide QUÉ vale la pena decirle al gerente    │  del estado del restaurante
  └───────────────────▲───────────────────────────┘
  ┌───────────────────┴───────────────────────────┐
  │  Capa 1 — HERRAMIENTAS DETERMINISTAS (código)  │  matemática exacta:
  │  fraude, food cost, anomalía, cierre, mermas   │  el LLM NUNCA calcula números
  └────────────────────────────────────────────────┘
```

1. **Herramientas deterministas (código, no LLM).** La matemática exacta: el diff del skimming, el
   food cost, la desviación estadística. Un LLM **nunca** debe "calcular" un número — lo calcula código
   y da un valor exacto. (El [`edge-watcher.js`](../../electron-app/local-server/core/edge-watcher.js) local ya es una semilla de esto: detección determinista, offline.)
2. **El experto (el cerebro).** UNA mente con **contexto compartido** (hora, día, patrón histórico, qué
   pasó hoy), **memoria**, y **una sola voz** al gerente. Consume lo que las herramientas detectan, lo
   pesa contra el contexto, y decide qué comunicar.
3. **Verificación antes de hablar.** El experto checa cada hallazgo contra el contexto (¿esta anomalía
   es real siendo martes 9am post-feriado?) y expresa incertidumbre.

**Por qué es lo más accurate:** matemática exacta (código) + juicio contextual (una mente que ve todo)
+ verificación (no gritar hasta confirmar). Es cómo opera un buen gerente: una cabeza que consulta
especialistas, los pesa contra lo que sabe, y decide — no 24 asesores mandando WhatsApps sueltos.

**Bonus:** la arquitectura correcta para precisión **es también el producto**. "Un experto que vive en
tu restaurante" = un experto, no 30 agentes. Dos pájaros de un tiro.

---

## Migración — aditiva, incremental, NO rompe nada

**Clave de seguridad:** toda esta capa está **aislada del POS/caja/offline**. Son GitHub Actions que
**leen** Supabase y mandan Telegram; el restaurante NO depende de ellos para operar. Si un agente
falla, la caja sigue cobrando e imprimiendo. Por eso esto se puede iterar **sin riesgo** — incluso
antes del jueves — a diferencia del camino offline (congelado). No se hace big-bang: se construye el
experto AL LADO de los agentes actuales.

### Fase 0 — Fundación (segura, se puede empezar YA)
- **Cerrar el bucle de valor:** poblar `agent_events` (estimated_value + outcome) desde cada agente.
  Puramente aditivo (un write a una tabla nueva) — no cambia comportamiento. Sin esto no se puede
  priorizar ni podar falsos positivos. **Prerequisito de todo.**
- **Primitivo de contexto compartido:** `get_monitoring_context()` (hora, órdenes hasta ahora,
  baseline del día, si el turno abrió). Los agentes lo adoptan uno por uno. Arregla los 22/24 que
  alertan fuera de contexto.

### Fase 1 — El experto consume, los especialistas siguen
- Un orquestador-experto lee las salidas de los especialistas + el contexto, y decide **qué** decirle
  al gerente con **una sola voz** (en vez de 24 Telegrams). Los agentes viejos siguen corriendo.

### Fase 2 — Los especialistas se vuelven herramientas
- Migrar los detectores a **tools** que el experto llama (no broadcasters independientes). La
  matemática se queda en código; el experto razona sobre ella. Se apaga el Telegram directo de cada
  especialista una vez que el experto lo cubre.

### Fase 3 — Memoria + verificación completa
- El experto mantiene memoria del restaurante (qué alertó, qué resultó cierto) y una capa de
  verificación/incertidumbre antes de cada afirmación. Aquí se **certifican** los detectores.

---

## Reglas

1. **La matemática vive en código, no en el LLM.** Números exactos = deterministas.
2. **El experto tiene contexto antes de hablar.** Nada de alertar sin saber qué hora/día es.
3. **Una voz al gerente.** Menos ruido = más confianza = el gerente vuelve a actuar.
4. **No agregar más agentes** — certificar y unificar los que hay (la flota no necesita más miembros;
   necesita un cerebro y medición).
5. **Aislado del POS.** Esta capa nunca debe ser dependencia de la operación del restaurante.

Ver `PLAN-AHORA.md` Ola 3 (OP-27..OP-32) y `state/OPEN-ITEMS.md`.
