'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, User, Sparkles } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { ChatMessage } from '@/lib/types'

const quickQuestions = [
  '¿Cómo van las ventas hoy?',
  '¿Quién es mi mejor mesero?',
  '¿Qué día vendo más?',
  '¿Cómo subo el ticket promedio?',
]

function formatTime(date: Date) {
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatWidget() {
  const { clientId } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<(ChatMessage & { timestamp?: Date })[]>([
    {
      role: 'assistant',
      content:
        'Hola, soy el asistente IA de Fullsite. Puedo ayudarte con datos de ventas, meseros, platillos y tendencias de tu restaurante.',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
          content:
            'Lo siento, hubo un error al procesar tu mensaje. Verifica que las claves API estén configuradas.',
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
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center animate-pulse-ring"
      >
        <MessageCircle size={22} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-50 w-full sm:w-[400px] h-[100dvh] sm:h-auto sm:max-h-[580px] bg-white sm:rounded-2xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden animate-widget-in">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between bg-gradient-to-r from-blue-500 to-indigo-600">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">fullsite. IA</h3>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-300" />
              <p className="text-[11px] text-blue-100">Pregúntame lo que quieras</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-white/70 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[380px] bg-slate-50/50">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 animate-message-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user'
                  ? 'bg-slate-600 text-white'
                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
              }`}
            >
              {msg.role === 'user' ? <User size={12} /> : <Sparkles size={12} />}
            </div>
            <div className={`max-w-[80%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-md'
                    : 'bg-white text-slate-900 border border-slate-200/80 shadow-sm rounded-bl-md'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
              {msg.timestamp && (
                <span className="text-[10px] text-slate-400 mt-0.5 px-1">
                  {formatTime(msg.timestamp)}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Quick questions */}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {quickQuestions.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="text-xs text-blue-600 bg-white border border-blue-200/80 rounded-full px-3 py-1.5 hover:bg-blue-50 hover:border-blue-300 transition-all shadow-sm"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex gap-2 animate-message-in">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
              <Sparkles size={12} className="text-white" />
            </div>
            <div className="bg-white border border-slate-200/80 shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5 items-center h-4">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-typing-dot" />
                <span
                  className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-typing-dot"
                  style={{ animationDelay: '0.2s' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-typing-dot"
                  style={{ animationDelay: '0.4s' }}
                />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-200/80 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage(input)
              }
            }}
            placeholder="Escribe tu pregunta..."
            className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all text-slate-900 placeholder:text-slate-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-10 h-10 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-all disabled:opacity-40 shadow-sm flex items-center justify-center shrink-0"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
