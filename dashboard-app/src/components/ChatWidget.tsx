'use client'

import { useState, useRef, useEffect } from 'react'
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

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
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response, timestamp: new Date() },
      ])
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-[var(--surface-2)]/30">
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
                <div className="whitespace-pre-wrap">{renderMarkdown(msg.content)}</div>
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
