import { NextResponse } from 'next/server'

// Returns the Deepgram API key for browser-side WebSocket STT
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''

export async function GET() {
  if (!DEEPGRAM_API_KEY) {
    return NextResponse.json({ error: 'No Deepgram API key' }, { status: 503 })
  }
  return NextResponse.json({ key: DEEPGRAM_API_KEY })
}
