'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, Star, MessageCircle, Clock, TrendingUp, CheckCircle2, AlertCircle, Eye } from 'lucide-react'
import { getGoogleReviews } from '@/lib/data'
import Link from 'next/link'

interface GoogleReview {
  id: string
  reviewer_name: string
  star_rating: number
  comment: string | null
  create_time: string
  status: string
  ai_draft: string | null
  review_reply_text: string | null
  review_reply_at: string | null
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pendiente', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ai_drafted: { label: 'Draft IA', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  awaiting_approval: { label: 'En revisión', color: 'text-violet-400', bg: 'bg-violet-500/10' },
  auto_approved: { label: 'Auto-aprobada', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  replied: { label: 'Respondida', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  flagged: { label: 'Flagged', color: 'text-red-400', bg: 'bg-red-500/10' },
  ignored: { label: 'Ignorada', color: 'text-[var(--text-3)]', bg: 'bg-[var(--surface-2)]' },
  error: { label: 'Error', color: 'text-red-400', bg: 'bg-red-500/10' },
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={14} className={i <= rating ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-4)]'} />
      ))}
    </div>
  )
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

export default function ResenasPage() {
  const [reviews, setReviews] = useState<GoogleReview[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await getGoogleReviews()
      setReviews(data as unknown as GoogleReview[])
    } catch (err) {
      console.error('Error loading reviews:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  // KPIs
  const total = reviews.length
  const avgRating = total > 0 ? reviews.reduce((s, r) => s + r.star_rating, 0) / total : 0
  const replied = reviews.filter(r => r.status === 'replied' || r.status === 'auto_approved').length
  const responseRate = total > 0 ? (replied / total) * 100 : 0
  const repliedWithTime = reviews.filter(r => r.review_reply_at && r.create_time)
  const avgResponseMs = repliedWithTime.length > 0
    ? repliedWithTime.reduce((s, r) => s + (new Date(r.review_reply_at!).getTime() - new Date(r.create_time).getTime()), 0) / repliedWithTime.length
    : 0
  const avgResponseHours = Math.round(avgResponseMs / 3600000)

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Reseñas Google</h2>
            <p className="text-sm text-[var(--text-3)]">Auto-responder con IA · Google Business Profile</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Star size={14} className="text-amber-400" />
            <span className="text-xs text-[var(--text-3)] font-medium">Rating promedio</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{avgRating.toFixed(1)} <span className="text-sm font-normal text-[var(--text-3)]">/ 5</span></p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <span className="text-xs text-[var(--text-3)] font-medium">Tasa de respuesta</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{responseRate.toFixed(0)}%</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-blue-400" />
            <span className="text-xs text-[var(--text-3)] font-medium">Tiempo de respuesta</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{avgResponseHours > 0 ? `${avgResponseHours}h` : '—'}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle size={14} className="text-violet-400" />
            <span className="text-xs text-[var(--text-3)] font-medium">Total reseñas</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{total}</p>
        </div>
      </div>

      {/* Empty state */}
      {reviews.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Star size={24} className="text-amber-500" />
          </div>
          <h3 className="text-base font-bold text-[var(--text-1)] mb-2">Sin reseñas sincronizadas</h3>
          <p className="text-sm text-[var(--text-3)] max-w-md mx-auto mb-4">El agente de reseñas sincroniza automáticamente desde Google Business Profile cada 2 horas. Las reseñas de 4-5 estrellas se responden automáticamente; las de 1-3 requieren aprobación por Telegram.</p>
          <div className="flex items-center justify-center gap-4 text-xs text-[var(--text-3)]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>4-5★ auto-respuesta</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span>1-3★ aprobación manual</span>
          </div>
        </div>
      )}

      {/* Reviews list */}
      {reviews.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--line-soft)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Reseñas recientes</h3>
            <span className="text-xs text-[var(--text-3)]">{total} total</span>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">
            {reviews.slice(0, 30).map(review => {
              const status = STATUS_MAP[review.status] || STATUS_MAP.pending
              const isExpanded = expanded === review.id
              return (
                <div key={review.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-[var(--text-1)]">{review.reviewer_name}</span>
                        <StarRating rating={review.star_rating} />
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status.color} ${status.bg}`}>{status.label}</span>
                      </div>
                      {review.comment && (
                        <p className="text-sm text-[var(--text-2)] line-clamp-2">{review.comment}</p>
                      )}
                      {!review.comment && (
                        <p className="text-xs text-[var(--text-3)] italic">Sin comentario — solo calificación</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] text-[var(--text-3)]">{timeAgo(review.create_time)}</span>
                      {(review.ai_draft || review.review_reply_text) && (
                        <button
                          onClick={() => setExpanded(isExpanded ? null : review.id)}
                          className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 space-y-2">
                      {review.review_reply_text && (
                        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3">
                          <p className="text-[11px] font-medium text-emerald-400 mb-1">Respuesta publicada</p>
                          <p className="text-sm text-[var(--text-2)]">{review.review_reply_text}</p>
                        </div>
                      )}
                      {review.ai_draft && !review.review_reply_text && (
                        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3">
                          <p className="text-[11px] font-medium text-blue-400 mb-1">Draft IA (pendiente)</p>
                          <p className="text-sm text-[var(--text-2)]">{review.ai_draft}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
