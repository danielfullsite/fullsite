/**
 * LLM API helper — Groq (free, fast) with Anthropic Claude fallback (paid, reliable).
 *
 * Chain: Groq Llama 3.3 → Anthropic Claude Haiku → error
 * This ensures the chat NEVER fails: Groq handles 99% of requests for free,
 * Claude catches the 1% when Groq is rate limited or down.
 *
 * Groq free tier: 30 req/min, 14,400 req/day
 * Anthropic: ~$0.001 per request (Haiku) — negligible cost for fallback
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// llama-3.3-70b-versatile devuelve 404 (model_not_found) para esta cuenta desde
// 2026-08-17; override por env para no redeployar en la próxima baja de modelo.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOptions {
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  stream?: boolean
}

function getGroqKey(): string {
  return process.env.GROQ_API_KEY || process.env.GROQ || ''
}

function getAnthropicKey(): string {
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPICAPIKEY || ''
}

// ─── Anthropic Claude fallback ────────────────────────────────────────────

async function anthropicChat(options: ChatOptions): Promise<string> {
  const key = getAnthropicKey()
  if (!key) throw new Error('No Anthropic API key for fallback')

  // Convert messages: extract system message, keep user/assistant
  const systemMsg = options.messages.find(m => m.role === 'system')?.content || ''
  const chatMessages = options.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }))

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: options.maxTokens || 2000,
      temperature: options.temperature ?? 0.3,
      system: systemMsg,
      messages: chatMessages,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[anthropic] Error ${res.status}: ${err}`)
    throw new Error(`Anthropic error: ${res.status}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ─── Main chat function with fallback chain ──────────────────────────────

/**
 * Chat with fallback: Groq → Anthropic Claude.
 * NEVER throws unless both providers fail.
 */
export async function groqChat(options: ChatOptions): Promise<string> {
  // 1. Try Groq first (free)
  const groqKey = getGroqKey()
  if (groqKey) {
    try {
      const body = {
        model: GROQ_MODEL,
        messages: options.messages,
        max_tokens: options.maxTokens || 2000,
        temperature: options.temperature ?? 0.3,
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000), // 8s max — leave 2s for fallback
        })

        if (res.ok) {
          const data = await res.json()
          return data.choices?.[0]?.message?.content || ''
        }

        if (res.status === 429) {
          console.warn(`[groq] Rate limited (attempt ${attempt + 1}/2) — falling back to Claude`)
          break // Don't retry, go straight to fallback
        }

        const err = await res.text()
        console.error(`[groq] Error ${res.status}: ${err}`)
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 500))
          continue
        }
      }
    } catch (err) {
      console.warn(`[groq] Failed: ${err instanceof Error ? err.message : 'unknown'} — falling back to Claude`)
    }
  }

  // 2. Fallback to Anthropic Claude (paid, reliable)
  try {
    console.log('[fallback] Using Anthropic Claude Haiku')
    return await anthropicChat(options)
  } catch (err) {
    console.error(`[anthropic] Fallback also failed: ${err instanceof Error ? err.message : 'unknown'}`)
  }

  // 3. Both failed — return helpful error
  throw new Error('Servicio temporalmente no disponible. Intenta en unos minutos.')
}

// ─── Tool calling (formato OpenAI) ───────────────────────────────────────

export interface LlamadaHerramienta {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type MensajeConHerramientas =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlamadaHerramienta[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface DefinicionHerramienta {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface OpcionesHerramientas {
  messages: MensajeConHerramientas[]
  tools: DefinicionHerramienta[]
  /** 'none' = contestar ya, sin pedir más herramientas. */
  toolChoice?: 'auto' | 'none'
  maxTokens?: number
  temperature?: number
  timeoutMs: number
}

/**
 * Una vuelta del modelo con herramientas (Groq, OpenAI-compatible). SIN reintentos ni
 * respaldo: quien llama maneja el presupuesto de tiempo y cae a `groqChat` si esto
 * lanza (sin llave, HTTP no-OK, 429, timeout o respuesta sin mensaje).
 */
export async function groqConHerramientas(o: OpcionesHerramientas): Promise<{ content: string; tool_calls: LlamadaHerramienta[] }> {
  const key = getGroqKey()
  if (!key) throw new Error('GROQ_API_KEY not configured')
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: o.messages,
      tools: o.tools,
      tool_choice: o.toolChoice ?? 'auto',
      max_tokens: o.maxTokens || 2000,
      temperature: o.temperature ?? 0.2,
    }),
    signal: AbortSignal.timeout(Math.max(1000, o.timeoutMs)),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Groq tools error ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const msg = data?.choices?.[0]?.message
  if (!msg || typeof msg !== 'object') throw new Error('Groq tools: respuesta sin mensaje')
  const calls = Array.isArray(msg.tool_calls)
    ? (msg.tool_calls as unknown[]).filter((c): c is LlamadaHerramienta =>
      !!c && typeof c === 'object'
      && typeof (c as LlamadaHerramienta).id === 'string'
      && typeof (c as LlamadaHerramienta).function?.name === 'string')
      .map(c => ({ id: c.id, type: 'function' as const, function: { name: c.function.name, arguments: String(c.function.arguments ?? '') } }))
    : []
  return { content: typeof msg.content === 'string' ? msg.content : '', tool_calls: calls }
}

// ─── Tool calling con Claude (Anthropic) ─────────────────────────────────
// Mismo contrato que groqConHerramientas (entra/sale en formato OpenAI), pero corre
// sobre Claude Haiku 4.5, mucho más confiable decidiendo cuándo consultar y escribiendo
// el SQL de los cruces. El ciclo (responderConHerramientas) no cambia: aquí se traduce
// OpenAI -> Anthropic a la entrada y Anthropic -> OpenAI a la salida.

interface BloqueAnthropic { type: string; [k: string]: unknown }
interface MsgAnthropic { role: 'user' | 'assistant'; content: BloqueAnthropic[] }

/** Traduce los mensajes del ciclo (formato OpenAI) al formato de Anthropic. */
function aMensajesAnthropic(messages: MensajeConHerramientas[]): { system: string; msgs: MsgAnthropic[] } {
  let system = ''
  let systemTomado = false
  const msgs: MsgAnthropic[] = []
  const pushUser = (blocks: BloqueAnthropic[]) => {
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'user') last.content.push(...blocks)
    else msgs.push({ role: 'user', content: blocks })
  }
  for (const m of messages) {
    if (m.role === 'system') {
      // El primer system va al parámetro top-level; uno posterior (p. ej. NOTA_CIERRE)
      // se manda como turno de usuario para conservar su posición al final.
      if (!systemTomado) { system = m.content; systemTomado = true }
      else pushUser([{ type: 'text', text: m.content }])
    } else if (m.role === 'user') {
      pushUser([{ type: 'text', text: m.content }])
    } else if (m.role === 'assistant') {
      const blocks: BloqueAnthropic[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {}
        try { input = JSON.parse(tc.function.arguments || '{}') } catch { input = {} }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
      // Anthropic no acepta content vacío en assistant.
      msgs.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] })
    } else if (m.role === 'tool') {
      // Los resultados de herramientas son bloques tool_result DENTRO de un turno de usuario;
      // varios (consultas en paralelo) se agrupan en el mismo turno.
      pushUser([{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }])
    }
  }
  return { system, msgs }
}

/**
 * Una vuelta del modelo con herramientas sobre Claude Haiku. SIN reintentos ni respaldo:
 * quien llama (modeloConHerramientas / el ciclo) maneja el presupuesto y el fallback.
 */
export async function anthropicConHerramientas(o: OpcionesHerramientas): Promise<{ content: string; tool_calls: LlamadaHerramienta[] }> {
  const key = getAnthropicKey()
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured')
  const { system, msgs } = aMensajesAnthropic(o.messages)
  // toolChoice 'none' = contestar ya: se logra no mandando herramientas.
  const conTools = (o.toolChoice ?? 'auto') !== 'none'
  const tools = o.tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }))
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: o.maxTokens || 2000,
      temperature: o.temperature ?? 0.2,
      system,
      messages: msgs,
      ...(conTools ? { tools, tool_choice: { type: 'auto' } } : {}),
    }),
    signal: AbortSignal.timeout(Math.max(1000, o.timeoutMs)),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Anthropic tools error ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const bloques: unknown = data?.content
  if (!Array.isArray(bloques)) throw new Error('Anthropic tools: respuesta sin content')
  let content = ''
  const tool_calls: LlamadaHerramienta[] = []
  for (const b of bloques as BloqueAnthropic[]) {
    if (b?.type === 'text' && typeof b.text === 'string') content += b.text
    else if (b?.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      tool_calls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } })
    }
  }
  return { content, tool_calls }
}

/**
 * Modelo con herramientas para el ciclo: Claude Haiku primero (mejor cruces/SQL) con Groq
 * como respaldo QUE CONSERVA las herramientas — así, si un proveedor falla, el chat sigue
 * pudiendo consultar en vez de declinar. Kill-switch: TOOLS_PROVIDER=groq fuerza Groq.
 */
export async function modeloConHerramientas(o: OpcionesHerramientas): Promise<{ content: string; tool_calls: LlamadaHerramienta[] }> {
  const preferGroq = process.env.TOOLS_PROVIDER === 'groq' || !getAnthropicKey()
  if (preferGroq) return groqConHerramientas(o)
  try {
    return await anthropicConHerramientas(o)
  } catch (err) {
    console.warn(`[tools] Anthropic falló (${err instanceof Error ? err.message.slice(0, 80) : 'error'}); respaldo Groq con herramientas`)
    return groqConHerramientas(o)
  }
}

// ─── Streaming (Groq only, no fallback needed for streaming) ─────────────

export async function groqStream(options: ChatOptions): Promise<ReadableStream<Uint8Array>> {
  const key = getGroqKey()
  if (!key) throw new Error('GROQ_API_KEY not configured')

  const body = {
    model: GROQ_MODEL,
    messages: options.messages,
    max_tokens: options.maxTokens || 300,
    temperature: options.temperature ?? 0.3,
    stream: true,
  }

  let res: Response | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) break

    if (res.status === 429) {
      console.warn(`[groq] Stream rate limited`)
      break
    }

    const err = await res.text()
    console.error(`[groq] Stream error ${res.status}: ${err}`)
    if (attempt === 1) throw new Error(`Groq stream failed: ${res.status}`)
    await new Promise(r => setTimeout(r, 500))
  }

  if (!res || !res.ok) throw new Error('Groq stream failed')

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return new ReadableStream({
    async start(controller) {
      try {
        const reader = res!.body!.getReader()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6))
                const text = json.choices?.[0]?.delta?.content
                if (text) controller.enqueue(encoder.encode(text))
              } catch { /* skip malformed */ }
            }
          }
        }
        controller.close()
      } catch (err) {
        console.error('[groq] Stream read error:', err)
        controller.enqueue(encoder.encode('Lo siento, hubo un error. Intenta de nuevo.'))
        controller.close()
      }
    },
  })
}
