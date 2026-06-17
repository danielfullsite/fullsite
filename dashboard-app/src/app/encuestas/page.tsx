'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ClipboardList, Star, MessageSquare, BarChart3, Plus, Trash2,
  ChevronUp, ChevronDown, Eye, EyeOff, QrCode, Download, Copy,
  Smartphone, ArrowRight, Hash, ThumbsUp, Type, X, Check,
  TrendingUp, Users, Percent, FileDown, Calendar, Clock,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getActiveClientSlug } from '@/lib/data'
import { sbGet, sbPost } from '@/lib/supabase-helpers'

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

interface SurveyResponse {
  id: string
  survey_id: string
  timestamp: string
  answers: Record<string, number | string | boolean>
  comment?: string
}

type Tab = 'config' | 'results'

// ─── Storage ─────────────────────────────────────────────────────────
const STORAGE_KEY_CONFIG = 'survey_config'
const STORAGE_KEY_RESPONSES = 'survey_responses'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function save<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify(data))
}

function uuid(): string {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const TYPE_LABELS: Record<QuestionType, string> = {
  stars: '1-5 Estrellas',
  yesno: 'Si / No',
  text: 'Texto libre',
  nps: 'NPS (0-10)',
}

const TYPE_ICONS: Record<QuestionType, typeof Star> = {
  stars: Star,
  yesno: ThumbsUp,
  text: Type,
  nps: Hash,
}

const DEFAULT_CONFIG: SurveyConfig = {
  name: 'Encuesta de Satisfaccion',
  welcome_text: 'Nos encantaria conocer tu opinion sobre tu experiencia.',
  thank_you_text: 'Gracias por tu tiempo. Tu opinion nos ayuda a mejorar.',
  questions: [
    { id: uuid(), text: 'Como calificarias la calidad de la comida?', type: 'stars', active: true, order: 0 },
    { id: uuid(), text: 'Como calificarias el servicio?', type: 'stars', active: true, order: 1 },
    { id: uuid(), text: 'Como calificarias el ambiente?', type: 'stars', active: true, order: 2 },
    { id: uuid(), text: 'Que tan probable es que nos recomiendes? (0-10)', type: 'nps', active: true, order: 3 },
    { id: uuid(), text: 'Regresarias a visitarnos?', type: 'yesno', active: true, order: 4 },
    { id: uuid(), text: 'Comentarios adicionales', type: 'text', active: true, order: 5 },
  ],
}

// ─── Demo responses generator ────────────────────────────────────────
function generateDemoResponses(questions: SurveyQuestion[]): SurveyResponse[] {
  const responses: SurveyResponse[] = []
  const now = Date.now()
  const comments = [
    'Excelente servicio, muy atentos',
    'La comida estuvo increible, volvere pronto',
    'El mesero fue muy amable',
    'Un poco lenta la atencion pero buena comida',
    'Todo perfecto, los chilaquiles son los mejores',
    'Buen ambiente, musica agradable',
    'Las porciones podrian ser un poco mas grandes',
    'Muy rico todo, felicidades al chef',
    '',
    'Me encanto el lugar, super recomendado',
    '',
    'Los precios son justos para la calidad',
    'El postre estuvo delicioso',
    '',
    'Faltaba variedad en bebidas',
  ]

  for (let i = 0; i < 47; i++) {
    const answers: Record<string, number | string | boolean> = {}
    questions.forEach(q => {
      if (!q.active) return
      switch (q.type) {
        case 'stars': answers[q.id] = Math.random() > 0.15 ? Math.floor(Math.random() * 2) + 4 : Math.floor(Math.random() * 3) + 1; break
        case 'yesno': answers[q.id] = Math.random() > 0.12; break
        case 'nps': answers[q.id] = Math.floor(Math.random() * 4) + 7; break
        case 'text': answers[q.id] = comments[Math.floor(Math.random() * comments.length)]; break
      }
    })
    responses.push({
      id: uuid(),
      survey_id: 'default',
      timestamp: new Date(now - i * 3600000 * (2 + Math.random() * 10)).toISOString(),
      answers,
      comment: comments[Math.floor(Math.random() * comments.length)],
    })
  }
  return responses.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

// ═════════════════════════════════════════════════════════════════════
export default function EncuestasPage() {
  const [tab, setTab] = useState<Tab>('config')
  const [config, setConfig] = useState<SurveyConfig>(DEFAULT_CONFIG)
  const [responses, setResponses] = useState<SurveyResponse[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null)
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>('stars')
  const [showAddForm, setShowAddForm] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const clientId = typeof window !== 'undefined' ? getActiveClientSlug() : 'amalay'
  const surveyUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/encuesta/${clientId}`
    : `https://app.fullsite.mx/encuesta/${clientId}`

  // ─── Load ────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = load<SurveyConfig | null>(STORAGE_KEY_CONFIG, null)
    if (stored) setConfig(stored)

    const storedResponses = load<SurveyResponse[]>(STORAGE_KEY_RESPONSES, [])
    if (storedResponses.length > 0) {
      setResponses(storedResponses)
    }

    // Also try to load from Supabase
    sbGet<Array<{ data: SurveyConfig }>>('wansoft_data', clientId, {
      data_key: 'eq.survey_config',
      order: 'fecha.desc',
      limit: '1',
      select: 'data',
    }).then(rows => {
      if (rows.length > 0 && rows[0].data) {
        setConfig(rows[0].data)
        save(STORAGE_KEY_CONFIG, rows[0].data)
      }
    }).catch(() => {})
  }, [clientId])

  // ─── Save ────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    save(STORAGE_KEY_CONFIG, config)
    const today = new Date().toISOString().slice(0, 10)
    await sbPost('wansoft_data', clientId, {
      data_key: 'survey_config',
      fecha: today,
      data: config,
    }, { upsert: true }).catch(() => {})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [config, clientId])

  // ─── Question CRUD ───────────────────────────────────────────────
  const addQuestion = () => {
    if (!newQuestionText.trim()) return
    const q: SurveyQuestion = {
      id: uuid(),
      text: newQuestionText.trim(),
      type: newQuestionType,
      active: true,
      order: config.questions.length,
    }
    setConfig(c => ({ ...c, questions: [...c.questions, q] }))
    setNewQuestionText('')
    setShowAddForm(false)
  }

  const removeQuestion = (id: string) => {
    setConfig(c => ({
      ...c,
      questions: c.questions.filter(q => q.id !== id).map((q, i) => ({ ...q, order: i })),
    }))
  }

  const moveQuestion = (id: string, dir: -1 | 1) => {
    setConfig(c => {
      const qs = [...c.questions]
      const idx = qs.findIndex(q => q.id === id)
      if (idx < 0) return c
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= qs.length) return c
      ;[qs[idx], qs[newIdx]] = [qs[newIdx], qs[idx]]
      return { ...c, questions: qs.map((q, i) => ({ ...q, order: i })) }
    })
  }

  const toggleQuestion = (id: string) => {
    setConfig(c => ({
      ...c,
      questions: c.questions.map(q => q.id === id ? { ...q, active: !q.active } : q),
    }))
  }

  const updateQuestionText = (id: string, text: string) => {
    setConfig(c => ({
      ...c,
      questions: c.questions.map(q => q.id === id ? { ...q, text } : q),
    }))
    setEditingQuestion(null)
  }

  // ─── Results calculations ────────────────────────────────────────
  const activeQuestions = config.questions.filter(q => q.active)

  const calcStats = useCallback(() => {
    if (responses.length === 0) return { total: 0, avg: 0, nps: 0, rate: 0 }
    const total = responses.length

    // Average of star questions
    const starQs = activeQuestions.filter(q => q.type === 'stars')
    let starSum = 0, starCount = 0
    responses.forEach(r => {
      starQs.forEach(q => {
        const v = r.answers[q.id]
        if (typeof v === 'number') { starSum += v; starCount++ }
      })
    })
    const avg = starCount > 0 ? starSum / starCount : 0

    // NPS
    const npsQ = activeQuestions.find(q => q.type === 'nps')
    let nps = 0
    if (npsQ) {
      let promoters = 0, detractors = 0, npsTotal = 0
      responses.forEach(r => {
        const v = r.answers[npsQ.id]
        if (typeof v === 'number') {
          npsTotal++
          if (v >= 9) promoters++
          else if (v <= 6) detractors++
        }
      })
      nps = npsTotal > 0 ? Math.round(((promoters - detractors) / npsTotal) * 100) : 0
    }

    // Response rate (simulated: assume 3x more customers than responses)
    const rate = Math.min(100, Math.round((total / (total * 3)) * 100))

    return { total, avg, nps, rate }
  }, [responses, activeQuestions])

  const stats = calcStats()

  const questionStats = useCallback((qId: string, qType: QuestionType) => {
    const vals: (number | boolean | string)[] = responses.map(r => r.answers[qId]).filter(v => v !== undefined)
    if (vals.length === 0) return null

    if (qType === 'stars') {
      const nums = vals.filter((v): v is number => typeof v === 'number')
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length
      const dist = [0, 0, 0, 0, 0]
      nums.forEach(n => { if (n >= 1 && n <= 5) dist[n - 1]++ })
      return { avg, dist, count: nums.length }
    }
    if (qType === 'nps') {
      const nums = vals.filter((v): v is number => typeof v === 'number')
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length
      const dist = Array(11).fill(0) as number[]
      nums.forEach(n => { if (n >= 0 && n <= 10) dist[n]++ })
      return { avg, dist, count: nums.length }
    }
    if (qType === 'yesno') {
      const bools = vals.filter((v): v is boolean => typeof v === 'boolean')
      const yes = bools.filter(b => b).length
      return { yes, no: bools.length - yes, count: bools.length }
    }
    if (qType === 'text') {
      const texts = vals.filter((v): v is string => typeof v === 'string' && v.length > 0)
      return { texts: texts.slice(0, 10), count: texts.length }
    }
    return null
  }, [responses])

  // ─── Export ──────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Fecha', ...activeQuestions.map(q => q.text), 'Comentario']
    const rows = responses.map(r => [
      new Date(r.timestamp).toLocaleString('es-MX'),
      ...activeQuestions.map(q => {
        const v = r.answers[q.id]
        if (v === true) return 'Si'
        if (v === false) return 'No'
        return String(v ?? '')
      }),
      r.comment || '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `encuestas_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyUrl = () => {
    navigator.clipboard.writeText(surveyUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--bg-root)] p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Encuestas"
        subtitle="Satisfaccion del cliente"
        action={
          <button
            onClick={handleSave}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {saved ? 'Guardado' : 'Guardar cambios'}
          </button>
        }
      />

      {/* ─── Tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 bg-[var(--surface-1)] p-1 rounded-xl w-fit">
        {([['config', 'Configuracion', ClipboardList], ['results', 'Resultados', BarChart3]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === key
                ? 'bg-[var(--surface-3)] text-[var(--text-1)] shadow-sm'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* ═══ CONFIG TAB ══════════════════════════════════════════ */}
      {tab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left: Questions ─────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Survey settings */}
            <div className="rounded-2xl border border-[var(--accent-line)] p-5"
              style={{ background: 'var(--bento-card)' }}>
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-4">Configuracion general</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1 block">Nombre de la encuesta</label>
                  <input
                    value={config.name}
                    onChange={e => setConfig(c => ({ ...c, name: e.target.value }))}
                    className="w-full bg-[var(--surface-1)] border border-[var(--accent-line)] rounded-lg px-3 py-2 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1 block">Mensaje de bienvenida</label>
                  <textarea
                    value={config.welcome_text}
                    onChange={e => setConfig(c => ({ ...c, welcome_text: e.target.value }))}
                    rows={2}
                    className="w-full bg-[var(--surface-1)] border border-[var(--accent-line)] rounded-lg px-3 py-2 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1 block">Mensaje de agradecimiento</label>
                  <textarea
                    value={config.thank_you_text}
                    onChange={e => setConfig(c => ({ ...c, thank_you_text: e.target.value }))}
                    rows={2}
                    className="w-full bg-[var(--surface-1)] border border-[var(--accent-line)] rounded-lg px-3 py-2 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Questions list */}
            <div className="rounded-2xl border border-[var(--accent-line)] p-5"
              style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-[var(--text-1)]">
                  Preguntas ({config.questions.length})
                </h3>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                >
                  {showAddForm ? <X size={14} /> : <Plus size={14} />}
                  {showAddForm ? 'Cancelar' : 'Agregar'}
                </button>
              </div>

              {/* Add question form */}
              {showAddForm && (
                <div className="mb-4 p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--accent-line)] space-y-3">
                  <input
                    value={newQuestionText}
                    onChange={e => setNewQuestionText(e.target.value)}
                    placeholder="Escribe la pregunta..."
                    className="w-full bg-[var(--surface-2)] border border-[var(--accent-line)] rounded-lg px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500"
                    onKeyDown={e => e.key === 'Enter' && addQuestion()}
                  />
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(TYPE_LABELS) as QuestionType[]).map(t => {
                      const Icon = TYPE_ICONS[t]
                      return (
                        <button
                          key={t}
                          onClick={() => setNewQuestionType(t)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            newQuestionType === t
                              ? 'bg-blue-600 text-white'
                              : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)]'
                          }`}
                        >
                          <Icon size={13} />
                          {TYPE_LABELS[t]}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={addQuestion}
                    disabled={!newQuestionText.trim()}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
                  >
                    Agregar pregunta
                  </button>
                </div>
              )}

              {/* Questions */}
              <div className="space-y-2">
                {config.questions.map((q, idx) => {
                  const Icon = TYPE_ICONS[q.type]
                  return (
                    <div
                      key={q.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        q.active
                          ? 'border-[var(--accent-line)] bg-[var(--surface-1)]'
                          : 'border-[var(--accent-line)] bg-[var(--surface-1)] opacity-50'
                      }`}
                    >
                      {/* Order arrows */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => moveQuestion(q.id, -1)}
                          disabled={idx === 0}
                          className="p-0.5 rounded hover:bg-[var(--surface-3)] text-[var(--text-4)] hover:text-[var(--text-2)] disabled:opacity-30 transition-colors"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveQuestion(q.id, 1)}
                          disabled={idx === config.questions.length - 1}
                          className="p-0.5 rounded hover:bg-[var(--surface-3)] text-[var(--text-4)] hover:text-[var(--text-2)] disabled:opacity-30 transition-colors"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      {/* Icon + type */}
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center shrink-0">
                        <Icon size={14} className="text-[var(--text-3)]" />
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        {editingQuestion === q.id ? (
                          <input
                            autoFocus
                            defaultValue={q.text}
                            onBlur={e => updateQuestionText(q.id, e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && updateQuestionText(q.id, (e.target as HTMLInputElement).value)}
                            className="w-full bg-[var(--surface-2)] border border-blue-500 rounded-lg px-2 py-1 text-sm text-[var(--text-1)] focus:outline-none"
                          />
                        ) : (
                          <p
                            className="text-sm text-[var(--text-1)] cursor-pointer hover:text-blue-400 transition-colors truncate"
                            onClick={() => setEditingQuestion(q.id)}
                          >
                            {q.text}
                          </p>
                        )}
                        <p className="text-[10px] text-[var(--text-4)] mt-0.5">{TYPE_LABELS[q.type]}</p>
                      </div>

                      {/* Toggle + delete */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => toggleQuestion(q.id)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            q.active ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-[var(--text-4)] hover:bg-[var(--surface-3)]'
                          }`}
                          title={q.active ? 'Desactivar' : 'Activar'}
                        >
                          {q.active ? <Eye size={15} /> : <EyeOff size={15} />}
                        </button>
                        <button
                          onClick={() => removeQuestion(q.id)}
                          className="p-1.5 rounded-lg text-[var(--text-4)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Right: QR + Preview ────────────────────────────── */}
          <div className="space-y-4">
            {/* QR Code */}
            <div className="rounded-2xl border border-[var(--accent-line)] p-5"
              style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center gap-2 mb-4">
                <QrCode size={16} className="text-blue-400" />
                <h3 className="text-sm font-bold text-[var(--text-1)]">Codigo QR</h3>
              </div>
              <p className="text-xs text-[var(--text-3)] mb-3">
                Imprime este QR en los tickets para que los clientes accedan a la encuesta.
              </p>

              {/* QR placeholder using API */}
              <div className="flex justify-center mb-3">
                <div className="w-48 h-48 bg-white rounded-xl p-2 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(surveyUrl)}`}
                    alt="QR Code"
                    className="w-full h-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-1)] border border-[var(--accent-line)]">
                  <p className="text-[11px] text-[var(--text-3)] truncate flex-1 font-mono">{surveyUrl}</p>
                  <button
                    onClick={copyUrl}
                    className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-3)] transition-colors shrink-0"
                    title="Copiar URL"
                  >
                    {copiedUrl ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
                <a
                  href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&format=png&data=${encodeURIComponent(surveyUrl)}`}
                  download="encuesta-qr.png"
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-[var(--surface-1)] border border-[var(--accent-line)] text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  <Download size={14} />
                  Descargar QR (PNG)
                </a>
              </div>
            </div>

            {/* Mobile Preview */}
            <div className="rounded-2xl border border-[var(--accent-line)] p-5"
              style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Smartphone size={16} className="text-purple-400" />
                <h3 className="text-sm font-bold text-[var(--text-1)]">Vista previa movil</h3>
              </div>

              {/* Phone mockup */}
              <div className="mx-auto w-[220px] rounded-[24px] border-2 border-neutral-600 bg-white overflow-hidden shadow-lg">
                {/* Status bar */}
                <div className="h-6 bg-neutral-100 flex items-center justify-center">
                  <div className="w-12 h-1 bg-neutral-300 rounded-full" />
                </div>
                {/* Content */}
                <div className="p-3 space-y-2.5 max-h-[350px] overflow-y-auto">
                  <p className="text-[10px] font-bold text-neutral-800 text-center">{config.name}</p>
                  <p className="text-[8px] text-neutral-500 text-center leading-tight">{config.welcome_text}</p>
                  {activeQuestions.map((q) => (
                    <div key={q.id} className="space-y-1">
                      <p className="text-[8px] font-semibold text-neutral-700 leading-tight">{q.text}</p>
                      {q.type === 'stars' && (
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star key={s} size={10} className={s <= 4 ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'} />
                          ))}
                        </div>
                      )}
                      {q.type === 'nps' && (
                        <div className="flex gap-[2px] flex-wrap">
                          {Array.from({ length: 11 }, (_, i) => (
                            <div key={i} className={`w-[14px] h-[14px] rounded text-[7px] flex items-center justify-center font-bold ${
                              i === 8 ? 'bg-blue-500 text-white' : 'bg-neutral-100 text-neutral-500'
                            }`}>{i}</div>
                          ))}
                        </div>
                      )}
                      {q.type === 'yesno' && (
                        <div className="flex gap-1">
                          <div className="px-2 py-0.5 rounded bg-emerald-100 text-[7px] font-bold text-emerald-600">Si</div>
                          <div className="px-2 py-0.5 rounded bg-neutral-100 text-[7px] font-bold text-neutral-400">No</div>
                        </div>
                      )}
                      {q.type === 'text' && (
                        <div className="h-5 rounded bg-neutral-100 border border-neutral-200" />
                      )}
                    </div>
                  ))}
                  <div className="pt-1">
                    <div className="w-full h-6 rounded-lg bg-blue-500 flex items-center justify-center">
                      <span className="text-[8px] font-bold text-white">Enviar</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ RESULTS TAB ═════════════════════════════════════════ */}
      {tab === 'results' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="Total respuestas"
              value={String(stats.total)}
              icon={Users}
              accentClass="kpi-accent-blue"
              index={0}
            />
            <KPICard
              label="Promedio general"
              value={`${stats.avg.toFixed(1)} / 5`}
              icon={Star}
              accentClass="kpi-accent-amber"
              index={1}
              delta={stats.avg >= 4 ? 'Excelente' : stats.avg >= 3 ? 'Bueno' : 'Mejorar'}
              deltaType={stats.avg >= 4 ? 'up' : stats.avg >= 3 ? 'neutral' : 'down'}
            />
            <KPICard
              label="NPS Score"
              value={`${stats.nps > 0 ? '+' : ''}${stats.nps}`}
              icon={TrendingUp}
              accentClass="kpi-accent-green"
              index={2}
              delta={stats.nps >= 50 ? 'Excelente' : stats.nps >= 0 ? 'Bueno' : 'Critico'}
              deltaType={stats.nps >= 50 ? 'up' : stats.nps >= 0 ? 'neutral' : 'down'}
            />
            <KPICard
              label="Tasa de respuesta"
              value={`${stats.rate}%`}
              icon={Percent}
              accentClass="kpi-accent-purple"
              index={3}
            />
          </div>

          {/* Per-question breakdown */}
          <div className="rounded-2xl border border-[var(--accent-line)] p-5"
            style={{ background: 'var(--bento-card)' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-[var(--text-1)]">Desglose por pregunta</h3>
              <button
                onClick={exportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-1)] border border-[var(--accent-line)] text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
              >
                <FileDown size={14} />
                Exportar CSV
              </button>
            </div>

            <div className="space-y-4">
              {activeQuestions.map(q => {
                const qStats = questionStats(q.id, q.type)
                if (!qStats) return null
                const Icon = TYPE_ICONS[q.type]

                return (
                  <div key={q.id} className="p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--accent-line)]">
                    <div className="flex items-center gap-2 mb-3">
                      <Icon size={14} className="text-[var(--text-3)]" />
                      <p className="text-sm font-semibold text-[var(--text-1)]">{q.text}</p>
                    </div>

                    {/* Stars distribution */}
                    {q.type === 'stars' && 'dist' in qStats && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-[var(--text-3)]">
                          Promedio: <span className="font-bold text-amber-400">{(qStats as { avg: number }).avg.toFixed(1)}</span> / 5
                          <span className="text-[var(--text-4)] ml-2">({(qStats as { count: number }).count} respuestas)</span>
                        </p>
                        <div className="space-y-1">
                          {[5, 4, 3, 2, 1].map(star => {
                            const count = (qStats as { dist: number[] }).dist[star - 1]
                            const pct = (qStats as { count: number }).count > 0 ? (count / (qStats as { count: number }).count) * 100 : 0
                            return (
                              <div key={star} className="flex items-center gap-2">
                                <span className="text-[10px] text-[var(--text-3)] w-3 text-right">{star}</span>
                                <Star size={10} className="text-amber-400 fill-amber-400" />
                                <div className="flex-1 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-amber-400 rounded-full transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[var(--text-4)] w-8 text-right">{count}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* NPS distribution */}
                    {q.type === 'nps' && 'dist' in qStats && (
                      <div className="space-y-2">
                        <p className="text-xs text-[var(--text-3)]">
                          Promedio: <span className="font-bold text-blue-400">{(qStats as { avg: number }).avg.toFixed(1)}</span> / 10
                          <span className="text-[var(--text-4)] ml-2">({(qStats as { count: number }).count} respuestas)</span>
                        </p>
                        <div className="flex gap-1">
                          {(qStats as { dist: number[] }).dist.map((count, i) => {
                            const max = Math.max(...(qStats as { dist: number[] }).dist, 1)
                            const h = Math.max(4, (count / max) * 40)
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                                <div
                                  className={`w-full rounded-sm transition-all ${
                                    i <= 6 ? 'bg-red-400/60' : i <= 8 ? 'bg-amber-400/60' : 'bg-emerald-400/60'
                                  }`}
                                  style={{ height: `${h}px` }}
                                />
                                <span className="text-[8px] text-[var(--text-4)]">{i}</span>
                              </div>
                            )
                          })}
                        </div>
                        <div className="flex gap-3 text-[9px] text-[var(--text-4)]">
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400/60" />Detractores (0-6)</span>
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400/60" />Pasivos (7-8)</span>
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400/60" />Promotores (9-10)</span>
                        </div>
                      </div>
                    )}

                    {/* Yes/No */}
                    {q.type === 'yesno' && 'yes' in qStats && (
                      <div className="space-y-2">
                        <div className="flex gap-4">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm bg-emerald-400" />
                            <span className="text-xs text-[var(--text-2)]">
                              Si: <span className="font-bold">{(qStats as { yes: number }).yes}</span>
                              <span className="text-[var(--text-4)] ml-1">
                                ({((qStats as { yes: number; count: number }).yes / (qStats as { count: number }).count * 100).toFixed(0)}%)
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm bg-red-400" />
                            <span className="text-xs text-[var(--text-2)]">
                              No: <span className="font-bold">{(qStats as { no: number }).no}</span>
                              <span className="text-[var(--text-4)] ml-1">
                                ({((qStats as { no: number; count: number }).no / (qStats as { count: number }).count * 100).toFixed(0)}%)
                              </span>
                            </span>
                          </div>
                        </div>
                        <div className="h-3 bg-[var(--surface-2)] rounded-full overflow-hidden flex">
                          <div
                            className="h-full bg-emerald-400 transition-all"
                            style={{ width: `${(qStats as { yes: number; count: number }).yes / (qStats as { count: number }).count * 100}%` }}
                          />
                          <div
                            className="h-full bg-red-400 transition-all"
                            style={{ width: `${(qStats as { no: number; count: number }).no / (qStats as { count: number }).count * 100}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Text responses */}
                    {q.type === 'text' && 'texts' in qStats && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-[var(--text-3)]">{(qStats as { count: number }).count} respuestas con texto</p>
                        {(qStats as { texts: string[] }).texts.map((t, i) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--surface-2)]">
                            <MessageSquare size={12} className="text-[var(--text-4)] mt-0.5 shrink-0" />
                            <p className="text-xs text-[var(--text-2)] leading-relaxed">{t}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recent responses */}
          <div className="rounded-2xl border border-[var(--accent-line)] p-5"
            style={{ background: 'var(--bento-card)' }}>
            <h3 className="text-sm font-bold text-[var(--text-1)] mb-4">Respuestas recientes</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--accent-line)]">
                    <th className="text-left py-2 px-2 text-[var(--text-3)] font-semibold">Fecha</th>
                    {activeQuestions.filter(q => q.type !== 'text').map(q => (
                      <th key={q.id} className="text-center py-2 px-2 text-[var(--text-3)] font-semibold max-w-[100px] truncate">
                        {q.text.length > 20 ? q.text.slice(0, 20) + '...' : q.text}
                      </th>
                    ))}
                    <th className="text-left py-2 px-2 text-[var(--text-3)] font-semibold">Comentario</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.slice(0, 15).map(r => (
                    <tr key={r.id} className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-1)] transition-colors">
                      <td className="py-2 px-2 text-[var(--text-2)] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={11} className="text-[var(--text-4)]" />
                          {new Date(r.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                          <Clock size={11} className="text-[var(--text-4)] ml-1" />
                          {new Date(r.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      {activeQuestions.filter(q => q.type !== 'text').map(q => {
                        const v = r.answers[q.id]
                        return (
                          <td key={q.id} className="py-2 px-2 text-center">
                            {q.type === 'stars' && typeof v === 'number' && (
                              <div className="flex items-center justify-center gap-0.5">
                                {[1, 2, 3, 4, 5].map(s => (
                                  <Star key={s} size={10} className={s <= v ? 'fill-amber-400 text-amber-400' : 'text-[var(--text-4)]'} />
                                ))}
                              </div>
                            )}
                            {q.type === 'nps' && typeof v === 'number' && (
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-[10px] font-bold ${
                                v >= 9 ? 'bg-emerald-500/20 text-emerald-400' :
                                v >= 7 ? 'bg-amber-500/20 text-amber-400' :
                                'bg-red-500/20 text-red-400'
                              }`}>
                                {v}
                              </span>
                            )}
                            {q.type === 'yesno' && typeof v === 'boolean' && (
                              <span className={`text-[10px] font-bold ${v ? 'text-emerald-400' : 'text-red-400'}`}>
                                {v ? 'Si' : 'No'}
                              </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="py-2 px-2 text-[var(--text-3)] max-w-[200px] truncate">
                        {r.comment || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
