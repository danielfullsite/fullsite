'use client'

import { useState } from 'react'
import { Download, Package, ChefHat, Users, ShoppingCart, Layers, FileSpreadsheet } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() {
  try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' }
}

const EXPORTS = [
  { id: 'ingredients', label: 'Ingredientes', icon: Package, table: 'pos_ingredients', select: '*', filter: true, desc: 'Catálogo completo de insumos con costos' },
  { id: 'inventory', label: 'Inventario (stocks)', icon: Layers, table: 'pos_inventory', select: '*', filter: true, desc: 'Stock actual de cada ingrediente' },
  { id: 'recipes', label: 'Recetas', icon: ChefHat, table: 'pos_recipes_old', select: '*', filter: true, desc: 'Recetas con ingredientes y cantidades' },
  { id: 'menu', label: 'Menú (platillos)', icon: FileSpreadsheet, table: 'pos_menu_items', select: '*', filter: true, desc: 'Todos los platillos con precios' },
  { id: 'categories', label: 'Categorías', icon: Layers, table: 'pos_menu_categories', select: '*', filter: true, desc: 'Categorías del menú' },
  { id: 'staff', label: 'Staff', icon: Users, table: 'pos_staff', select: 'id,name,role,active', filter: true, desc: 'Empleados y roles (sin PINs)' },
  { id: 'market', label: 'Market (stock)', icon: ShoppingCart, table: 'pos_market_stock', select: '*', filter: true, desc: 'Stock de productos Market' },
  { id: 'wansoft_recipes', label: 'Recetas Wansoft', icon: ChefHat, table: 'wansoft_recipes', select: 'saucer_id,saucer_name,budget_cost', filter: false, desc: '574 recetas originales de Wansoft' },
]

export default function ExportarPage() {
  const [downloading, setDownloading] = useState<string | null>(null)

  async function downloadCSV(exp: typeof EXPORTS[0]) {
    setDownloading(exp.id)
    try {
      const clientFilter = exp.filter ? `&client_id=eq.${_cid()}` : ''
      const url = `${SUPABASE_URL}/rest/v1/${exp.table}?select=${exp.select}${clientFilter}&limit=10000`
      const headers: Record<string, string> = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'text/csv' }
      const res = await fetch(url, { headers })
      const text = await res.text()
      if (!res.ok || text.includes('"code"')) {
        // Retry without client_id filter
        const res2 = await fetch(`${SUPABASE_URL}/rest/v1/${exp.table}?select=${exp.select}&limit=10000`, { headers })
        const text2 = await res2.text()
        if (!res2.ok || text2.includes('"code"')) {
          alert(`Error exportando ${exp.label}: ${text2.slice(0, 100)}`)
          setDownloading(null)
          return
        }
        downloadFile(text2, `${exp.id}_${new Date().toISOString().slice(0, 10)}.csv`)
      } else {
        downloadFile(text, `${exp.id}_${new Date().toISOString().slice(0, 10)}.csv`)
      }
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'desconocido'))
    }
    setDownloading(null)
  }

  async function downloadAll() {
    for (const exp of EXPORTS) {
      await downloadCSV(exp)
      await new Promise(r => setTimeout(r, 500))
    }
  }

  function downloadFile(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title="Exportar datos"
        subtitle="Descarga todo el catálogo en CSV para migración o respaldo"
        eyebrow="Admin"
      />

      <div className="mb-6">
        <button
          onClick={downloadAll}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-colors"
        >
          <Download size={18} />
          Exportar TODO (8 archivos CSV)
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {EXPORTS.map(exp => (
          <div key={exp.id} className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <exp.icon size={20} className="text-emerald-500" />
              </div>
              <div>
                <p className="font-semibold text-[var(--text-1)]">{exp.label}</p>
                <p className="text-xs text-[var(--text-3)]">{exp.desc}</p>
              </div>
            </div>
            <button
              onClick={() => downloadCSV(exp)}
              disabled={downloading === exp.id}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
            >
              {downloading === exp.id ? (
                <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
              ) : (
                <Download size={14} />
              )}
              CSV
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
