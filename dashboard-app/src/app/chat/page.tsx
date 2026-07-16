'use client'

import { useState, useRef, useEffect } from 'react'
import { User, Sparkles, ArrowUp } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { ChatMessage } from '@/lib/types'

const suggestionCards = [
  {
    icon: '\u{1F4CA}',
    title: 'Resumen del d\u00EDa',
    description: 'Ventas, tickets y ticket promedio de hoy',
  },
  {
    icon: '\u{1F465}',
    title: 'Top meseros',
    description: 'Qui\u00E9n vendi\u00F3 m\u00E1s esta semana',
  },
  {
    icon: '\u{1F37D}\uFE0F',
    title: 'Platillos populares',
    description: 'Los m\u00E1s vendidos del mes',
  },
  {
    icon: '\u{1F4C8}',
    title: 'Tendencias',
    description: 'Compara este mes vs el anterior',
  },
  {
    icon: '\u2615',
    title: 'Bebidas por persona',
    description: 'Cu\u00E1ntas bebidas vende cada mesero',
  },
  {
    icon: '\u{1F4B0}',
    title: 'Ticket promedio',
    description: 'Por mesero y por d\u00EDa de la semana',
  },
]

function formatTime(date: Date) {
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPage() {
  const { clientId } = useAuth()
  const [messages, setMessages] = useState<(ChatMessage & { timestamp?: Date })[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

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
          history: messages.slice(-8),
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
          content:
            'Lo siento, hubo un error al procesar tu mensaje. Verifica que las claves API est\u00E9n configuradas en .env.local.',
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div
      className="flex flex-col bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden"
      style={{ height: 'calc(100dvh - 80px)' }}
    >
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-[var(--line)] bg-[var(--surface)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm shrink-0">
            <Sparkles size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-1)]">Asistente IA</h1>
            <p className="text-xs text-[var(--text-2)] truncate">
              Preg&uacute;ntame sobre ventas, meseros, platillos y m&aacute;s
            </p>
          </div>
          <div className="ml-auto hidden sm:flex items-center gap-1.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-full px-3 py-1 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span className="text-[11px] text-[var(--text-2)] font-medium">Powered by Claude</span>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        {!hasMessages ? (
          /* Welcome state */
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-100 via-indigo-100 to-purple-100 flex items-center justify-center mb-6 shadow-inner">
              <Sparkles size={32} className="text-blue-400" />
            </div>
            <h2 className="text-2xl font-semibold text-[var(--text-1)] mb-2">
              &iquest;En qu&eacute; puedo ayudarte?
            </h2>
            <p className="text-sm text-[var(--text-2)] mb-8">
              Tengo acceso a los datos del restaurante en tiempo real
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {suggestionCards.map((card) => (
                <button
                  key={card.title}
                  onClick={() => sendMessage(card.title)}
                  className="group text-left bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3.5 hover:shadow-md hover:border-blue-500/20 hover:bg-blue-500/10 transition-all duration-200 cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl shrink-0 mt-0.5">{card.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-1)] group-hover:text-blue-700 transition-colors">
                        {card.title}
                      </p>
                      <p className="text-xs text-[var(--text-2)] mt-0.5 leading-relaxed">
                        {card.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="space-y-5 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 animate-message-in ${
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === 'user'
                      ? 'bg-slate-600 text-white'
                      : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <User size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                </div>

                {/* Bubble + timestamp */}
                <div className={`max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white rounded-br-md'
                        : 'bg-[var(--surface)] text-[var(--text-1)] border border-[var(--line-soft)] shadow-sm rounded-bl-md'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                  {msg.timestamp && (
                    <span className={`text-xs text-[var(--text-3)] mt-1 px-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                      {formatTime(msg.timestamp)}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex gap-3 animate-message-in">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div className="bg-[var(--surface)] border border-[var(--line-soft)] shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1.5 items-center h-5">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-typing-dot" />
                    <span
                      className="w-2 h-2 bg-slate-400 rounded-full animate-typing-dot"
                      style={{ animationDelay: '0.2s' }}
                    />
                    <span
                      className="w-2 h-2 bg-slate-400 rounded-full animate-typing-dot"
                      style={{ animationDelay: '0.4s' }}
                    />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-4 sm:px-6 py-4 border-t border-[var(--line)] bg-[var(--surface)] shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex gap-3 items-end max-w-3xl mx-auto"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Preguntame lo que quieras..."
            rows={1}
            className="flex-1 text-sm bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none transition-all text-[var(--text-1)] placeholder:text-[var(--text-3)]"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-11 h-11 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-all disabled:opacity-40 disabled:hover:bg-blue-500 flex items-center justify-center shadow-sm hover:shadow shrink-0"
          >
            <ArrowUp size={18} />
          </button>
        </form>
        <p className="text-[11px] text-[var(--text-3)] text-center mt-2.5">
          Powered by Claude &middot; Las respuestas se basan en datos reales del restaurante
        </p>
      </div>
    </div>
  )
}
