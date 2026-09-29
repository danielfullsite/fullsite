// Cliente de /api/chat compartido por el chat escrito y el modo voz: los dos hablan
// con el MISMO cerebro (misma ruta, mismos datos y guardias). La respuesta de la ruta
// no es streaming: `{ response }`.

import type { ModoChat } from '@/lib/voz/instruccion-voz'

export interface MensajeHistorial {
  role: 'user' | 'assistant'
  content: string
}

export class ErrorChat extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ErrorChat'
  }
}

export const MENSAJE_ERROR_CHAT = 'Hubo un error al procesar tu mensaje. Intenta de nuevo.'

export async function consultarChat(opciones: {
  message: string
  history: MensajeHistorial[]
  clientId: string | null | undefined
  modo?: ModoChat
  signal?: AbortSignal
}): Promise<string> {
  const { message, history, clientId, modo, signal } = opciones
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: history.map(({ role, content }) => ({ role, content })),
      client_id: clientId,
      ...(modo ? { modo } : {}),
    }),
    signal,
  })
  const data = await res.json().catch(() => ({})) as { response?: unknown; error?: unknown }
  if (!res.ok) {
    // El 429 del chat trae su mensaje en `response`; otros errores en `error`.
    const msg = typeof data.response === 'string' && data.response ? data.response
      : typeof data.error === 'string' && data.error ? data.error
        : MENSAJE_ERROR_CHAT
    throw new ErrorChat(msg, res.status)
  }
  return typeof data.response === 'string' ? data.response : ''
}
