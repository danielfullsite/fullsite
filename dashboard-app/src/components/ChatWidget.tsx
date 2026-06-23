'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send, ArrowLeft, Sparkles } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { ChatMessage } from '@/lib/types'

const quickQuestions = [
  '¿Cómo van las ventas hoy?',
  '¿Quién es mi mejor mesero?',
  '¿Qué día vendo más?',
  '¿Cómo subo el ticket promedio?',
  '¿Cuántos chilaquiles vendimos?',
  '¿Cómo vamos vs la semana pasada?',
]

// Parse chart data from <!--chart ... chart--> markers
interface ChartData { type: 'bar' | 'line' | 'pie'; title: string; data: { label: string; value: number }[] }

function extractChart(text: string): { clean: string; chart: ChartData | null } {
  // Strip ALL chart blocks and parse the first valid one
  let chart: ChartData | null = null
  let clean = text
  const regex = /<!--\s*chart\s*([\s\S]*?)\s*chart\s*-->/g
  let match
  while ((match = regex.exec(text)) !== null) {
    if (!chart) {
      try { chart = JSON.parse(match[1].trim()) as ChartData } catch { /* skip invalid */ }
    }
    clean = clean.replace(match[0], '')
  }
  return { clean: clean.trim(), chart }
}

function MiniChart({ chart }: { chart: ChartData }) {
  const max = Math.max(...chart.data.map(d => d.value), 1)
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

  if (chart.type === 'pie') {
    const total = chart.data.reduce((s, d) => s + d.value, 0)
    let angle = 0
    return (
      <div className="mt-2 p-3 bg-black/20 rounded-xl">
        <p className="text-xs font-semibold text-[var(--text-2)] mb-2">{chart.title}</p>
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 100 100" className="w-20 h-20 flex-shrink-0">
            {chart.data.map((d, i) => {
              const pct = d.value / total
              const start = angle
              angle += pct * 360
              const r = 45, cx = 50, cy = 50
              const startRad = (start - 90) * Math.PI / 180
              const endRad = (start + pct * 360 - 90) * Math.PI / 180
              const large = pct > 0.5 ? 1 : 0
              const path = `M${cx},${cy} L${cx + r * Math.cos(startRad)},${cy + r * Math.sin(startRad)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(endRad)},${cy + r * Math.sin(endRad)} Z`
              return <path key={i} d={path} fill={colors[i % colors.length]} />
            })}
          </svg>
          <div className="space-y-1">
            {chart.data.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors[i % colors.length] }} />
                <span className="text-[var(--text-3)]">{d.label}</span>
                <span className="text-white font-medium">${d.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Bar or Line chart
  const [expanded, setExpanded] = useState(false)
  const displayData = chart.data.length > 14 && !expanded ? chart.data.slice(-14) : chart.data

  const renderBars = (h: number, maxW: number, labelSize: string, valueSize: string, gap: string) => (
    <div className={`flex items-end ${gap} overflow-hidden`} style={{ height: h }}>
      {displayData.map((d, i) => (
        <div key={i} className="flex flex-col items-center gap-px flex-1 min-w-0">
          <span className={`${valueSize} text-emerald-400 font-medium truncate w-full text-center`}>
            ${d.value >= 1000 ? `${(d.value / 1000).toFixed(0)}k` : d.value.toLocaleString()}
          </span>
          <div
            className="rounded-t w-full mx-auto"
            style={{ maxWidth: maxW, height: `${Math.max(3, (d.value / max) * (h * 0.75))}px`, background: colors[i % colors.length] }}
          />
          <span className={`${labelSize} text-[var(--text-3)] truncate w-full text-center`}>{d.label}</span>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <div className="mt-2 p-2 bg-black/20 rounded-xl overflow-hidden cursor-pointer hover:bg-black/30 transition-colors" onClick={() => setExpanded(true)}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-semibold text-[var(--text-2)]">{chart.title}</p>
          <span className="text-[8px] text-[var(--text-3)]">Click para expandir</span>
        </div>
        {renderBars(80, 20, 'text-[6px]', 'text-[7px]', 'gap-px')}
      </div>
      {expanded && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={() => setExpanded(false)}>
          <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-4xl max-h-[80vh] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">{chart.title}</h3>
              <button onClick={() => setExpanded(false)} className="w-10 h-10 rounded-lg bg-[var(--line)] flex items-center justify-center text-white hover:bg-[var(--line-soft)]">✕</button>
            </div>
            {renderBars(300, 40, 'text-xs', 'text-sm', 'gap-1')}
            <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-3)]">
              <span>{displayData.length} datos</span>
              <span>Total: ${displayData.reduce((s, d) => s + d.value, 0).toLocaleString()}</span>
              <span>Promedio: ${Math.round(displayData.reduce((s, d) => s + d.value, 0) / displayData.length).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Renderiza markdown básico: **negritas** y [links](url)
function renderMarkdown(text: string) {
  // First split by links [text](url)
  const linkParts = text.split(/(\[[^\]]+\]\([^)]+\))/g)
  return linkParts.map((part, i) => {
    const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      const [, label, href] = linkMatch
      return (
        <a key={i} href={href} className="text-emerald-400 hover:text-emerald-300 underline font-medium"
          onClick={(e) => { e.preventDefault(); window.location.href = href }}>
          {label}
        </a>
      )
    }
    // Then handle **bold** within non-link parts
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
    return boldParts.map((bp, j) =>
      bp.startsWith('**') && bp.endsWith('**')
        ? <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>
        : <span key={`${i}-${j}`}>{bp}</span>
    )
  })
}

export default function ChatWidget() {
  const { clientId } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<(ChatMessage & { timestamp?: Date })[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // Typewriter state: the partial text being animated in for the latest assistant message
  const [typingContent, setTypingContent] = useState<string | null>(null)
  const typingFullRef = useRef<string>('')      // full target text
  const typingIndexRef = useRef(0)              // chars revealed so far
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Finish the typewriter animation immediately (skip to end)
  const skipAnimation = useCallback(() => {
    if (typingTimerRef.current !== null) {
      clearInterval(typingTimerRef.current)
      typingTimerRef.current = null
      const full = typingFullRef.current
      setTypingContent(null)
      setMessages((prev) => {
        // Replace the last assistant message (which was added as a placeholder) with the full text
        const copy = [...prev]
        const lastIdx = copy.length - 1
        if (copy[lastIdx]?.role === 'assistant') {
          copy[lastIdx] = { ...copy[lastIdx], content: full }
        }
        return copy
      })
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, typingContent])

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKey)
      return () => document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300)
  }, [isOpen])

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return

    const userMessage: ChatMessage & { timestamp?: Date } = {
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-6),
          client_id: clientId || 'amalay',
        }),
      })

      if (!res.ok) throw new Error('Error en la respuesta')

      const data = await res.json()
      const fullText: string = data.response || ''

      // Add placeholder message immediately (empty), then animate
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', timestamp: new Date() },
      ])

      // Kick off typewriter
      typingFullRef.current = fullText
      typingIndexRef.current = 0
      setTypingContent('')

      const CHARS_PER_TICK = 4
      const TICK_MS = 15

      typingTimerRef.current = setInterval(() => {
        typingIndexRef.current = Math.min(
          typingIndexRef.current + CHARS_PER_TICK,
          fullText.length
        )
        const partial = fullText.slice(0, typingIndexRef.current)
        setTypingContent(partial)

        // Update the placeholder message so extractChart / renderMarkdown work correctly
        setMessages((prev) => {
          const copy = [...prev]
          const lastIdx = copy.length - 1
          if (copy[lastIdx]?.role === 'assistant') {
            copy[lastIdx] = { ...copy[lastIdx], content: partial }
          }
          return copy
        })

        if (typingIndexRef.current >= fullText.length) {
          clearInterval(typingTimerRef.current!)
          typingTimerRef.current = null
          setTypingContent(null)
        }
      }, TICK_MS)
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Hubo un error al procesar tu mensaje. Intenta de nuevo.',
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
      >
        <MessageCircle size={22} />
      </button>
    )
  }

  const hasMessages = messages.length > 0

  return (
    <div className="fixed inset-0 sm:inset-auto sm:bottom-6 sm:right-6 z-50 w-full sm:w-[420px] h-[100dvh] sm:h-auto sm:max-h-[600px] bg-[var(--surface)] sm:rounded-2xl shadow-2xl sm:border sm:border-[var(--line)]/80 flex flex-col overflow-hidden animate-widget-in">
      {/* Header — safe area for iOS notch */}
      <div className="shrink-0 pt-[env(safe-area-inset-top)] bg-[var(--surface)]">
        <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--line)]/60">
          <button
            onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)] transition-colors shrink-0"
            aria-label="Cerrar chat"
          >
            <ArrowLeft size={20} className="text-[var(--text-2)]" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0">
              <Sparkles size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text-1)] leading-tight">fullsite IA</h3>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <p className="text-[11px] text-[var(--text-3)]">En linea</p>
              </div>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)] transition-colors shrink-0 sm:hidden"
            aria-label="Cerrar"
          >
            <X size={18} className="text-[var(--text-3)]" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
            className="hidden sm:flex w-8 h-8 rounded-full items-center justify-center hover:bg-[var(--surface-2)] transition-colors shrink-0"
            aria-label="Cerrar"
          >
            <X size={16} className="text-[var(--text-3)]" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-[var(--surface-2)]/30"
        onScroll={() => { if (typingTimerRef.current !== null) skipAnimation() }}
        onClick={() => { if (typingTimerRef.current !== null) skipAnimation() }}
      >
        {/* Empty state */}
        {!hasMessages && !isLoading && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-emerald-600/10 flex items-center justify-center">
              <Sparkles size={28} className="text-emerald-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--text-1)]">Asistente IA</p>
              <p className="text-xs text-[var(--text-3)] mt-1 max-w-[240px]">Pregunta sobre ventas, meseros, platillos o tendencias</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2 px-2">
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/8 border border-emerald-500/15 rounded-full px-3.5 py-2 hover:bg-emerald-500/15 hover:border-emerald-500/25 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2.5 animate-message-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles size={12} className="text-white" />
              </div>
            )}
            <div className={`max-w-[82%] ${msg.role === 'user' ? 'ml-auto' : ''}`}>
              <div
                className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-emerald-500 text-white rounded-tr-md'
                    : 'bg-[var(--surface)] text-[var(--text-1)] border border-[var(--line)]/60 shadow-sm rounded-tl-md'
                }`}
              >
                <div className="whitespace-pre-wrap">{renderMarkdown(msg.role === 'assistant' ? extractChart(msg.content).clean : msg.content)}</div>
                {msg.role === 'assistant' && extractChart(msg.content).chart && (
                  <MiniChart chart={extractChart(msg.content).chart!} />
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex gap-2.5 animate-message-in">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0">
              <Sparkles size={12} className="text-white" />
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)]/60 shadow-sm rounded-2xl rounded-tl-md px-4 py-3">
              <div className="flex gap-1.5 items-center h-4">
                <span className="w-1.5 h-1.5 bg-[var(--text-4)] rounded-full animate-typing-dot" />
                <span className="w-1.5 h-1.5 bg-[var(--text-4)] rounded-full animate-typing-dot" style={{ animationDelay: '0.2s' }} />
                <span className="w-1.5 h-1.5 bg-[var(--text-4)] rounded-full animate-typing-dot" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input — safe area for iOS home indicator */}
      <div className="shrink-0 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[var(--line)]/60 bg-[var(--surface)]">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(input) }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage(input)
              }
            }}
            placeholder="Escribe tu pregunta..."
            className="flex-1 text-sm bg-[var(--surface-2)] border border-[var(--line)] rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition-all text-[var(--text-1)] placeholder:text-[var(--text-3)]"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-10 h-10 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 transition-all disabled:opacity-30 shadow-sm flex items-center justify-center shrink-0"
          >
            <Send size={16} className="-ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  )
}
