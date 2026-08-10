'use client'
// BUG-019-B — read-only public menu view. Receives ONLY already-public menu data
// (server-shaped) + the mesa number. No Supabase calls, no token, no client_id
// authority, no ordering. Ordering via QR is Batch C.
import { useState } from 'react'
import { formatMXN } from '@/lib/pos-data'
import type { PublicMenu } from '@/lib/public-menu'

export default function MenuView({
  menu, mesaNum, misconfigured,
}: { menu: PublicMenu | null; mesaNum: number | null; misconfigured: boolean }) {
  const categories = menu?.categories ?? []
  const [selectedCat, setSelectedCat] = useState(categories[0]?.id ?? '')

  if (misconfigured || !menu || categories.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-bold text-[var(--text-1)] mb-2">Menú no disponible</h2>
          <p className="text-[var(--text-3)] text-sm">
            {mesaNum ? `Mesa ${mesaNum}. ` : ''}Pide a tu mesero la carta o vuelve a intentar más tarde.
          </p>
        </div>
      </div>
    )
  }

  const activeCat = categories.find(c => c.id === selectedCat) ?? categories[0]

  return (
    <div className="min-h-screen bg-[var(--surface-2)] flex flex-col">
      <header className="bg-[var(--surface)] text-white px-4 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div>
          <span className="font-black text-lg tracking-tight">
            fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
          {mesaNum != null && <span className="text-[var(--text-3)] text-sm ml-2">Mesa {mesaNum}</span>}
        </div>
      </header>

      <div className="flex gap-1.5 px-3 py-2.5 overflow-x-auto border-b border-[var(--line-soft)] bg-[var(--surface)] sticky top-[56px] z-10">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setSelectedCat(cat.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              activeCat.id === cat.id ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200' : 'bg-[var(--surface-2)] text-[var(--text-2)]'
            }`}>
            {cat.name}
          </button>
        ))}
      </div>

      <div className="flex-1 px-4 py-4">
        <h3 className="text-lg font-bold text-[var(--text-1)] mb-3">{activeCat.name}</h3>
        <div className="grid grid-cols-2 gap-3">
          {activeCat.items.map(item => (
            <div key={item.id} className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-4">
              <p className="font-semibold text-[var(--text-1)] text-sm leading-tight">{item.name}</p>
              <p className="text-emerald-600 font-bold mt-1.5">{formatMXN(item.price)}</p>
              {item.modifier_groups.length > 0 && (
                <p className="text-[var(--text-3)] text-xs mt-1">
                  {item.modifier_groups.map(g => g.name).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 bg-[var(--surface)] border-t border-[var(--line)] px-4 py-3 text-center">
        <p className="text-[var(--text-3)] text-sm">Para ordenar, pide a tu mesero</p>
      </div>
    </div>
  )
}
