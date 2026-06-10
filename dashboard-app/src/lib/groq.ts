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
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-fable-5'

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
