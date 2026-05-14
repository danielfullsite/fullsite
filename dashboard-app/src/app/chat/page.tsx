'use client'

import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import type { ChatMessage } from '@/lib/types'

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hola, soy el asistente IA de Fullsite para AMALAY Coffee & Market. Tengo acceso a los datos de ventas, meseros, platillos y tendencias del restaurante. Preguntame lo que necesites.',
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
    'Como van las ventas esta semana vs la semana pasada?',
    'Quien es el mesero con mejor ticket promedio?',
    'Cual es el dia de la semana con mas ventas?',
    'Que categoria de menu vende mas?',
    'Como puedo subir el ticket promedio del restaurante?',
    'Dame un resumen del ultimo mes',
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
          client_id: 'amalay',
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
            'Lo siento, hubo un error al procesar tu mensaje. Verifica que las claves API esten configuradas en .env.local.',
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

      <div className="bg-card rounded-xl border border-border flex flex-col" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-accent text-white'
                    : 'bg-surface text-text border border-border'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}

          {/* Suggested questions */}
          {messages.length === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 max-w-2xl">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-left text-sm text-text-soft bg-white border border-border rounded-xl px-4 py-3 hover:bg-accent-light hover:border-accent/30 hover:text-accent transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border rounded-2xl px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-text-muted rounded-full animate-bounce"
                    style={{ animationDelay: '0.15s' }}
                  />
                  <span
                    className="w-2 h-2 bg-text-muted rounded-full animate-bounce"
                    style={{ animationDelay: '0.3s' }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-border">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage(input)
            }}
            className="flex gap-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe tu pregunta..."
              rows={1}
              className="flex-1 text-sm bg-surface border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-accent text-white rounded-xl px-5 py-3 hover:bg-accent/90 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm font-medium"
            >
              <Send size={16} />
              Enviar
            </button>
          </form>
          <p className="text-xs text-text-muted text-center mt-2">
            Powered by Claude Haiku - Las respuestas se basan en datos reales del restaurante
          </p>
        </div>
      </div>
    </>
  )
}
