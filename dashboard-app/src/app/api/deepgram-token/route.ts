import { NextResponse } from 'next/server'

// Mints a temporary Deepgram API key for browser-side WebSocket STT
// The browser uses this short-lived key to connect directly to Deepgram
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''

export async function GET() {
  if (!DEEPGRAM_API_KEY) {
    return NextResponse.json({ error: 'No Deepgram API key configured' }, { status: 503 })
  }

  try {
    // Get project ID first
    const projectsRes = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    })
    if (!projectsRes.ok) {
      return NextResponse.json({ key: DEEPGRAM_API_KEY }) // Fallback: use main key directly
    }
    const projects = await projectsRes.json()
    const projectId = projects?.projects?.[0]?.project_id

    if (!projectId) {
      return NextResponse.json({ key: DEEPGRAM_API_KEY })
    }

    // Create temporary key (expires in 10 seconds — just enough for one session)
    const tempRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: 'Fullsite voice session',
        scopes: ['usage:write'],
        time_to_live_in_seconds: 30,
      }),
    })

    if (tempRes.ok) {
      const data = await tempRes.json()
      return NextResponse.json({ key: data.key })
    }

    // Fallback
    return NextResponse.json({ key: DEEPGRAM_API_KEY })
  } catch {
    return NextResponse.json({ key: DEEPGRAM_API_KEY })
  }
}
