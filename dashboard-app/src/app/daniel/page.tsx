'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

type AgentState = 'idle' | 'listening' | 'processing' | 'speaking'

export default function DanielAgent() {
  const [state, setState] = useState<AgentState>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [interim, setInterim] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const messagesEnd = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  // Auto scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, interim])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      window.speechSynthesis.cancel()
    }
  }, [])

  // Draw waveform
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)

      ctx.fillStyle = 'rgba(10,10,11,0.3)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.lineWidth = 2
      ctx.strokeStyle = '#00ff88'
      ctx.beginPath()

      const sliceWidth = canvas.width / bufferLength
      let x = 0
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * canvas.height) / 2
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        x += sliceWidth
      }
      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
    }
    draw()
  }, [])

  const stopWaveform = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#0a0a0b'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [])

  // Start mic + waveform
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser
      drawWaveform()
    } catch {
      // Mic access denied
    }
  }, [drawWaveform])

  // Speak text
  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      setState('speaking')
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'es-MX'
      utterance.rate = 1.05
      utterance.pitch = 1.0

      // Try to find a good Spanish voice
      const voices = window.speechSynthesis.getVoices()
      const mxVoice = voices.find(v => v.lang === 'es-MX')
      const esVoice = voices.find(v => v.lang.startsWith('es'))
      if (mxVoice) utterance.voice = mxVoice
      else if (esVoice) utterance.voice = esVoice

      utterance.onend = () => {
        setState('idle')
        resolve()
      }
      utterance.onerror = () => {
        setState('idle')
        resolve()
      }
      synthRef.current = utterance
      window.speechSynthesis.speak(utterance)
    })
  }, [])

  // Send to API and stream response
  const sendMessage = useCallback(async (text: string) => {
    setState('processing')

    const userMsg: Message = { role: 'user', content: text, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/daniel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })

      if (!res.ok || !res.body) {
        const fallback = 'No pude conectarme. Intenta de nuevo.'
        setMessages(prev => [...prev, { role: 'assistant', content: fallback, ts: Date.now() }])
        speak(fallback)
        return
      }

      // Stream the response
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullResponse = ''

      const assistantMsg: Message = { role: 'assistant', content: '', ts: Date.now() }
      setMessages(prev => [...prev, assistantMsg])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        fullResponse += chunk
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullResponse }
          return updated
        })
      }

      // Speak the full response
      if (fullResponse.trim()) {
        speak(fullResponse.trim())
      } else {
        setState('idle')
      }
    } catch {
      const errMsg = 'Error de conexion. Intenta de nuevo.'
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg, ts: Date.now() }])
      setState('idle')
    }
  }, [messages, speak])

  // Start listening
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Tu navegador no soporta reconocimiento de voz. Usa Chrome.')
      return
    }

    // Stop any current speech
    window.speechSynthesis.cancel()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SpeechRecognition as any)()
    recognition.lang = 'es-MX'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onstart = () => {
      setState('listening')
      setInterim('')
      startMic()
    }

    recognition.onresult = (event: any) => {
      let interimText = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += transcript
        else interimText += transcript
      }
      if (finalText) {
        setInterim('')
        stopWaveform()
        sendMessage(finalText)
      } else {
        setInterim(interimText)
      }
    }

    recognition.onerror = () => {
      setState('idle')
      setInterim('')
      stopWaveform()
    }

    recognition.onend = () => {
      stopWaveform()
      if (state === 'listening') {
        // If we haven't gotten a final result, check interim
        if (interim) {
          sendMessage(interim)
          setInterim('')
        } else {
          setState('idle')
        }
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [startMic, stopWaveform, sendMessage, state, interim])

  // Handle main button
  const handleButton = useCallback(() => {
    if (state === 'listening') {
      recognitionRef.current?.stop()
      stopWaveform()
    } else if (state === 'speaking') {
      window.speechSynthesis.cancel()
      setState('idle')
    } else if (state === 'idle') {
      startListening()
    }
  }, [state, startListening, stopWaveform])

  // PIN gate
  if (!unlocked) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0b', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24,
        fontFamily: "'Geist', -apple-system, system-ui, sans-serif",
      }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}>
          fullsite<span style={{ display: 'inline-block', width: 10, height: 10, background: '#00ff88', borderRadius: 2, marginLeft: 2, marginBottom: 4, verticalAlign: 'middle' }}></span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Agente personal de Daniel</div>
        <input
          type="password"
          placeholder="PIN"
          value={pin}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && pin === '2741') setUnlocked(true) }}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12, padding: '14px 24px', fontSize: 18, color: '#fff',
            textAlign: 'center', width: 200, outline: 'none', letterSpacing: '0.2em',
            fontFamily: "'Geist Mono', monospace",
          }}
          autoFocus
        />
        <button
          onClick={() => { if (pin === '2741') setUnlocked(true) }}
          style={{
            background: '#00ff88', color: '#0a0a0b', border: 'none', borderRadius: 99,
            padding: '12px 32px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Geist', sans-serif",
          }}
        >
          Entrar
        </button>
      </div>
    )
  }

  const stateLabel = {
    idle: 'Toca para hablar',
    listening: 'Escuchando...',
    processing: 'Pensando...',
    speaking: 'Hablando...',
  }

  const stateColor = {
    idle: '#00ff88',
    listening: '#ff4444',
    processing: '#ffc857',
    speaking: '#8b5cf6',
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0b',
      fontFamily: "'Geist', -apple-system, system-ui, sans-serif",
      display: 'flex', flexDirection: 'column', color: '#fff',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
          fullsite<span style={{ display: 'inline-block', width: 8, height: 8, background: '#00ff88', borderRadius: 2, marginLeft: 1, marginBottom: 3, verticalAlign: 'middle' }}></span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, marginLeft: 12, fontSize: 13 }}>Daniel&apos;s Agent</span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
          {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '24px', maxWidth: 720, width: '100%', margin: '0 auto',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.25)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#127908;</div>
            <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 8, color: 'rgba(255,255,255,0.5)' }}>
              Hola Daniel
            </div>
            <div style={{ fontSize: 14, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
              Preguntame lo que quieras sobre AMALAY, ventas, meseros, el roadmap de Fullsite, prospects, o lo que necesites. Tengo toda la memoria.
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '80%',
              padding: '14px 18px',
              borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: m.role === 'user'
                ? 'rgba(0,255,136,0.12)'
                : 'rgba(255,255,255,0.06)',
              border: m.role === 'user'
                ? '1px solid rgba(0,255,136,0.2)'
                : '1px solid rgba(255,255,255,0.08)',
              fontSize: 15,
              lineHeight: 1.55,
              color: m.role === 'user' ? '#fff' : 'rgba(255,255,255,0.86)',
            }}>
              {m.content}
              <div style={{
                fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 6, textAlign: 'right',
              }}>
                {new Date(m.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {interim && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{
              maxWidth: '80%', padding: '14px 18px', borderRadius: '18px 18px 4px 18px',
              background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.1)',
              fontSize: 15, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic',
            }}>
              {interim}...
            </div>
          </div>
        )}

        <div ref={messagesEnd} />
      </div>

      {/* Voice controls */}
      <div style={{
        padding: '24px', borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        {/* Waveform canvas */}
        <canvas
          ref={canvasRef}
          width={300}
          height={40}
          style={{
            borderRadius: 8,
            opacity: state === 'listening' ? 1 : 0,
            transition: 'opacity 0.3s',
          }}
        />

        {/* Main button */}
        <button
          onClick={handleButton}
          disabled={state === 'processing'}
          style={{
            width: 80, height: 80, borderRadius: '50%',
            background: state === 'processing' ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: `2px solid ${stateColor[state]}`,
            cursor: state === 'processing' ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: state !== 'idle' ? `0 0 32px ${stateColor[state]}40` : 'none',
            animation: state === 'listening' ? 'pulse-ring 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {state === 'processing' ? (
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#ffc857',
                  animation: `bounce 0.6s ease-in-out ${i * 0.15}s infinite alternate`,
                }} />
              ))}
            </div>
          ) : state === 'speaking' ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill={stateColor.speaking}>
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={stateColor[state]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        <div style={{
          fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: stateColor[state], transition: 'color 0.3s',
        }}>
          {stateLabel[state]}
        </div>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 ${stateColor.listening}40; }
          50% { box-shadow: 0 0 0 16px ${stateColor.listening}00; }
        }
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  )
}
