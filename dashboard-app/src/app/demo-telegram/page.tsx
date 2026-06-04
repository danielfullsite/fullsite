'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

interface Message {
  id: number
  from: 'user' | 'bot'
  text: string
  time: string
}

const DEMO_RESTAURANT = 'Casa Montaña'

// Pre-built responses for common queries
const RESPONSES: Record<string, string> = {
  '/briefing': `Buenos dias. Resumen de ayer:

Ventas: $68,450
Tickets: 182 | Personas: 156
Ticket promedio: $439
Propinas: $9,820 (14.3%)

Top meseros:
1. Carlos M. — $22,400 (48 tickets)
2. Andrea L. — $18,200 (42 tickets)
3. Roberto S. — $14,800 (38 tickets)

3 acciones para hoy:
- Luis G. lleva 3 dias sin vender postres. Hablar con el.
- Aguacate llega a 2kg manana. Pedir 5kg hoy.
- Sabado pasado vendieron 12% mas. Preparar staff extra.`,

  '/ventas': `Ventas de ayer: $68,450
vs mismo dia semana pasada: +8.3%
vs promedio del mes: +12.1%

Efectivo: $15,740 (23%)
Tarjeta credito: $31,487 (46%)
Tarjeta debito: $14,380 (21%)
Transferencia: $4,110 (6%)
Apps (Rappi/Uber): $2,733 (4%)`,

  '/top': `Top meseros de ayer:

1. Carlos M. — $22,400 | TP $467 | 2.3 beb/persona
2. Andrea L. — $18,200 | TP $433 | 2.1 beb/persona
3. Roberto S. — $14,800 | TP $389 | 1.8 beb/persona
4. Luis G. — $8,200 | TP $256 | 1.4 beb/persona
5. Diana R. — $4,850 | TP $220 | 1.2 beb/persona

Luis G. no vendio postres ni H&H ayer. 3er dia consecutivo.`,

  '/help': `Comandos disponibles:

/briefing — Resumen del dia con acciones
/ventas — Ventas y desglose por metodo
/top — Ranking de meseros
/help — Este mensaje

Tambien puedes preguntar en lenguaje natural:
"cuantos chilaquiles vendimos ayer"
"como va Carlos esta semana"
"que platillo tiene mejor margen"`,

  'como vamos': `Ayer cerraron con $68,450. 8% arriba del mismo dia la semana pasada. Ticket promedio $439. Carlos fue top con $22,400.`,

  'chilaquiles': `Ayer se vendieron 29 piezas de chilaquiles por $8,354.
Chilaquiles Light: 11 piezas ($2,914).
Total categoria: 40 piezas ($11,268).

Es el platillo mas vendido — 22% de las ordenes lo incluyen.`,

  'food cost': `Food cost promedio: 29%

Top margen:
- Chilaquiles: 84% ($195 precio, $31 costo)
- Pancakes: 83% ($175 precio, $28 costo)
- Avocado Toast: 79% ($185 precio, $39 costo)

Problema (<30%):
- Pizza Margarita: 23% ($185 precio, $143 costo)
- Salmon Bowl: 58% ($265 precio, $112 costo)`,

  'fraude': `Anti-fraude reporte semanal:

0 alertas criticas esta semana.

Cancelaciones: 8 (normal: 6-10/semana)
Descuentos aplicados: $3,200 (2.1% de ventas)
Cortesias: $1,480 (dentro de rango)

Sin patrones sospechosos detectados. Todo limpio.`,

  'prediccion': `Prediccion de cierre para hoy:

Proyectado: $72,300
Basado en: sabado promedio + tendencia +8%
Progreso: 45% ($32,500 vendidos a las 2pm)

Si mantienen el ritmo, cierran 6% arriba del sabado pasado.`,

  'mesero': `Meseros activos hoy:
- Carlos M. — 12 mesas, $8,400 (va bien)
- Andrea L. — 10 mesas, $6,200
- Roberto S. — 8 mesas, $5,100
- Luis G. — 6 mesas, $2,800 (bajo)
- Diana R. — 4 mesas, $1,520

Luis lleva bajo toda la semana. Hablar con el.`,

  'inventario': `Stock critico:
- Aguacate: 2.1kg (punto reorden: 5kg) — PEDIR HOY
- Arandano: 0.8kg (reorden: 2kg) — CRITICO

Compras sugeridas para manana:
- Aguacate: 5kg ($250)
- Arandano: 2.3kg ($115)
- Limon: 2kg ($40)
- Fresas: 2.3kg ($92)
Total: $497`,
}

function getResponse(input: string): string {
  const q = input.toLowerCase().trim()

  // Exact command matches
  if (q.startsWith('/')) {
    const cmd = q.split(' ')[0]
    if (RESPONSES[cmd]) return RESPONSES[cmd]
    return RESPONSES['/help']
  }

  // Keyword matching
  for (const [key, response] of Object.entries(RESPONSES)) {
    if (key.startsWith('/')) continue
    if (q.includes(key)) return response
  }

  // Greetings
  if (q.match(/hola|buenos|buenas|que onda|hey/)) {
    return `Hola! Soy el bot de ${DEMO_RESTAURANT}. Preguntame lo que quieras sobre ventas, meseros, inventario o costos. Escribe /help para ver los comandos.`
  }

  // Fallback
  return `Ayer cerraron con $68,450 en ventas. 182 tickets, ticket promedio $439. Carlos fue top con $22,400. Hay que hablar con Luis que lleva 3 dias bajo en upselling.

Preguntame algo mas especifico: chilaquiles, food cost, inventario, fraude, prediccion...`
}

function getTime(): string {
  return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export default function DemoTelegramPage() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: 'bot', text: `Hola! Soy el bot de IA de ${DEMO_RESTAURANT}. Preguntame lo que quieras sobre la operacion.\n\nPrueba: /briefing, /ventas, /top, o pregunta en lenguaje natural.`, time: getTime() },
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = () => {
    const text = input.trim()
    if (!text) return

    const userMsg: Message = { id: Date.now(), from: 'user', text, time: getTime() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setTyping(true)

    // Simulate bot thinking
    const delay = 800 + Math.random() * 1200
    setTimeout(() => {
      const response = getResponse(text)
      const botMsg: Message = { id: Date.now() + 1, from: 'bot', text: response, time: getTime() }
      setMessages(prev => [...prev, botMsg])
      setTyping(false)
    }, delay)
  }

  const quickActions = ['/briefing', '/ventas', '/top', 'food cost', 'inventario']

  return (
    <div style={{ minHeight: '100vh', background: '#0e1621', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#17212b', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #242f3d', flexShrink: 0 }}>
        <Link href="/demo-live" style={{ color: '#6ab3f3', textDecoration: 'none', fontSize: 14 }}>← Demo</Link>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 8V4H8"/><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M2 12h20"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Fullsite Bot</div>
          <div style={{ color: '#6ab3f3', fontSize: 12 }}>en linea · {DEMO_RESTAURANT}</div>
        </div>
        <div style={{ background: '#232e3c', padding: '6px 14px', borderRadius: 20, fontSize: 11, color: '#8b9bab', fontWeight: 600, letterSpacing: 0.5 }}>DEMO</div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', overflowX: 'auto', flexShrink: 0, background: '#0e1621' }}>
        {quickActions.map(cmd => (
          <button
            key={cmd}
            onClick={() => { setInput(cmd); setTimeout(() => { send() }, 50) }}
            style={{
              background: '#232e3c', border: 'none', borderRadius: 16, padding: '6px 14px',
              color: '#6ab3f3', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
            onMouseOver={e => (e.currentTarget.style.background = '#2b3945')}
            onMouseOut={e => (e.currentTarget.style.background = '#232e3c')}
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px' }}>
        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            justifyContent: msg.from === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 6,
          }}>
            <div style={{
              maxWidth: '85%',
              background: msg.from === 'user' ? '#2b5278' : '#182533',
              borderRadius: msg.from === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              padding: '8px 14px 6px',
              position: 'relative',
            }}>
              <div style={{ color: '#e1e3e6', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {msg.text}
              </div>
              <div style={{ textAlign: 'right', marginTop: 2 }}>
                <span style={{ fontSize: 11, color: '#5d6d7e' }}>{msg.time}</span>
                {msg.from === 'user' && <span style={{ fontSize: 11, color: '#5d6d7e', marginLeft: 4 }}>✓✓</span>}
              </div>
            </div>
          </div>
        ))}

        {typing && (
          <div style={{ display: 'flex', marginBottom: 6 }}>
            <div style={{ background: '#182533', borderRadius: '16px 16px 16px 4px', padding: '10px 18px' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5d6d7e', animation: 'pulse 1.2s ease-in-out infinite' }} />
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5d6d7e', animation: 'pulse 1.2s ease-in-out 0.3s infinite' }} />
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5d6d7e', animation: 'pulse 1.2s ease-in-out 0.6s infinite' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ background: '#17212b', padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid #242f3d', flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder="Escribe un mensaje..."
          style={{
            flex: 1, background: '#242f3d', border: 'none', borderRadius: 20, padding: '10px 16px',
            color: '#e1e3e6', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || typing}
          style={{
            width: 40, height: 40, borderRadius: '50%', background: input.trim() && !typing ? '#6ab3f3' : '#232e3c',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={input.trim() && !typing ? '#17212b' : '#5d6d7e'} strokeWidth="2.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* CTA */}
      <div style={{ background: '#17212b', padding: '12px 16px', borderTop: '1px solid #242f3d', textAlign: 'center', flexShrink: 0 }}>
        <p style={{ color: '#5d6d7e', fontSize: 12, marginBottom: 8 }}>Esto es una demo con datos ficticios de {DEMO_RESTAURANT}</p>
        <a
          href="https://wa.me/528112741000?text=Hola%20Daniel%2C%20probé%20el%20demo%20del%20bot%20y%20quiero%20verlo%20con%20mis%20datos"
          target="_blank"
          rel="noopener"
          style={{
            display: 'inline-block', background: '#10b981', color: '#fff', padding: '10px 24px',
            borderRadius: 20, fontSize: 14, fontWeight: 600, textDecoration: 'none',
          }}
        >
          Quiero verlo con mis datos →
        </a>
      </div>
    </div>
  )
}
