'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'

const STATUS_TEXT: Record<VoiceState, string> = {
  idle: 'Toca para hablar',
  listening: 'Escuchando...',
  processing: 'Pensando...',
  speaking: 'Hablando...',
}

// Convert Float32 audio samples to Int16 PCM ArrayBuffer for Deepgram
function float32ToInt16(float32Array: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16.buffer
}

// Downsample audio from source sample rate to target sample rate
function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer
  const ratio = fromRate / toRate
  const newLength = Math.round(buffer.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const idx = Math.round(i * ratio)
    result[i] = buffer[idx] ?? 0
  }
  return result
}

export default function VoicePage() {
  const [state, setState] = useState<VoiceState>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [supported, setSupported] = useState(true)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceIdx, setSelectedVoiceIdx] = useState<number>(-1)
  const [useDeepgram, setUseDeepgram] = useState(true) // true = try Deepgram first

  // Refs for audio/speech
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null) // Web Speech API fallback
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Refs for Deepgram WebSocket STT
  const dgSocketRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  // Refs for visualization
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track accumulated transcript for Deepgram
  const dgTranscriptRef = useRef('')
  const dgInterimRef = useRef('')

  // Pre-load browser TTS voices on mount (for fallback)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const loadVoices = () => {
      const all = window.speechSynthesis.getVoices()
      const spanish = all.filter(v => v.lang.startsWith('es'))
      setVoices(spanish.length > 0 ? spanish : all)
      if (selectedVoiceIdx === -1 && spanish.length > 0) {
        const paulina = spanish.findIndex(v => v.name.includes('Paulina'))
        const esMX = spanish.findIndex(v => v.lang === 'es-MX')
        setSelectedVoiceIdx(paulina >= 0 ? paulina : esMX >= 0 ? esMX : 0)
      }
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
  }, [selectedVoiceIdx])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Check browser support (Web Speech API as fallback)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR && !useDeepgram) {
      setSupported(false)
      setError('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.')
    }
  }, [useDeepgram])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      if (dgSocketRef.current) {
        try { dgSocketRef.current.close() } catch { /* ignore */ }
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close() } catch { /* ignore */ }
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      window.speechSynthesis.cancel()
    }
  }, [])

  // Draw waveform visualization
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

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      ctx.lineWidth = 2
      ctx.strokeStyle = '#10b981'
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

  // Stop mic visualization
  const stopMicVisualization = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    analyserRef.current = null
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [])

  // Cleanup Deepgram resources
  const cleanupDeepgram = useCallback(() => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect()
      scriptProcessorRef.current = null
    }
    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect()
      mediaSourceRef.current = null
    }
    if (dgSocketRef.current) {
      try {
        if (dgSocketRef.current.readyState === WebSocket.OPEN) {
          // Send empty buffer to signal end of audio
          dgSocketRef.current.send(new ArrayBuffer(0))
        }
        dgSocketRef.current.close()
      } catch { /* ignore */ }
      dgSocketRef.current = null
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close() } catch { /* ignore */ }
      audioContextRef.current = null
    }
    stopMicVisualization()
  }, [stopMicVisualization])

  // Send message to API and speak response (ElevenLabs with browser TTS fallback)
  const sendAndSpeak = useCallback(async (text: string) => {
    setState('processing')
    setInterim('')

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])

    try {
      const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })

      if (!res.ok) {
        throw new Error('API error')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No stream')

      const decoder = new TextDecoder()
      let fullText = ''

      // Read stream chunks
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        // Update assistant message in real-time
        setMessages(prev => {
          const updated = [...prev]
          const lastIdx = updated.length - 1
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = { ...updated[lastIdx], content: fullText }
          } else {
            updated.push({ role: 'assistant', content: fullText, timestamp: new Date() })
          }
          return updated
        })
      }

      // Speak the response — try ElevenLabs first, fall back to browser TTS
      if (fullText) {
        setState('speaking')

        try {
          const ttsRes = await fetch('/api/voice-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: fullText }),
          })

          if (ttsRes.ok && ttsRes.status === 200) {
            // ElevenLabs returned audio
            const blob = await ttsRes.blob()
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audioRef.current = audio
            audio.onended = () => {
              setState('idle')
              URL.revokeObjectURL(url)
              audioRef.current = null
            }
            audio.onerror = () => {
              setState('idle')
              URL.revokeObjectURL(url)
              audioRef.current = null
            }
            audio.play().catch(() => {
              // Autoplay blocked — fall back to browser TTS
              URL.revokeObjectURL(url)
              audioRef.current = null
              speakWithBrowserTTS(fullText)
            })
            return
          }
        } catch {
          // ElevenLabs failed — fall back
        }

        // Fallback: browser TTS
        speakWithBrowserTTS(fullText)
      } else {
        setState('idle')
      }
    } catch (err) {
      console.error('Voice error:', err)
      setError('Error al procesar. Intenta de nuevo.')
      setState('idle')
      setTimeout(() => setError(''), 3000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // Browser TTS fallback
  const speakWithBrowserTTS = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'es-MX'
      utterance.rate = 0.85
      utterance.pitch = 1.05
      if (voices.length > 0 && selectedVoiceIdx >= 0) {
        utterance.voice = voices[selectedVoiceIdx]
      }
      synthRef.current = utterance
      utterance.onend = () => { setState('idle'); synthRef.current = null }
      utterance.onerror = () => { setState('idle'); synthRef.current = null }
      window.speechSynthesis.speak(utterance)
    } else {
      setState('idle')
    }
  }, [voices, selectedVoiceIdx])

  // Start listening with Deepgram WebSocket STT
  const startDeepgramListening = useCallback(async () => {
    setError('')
    setState('listening')
    dgTranscriptRef.current = ''
    dgInterimRef.current = ''

    try {
      // 1. Get temp API key from our backend
      const tokenRes = await fetch('/api/deepgram-token')
      if (!tokenRes.ok) throw new Error('No Deepgram token')
      const { key } = await tokenRes.json()
      if (!key) throw new Error('Empty Deepgram key')

      // 2. Get mic stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      // 3. Set up AudioContext for visualization + PCM extraction
      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      mediaSourceRef.current = source

      // Analyser for waveform visualization
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      drawWaveform()

      // ScriptProcessor for PCM extraction → Deepgram WebSocket
      const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1)
      scriptProcessorRef.current = scriptProcessor
      source.connect(scriptProcessor)
      scriptProcessor.connect(audioCtx.destination) // required for onaudioprocess to fire

      // 4. Open Deepgram WebSocket
      const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=es-419&punctuate=true&interim_results=true&endpointing=300&encoding=linear16&sample_rate=16000`
      const socket = new WebSocket(dgUrl, ['token', key])
      dgSocketRef.current = socket

      socket.onopen = () => {
        // Start sending audio data
        scriptProcessor.onaudioprocess = (e) => {
          if (socket.readyState !== WebSocket.OPEN) return
          const input = e.inputBuffer.getChannelData(0)
          // Downsample from AudioContext sample rate to 16000
          const downsampled = downsample(input, audioCtx.sampleRate, 16000)
          const pcm = float32ToInt16(downsampled)
          socket.send(pcm)
        }
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
            const alt = data.channel.alternatives[0]
            const transcript = alt.transcript || ''

            if (data.is_final && transcript.trim()) {
              // Accumulate final transcript
              dgTranscriptRef.current += (dgTranscriptRef.current ? ' ' : '') + transcript.trim()
              dgInterimRef.current = ''
              setInterim(dgTranscriptRef.current)

              // After endpointing (speech_final), close and send
              if (data.speech_final) {
                const finalText = dgTranscriptRef.current.trim()
                cleanupDeepgram()
                if (finalText) {
                  sendAndSpeak(finalText)
                } else {
                  setState('idle')
                }
              }
            } else if (!data.is_final && transcript.trim()) {
              // Interim result — show accumulated + current interim
              dgInterimRef.current = transcript.trim()
              const display = dgTranscriptRef.current
                ? dgTranscriptRef.current + ' ' + dgInterimRef.current
                : dgInterimRef.current
              setInterim(display)
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      socket.onerror = () => {
        console.error('[Deepgram] WebSocket error — falling back to Web Speech API')
        cleanupDeepgram()
        setUseDeepgram(false)
        // Retry with Web Speech API
        startWebSpeechListening()
      }

      socket.onclose = (event) => {
        // If closed unexpectedly while still listening, submit what we have
        if (state === 'listening' || dgTranscriptRef.current.trim()) {
          const finalText = dgTranscriptRef.current.trim()
          cleanupDeepgram()
          if (finalText) {
            sendAndSpeak(finalText)
          } else {
            setState('idle')
          }
        }
        // Normal close after speech_final is handled in onmessage
        void event // suppress unused
      }
    } catch (err) {
      console.error('[Deepgram] Setup error:', err)
      cleanupDeepgram()
      // Fall back to Web Speech API
      setUseDeepgram(false)
      startWebSpeechListening()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawWaveform, cleanupDeepgram, sendAndSpeak])

  // Web Speech API fallback for STT
  const startWebSpeechListening = useCallback(() => {
    setError('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setSupported(false)
      setError('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.')
      setState('idle')
      return
    }

    const recognition = new SR()
    recognition.lang = 'es-MX'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognitionRef.current = recognition

    recognition.onstart = () => {
      setState('listening')
      // Start visualization via mic
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        streamRef.current = stream
        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
        drawWaveform()
      }).catch(() => { /* no viz, still works */ })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)

      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript += transcript
        }
      }

      if (interimTranscript) {
        setInterim(interimTranscript)
      }

      if (finalTranscript) {
        setInterim('')
        recognition.stop()
        stopMicVisualization()
        sendAndSpeak(finalTranscript.trim())
        return
      }

      // Auto-stop after 1.5 seconds of silence
      silenceTimerRef.current = setTimeout(() => {
        recognition.stop()
        stopMicVisualization()
        if (interimTranscript.trim()) {
          sendAndSpeak(interimTranscript.trim())
        } else {
          setState('idle')
        }
      }, 1500)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      stopMicVisualization()
      if (event.error === 'not-allowed') {
        setError('Permite acceso al microfono para usar el agente de voz.')
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError('Error de reconocimiento. Intenta de nuevo.')
        setTimeout(() => setError(''), 3000)
      }
      setState('idle')
    }

    recognition.onend = () => {
      stopMicVisualization()
      setState((prev: VoiceState) => prev === 'listening' ? 'idle' : prev)
    }

    recognition.start()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawWaveform, stopMicVisualization, sendAndSpeak])

  // Handle main button click
  const handleButtonClick = useCallback(() => {
    if (state === 'speaking') {
      // Stop speaking — ElevenLabs audio or browser TTS
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      window.speechSynthesis.cancel()
      setState('idle')
      return
    }

    if (state === 'listening') {
      // Stop listening — Deepgram or Web Speech API
      if (dgSocketRef.current) {
        const finalText = dgTranscriptRef.current.trim()
        cleanupDeepgram()
        if (finalText) {
          sendAndSpeak(finalText)
        } else {
          setState('idle')
        }
      } else if (recognitionRef.current) {
        recognitionRef.current.stop()
        stopMicVisualization()
      }
      return
    }

    if (state !== 'idle') return

    // Start listening — try Deepgram first, fall back to Web Speech API
    if (useDeepgram) {
      startDeepgramListening()
    } else {
      startWebSpeechListening()
    }
  }, [state, useDeepgram, cleanupDeepgram, sendAndSpeak, stopMicVisualization, startDeepgramListening, startWebSpeechListening])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#e5e5e5',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Top bar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid #1a1a1a',
        flexShrink: 0,
      }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
          <span style={{ color: '#fff', fontWeight: 900, fontSize: 20, letterSpacing: '-0.5px' }}>
            fullsite
            <span style={{ display: 'inline-block', width: 8, height: 8, background: '#10b981', marginLeft: 2, marginBottom: 2 }} />
          </span>
        </Link>
        <Link href="/" style={{
          color: '#737373',
          textDecoration: 'none',
          fontSize: 14,
          transition: 'color 0.2s',
        }}>
          Volver al dashboard
        </Link>
      </header>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: messages.length === 0 ? 'center' : 'flex-start',
        padding: '32px 16px',
        maxWidth: 640,
        margin: '0 auto',
        width: '100%',
        overflow: 'hidden',
      }}>
        {/* Voice button area */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          marginBottom: messages.length > 0 ? 32 : 0,
          flexShrink: 0,
        }}>
          {/* Title — only show when no messages */}
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
                Agente de Voz
              </h1>
              <p style={{ color: '#737373', fontSize: 15 }}>
                Preguntame sobre ventas, meseros, tendencias y mas.
              </p>
              {voices.length > 0 && (
                <select
                  value={selectedVoiceIdx}
                  onChange={e => setSelectedVoiceIdx(Number(e.target.value))}
                  style={{
                    marginTop: 12, padding: '6px 12px', fontSize: 12, borderRadius: 8,
                    background: '#1a1a1a', color: '#aaa', border: '1px solid #333',
                    cursor: 'pointer', maxWidth: 280,
                  }}
                >
                  {voices.map((v, i) => (
                    <option key={i} value={i}>{v.name} ({v.lang})</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Button container with rings */}
          <div style={{ position: 'relative', width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* Animated rings for listening state */}
            {state === 'listening' && (
              <>
                <div style={{
                  position: 'absolute',
                  width: 160, height: 160,
                  borderRadius: '50%',
                  border: '2px solid rgba(239, 68, 68, 0.3)',
                  animation: 'voiceRing 1.5s ease-out infinite',
                }} />
                <div style={{
                  position: 'absolute',
                  width: 160, height: 160,
                  borderRadius: '50%',
                  border: '2px solid rgba(239, 68, 68, 0.2)',
                  animation: 'voiceRing 1.5s ease-out 0.5s infinite',
                }} />
                <div style={{
                  position: 'absolute',
                  width: 160, height: 160,
                  borderRadius: '50%',
                  border: '2px solid rgba(239, 68, 68, 0.1)',
                  animation: 'voiceRing 1.5s ease-out 1s infinite',
                }} />
              </>
            )}

            {/* Pulse for idle */}
            {state === 'idle' && (
              <div style={{
                position: 'absolute',
                width: 130, height: 130,
                borderRadius: '50%',
                border: '2px solid rgba(16, 185, 129, 0.15)',
                animation: 'idlePulse 2.5s ease-in-out infinite',
              }} />
            )}

            {/* Main button */}
            <button
              onClick={handleButtonClick}
              disabled={!supported || state === 'processing'}
              style={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                border: `3px solid ${
                  state === 'listening' ? '#ef4444' :
                  state === 'processing' ? '#f59e0b' :
                  state === 'speaking' ? '#8b5cf6' :
                  '#10b981'
                }`,
                background: state === 'listening' ? 'rgba(239, 68, 68, 0.1)' :
                  state === 'processing' ? 'rgba(245, 158, 11, 0.1)' :
                  state === 'speaking' ? 'rgba(139, 92, 246, 0.1)' :
                  'rgba(16, 185, 129, 0.05)',
                cursor: state === 'processing' ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease',
                position: 'relative',
                zIndex: 1,
                outline: 'none',
                boxShadow: state === 'listening' ? '0 0 40px rgba(239, 68, 68, 0.3)' :
                  state === 'speaking' ? '0 0 40px rgba(139, 92, 246, 0.2)' :
                  '0 0 30px rgba(16, 185, 129, 0.1)',
              }}
            >
              {state === 'processing' ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'dotBounce 0.6s ease-in-out infinite' }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'dotBounce 0.6s ease-in-out 0.15s infinite' }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'dotBounce 0.6s ease-in-out 0.3s infinite' }} />
                </div>
              ) : state === 'speaking' ? (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="20" rx="2" />
                </svg>
              ) : (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={state === 'listening' ? '#ef4444' : '#10b981'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              )}
            </button>
          </div>

          {/* Waveform canvas — only during listening */}
          {state === 'listening' && (
            <canvas
              ref={canvasRef}
              width={300}
              height={40}
              style={{ opacity: 0.8 }}
            />
          )}

          {/* Status text */}
          <p style={{
            fontSize: 14,
            color: state === 'listening' ? '#ef4444' :
              state === 'processing' ? '#f59e0b' :
              state === 'speaking' ? '#8b5cf6' :
              '#737373',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            transition: 'color 0.3s',
          }}>
            {STATUS_TEXT[state]}
          </p>

          {/* Interim transcription */}
          {interim && (
            <p style={{
              fontSize: 16,
              color: '#a3a3a3',
              fontStyle: 'italic',
              textAlign: 'center',
              maxWidth: 400,
              animation: 'fadeIn 0.2s ease',
            }}>
              {interim}
            </p>
          )}

          {/* Error */}
          {error && (
            <p style={{
              fontSize: 13,
              color: '#ef4444',
              textAlign: 'center',
              padding: '8px 16px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: 8,
            }}>
              {error}
            </p>
          )}
        </div>

        {/* Conversation history */}
        {messages.length > 0 && (
          <div style={{
            flex: 1,
            width: '100%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            paddingBottom: 24,
          }}>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  animation: 'fadeIn 0.3s ease',
                }}
              >
                <div style={{
                  maxWidth: '85%',
                  padding: '12px 16px',
                  borderRadius: 16,
                  ...(msg.role === 'user' ? {
                    background: 'rgba(255, 255, 255, 0.07)',
                    backdropFilter: 'blur(10px)',
                    borderTopRightRadius: 4,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  } : {
                    background: 'rgba(16, 185, 129, 0.08)',
                    borderTopLeftRadius: 4,
                    borderLeft: '3px solid #10b981',
                  }),
                }}>
                  <p style={{
                    fontSize: 15,
                    lineHeight: 1.5,
                    color: msg.role === 'user' ? '#e5e5e5' : '#d4d4d4',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </p>
                  <p style={{
                    fontSize: 11,
                    color: '#525252',
                    marginTop: 6,
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                    margin: '6px 0 0',
                  }}>
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes voiceRing {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes idlePulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.08); opacity: 0.6; }
        }
        @keyframes dotBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        button:hover:not(:disabled) {
          transform: scale(1.05);
        }
        button:active:not(:disabled) {
          transform: scale(0.95);
        }
        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
      `}</style>
    </div>
  )
}
