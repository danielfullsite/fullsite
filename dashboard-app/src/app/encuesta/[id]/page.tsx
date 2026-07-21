'use client'

import { useState, useEffect } from 'react'
import { Star, Send, CheckCircle2, Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'

// ─── Types ───────────────────────────────────────────────────────────
type QuestionType = 'stars' | 'yesno' | 'text' | 'nps'

interface SurveyQuestion {
  id: string
  text: string
  type: QuestionType
  active: boolean
  order: number
}

interface SurveyConfig {
  name: string
  welcome_text: string
  thank_you_text: string
  questions: SurveyQuestion[]
}

// ─── Default config (fallback) ───────────────────────────────────────
const DEFAULT_CONFIG: SurveyConfig = {
  name: 'Encuesta de Satisfaccion',
  welcome_text: 'Nos encantaria conocer tu opinion sobre tu experiencia.',
  thank_you_text: 'Gracias por tu tiempo. Tu opinion nos ayuda a mejorar.',
  questions: [
    { id: 'q1', text: 'Como calificarias la calidad de la comida?', type: 'stars', active: true, order: 0 },
    { id: 'q2', text: 'Como calificarias el servicio?', type: 'stars', active: true, order: 1 },
    { id: 'q3', text: 'Como calificarias el ambiente?', type: 'stars', active: true, order: 2 },
    { id: 'q4', text: 'Que tan probable es que nos recomiendes?', type: 'nps', active: true, order: 3 },
    { id: 'q5', text: 'Regresarias a visitarnos?', type: 'yesno', active: true, order: 4 },
    { id: 'q6', text: 'Comentarios adicionales', type: 'text', active: true, order: 5 },
  ],
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ═════════════════════════════════════════════════════════════════════
export default function PublicSurveyPage() {
  const params = useParams()
  const clientId = (params?.id as string) || ''

  const [config, setConfig] = useState<SurveyConfig | null>(null)
  const [answers, setAnswers] = useState<Record<string, number | string | boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  // ─── Load survey config from Supabase ────────────────────────────
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.${clientId}&data_key=eq.survey_config&order=fecha.desc&limit=1&select=data`,
          {
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
          }
        )
        if (res.ok) {
          const rows = await res.json()
          if (rows.length > 0 && rows[0].data) {
            setConfig(rows[0].data)
            setLoading(false)
            return
          }
        }
      } catch {}
      // Fallback: try localStorage (for dev/demo)
      try {
        const raw = localStorage.getItem('survey_config')
        if (raw) {
          setConfig(JSON.parse(raw))
          setLoading(false)
          return
        }
      } catch {}
      setConfig(DEFAULT_CONFIG)
      setLoading(false)
    }
    loadConfig()
  }, [clientId])

  // ─── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!config) return
    setSubmitting(true)

    const now = new Date()
    const dataKey = `survey_response_${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 8).replace(/:/g, '-')}`
    const payload = {
      survey_id: clientId,
      timestamp: now.toISOString(),
      answers,
      user_agent: navigator.userAgent,
    }

    // Save to Supabase
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/wansoft_data`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          client_id: clientId,
          data_key: dataKey,
          fecha: now.toISOString().slice(0, 10),
          data: payload,
        }),
      })
    } catch {}

    // Also save to localStorage for the admin to see
    try {
      const existing = JSON.parse(localStorage.getItem('survey_responses') || '[]')
      existing.unshift({ id: dataKey, ...payload })
      localStorage.setItem('survey_responses', JSON.stringify(existing.slice(0, 500)))
    } catch {}

    setSubmitting(false)
    setSubmitted(true)
  }

  const activeQuestions = config?.questions.filter(q => q.active).sort((a, b) => a.order - b.order) || []
  const requiredAnswered = activeQuestions.filter(q => q.type !== 'text').every(q => answers[q.id] !== undefined)

  // ─── Loading ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin">
          <Loader2 size={32} className="text-blue-500" />
        </div>
      </div>
    )
  }

  // ─── Thank you ───────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} className="text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-800 mb-3">Gracias</h1>
          <p className="text-neutral-500 text-sm leading-relaxed">
            {config?.thank_you_text || DEFAULT_CONFIG.thank_you_text}
          </p>
        </div>
      </div>
    )
  }

  // ─── Survey form ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-8 text-center">
        <h1 className="text-xl font-bold text-white mb-2">
          {config?.name || DEFAULT_CONFIG.name}
        </h1>
        <p className="text-blue-100 text-sm leading-relaxed max-w-md mx-auto">
          {config?.welcome_text || DEFAULT_CONFIG.welcome_text}
        </p>
      </div>

      {/* Questions */}
      <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
        {activeQuestions.map((q, idx) => (
          <div key={q.id} className="space-y-3">
            <p className="text-sm font-semibold text-neutral-800 leading-snug">
              <span className="text-blue-500 mr-1.5">{idx + 1}.</span>
              {q.text}
            </p>

            {/* Stars */}
            {q.type === 'stars' && (
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <button
                    key={s}
                    onClick={() => setAnswers(a => ({ ...a, [q.id]: s }))}
                    className="p-1.5 rounded-lg transition-all active:scale-90"
                  >
                    <Star
                      size={32}
                      className={`transition-colors ${
                        typeof answers[q.id] === 'number' && s <= (answers[q.id] as number)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-neutral-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
            )}

            {/* NPS 0-10 */}
            {q.type === 'nps' && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 11 }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setAnswers(a => ({ ...a, [q.id]: i }))}
                      className={`w-10 h-10 rounded-xl text-sm font-bold transition-all active:scale-90 ${
                        answers[q.id] === i
                          ? i <= 6 ? 'bg-red-500 text-white shadow-md'
                            : i <= 8 ? 'bg-amber-500 text-white shadow-md'
                            : 'bg-emerald-500 text-white shadow-md'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-neutral-400 px-1">
                  <span>Nada probable</span>
                  <span>Muy probable</span>
                </div>
              </div>
            )}

            {/* Yes / No */}
            {q.type === 'yesno' && (
              <div className="flex gap-3">
                {[
                  { val: true, label: 'Si', bg: 'bg-emerald-500', ring: 'ring-emerald-200' },
                  { val: false, label: 'No', bg: 'bg-red-500', ring: 'ring-red-200' },
                ].map(opt => (
                  <button
                    key={String(opt.val)}
                    onClick={() => setAnswers(a => ({ ...a, [q.id]: opt.val }))}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                      answers[q.id] === opt.val
                        ? `${opt.bg} text-white shadow-md ring-4 ${opt.ring}`
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Text */}
            {q.type === 'text' && (
              <textarea
                value={(answers[q.id] as string) || ''}
                onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                placeholder="Escribe tu respuesta..."
                rows={3}
                className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none transition-all"
              />
            )}

            {/* Divider */}
            {idx < activeQuestions.length - 1 && (
              <div className="border-b border-neutral-100" />
            )}
          </div>
        ))}

        {/* Submit */}
        <div className="pt-4 pb-10">
          <button
            onClick={handleSubmit}
            disabled={!requiredAnswered || submitting}
            className={`w-full py-4 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              requiredAnswered && !submitting
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-500 active:scale-[0.98]'
                : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send size={18} />
                Enviar encuesta
              </>
            )}
          </button>
          {!requiredAnswered && (
            <p className="text-[11px] text-neutral-400 text-center mt-2">
              Responde todas las preguntas para enviar
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 border-t border-neutral-100">
        <p className="text-[10px] text-neutral-300">
          Powered by Fullsite
        </p>
      </div>
    </div>
  )
}
