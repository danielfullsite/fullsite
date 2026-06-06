/**
 * Groq API helper — with retry, rate limit handling, and fallback.
 * Used by voice, chat, and coach endpoints.
 *
 * Free tier: 30 req/min, 14,400 req/day, 6K tokens/min
 * If rate limited: waits and retries once.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

interface GroqMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface GroqOptions {
  messages: GroqMessage[]
  maxTokens?: number
  temperature?: number
  stream?: boolean
}

function getKey(): string {
  return process.env.GROQ_API_KEY || process.env.GROQ || ''
}

/**
 * Non-streaming Groq call with retry.
 * Returns the text response.
 */
export async function groqChat(options: GroqOptions): Promise<string> {
  const key = getKey()
  if (!key) throw new Error('GROQ_API_KEY not configured')

  const body = {
    model: MODEL,
    messages: options.messages,
    max_tokens: options.maxTokens || 2000,
    temperature: options.temperature ?? 0.3,
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const data = await res.json()
      return data.choices?.[0]?.message?.content || ''
    }

    // Rate limit — wait and retry
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '2')
      console.warn(`[groq] Rate limited, waiting ${retryAfter}s (attempt ${attempt + 1}/3)`)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      continue
    }

    // Other error
    const err = await res.text()
    console.error(`[groq] Error ${res.status}: ${err}`)
    if (attempt === 2) throw new Error(`Groq API error: ${res.status}`)
    await new Promise(r => setTimeout(r, 1000))
  }

  throw new Error('Groq API failed after 3 attempts')
}

/**
 * Streaming Groq call with retry.
 * Returns a ReadableStream of text chunks.
 */
export async function groqStream(options: GroqOptions): Promise<ReadableStream<Uint8Array>> {
  const key = getKey()
  if (!key) throw new Error('GROQ_API_KEY not configured')

  const body = {
    model: MODEL,
    messages: options.messages,
    max_tokens: options.maxTokens || 300,
    temperature: options.temperature ?? 0.3,
    stream: true,
  }

  let res: Response | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) break

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '2')
      console.warn(`[groq] Rate limited, waiting ${retryAfter}s (attempt ${attempt + 1}/3)`)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      continue
    }

    const err = await res.text()
    console.error(`[groq] Stream error ${res.status}: ${err}`)
    if (attempt === 2) throw new Error(`Groq stream failed: ${res.status}`)
    await new Promise(r => setTimeout(r, 1000))
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
