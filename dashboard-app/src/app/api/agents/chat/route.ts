import { NextRequest, NextResponse } from 'next/server'
import { groqChat } from '@/lib/groq'

export const dynamic = 'force-dynamic'

// Auth ligera: cookie fs-at (login del dashboard) o header Authorization.
async function getSessionUserId(req: NextRequest): Promise<string | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const token = req.cookies.get('fs-at')?.value || bearer
  if (!token) return null
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const u = await res.json()
    return u?.id || null
  } catch {
    return null
  }
}

interface Msg { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  const uid = await getSessionUserId(req)
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { agentName?: string; summary?: string; data?: unknown; messages?: Msg[] } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const agentName = String(body.agentName || 'Agente').slice(0, 60)
  const summary = String(body.summary || '').slice(0, 600)
  const ctx = (typeof body.data === 'string' ? body.data : JSON.stringify(body.data ?? {})).slice(0, 2200)
  const history = Array.isArray(body.messages) ? body.messages.slice(-8) : []

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    {
      role: 'system',
      content:
        `Eres "${agentName}", un agente de IA dentro de Fullsite, el sistema operativo para restaurantes. ` +
        `Hoy detectaste esto: "${summary}". Datos de respaldo (JSON): ${ctx}. ` +
        `Hablas con el dueño o gerente del restaurante. Responde en español mexicano, cercano y directo, ` +
        `MUY breve (2 a 4 frases), concreto y accionable. Explica el "por qué" con base en los datos y ` +
        `sugiere qué hacer. NO inventes cifras que no estén en los datos; si falta información, dilo con honestidad.`,
    },
    ...history.map((m): { role: 'user' | 'assistant'; content: string } => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content).slice(0, 1200),
    })),
  ]

  try {
    const reply = await groqChat({ messages })
    return NextResponse.json({ reply: (reply || '').trim() || 'No pude generar una respuesta en este momento.' })
  } catch {
    return NextResponse.json({ reply: 'El agente no está disponible ahora mismo. Intenta de nuevo en un momento.' })
  }
}
