'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Sparkles } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useAuth } from '@/contexts/AuthContext'
import type { ChatMessage } from '@/lib/types'

export default function ChatPage() {
  const { clientId } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hola, soy el asistente IA de Fullsite para AMALAY Coffee & Market. Tengo acceso a los datos de ventas, meseros, platillos y tendencias del restaurante. Pregúntame lo que necesites.',
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const suggestedQuestions = [
    '¿Cómo van las ventas esta semana vs la semana pasada?',
    '¿Quién es el mesero con mejor ticket promedio?',
    '¿Cuál es el día de la semana con más ventas?',
    '¿Qué categoría de menú vende más?',
    '¿Cómo puedo subir el ticket promedio del restaurante?',
    'Dame un resumen del último mes',
  ]

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return

    const userMessage: ChatMessage = { role: 'user', content: text }
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
        { role: 'assistant', content: data.response },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Lo siento, hubo un error al procesar tu mensaje. Verifica que las claves API estén configuradas en .env.local.',
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

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Chat IA"
        subtitle="Asistente inteligente con acceso a los datos del restaurante"
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 120px)', minHeight: '500px' }}>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 animate-message-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gradient-to-br from-purple-100 to-blue-100 text-blue-600'
              }`}>
                {msg.role === 'user' ? <User size={15} /> : <Bot size={15} />}
              </div>

              {/* Bubble */}
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-md'
                    : 'bg-slate-50 text-slate-900 border border-slate-200 rounded-bl-md'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}

          {/* Suggested questions */}
          {messages.length === 1 && (
            <div className="pt-2 max-w-2xl">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} className="text-blue-500" />
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Preguntas sugeridas</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-left text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-3 hover:bg-blue-50/50 hover:border-blue-200 hover:text-blue-700 transition-all duration-150 shadow-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading && (
            <div className="flex gap-3 animate-message-in">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center shrink-0">
                <Bot size={15} className="text-blue-600" />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"
                    style={{ animationDelay: '0.15s' }}
                  />
                  <span
                    className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"
                    style={{ animationDelay: '0.3s' }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white/80 backdrop-blur-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage(input)
            }}
            className="flex gap-3 items-end"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe tu pregunta..."
              rows={1}
              className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none transition-all text-slate-900 placeholder:text-slate-400"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-blue-500 text-white rounded-xl px-5 py-3 hover:bg-blue-600 transition-all disabled:opacity-40 disabled:hover:bg-blue-500 flex items-center gap-2 text-sm font-medium shadow-sm hover:shadow"
            >
              <Send size={16} />
              <span className="hidden sm:inline">Enviar</span>
            </button>
          </form>
          <p className="text-[11px] text-slate-400 text-center mt-2.5">
            Powered by Claude Haiku -- Las respuestas se basan en datos reales del restaurante
          </p>
        </div>
      </div>
    </>
  )
}
