import { NextRequest } from 'next/server'

// ElevenLabs TTS API — streams natural Spanish audio
// Voice: "Laura" (Latin American Spanish, warm, conversational)
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || ''
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5' // Laura — LatAm Spanish
const MODEL_ID = 'eleven_multilingual_v2'

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json()

    if (!text || typeof text !== 'string') {
      return new Response('Missing text', { status: 400 })
    }

    if (!ELEVENLABS_API_KEY) {
      // Fallback: return empty so client uses browser TTS
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
