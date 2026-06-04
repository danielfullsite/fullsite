'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  id: number
  from: 'user' | 'bot'
  text: string
  time: string
}

const RESTAURANT = 'Atope'

const RESPONSES: Record<string, string> = {
  '/briefing': `Buenos dias Ricardo. Resumen de ayer:

Ventas: $89,200
Tickets: 124 | Personas: 198
Ticket promedio: $720
Propinas: $14,276 (16%)

Top meseros:
1. Miguel A. — $28,400 (32 mesas)
2. Patricia R. — $22,100 (26 mesas)
3. Fernando L. — $18,700 (24 mesas)

3 acciones para hoy:
- Reserva de 20 personas a las 8pm en salon privado. Confirmar menu.
- Pulpo a la gallega agotado ayer a las 9pm. Pedir doble hoy.
- Fernando bajo 15% vs semana pasada. Hablar con el.`,

  '/ventas': `Ventas de ayer: $89,200
vs mismo dia semana pasada: +11.4%
vs promedio del mes: +8.2%

Efectivo: $12,488 (14%)
Tarjeta credito: $44,600 (50%)
Tarjeta debito: $22,300 (25%)
Transferencia: $5,352 (6%)
Apps (Rappi/Uber): $4,460 (5%)`,

  '/top': `Top meseros de ayer:

1. Miguel A. — $28,400 | TP $888 | 32 mesas
2. Patricia R. — $22,100 | TP $850 | 26 mesas
3. Fernando L. — $18,700 | TP $779 | 24 mesas
4. Laura M. — $12,400 | TP $620 | 20 mesas
5. Carlos D. — $7,600 | TP $507 | 15 mesas

Fernando bajo 15% esta semana. Era #2 la semana pasada.`,

  '/help': `Comandos disponibles:

/briefing — Resumen del dia con acciones
/ventas — Ventas y desglose por metodo
/top — Ranking de meseros
/help — Este mensaje

Tambien puedes preguntar en lenguaje natural:
"cuantas paellas vendimos ayer"
"como va Miguel esta semana"
"que platillo tiene mejor margen"`,

  'como vamos': `Ayer cerraron con $89,200. 11% arriba del mismo dia la semana pasada. Ticket promedio $720. Miguel fue top con $28,400. Buen dia para ser martes.`,

  'paella': `Ayer se vendieron 18 paellas:
- Paella Mixta: 8 pzas / $3,920 ($490 c/u)
- Paella Negra: 6 pzas / $3,540 ($590 c/u)
- Paella Valenciana: 4 pzas / $2,360 ($590 c/u)

Total paellas: $9,820. Son el 11% de las ventas. Margen promedio 68%.`,

  'croqueta': `Croquetas ayer: 42 ordenes / $5,880
- Croquetas de Jamon: 28 ordenes ($140 c/u)
- Croquetas de Bacalao: 14 ordenes ($140 c/u)

Es el platillo mas pedido como entrada. Margen 82%.`,

  'food cost': `Food cost promedio Atope: 31%

Top margen:
- Croquetas: 82% ($140 precio, $25 costo)
- Tortilla Espanola: 78% ($180 precio, $40 costo)
- Patatas Bravas: 76% ($160 precio, $38 costo)

Problema (<40%):
- Cochinillo: 38% ($890 precio, $552 costo)
- Solomillo con Foie: 35% ($680 precio, $442 costo)
- Dorada por kg: 32% ($750/kg precio, $510/kg costo)`,

  'fraude': `Anti-fraude reporte semanal:

0 alertas criticas.

Cancelaciones: 5 (normal: 4-7/semana)
Descuentos aplicados: $4,100 (2.3% de ventas)
Cortesias: $2,200 (1.2%)

Sin patrones sospechosos. Todo limpio.`,

  'prediccion': `Prediccion de cierre para hoy (viernes):

Proyectado: $112,500
Basado en: viernes promedio + tendencia +8%
Los viernes son el 2do mejor dia despues del sabado.

Reservaciones confirmadas: 8 mesas (42 personas).
Estimado adicional walk-in: 80 personas.`,

  'mesero': `Meseros activos hoy:
- Miguel A. — 8 mesas, $12,400 (va fuerte)
- Patricia R. — 6 mesas, $8,200
- Fernando L. — 5 mesas, $5,100 (bajo)
- Laura M. — 4 mesas, $3,800
- Carlos D. — 3 mesas, $2,100

Fernando bajo 15% vs la semana pasada. Revisar.`,

  'inventario': `Stock critico:
- Pulpo: 2.3kg (reorden: 5kg) — PEDIR HOY
- Jamon Serrano: 1.8kg (reorden: 4kg) — PEDIR HOY
- Chorizo Iberico: 0.5kg (reorden: 2kg) — CRITICO

Compras sugeridas:
- Pulpo: 5kg ($1,250)
- Jamon Serrano: 4kg ($2,800)
- Chorizo: 2kg ($960)
- Aceite de oliva: 5L ($450)
Total: $5,460`,

  'reserva': `Reservaciones de hoy:
- 2:00pm: Mesa 4 personas (terraza) — Familia Garcia
- 7:00pm: Mesa 6 personas (salon) — Cumpleanos
- 8:00pm: Privado 20 personas (salon VIP) — Evento corporativo
- 9:00pm: Mesa 8 personas (interior) — Sr. Villarreal

Total: 38 personas confirmadas. Preparar 2 meseros extra para las 8pm.`,

  'pulpo': `Pulpo a la Gallega ayer: 14 ordenes / $4,900
Precio: $350 por orden
Costo: $145 (margen 59%)

Se agoto a las 9pm. Pedir el doble hoy (viernes = mas demanda).
Proveedor: Mariscos del Norte. Entrega antes de 2pm si pides antes de 10am.`,

  'vino': `Top vinos vendidos ayer:
1. Rioja Crianza — 12 botellas / $4,800
2. Ribera del Duero — 8 botellas / $4,400
3. Albarino — 6 botellas / $2,100
4. Cava — 4 botellas / $1,200

Total vinos: $12,500 (14% de ventas). Margen promedio 65%.
El Ribera del Duero se esta acabando — quedan 4 botellas.`,

  'tapas': `Top tapas ayer:
1. Croquetas de Jamon: 28 ordenes / $3,920
2. Patatas Bravas: 22 ordenes / $3,520
3. Tortilla Espanola: 18 ordenes / $3,240
4. Gambas al Ajillo: 15 ordenes / $3,375
5. Pulpo a la Gallega: 14 ordenes / $4,900

Las tapas representan 38% de las ventas. Margen promedio 72%.`,
}

function getTime(): string {
  return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

async function getResponse(input: string): Promise<string> {
  const q = input.toLowerCase().trim()
  if (q.startsWith('/')) {
    const cmd = q.split(' ')[0]
    if (RESPONSES[cmd]) return RESPONSES[cmd]
    return RESPONSES['/help']
  }
  for (const [key, response] of Object.entries(RESPONSES)) {
    if (key.startsWith('/')) continue
    if (q.includes(key)) return response
  }
  if (q.match(/hola|buenos|buenas|que onda|hey/)) {
    return `Hola Ricardo! Soy el bot de Atope. Preguntame lo que quieras sobre ventas, meseros, inventario o costos. Escribe /help para ver los comandos.`
  }
  try {
    const res = await fetch('/api/demo-chat-atope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.response) return data.response
    }
  } catch { /* fall through */ }
  return `Ayer Atope cerro con $89,200. 124 tickets, TP $720. Miguel fue top con $28,400. Preguntame algo mas especifico.`
}

export default function DemoAtopeBotPage() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: 'bot', text: `Hola Ricardo! Soy el bot de IA de Atope. Preguntame lo que quieras sobre la operacion.\n\nPrueba: /briefing, /ventas, /top, o pregunta lo que sea.`, time: getTime() },
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = () => {
    const text = input.trim()
    if (!text || typing) return
    const userMsg: Message = { id: Date.now(), from: 'user', text, time: getTime() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setTyping(true)
    getResponse(text).then(response => {
      setMessages(prev => [...prev, { id: Date.now() + 1, from: 'bot', text: response, time: getTime() }])
      setTyping(false)
    })
  }

  const quickActions = ['/briefing', '/ventas', '/top', 'paella', 'tapas', 'inventario', 'vino']

  return (
    <div style={{ minHeight: '100vh', background: '#0e1621', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ background: '#17212b', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #242f3d', flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #dc2626, #b91c1c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#fff' }}>A</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Fullsite Bot</div>
          <div style={{ color: '#e74c3c', fontSize: 12 }}>en linea · Atope Cocina Española</div>
        </div>
        <div style={{ background: '#232e3c', padding: '6px 14px', borderRadius: 20, fontSize: 11, color: '#8b9bab', fontWeight: 600 }}>DEMO</div>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', overflowX: 'auto', flexShrink: 0 }}>
        {quickActions.map(cmd => (
          <button key={cmd} onClick={() => { setInput(cmd); setTimeout(send, 50) }}
            style={{ background: '#232e3c', border: 'none', borderRadius: 16, padding: '6px 14px', color: '#6ab3f3', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {cmd}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px' }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
            <div style={{
              maxWidth: '85%', background: msg.from === 'user' ? '#2b5278' : '#182533',
              borderRadius: msg.from === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', padding: '8px 14px 6px',
            }}>
              <div style={{ color: '#e1e3e6', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
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
                {[0, 0.3, 0.6].map((d, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#5d6d7e', animation: `pulse 1.2s ease-in-out ${d}s infinite` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ background: '#17212b', padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid #242f3d', flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder="Escribe un mensaje..."
          style={{ flex: 1, background: '#242f3d', border: 'none', borderRadius: 20, padding: '10px 16px', color: '#e1e3e6', fontSize: 14, outline: 'none' }} />
        <button onClick={send} disabled={!input.trim() || typing}
          style={{ width: 40, height: 40, borderRadius: '50%', background: input.trim() && !typing ? '#6ab3f3' : '#232e3c', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={input.trim() && !typing ? '#17212b' : '#5d6d7e'} strokeWidth="2.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }`}</style>

      <div style={{ background: '#17212b', padding: '12px 16px', borderTop: '1px solid #242f3d', textAlign: 'center', flexShrink: 0 }}>
        <p style={{ color: '#5d6d7e', fontSize: 12, marginBottom: 8 }}>Demo interactiva para Atope · Datos simulados</p>
        <a href="https://wa.me/528112741000?text=Hola%20Daniel%2C%20probé%20el%20demo%20del%20bot%20de%20Atope%20y%20quiero%20activarlo" target="_blank" rel="noopener"
          style={{ display: 'inline-block', background: '#10b981', color: '#fff', padding: '10px 24px', borderRadius: 20, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          Activar Fullsite en Atope →
        </a>
      </div>
    </div>
  )
}
