'use client'

import { useState } from 'react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export default function EncuestaPage() {
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [q3, setQ3] = useState('')
  const [nombre, setNombre] = useState('')
  const [restaurante, setRestaurante] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [sending, setSending] = useState(false)

  const handleSubmit = async () => {
    if (!q1 || !q3) return
    setSending(true)

    await fetch(`${SUPABASE_URL}/rest/v1/pos_survey`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        q1_como_consigues_dato: q1,
        q2_que_preguntarias: q2 || null,
        q3_cuanto_pagarias: q3,
        nombre: nombre || null,
        restaurante: restaurante || null,
      }),
    })

    setSubmitted(true)
    setSending(false)
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Gracias</h2>
          <p className="text-slate-500">Tu respuesta nos ayuda a construir el POS que los restauranteros realmente necesitan.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-lg mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <span className="text-slate-900 font-black text-xl tracking-tight">
            fullsite
            <span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
          <h1 className="text-3xl font-bold text-slate-900 mt-4">3 preguntas sobre tu punto de venta</h1>
          <p className="text-slate-500 mt-2">Toma 30 segundos</p>
        </div>

        <div className="space-y-8">
          {/* Q1 */}
          <div>
            <label className="text-lg font-semibold text-slate-900 block mb-3">
              1. Cuando necesitas un dato de tu POS (ventas, meseros, inventario), ¿como lo consigues?
            </label>
            <div className="space-y-2">
              {[
                'Lo saco yo en menos de 5 minutos',
                'Me tardo 15-20 minutos navegando reportes',
                'Se lo pido a alguien mas',
                'No se como sacarlo',
              ].map(opt => (
                <label key={opt} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border cursor-pointer transition-colors ${
                  q1 === opt ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-slate-200 hover:border-slate-300'
                }`}>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    q1 === opt ? 'border-emerald-500' : 'border-slate-300'
                  }`}>
                    {q1 === opt && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                  </div>
                  <span className="text-slate-700">{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Q2 */}
          <div>
            <label className="text-lg font-semibold text-slate-900 block mb-2">
              2. Si pudieras preguntarle ALGO a tu POS ahorita mismo, ¿que le preguntarias?
            </label>
            <p className="text-slate-400 text-sm mb-3">Escribe lo primero que se te venga a la mente</p>
            <textarea
              value={q2}
              onChange={e => setQ2(e.target.value)}
              placeholder="Ej: ¿Quien es mi mejor mesero esta semana?"
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Q3 */}
          <div>
            <label className="text-lg font-semibold text-slate-900 block mb-3">
              3. ¿Cuanto pagarias al mes por un POS donde le preguntas lo que quieras y te contesta al instante?
            </label>
            <div className="space-y-2">
              {[
                '$1,000 - $2,000 MXN',
                '$2,000 - $3,000 MXN',
                '$3,000 - $5,000 MXN',
                'Mas de $5,000 MXN',
              ].map(opt => (
                <label key={opt} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border cursor-pointer transition-colors ${
                  q3 === opt ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-slate-200 hover:border-slate-300'
                }`}>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    q3 === opt ? 'border-emerald-500' : 'border-slate-300'
                  }`}>
                    {q3 === opt && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                  </div>
                  <span className="text-slate-700">{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Optional info */}
          <div className="pt-4 border-t border-slate-100">
            <p className="text-sm text-slate-400 mb-4">Opcional</p>
            <div className="grid grid-cols-2 gap-3">
              <input
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Tu nombre"
                className="border border-slate-200 rounded-xl px-4 py-3 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
              />
              <input
                value={restaurante}
                onChange={e => setRestaurante(e.target.value)}
                placeholder="Tu restaurante"
                className="border border-slate-200 rounded-xl px-4 py-3 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!q1 || !q3 || sending}
            className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-lg transition-colors"
          >
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
