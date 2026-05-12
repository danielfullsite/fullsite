# WarRoom Chat Agent — Brief para Claude Code

> **Para Claude Code:** Lee este archivo completo ANTES de tocar nada.
> 
> **Lección crítica de la sesión anterior (reviews-manager):** NO cambies decisiones de diseño documentadas en este brief sin avisar. Si encuentras una razón válida para deviar, PREGUNTA primero. La sesión pasada cambiaste el flow de aprobación de reviews sin discutir y eso requirió rollback. No queremos repetirlo.
>
> **Patrón de trabajo:** Implementa por pasos chicos. NO commitees hasta que el founder valide. Después de cada paso, lista qué hiciste para validar antes de avanzar.

---

## Contexto del proyecto

**Repo:** `github.com/ramonfaurdaniel-png/fullsite`
**Carpeta de trabajo:** `cloudflare/orquestador-worker/` (REESCRIBIR el existente)
**Founder:** Daniel Ramonfaur (Fullsite, Monterrey MX)
**Cliente pilot:** AMALAY Coffee & Market (dueña: Mónica Gracia)

**Stack:**
- Cloudflare Workers (TypeScript)
- Supabase Postgres (`qjiomlvudfmzuvqvhwpk`)
- Anthropic Claude API (Haiku 4.5)
- Telegram Bot API (bot `@fullsite_warroom_bot`)

**Sistemas existentes que el chat agent debe consultar:**
- Tabla `wansoft_kpis` en Supabase — cierres diarios de Wansoft (~30 días de histórico)
- Tabla `amalay_reservaciones` en Supabase — reservas activas
- Tablas `google_reviews`, `google_oauth_tokens`, `review_actions_log` (reviews-manager)

---

## Estado actual del Worker

El archivo `src/index.ts` actual hace:
1. Recibe webhook POST de Telegram
2. Valida secret token (`X-Telegram-Bot-Api-Secret-Token`)
3. Parsea el mensaje
4. Dispara workflow `orquestador.yml` en GitHub Actions
5. Responde 200 inmediato

**Qué se reusa:**
- Validación de secret token
- Parseo de Telegram update (interfaces `TelegramUpdate`, `TelegramMessage`)
- Estructura general del fetch handler
- Variable `TELEGRAM_BOT_TOKEN` y `WEBHOOK_SECRET`

**Qué se cambia:**
- En lugar de disparar Actions, responder directamente a Telegram
- Agregar lógica de routing: comando vs chat libre
- Conectar a Supabase y Claude API

**Qué se mantiene como legacy (no borrar):**
- El workflow `.github/workflows/orquestador.yml` y `orquestador.py` quedan en repo como histórico. No los borres todavía. Daniel decide después si los elimina.

**Acción inicial:** Renombrar `src/index.ts` a `src/index.legacy.ts` antes de crear el nuevo, para tener fallback.

---

## Objetivo del chat agent

Chat agent en Telegram que responde a Daniel y Mónica:
- **Comandos** rápidos (autocomplete de Telegram): `/briefing`, `/top`, `/ventas`, `/sync`, `/help`
- **Chat libre**: cualquier pregunta en lenguaje natural sobre operación de AMALAY (datos de Wansoft + reviews + reservas)

Respuesta inmediata (<5 seg). NO dispara GitHub Actions ni otros workflows.

---

## Decisiones técnicas (no las cambies sin avisar)

| Decisión | Razón |
|---|---|
| Reescribir `cloudflare/orquestador-worker/src/index.ts` | Telegram permite un solo webhook activo por bot — reutilizamos el URL existente |
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Consistencia con reviews-manager + sin rate limits de Groq + costo bajo |
| Híbrido: comandos `/algo` + chat libre | Comandos rápidos para queries frecuentes, chat para todo lo demás |
| Validación de secret token | Seguridad básica del webhook |
| Responder con `sendMessage` API directo | No esperar GitHub Actions (era el bug del approach viejo) |
| Multi-tenant ready (`client_slug` en queries) | Default `"amalay"`, futuro escalable |
| Chat libre incluye contexto últimos 7 días de cierres | Para que Claude pueda responder con data reciente sin context window overflow |
| NO publicar respuestas tipo "estoy pensando…" mientras Claude procesa | Solo `sendChatAction` con `typing` |

---

## Arquitectura

```
Telegram (mensaje del usuario)
    ↓ webhook POST
Cloudflare Worker (orquestador-worker)
    ↓
Router (en index.ts):
    ├─ text.startsWith('/') → handlers/commands.ts
    │    └─ /briefing, /top, /ventas, /sync, /help
    └─ else → handlers/chat.ts
              └─ Claude API con context Supabase
    ↓
Telegram API (sendMessage)
    ↓
Usuario ve la respuesta
```

---

## System prompt (chat libre)

Pega esto exacto en `lib/claude-api.ts` como `SYSTEM_PROMPT`:

```
Eres "WarRoom", el asistente de inteligencia operativa de AMALAY Coffee & Market, 
un café-brunch ubicado en Plaza Duendes, San Pedro Garza García, México.

Daniel (founder de Fullsite, la plataforma que opera AMALAY analytics) y Mónica 
(dueña de AMALAY) son tus usuarios principales. Trabajan contigo desde Telegram.

TU TAREA:
Responder preguntas sobre la operación de AMALAY usando data real de las tablas
de Supabase (wansoft_kpis, amalay_reservaciones, google_reviews). El contexto
te llega adjuntado al user message.

REGLAS:
1. Respuestas cortas. Máximo 4-5 líneas. Es Telegram, no email.
2. Usa NÚMEROS CONCRETOS. Cero generalizaciones tipo "vendieron bien".
3. EXCLUYE siempre del ranking de meseros: Oscar Ricardo, Hector Enrique, 
   Rodrigo Chávez, Fany Elizabeth, APLICACIONES, MESERO EVENTO. Son cajeros, 
   no meseros.
4. Si la pregunta es vaga, pide 1 aclaración concreta (no más).
5. Si no tienes el dato, di "No tengo data de X" — NUNCA inventes.
6. Tono: directo, casual, español MX. Sin formalismos.
7. NO uses markdown formatting en respuestas (Telegram lo renderea raro). 
   Texto plano con saltos de línea.
8. Para listas/rankings: usa números o guiones, no bullets markdown.

CONTEXTO DEL NEGOCIO:
- Revenue mensual ~$3-4M MXN
- Ticket promedio histórico ~$500 MXN
- ~200-250 personas/día
- Horario: Dom-Mié cierra 8pm, Jue-Sáb cierra 11pm, Dom cierra 5pm
- Brunch es el foco principal (mañana-tarde)
- Signature items: pan dulce, postres, H&H (huevos & holandesa), chilaquiles

MESEROS CONOCIDOS:
Brayan Berlanga, Omar Aguilera, Mario García, Christopher Antonio (Alexis), 
Oscar Ríos, Julio César, Mauricio Rodríguez.

DATA QUE RECIBES EN CONTEXT (formato):
Te llega un bloque <data> con los últimos 7 días de cierres + KPIs agregados.
Úsala para responder. No tienes acceso a más histórico salvo que el usuario 
te dé contexto adicional.

Genera SOLO la respuesta. Sin preámbulo, sin "Claro, claro:", sin markdown.
```

---

## Comandos a implementar

| Comando | Argumentos | Qué hace |
|---|---|---|
| `/briefing` | ninguno | Resumen del día actual: ventas totales, ticket promedio, top 3 meseros, # personas |
| `/top` | opcional: `dia`, `semana`, `mes` (default: `dia`) | Top 5 meseros con filtros de cajeros aplicados |
| `/ventas` | opcional: `hoy`, `ayer`, `semana`, `mes` (default: `hoy`) | Total de ventas del periodo |
| `/sync` | ninguno | Estado del scrape Wansoft: cuándo fue el último sync exitoso |
| `/help` o `/ayuda` | ninguno | Lista de comandos disponibles |

**Comandos sin reconocer** (ej. `/foo`): responder con `/help` automáticamente.

**Implementación: `handlers/commands.ts`**

Estructura sugerida:

```typescript
export async function handleCommand(text: string, env: Env, chatId: string) {
  const [cmd, ...args] = text.slice(1).split(/\s+/);
  
  switch (cmd.toLowerCase()) {
    case 'briefing':
      return await briefingHandler(env, chatId);
    case 'top':
      return await topMeserosHandler(env, chatId, args[0] || 'dia');
    case 'ventas':
      return await ventasHandler(env, chatId, args[0] || 'hoy');
    case 'sync':
      return await syncHandler(env, chatId);
    case 'help':
    case 'ayuda':
      return await helpHandler(env, chatId);
    default:
      return await helpHandler(env, chatId); // fallback
  }
}
```

---

## Schema de `wansoft_kpis` (verificar en Supabase antes de hacer queries)

**Acción de Claude Code:** ANTES de implementar `lib/supabase.ts`, ejecuta una query exploratoria para confirmar el schema. Usa el MCP de Supabase o pídele a Daniel un dump del schema. NO asumas los campos.

Mi mejor entendimiento del schema (sujeto a verificación):

```sql
CREATE TABLE wansoft_kpis (
    id              UUID PRIMARY KEY,
    date            DATE,                  -- fecha del cierre
    client_slug     TEXT,                  -- 'amalay'
    total_dia       NUMERIC,               -- total facturado
    total_meseros   NUMERIC,               -- total atribuible a meseros (excluye delivery/cajeros)
    ticket_promedio NUMERIC,
    personas        INTEGER,
    
    -- JSONB fields
    meseros         JSONB,    -- [{name, total, mesas, personas, ticket_promedio}, ...]
    platillos_top   JSONB,    -- [{nombre, cantidad, total}, ...]
    propinas_meseros JSONB,   -- [{name, propina_total, propina_pct}, ...]
    pago_metodos    JSONB,    -- {efectivo: X, tarjeta: Y, transferencia: Z}
    ventas_por_grupo JSONB,   -- {comida: X, bebida: Y, postre: Z}
    
    synced_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ
);
```

**Verifica con esto antes de implementar:**

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'wansoft_kpis' 
ORDER BY ordinal_position;
```

---

## Queries Supabase comunes (templates)

Implementar en `lib/supabase.ts`:

```typescript
// 1. Briefing del día actual
async function getDailyBriefing(client_slug = 'amalay'): Promise<DailyKpi | null> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('wansoft_kpis')
    .select('*')
    .eq('client_slug', client_slug)
    .eq('date', today)
    .single();
  return data;
}

// 2. Top meseros (filtrando cajeros)
const EXCLUDE_FROM_RANKING = [
  'Oscar Ricardo', 'Hector Enrique', 'Rodrigo Chávez', 'Fany Elizabeth',
  'APLICACIONES', 'MESERO EVENTO'
];

async function getTopMeseros(period: 'dia' | 'semana' | 'mes', client_slug = 'amalay') {
  // Query con filtro de fecha + parsear JSONB.meseros + filtrar cajeros + ordenar
  // ...
}

// 3. Ventas por periodo
async function getVentas(period: 'hoy' | 'ayer' | 'semana' | 'mes', client_slug = 'amalay') {
  // ...
}

// 4. Último sync
async function getLastSync(client_slug = 'amalay'): Promise<{synced_at: string, hours_ago: number}> {
  const { data } = await supabase
    .from('wansoft_kpis')
    .select('synced_at')
    .eq('client_slug', client_slug)
    .order('synced_at', { ascending: false })
    .limit(1)
    .single();
  // Calcular diferencia
}

// 5. Context para chat libre — últimos 7 días resumidos
async function getRecentContext(client_slug = 'amalay'): Promise<string> {
  // Pull últimos 7 days, format como markdown breve para incluir en user message
  // Retorna string tipo:
  // "Últimos 7 días: total $XYZ MXN, ticket promedio $XYZ, top mesero: Brayan ($X), ..."
}
```

---

## Estructura de archivos

```
cloudflare/orquestador-worker/
├── CLAUDE.md                # ESTE archivo
├── README.md                # instrucciones humanas
├── src/
│   ├── index.legacy.ts      # backup del Worker viejo (renombrado, no borrar)
│   ├── index.ts             # entry point nuevo
│   ├── handlers/
│   │   ├── chat.ts          # chat libre con Claude
│   │   └── commands.ts      # router de comandos
│   ├── lib/
│   │   ├── claude-api.ts    # llamadas a Anthropic + system prompt
│   │   ├── supabase.ts      # queries de wansoft_kpis
│   │   └── telegram.ts      # sendMessage, sendChatAction
│   └── types.ts             # interfaces compartidas
├── wrangler.toml            # ya existe, agregar SUPABASE_* y ANTHROPIC_API_KEY
├── package.json
└── tsconfig.json
```

---

## Variables de entorno (`wrangler.toml`)

**Ya existentes:**
- `GITHUB_TOKEN` (puede quedarse, no se usa pero no rompe nada)
- `TELEGRAM_BOT_TOKEN` (lo usamos)
- `WEBHOOK_SECRET` (lo usamos)

**Nuevas a agregar:**
- `SUPABASE_URL` (https://qjiomlvudfmzuvqvhwpk.supabase.co)
- `SUPABASE_SERVICE_KEY` (service_role key — el founder lo configura como secret)
- `ANTHROPIC_API_KEY` (la misma del proyecto, founder la pone como secret)
- `CHAT_ID_DANIEL` y `CHAT_ID_MONICA` (para autorización: solo estos dos pueden usar el bot)

Comando para setear secrets (founder lo corre):
```bash
cd cloudflare/orquestador-worker
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SUPABASE_SERVICE_KEY
```

---

## Autorización

El bot debe responder SOLO a `CHAT_ID_DANIEL` y `CHAT_ID_MONICA`. Cualquier otro chat_id recibe:

```
No tengo permiso para responder en este chat.
```

Implementación en `index.ts`:

```typescript
const ALLOWED_CHATS = [env.CHAT_ID_DANIEL, env.CHAT_ID_MONICA];
if (!ALLOWED_CHATS.includes(chatId)) {
  await sendMessage(env, chatId, 'No tengo permiso para responder en este chat.');
  return new Response('OK', { status: 200 });
}
```

---

## Plan de Sprints

### Sprint 1 (esta sesión) — Estructura + comandos básicos

1. Renombrar `src/index.ts` → `src/index.legacy.ts`
2. Crear estructura nueva (`handlers/`, `lib/`, `types.ts`)
3. Implementar `lib/telegram.ts` (sendMessage, sendChatAction)
4. Implementar `lib/supabase.ts` con stubs + 1 query funcional (`getLastSync` es el más simple)
5. Implementar `lib/claude-api.ts` con system prompt (stub, no usar todavía)
6. Implementar `handlers/commands.ts` con:
   - `/help` (hardcoded)
   - `/sync` (usa `getLastSync`)
7. Implementar nuevo `src/index.ts` con router + autorización
8. Validar localmente: `npx tsc --noEmit` clean
9. NO deployes todavía. Esperar OK del founder.

### Sprint 2 (próxima sesión) — Resto de comandos + chat libre

1. Verificar schema real de `wansoft_kpis` con Daniel
2. Completar `lib/supabase.ts` con queries reales
3. Implementar `/briefing`, `/top`, `/ventas`
4. Implementar `handlers/chat.ts` con Claude + context
5. Tests con vitest (similar a reviews-manager)
6. Validar con queries reales

### Sprint 3 — Deploy

1. Setear secrets en Cloudflare con `wrangler secret put`
2. `wrangler deploy`
3. Validar que el webhook sigue apuntando al mismo URL (no debe haber cambiado)
4. Smoke test: mandar mensaje desde Telegram, ver que responde
5. Monitorear primera semana

---

## Lessons aplicadas de la sesión de reviews-manager

1. **No te desvíes del scope.** Si pedimos "Sprint 1 estructura", NO implementes Sprint 2 (handlers de chat libre, etc) en la misma corrida.

2. **No cambies decisiones de diseño sin preguntar.** Si encuentras razón para cambiar algo del brief, PREGUNTA antes.

3. **No commitees hasta validar.** El founder revisa cada paso. Después comiteamos en batch.

4. **Verifica datos antes de queries.** No asumas schema — verifica con SELECT exploratorio.

5. **Para Python f-strings nunca uses sed con quotes.** (No aplica aquí pero por si tocas algún script Python).

6. **Después de cada paso, lista qué hiciste para validar antes de avanzar.**

---

## NO está en scope (no lo implementes)

- ❌ Reescribir el flow del orquestador.yml (queda como legacy)
- ❌ Migrar otros agents (kb, ops, reportes) — son de Groq y funcionan
- ❌ Tests de Telegram inline buttons (los de reviews-manager son suficientes)
- ❌ Análisis de sentimiento en mensajes del usuario
- ❌ Persistencia de conversación (cada mensaje es stateless por ahora)
- ❌ Multi-idioma (solo español)

---

## Si encuentras blockers

Si algo en este brief no encaja con la realidad del repo (archivo no existe, schema diferente, etc), STOP y avísale al founder con:
1. Qué encontraste
2. Qué esperabas según el brief
3. Cuál es tu propuesta

NO improvises decisiones de diseño.
