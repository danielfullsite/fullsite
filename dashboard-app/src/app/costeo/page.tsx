'use client'

// Costeo — el módulo empaquetado "de la factura al margen".
// Contra-narrativa a MaxIA: ellos lo CUENTAN bonito; nosotros lo mostramos
// CONECTADO Y VIVO con números reales del tenant. Cada paso enlaza a su página
// real. Esqueleton: todo por cliente activo (reusa /api/food-cost y /api/rentabilidad).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Package, BookOpen, Percent, AlertTriangle, ArrowRight, ArrowDown } from 'lucide-react'
import { formatNumber } from '@/lib/format'

type Stat = number | null

export default function CosteoPage() {
  const [recetas, setRecetas] = useState<Stat>(null)
  const [ingredientes, setIngredientes] = useState<Stat>(null)
  const [movidos, setMovidos] = useState<Stat>(null)
  const [afectados, setAfectados] = useState<Stat>(null)
  const [perdieron, setPerdieron] = useState<Stat>(null)

  useEffect(() => {
    fetch('/api/food-cost', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(j => {
      if (!j) return
      const rec = (Array.isArray(j.recipes) ? j.recipes.length : 0) + (Array.isArray(j.posRecipes) ? j.posRecipes.length : 0)
      setRecetas(rec)
      setIngredientes(Array.isArray(j.inventoryProducts) ? j.inventoryProducts.length : 0)
    }).catch(() => {})
    fetch('/api/rentabilidad?days=30', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(j => {
      if (!j) return
      setMovidos(Array.isArray(j.changes) ? j.changes.length : 0)
      const dishes = Array.isArray(j.dishes) ? j.dishes : []
      setAfectados(dishes.length)
      setPerdieron(dishes.filter((d: { marginBefore: number | null; marginNow: number | null }) =>
        d.marginBefore != null && d.marginNow != null && d.marginBefore >= 65 && d.marginNow < 65).length)
    }).catch(() => {})
  }, [])

  const steps = [
    { icon: FileText, title: 'Entra la factura', desc: 'Subes el XML del proveedor o lo capturas. El sistema lo lee.', stat: movidos, statLabel: 'insumos se movieron (30 días)', href: '/pos/facturas-proveedor', cta: 'Ver facturas' },
    { icon: Package, title: 'Se actualiza el costo del insumo', desc: 'El costo promedio ponderado del ingrediente se recalcula solo.', stat: ingredientes, statLabel: 'insumos costeados', href: '/inventario-real', cta: 'Ver insumos' },
    { icon: BookOpen, title: 'Se recalcula la receta', desc: 'Con sub-recetas y merma. El costo del platillo cambia al instante.', stat: recetas, statLabel: 'recetas con costeo', href: '/recetas', cta: 'Ver recetas' },
    { icon: Percent, title: 'Se ajusta el margen', desc: 'Ves el food cost real de cada platillo, actualizado.', stat: afectados, statLabel: 'platillos recalculados', href: '/food-cost', cta: 'Ver food cost' },
    { icon: AlertTriangle, title: 'Te avisa si dejó de ser rentable', desc: 'Con la causa: "tu ceviche bajó a 61% por el camarón +15%".', stat: perdieron, statLabel: 'platillos bajo margen', href: '/rentabilidad', cta: 'Ver rentabilidad', alert: true },
  ]

  return (
    <div className="max-w-[1080px] mx-auto w-full" style={{ color: 'var(--text-1)' }}>
      <div className="mb-1"><h1 className="text-2xl font-extrabold tracking-tight">Costeo</h1></div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>
        De la factura al margen — <b style={{ color: 'var(--text-1)' }}>automático y conectado</b>. Cuando entra una factura,
        el costo de tus insumos se mueve solo y ves al instante qué platillos dejaron de ser rentables. Sin re-capturar nada.
      </p>

      <div className="grid gap-3">
        {steps.map((s, i) => {
          const Icon = s.icon
          const last = i === steps.length - 1
          return (
            <div key={i}>
              <div className="rounded-2xl border p-4 sm:p-5 flex items-start gap-4"
                style={{ background: 'var(--bento-card)', borderColor: s.alert ? 'var(--crit-line, var(--line))' : 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className="w-11 h-11 rounded-xl grid place-items-center text-sm font-extrabold"
                    style={{ background: s.alert ? 'var(--crit-soft)' : 'var(--accent-soft)', color: s.alert ? 'var(--crit-ink)' : 'var(--accent-ink)' }}>
                    <Icon size={20} />
                  </span>
                  <span className="text-[10px] font-bold mt-1.5" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <h2 className="text-[15px] font-bold">{s.title}</h2>
                    <div className="text-right">
                      <span className="text-xl font-extrabold tabular-nums" style={{ color: s.alert && (s.stat ?? 0) > 0 ? 'var(--crit-ink)' : 'var(--accent-ink)' }}>
                        {s.stat == null ? '·' : formatNumber(s.stat)}
                      </span>
                      <span className="text-[11px] ml-1.5" style={{ color: 'var(--text-3)' }}>{s.statLabel}</span>
                    </div>
                  </div>
                  <p className="text-[13px] mt-1 leading-snug" style={{ color: 'var(--text-2)' }}>{s.desc}</p>
                  <Link href={s.href} className="inline-flex items-center gap-1.5 text-xs font-semibold mt-2.5" style={{ color: 'var(--accent-ink)' }}>
                    {s.cta} <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
              {!last && (
                <div className="flex justify-center py-0.5" style={{ color: 'var(--text-3)' }}>
                  <ArrowDown size={16} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border p-5 mt-4" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
        <p className="text-sm" style={{ color: 'var(--text-1)' }}>
          <b>Lo que nos separa:</b> esto no es un folleto — corre con <b>tus datos reales</b> y se actualiza con cada factura.
          El mesero nunca ve estos costos en el POS; solo tú, aquí.
        </p>
      </div>
    </div>
  )
}
