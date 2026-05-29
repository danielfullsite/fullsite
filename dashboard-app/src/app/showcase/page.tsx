'use client'

import { useEffect, useState, useRef } from 'react'

// Auto-scrolling product showcase — record as Reel/TikTok
// Rondesignlab style: dark, minimal, premium typography, green accent

const SCENES = [
  { type: 'hero', text: 'fullsite.', sub: '30 agentes de IA\npara tu restaurante', delay: 3000 },
  { type: 'kpi', label: 'VENTAS HOY', value: '$94,500', sub: 'Prediccion de cierre · 87% confianza', delay: 2500 },
  { type: 'kpi', label: 'TICKET PROMEDIO', value: '$797', sub: '+8.2% vs semana pasada', delay: 2000 },
  { type: 'kpi', label: 'PROPINAS', value: '$10,275', sub: '15% sobre ventas', delay: 2000 },
  { type: 'agent', name: 'Auto-86', icon: '🔴', finding: 'Jamon iberico: 3 dias de stock. Pedir 15kg.', delay: 3000 },
  { type: 'agent', name: 'Anti-Fraude', icon: '🛡️', finding: '0 alertas. Todo limpio.', delay: 2500 },
  { type: 'agent', name: 'Upselling', icon: '📈', finding: '62% de paellas sin vino. Potencial: +$890/mesa', delay: 3000 },
  { type: 'agent', name: 'Menu Engineering', icon: '🍽️', finding: 'Coquinas: food cost 58%. Subir precio.', delay: 3000 },
  { type: 'foodcost', items: [
    { name: 'Patatas Bravas', margin: 85, color: '#10b981' },
    { name: 'Paella Valenciana', margin: 75, color: '#10b981' },
    { name: 'Cochinillo', margin: 70, color: '#10b981' },
    { name: 'Solomillo + Foie', margin: 60, color: '#f59e0b' },
    { name: 'Coquinas', margin: 42, color: '#ef4444' },
  ], delay: 4000 },
  { type: 'roi', value: '13.7x', sub: '$68,400/mes de valor generado\n$4,999/mes de costo', delay: 3000 },
  { type: 'cta', text: '$4,999/mes\nTodo incluido.', sub: 'fullsite.mx', delay: 4000 },
]

export default function ShowcasePage() {
  const [scene, setScene] = useState(-1)
  const [visible, setVisible] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    let idx = 0
    const show = () => {
      setVisible(false)
      setTimeout(() => {
        setScene(idx)
        setVisible(true)
        if (idx < SCENES.length - 1) {
          setTimeout(() => { idx++; show() }, SCENES[idx].delay)
        }
      }, 400)
    }
    setTimeout(show, 500)
  }, [])

  const s = scene >= 0 ? SCENES[scene] : null

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0a0a0f', display: 'flex',
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        opacity: visible ? 1 : 0, transform: visible ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
        transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        textAlign: 'center', padding: 40, maxWidth: 500, width: '100%',
      }}>
        {s?.type === 'hero' && (
          <>
            <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: -3, color: '#fff', lineHeight: 1 }}>
              {s.text}<span style={{ color: '#10b981' }}>&#9632;</span>
            </div>
            <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)', marginTop: 24, whiteSpace: 'pre-line', lineHeight: 1.4 }}>{s.sub}</div>
          </>
        )}

        {s?.type === 'kpi' && (
          <>
            <div style={{ fontSize: 13, letterSpacing: 3, color: '#10b981', fontWeight: 600, marginBottom: 16 }}>{s.label}</div>
            <div style={{ fontSize: 72, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', marginTop: 16 }}>{s.sub}</div>
          </>
        )}

        {s?.type === 'agent' && (
          <div style={{ background: '#111118', borderRadius: 16, padding: 32, border: '1px solid rgba(255,255,255,0.08)', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 12px #10b981' }} />
              <span style={{ fontSize: 12, letterSpacing: 2, color: '#10b981', fontWeight: 600 }}>AGENTE ACTIVO</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 12 }}>{s.icon} {s.name}</div>
            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{s.finding}</div>
          </div>
        )}

        {s?.type === 'foodcost' && (
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, letterSpacing: 3, color: '#10b981', fontWeight: 600, marginBottom: 20 }}>FOOD COST</div>
            {(s as typeof SCENES[8] & { items: Array<{ name: string; margin: number; color: string }> }).items.map((item, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15 }}>{item.name}</span>
                  <span style={{ color: item.color, fontWeight: 700, fontSize: 15 }}>{item.margin}%</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    background: item.color, height: '100%', borderRadius: 4,
                    width: visible ? `${item.margin}%` : '0%',
                    transition: `width 1s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.15}s`,
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {s?.type === 'roi' && (
          <>
            <div style={{ fontSize: 13, letterSpacing: 3, color: '#f59e0b', fontWeight: 600, marginBottom: 16 }}>RETORNO DE INVERSION</div>
            <div style={{ fontSize: 96, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', marginTop: 20, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{s.sub}</div>
          </>
        )}

        {s?.type === 'cta' && (
          <>
            <div style={{ fontSize: 40, fontWeight: 900, color: '#fff', lineHeight: 1.2, whiteSpace: 'pre-line' }}>{s.text}</div>
            <div style={{
              marginTop: 32, display: 'inline-block', padding: '14px 40px',
              background: '#10b981', borderRadius: 12, fontSize: 18, fontWeight: 700, color: '#fff',
            }}>
              {s.sub}
            </div>
            <div style={{ marginTop: 20, fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>
              30 agentes de IA · POS completo · Todo incluido
            </div>
          </>
        )}
      </div>

      {/* Progress dots */}
      <div style={{ position: 'fixed', bottom: 40, display: 'flex', gap: 6, justifyContent: 'center', width: '100%' }}>
        {SCENES.map((_, i) => (
          <div key={i} style={{
            width: i === scene ? 24 : 6, height: 6, borderRadius: 3,
            background: i === scene ? '#10b981' : i < scene ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)',
            transition: 'all 0.3s ease',
          }} />
        ))}
      </div>
    </div>
  )
}
