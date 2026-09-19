# Loop de aprendizaje de agentes — diseño v1

> 2026-08-29 · Objetivo pedido por Daniel: "que los agentes de IA vayan aprendiendo con el
> tiempo". Diseño sobre lo que YA existe (agent_events con value+outcome, agent_results,
> /api/agents/feedback|ack|outcome) — cero infraestructura nueva en v1.
> Compañero de [../strategy/LOGICA-POR-VERTICAL.md](../strategy/LOGICA-POR-VERTICAL.md):
> los benchmarks por vertical son el CONOCIMIENTO DÍA-0; este loop es el que lo AFINA.

## El problema en una frase

Hoy los agentes son **reglas fijas con umbrales globales**: el mismo umbral de anomalía
para AMALAY que para una dark kitchen, sin memoria de qué alertas sirvieron. Un tenant
nuevo tiene IA muda semanas (arranque frío) y un tenant viejo recibe las mismas falsas
alarmas para siempre.

## Los tres lazos (en orden de construcción)

### Lazo 1 — Arranque frío: el vertical ES el prior (1-2 días de trabajo)
Cada preset nace con sus **KPIs y umbrales de industria precargados** (tabla transversal
#7 de LOGICA-POR-VERTICAL): fast_food → labor 25-30%, speed <6 min, accuracy ≥90%;
bar → pour cost 18-24%; dark kitchen → margen por canal. Se guardan en
`clients.pos_settings['agents.thresholds']` al provisionar (vertical-presets los define).
**Efecto:** un tenant recién nacido recibe su primera alerta útil el DÍA 1 — "tu pour
cost del viernes fue 31% vs 18-24% típico de bares" — sin histórico propio.

### Lazo 2 — Feedback humano cierra el ciclo (3-5 días)
Ya existe `/api/agents/feedback` y `agent_events.outcome`. Falta el circuito completo:
1. Cada alerta de Telegram lleva dos botones: **"Sirvió" / "Ruido"** (callback del bot).
2. El callback escribe `agent_events.outcome` (`useful` | `noise` | `acted`).
3. Un job semanal (`agent_tuner.py`) por tenant×agente calcula la **tasa de utilidad**:
   - >60% ruido en 4 semanas → el umbral se RELAJA un paso (menos alertas) y se anota
     en `agents.thresholds` con `tuned_at` + evidencia.
   - >80% útil y volumen bajo → el umbral se APRIETA un paso (más sensibilidad).
   - Todo movimiento queda auditado (de dónde a dónde y por qué) — nunca silencioso.
4. Tope de seguridad: un umbral nunca se mueve más de ±30% de su prior del vertical
   (el prior es el ancla; el aprendizaje ajusta, no reinventa).

### Lazo 3 — Memoria de patrones por tenant (1-2 semanas, después)
Los agentes hoy comparan contra "mismo día de semana, 4 semanas". Evolución:
- **Baseline estacional por tenant** (día×hora×daypart) materializado semanalmente en
  `agent_results` (agent_id='baseline'), que los demás agentes leen en vez de recalcular.
- **Excepciones aprendidas**: cuando Daniel/dueño marca "esto es normal aquí" (ej. "los
  martes cerramos temprano"), se guarda como regla del tenant que suprime esa clase de
  alerta — la lista es visible y borrable en /agentes (nada de caja negra).
- **Post-mortem de predicciones**: close-predictor ya predice; falta que un job nocturno
  compare predicción vs real y guarde el error — el MAPE por tenant es la métrica de
  "qué tan inteligente es" que se puede enseñar a un cliente o inversionista.

## Qué NO hacer (para no romper lo que funciona)
- No re-entrenar modelos ni fine-tuning: esto es ajuste de umbrales y memoria de reglas,
  auditables y reversibles. La "IA que aprende" v1 es estadística honesta + feedback.
- No mover umbrales sin evidencia mínima (≥10 alertas evaluadas) ni sin registro.
- No cruzar aprendizaje entre tenants (lo que es normal en AMALAY no lo es en un bar) —
  excepto los priors de vertical, que son públicos y de industria.

## Métrica de éxito del proyecto
- % de alertas marcadas "útil" (meta: >70% a 8 semanas de activar el lazo 2).
- MAPE del close-predictor por tenant (meta: <15%).
- Tiempo-a-primera-alerta-útil de un tenant nuevo (meta: <48 h con el lazo 1).

## Orden de ejecución propuesto
1. Lazo 1 (priors por vertical) — encaja con el trabajo de presets ya vivo.
2. Botones Sirvió/Ruido en Telegram + outcome — visible para Daniel de inmediato.
3. agent_tuner semanal con tope ±30%.
4. Lazo 3 cuando 1-2 tengan 4 semanas de datos.
