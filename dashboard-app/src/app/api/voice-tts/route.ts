import { NextRequest } from 'next/server'

// ElevenLabs TTS API — streams natural Spanish audio
// Voice: "Laura" (Latin American Spanish, warm, conversational)
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS || ''
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5' // Laura — LatAm Spanish
const MODEL_ID = 'eleven_multilingual_v2'

// GET — health check for diagnostics
export async function GET() {
  const hasKey = ELEVENLABS_API_KEY.length > 0
  if (!hasKey) {
    return Response.json({ status: 'no_key', engine: 'browser_tts', message: 'ELEVENLABS_API_KEY no configurada en Vercel' })
  }
  // Quick check: validate key by fetching user info
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    })
    if (res.ok) {
      const user = await res.json()
      return Response.json({
        status: 'ok', engine: 'elevenlabs',
        chars_remaining: user?.subscription?.character_count != null
          ? user.subscription.character_limit - user.subscription.character_count
          : 'unknown',
      })
    }
    return Response.json({ status: 'key_invalid', engine: 'browser_tts', http: res.status })
  } catch {
    return Response.json({ status: 'error', engine: 'browser_tts' })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json()

    if (!text || typeof text !== 'string') {
      return new Response('Missing text', { status: 400 })
    }

    if (!ELEVENLABS_API_KEY) {
      console.log('[voice-tts] No ElevenLabs key found. Checked: ELEVENLABS_API_KEY, ELEVEN_LABS_API_KEY, ELEVENLABS')
      return new Response(null, { status: 204 })
    }

    // Stream audio from ElevenLabs
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,        // More expressive
            similarity_boost: 0.75, // Natural but clear
            style: 0.4,            // Some style variation
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error')
      console.error('[voice-tts] ElevenLabs error:', response.status, error)
      return new Response(null, { status: 204 }) // Fallback to browser TTS
    }

    // Pipe the audio stream directly to the client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    console.error('[voice-tts] Error:', error)
    return new Response(null, { status: 204 })
  }
}
