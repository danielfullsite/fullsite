'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, FileText, CheckCircle, AlertTriangle, XCircle, Package, ArrowRight, Zap } from 'lucide-react'
import { parseCfdiXml, matchConceptToIngredient, type CfdiParsed, type CfdiConcept } from '@/lib/cfdi-xml-parser'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }
const fmt = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)

interface Ingredient { id: string; name: string; unit: string; cost_per_unit?: number }
interface OcItem { ingredient_name: string; quantity: number; unit_price: number }
interface MatchedLine {
  concepto: CfdiConcept
  ingredient: Ingredient | null
  confidence: number
  ocMatch: OcItem | null
  priceDiff: number | null // % difference vs last cost
  qtyDiff: number | null // vs OC quantity
  includeInRestock: boolean
}

export default function RecepcionFacturaPage() {
  const [cfdi, setCfdi] = useState<CfdiParsed | null>(null)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [matched, setMatched] = useState<MatchedLine[]>([])
  const [ocItems, setOcItems] = useState<OcItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_cid()}&active=eq.true&select=id,name,unit,cost_per_unit&limit=2000`, { headers: H })
      .then(r => r.ok ? r.json() : [])
      .then(setIngredients)
  }, [])

  const processXml = useCallback((xmlText: string) => {
    setError('')
    try {
      const parsed = parseCfdiXml(xmlText)
      setCfdi(parsed)

      // Match each concepto to an ingredient
      const lines: MatchedLine[] = parsed.conceptos.map(c => {
        const match = matchConceptToIngredient(c, ingredients)
        const priceDiff = match?.ingredient.cost_per_unit
          ? ((c.valorUnitario - match.ingredient.cost_per_unit) / match.ingredient.cost_per_unit) * 100
          : null
        return {
          concepto: c,
          ingredient: match?.ingredient || null,
          confidence: match?.confidence || 0,
          ocMatch: null,
          priceDiff,
          qtyDiff: null,
          includeInRestock: match !== null,
        }
      })
      setMatched(lines)

      // Try to find matching OC by supplier
      fetchOcForSupplier(parsed.emisorNombre, lines)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [ingredients])

  const fetchOcForSupplier = async (supplierName: string, lines: MatchedLine[]) => {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_purchase_orders?client_id=eq.${_cid()}&supplier=ilike.*${encodeURIComponent(supplierName.split(' ')[0])}*&status=eq.enviada&order=created_at.desc&limit=1&select=*`,
        { headers: H }
      )
      if (!r.ok) return
      const [oc] = await r.json()
      if (!oc?.items) return

      const items: OcItem[] = Array.isArray(oc.items) ? oc.items : []
      setOcItems(items)

      // Match OC items to factura lines
      const updated = lines.map(line => {
        const ocMatch = items.find(oi =>
          line.ingredient?.name.toLowerCase().includes(oi.ingredient_name?.toLowerCase() || '') ||
          (oi.ingredient_name || '').toLowerCase().includes(line.concepto.descripcion.toLowerCase())
        )
        return {
          ...line,
          ocMatch: ocMatch || null,
          qtyDiff: ocMatch ? ((line.concepto.cantidad - ocMatch.quantity) / ocMatch.quantity) * 100 : null,
        }
      })
      setMatched(updated)
    } catch { /* no OC found */ }
  }

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.xml')) { setError('Solo archivos XML'); return }
    const reader = new FileReader()
    reader.onload = (e) => processXml(e.target?.result as string)
    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const toggleRestock = (idx: number) => {
    setMatched(prev => prev.map((m, i) => i === idx ? { ...m, includeInRestock: !m.includeInRestock } : m))
  }

  const handleSave = async () => {
    if (!cfdi || matched.length === 0) return
    setSaving(true)
    try {
      const skey = SUPABASE_KEY
      const headers = { apikey: skey, Authorization: `Bearer ${skey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }

      // 1. Save factura record
      await fetch(`${SUPABASE_URL}/rest/v1/pos_facturas`, {
        method: 'POST', headers,
        body: JSON.stringify({
          id: `FACT-${cfdi.uuid || Date.now()}`,
          client_id: _cid(),
          supplier: cfdi.emisorNombre,
          folio: `${cfdi.serie}${cfdi.folio}`,
          uuid_sat: cfdi.uuid,
          subtotal: cfdi.subtotal,
          iva: cfdi.ivaTraslado,
          total: cfdi.total,
          status: 'procesada',
          captured_by: 'XML automático',
          notes: `${cfdi.conceptos.length} conceptos — ${cfdi.fecha}`,
        }),
      })

      // 2. Update ingredient costs + restock
      for (const line of matched) {
        if (!line.ingredient) continue

        // Update cost if changed
        if (line.priceDiff !== null && Math.abs(line.priceDiff) > 0.1) {
          await fetch(`${SUPABASE_URL}/rest/v1/pos_ingredients?id=eq.${line.ingredient.id}&client_id=eq.${_cid()}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ cost_per_unit: line.concepto.valorUnitario }),
          })
        }

        // Restock inventory
        if (line.includeInRestock) {
          // Get current stock
          const invRes = await fetch(
            `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${_cid()}&ingredient_id=eq.${line.ingredient.id}&select=id,stock`,
            { headers: H }
          )
          if (invRes.ok) {
            const rows = await invRes.json()
            if (rows.length > 0) {
              const newStock = Number(rows[0].stock || 0) + line.concepto.cantidad
              await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory?id=eq.${rows[0].id}`, {
                method: 'PATCH', headers,
                body: JSON.stringify({ stock: newStock, last_restock: new Date().toISOString() }),
              })
            }
          }

          // Log movement
          await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
            method: 'POST', headers,
            body: JSON.stringify({
              client_id: _cid(),
              ingredient_id: line.ingredient.id,
              movement_type: 'restock',
              quantity: line.concepto.cantidad,
              actor: 'XML Factura',
              notes: `${cfdi.emisorNombre} — ${cfdi.serie}${cfdi.folio}`,
            }),
          })
        }
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 5000)
    } catch (e) {
      setError((e as Error).message)
    }
    setSaving(false)
  }

  const discrepancies = matched.filter(m => (m.priceDiff !== null && Math.abs(m.priceDiff) > 10) || (m.qtyDiff !== null && Math.abs(m.qtyDiff) > 5))
  const unmatched = matched.filter(m => !m.ingredient)
  const totalRestock = matched.filter(m => m.includeInRestock).length

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <Zap size={24} className="text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-1)]">Recepcion de Factura</h1>
          <p className="text-sm text-[var(--text-3)]">Arrastra el XML del proveedor — auto-compara con OC, actualiza precios y sube inventario</p>
        </div>
      </div>

      {/* Drop zone */}
      {!cfdi && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer ${
            dragOver ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--line)] hover:border-amber-500/50'
          }`}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.xml'
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0]
              if (file) handleFile(file)
            }
            input.click()
          }}
        >
          <Upload size={48} className="mx-auto text-[var(--text-3)] mb-4" />
          <p className="text-lg font-bold text-[var(--text-1)]">Arrastra el XML aqui</p>
          <p className="text-sm text-[var(--text-3)] mt-1">o haz click para seleccionar archivo</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mt-4 flex items-center gap-3">
          <XCircle size={16} className="text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {cfdi && (
        <div className="space-y-4">
          {/* Header info */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-[var(--text-3)]">Proveedor</p>
                <p className="font-bold text-[var(--text-1)]">{cfdi.emisorNombre}</p>
                <p className="text-xs text-[var(--text-3)]">{cfdi.emisorRfc}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-3)]">Folio</p>
                <p className="font-bold text-[var(--text-1)]">{cfdi.serie}{cfdi.folio}</p>
                <p className="text-xs text-[var(--text-3)]">{cfdi.fecha?.slice(0, 10)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-3)]">Total</p>
                <p className="font-bold text-emerald-400 text-xl">{fmt(cfdi.total)}</p>
                <p className="text-xs text-[var(--text-3)]">Sub {fmt(cfdi.subtotal)} + IVA {fmt(cfdi.ivaTraslado)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-3)]">UUID SAT</p>
                <p className="text-xs text-[var(--text-2)] font-mono break-all">{cfdi.uuid || 'Sin timbrar'}</p>
              </div>
            </div>
          </div>

          {/* Discrepancies alert */}
          {discrepancies.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-amber-400" />
                <p className="font-bold text-amber-400">{discrepancies.length} discrepancia(s) detectadas</p>
              </div>
              {discrepancies.map((d, i) => (
                <p key={i} className="text-xs text-[var(--text-3)]">
                  {d.concepto.descripcion}:
                  {d.priceDiff !== null && Math.abs(d.priceDiff) > 10 && ` precio ${d.priceDiff > 0 ? '+' : ''}${d.priceDiff.toFixed(1)}%`}
                  {d.qtyDiff !== null && Math.abs(d.qtyDiff) > 5 && ` cantidad ${d.qtyDiff > 0 ? '+' : ''}${d.qtyDiff.toFixed(1)}% vs OC`}
                </p>
              ))}
            </div>
          )}

          {/* Unmatched alert */}
          {unmatched.length > 0 && (
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4">
              <p className="text-sm text-sky-400">{unmatched.length} concepto(s) no se pudieron ligar a un ingrediente — revisar manualmente</p>
            </div>
          )}

          {/* Lines table */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
              <h3 className="font-bold text-[var(--text-1)]">{matched.length} conceptos</h3>
              <span className="text-xs text-[var(--text-3)]">{totalRestock} para restock</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line-soft)] text-xs text-[var(--text-3)]">
                    <th className="text-left px-4 py-2">Concepto XML</th>
                    <th className="text-left px-4 py-2">Ingrediente</th>
                    <th className="text-center px-4 py-2">Cant</th>
                    <th className="text-right px-4 py-2">P/U</th>
                    <th className="text-right px-4 py-2">Importe</th>
                    <th className="text-center px-4 py-2">Precio</th>
                    <th className="text-center px-4 py-2">Restock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line-soft)]">
                  {matched.map((line, i) => (
                    <tr key={i} className={line.priceDiff !== null && Math.abs(line.priceDiff) > 10 ? 'bg-amber-500/5' : ''}>
                      <td className="px-4 py-2">
                        <p className="text-[var(--text-1)]">{line.concepto.descripcion}</p>
                        <p className="text-[10px] text-[var(--text-3)]">{line.concepto.claveProdServ} · {line.concepto.claveUnidad}</p>
                      </td>
                      <td className="px-4 py-2">
                        {line.ingredient ? (
                          <div className="flex items-center gap-1">
                            <CheckCircle size={12} className="text-emerald-400" />
                            <span className="text-[var(--text-1)]">{line.ingredient.name}</span>
                          </div>
                        ) : (
                          <span className="text-[var(--text-3)] italic">Sin match</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center text-[var(--text-1)]">
                        {line.concepto.cantidad} {line.concepto.unidad}
                        {line.qtyDiff !== null && Math.abs(line.qtyDiff) > 5 && (
                          <span className={`text-[10px] block ${line.qtyDiff > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                            {line.qtyDiff > 0 ? '+' : ''}{line.qtyDiff.toFixed(0)}% vs OC
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-1)]">{fmt(line.concepto.valorUnitario)}</td>
                      <td className="px-4 py-2 text-right text-[var(--text-1)] font-medium">{fmt(line.concepto.importe)}</td>
                      <td className="px-4 py-2 text-center">
                        {line.priceDiff !== null && (
                          <span className={`text-xs font-semibold ${
                            Math.abs(line.priceDiff) <= 5 ? 'text-emerald-400' :
                            Math.abs(line.priceDiff) <= 15 ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {line.priceDiff > 0 ? '+' : ''}{line.priceDiff.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {line.ingredient && (
                          <button onClick={() => toggleRestock(i)}
                            className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                              line.includeInRestock ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-[var(--line)] text-transparent'
                            }`}>
                            {line.includeInRestock && <CheckCircle size={14} />}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={() => { setCfdi(null); setMatched([]); setError('') }}
              className="px-6 py-3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text-3)] rounded-xl font-semibold">
              Otra factura
            </button>
            <button onClick={handleSave} disabled={saving || saved}
              className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded-xl font-bold text-lg flex items-center justify-center gap-2">
              {saved ? <><CheckCircle size={20} /> Guardado</> :
               saving ? 'Procesando...' :
               <><Package size={20} /> Guardar factura + restock ({totalRestock} items)</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
