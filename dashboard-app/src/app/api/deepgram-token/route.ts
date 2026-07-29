import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'

// Returns the Deepgram API key for browser-side WebSocket STT
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr
  if (!DEEPGRAM_API_KEY) {
    return NextResponse.json({ error: 'No Deepgram API key' }, { status: 503 })
  }
  return NextResponse.json({ key: DEEPGRAM_API_KEY })
}
