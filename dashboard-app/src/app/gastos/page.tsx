'use client'

import { useState, useEffect, useCallback } from 'react'
import { Receipt, Upload, Plus, X, FileText, Wallet, Search, Calendar, DollarSign, TrendingDown } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }
function hdrs() { return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' } }

type Tab = 'facturas' | 'caja-chica' | 'xml'
type GastoStatus = 'pendiente' | 'pagado' | 'parcial'

interface Gasto {
  id: string
  client_id: string
  tipo: 'factura' | 'caja_chica'
  proveedor: string
  concepto: string
  subtotal: number
  iva: number
  total: number
  fecha: string
  fecha_pago?: string
  status: GastoStatus
  categoria: string
  notas?: string
  xml_data?: Record<string, unknown>
  created_at: string
}

const CATEGORIAS = ['Alimentos', 'Bebidas', 'Limpieza', 'Mantenimiento', 'Nómina', 'Renta', 'Servicios', 'Marketing', 'Equipo', 'Otros']

function getMonthRange() {
  const now = new Date()
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${last}`
  return { from, to }
}

export default function GastosPage() {
  const [tab, setTab] = useState<Tab>('facturas')
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [xmlFile, setXmlFile] = useState<File | null>(null)
  const [xmlParsed, setXmlParsed] = useState<Record<string, string> | null>(null)
  const [xmlError, setXmlError] = useState('')

  // Form state
  const [form, setForm] = useState({
    tipo: 'factura' as 'factura' | 'caja_chica',
    proveedor: '', concepto: '', subtotal: '', iva: '', total: '',
    fecha: new Date().toISOString().slice(0, 10), categoria: 'Alimentos', notas: '', status: 'pendiente' as GastoStatus,
  })

  const [proveedores, setProveedores] = useState<string[]>([])

  const loadGastos = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = getMonthRange()
      const [gastosRes, provRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/pos_gastos?client_id=eq.${_cid()}&fecha=gte.${from}&fecha=lte.${to}&order=fecha.desc&limit=500`, { headers: hdrs() }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_ingredients?select=supplier&client_id=eq.${_cid()}&limit=1000`, { headers: hdrs() }),
      ])
      if (gastosRes.ok) setGastos(await gastosRes.json())
      if (provRes.ok) {
        const data = await provRes.json()
        const unique = [...new Set(data.map((d: { supplier: string }) => d.supplier).filter(Boolean))] as string[]
        setProveedores(unique.sort())
      }
    } catch { /* */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadGastos() }, [loadGastos])

  // KPIs
  const totalGastos = gastos.reduce((s, g) => s + g.total, 0)
  const totalPendiente = gastos.filter(g => g.status === 'pendiente').reduce((s, g) => s + g.total, 0)
  const totalPagado = gastos.filter(g => g.status === 'pagado').reduce((s, g) => s + g.total, 0)
  const facturas = gastos.filter(g => g.tipo === 'factura')
  const cajaChica = gastos.filter(g => g.tipo === 'caja_chica')

  const filtered = gastos.filter(g => {
    if (tab === 'facturas' && g.tipo !== 'factura') return false
    if (tab === 'caja-chica' && g.tipo !== 'caja_chica') return false
    if (tab === 'xml') return g.tipo === 'factura'
    if (search) {
      const s = search.toLowerCase()
      return g.proveedor.toLowerCase().includes(s) || g.concepto.toLowerCase().includes(s)
    }
    return true
  })

  async function handleSave() {
    const subtotal = parseFloat(form.subtotal) || 0
    const iva = parseFloat(form.iva) || subtotal * 0.16
    const total = parseFloat(form.total) || subtotal + iva
    const body = {
      client_id: _cid(),
      tipo: tab === 'caja-chica' ? 'caja_chica' : 'factura',
      proveedor: form.proveedor, concepto: form.concepto,
      subtotal, iva, total,
      fecha: form.fecha, categoria: form.categoria,
      notas: form.notas || null, status: form.status,
      xml_data: xmlParsed || null,
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_gastos`, {
      method: 'POST', headers: { ...hdrs(), Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setShowAdd(false)
      setForm({ tipo: 'factura', proveedor: '', concepto: '', subtotal: '', iva: '', total: '', fecha: new Date().toISOString().slice(0, 10), categoria: 'Alimentos', notas: '', status: 'pendiente' })
      setXmlParsed(null)
      loadGastos()
    }
  }

  async function handleXmlUpload(file: File) {
    setXmlFile(file)
    setXmlError('')
    try {
      const text = await file.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(text, 'text/xml')

      // Parse CFDI XML
      const comp = doc.querySelector('Comprobante') || doc.querySelector('cfdi\\:Comprobante')
      if (!comp) { setXmlError('No es un CFDI válido'); return }

      const emisor = doc.querySelector('Emisor') || doc.querySelector('cfdi\\:Emisor')
      const receptor = doc.querySelector('Receptor') || doc.querySelector('cfdi\\:Receptor')

      const parsed: Record<string, string> = {
        rfc_emisor: emisor?.getAttribute('Rfc') || emisor?.getAttribute('rfc') || '',
        nombre_emisor: emisor?.getAttribute('Nombre') || emisor?.getAttribute('nombre') || '',
        rfc_receptor: receptor?.getAttribute('Rfc') || receptor?.getAttribute('rfc') || '',
        subtotal: comp.getAttribute('SubTotal') || comp.getAttribute('subTotal') || '0',
        total: comp.getAttribute('Total') || comp.getAttribute('total') || '0',
        fecha: (comp.getAttribute('Fecha') || comp.getAttribute('fecha') || '').slice(0, 10),
        folio: comp.getAttribute('Folio') || comp.getAttribute('folio') || '',
        serie: comp.getAttribute('Serie') || comp.getAttribute('serie') || '',
        uuid: '',
      }

      // Get UUID from TimbreFiscalDigital
      const timbre = doc.querySelector('TimbreFiscalDigital') || doc.querySelector('tfd\\:TimbreFiscalDigital')
      if (timbre) parsed.uuid = timbre.getAttribute('UUID') || timbre.getAttribute('uuid') || ''

      // Calculate IVA
      const iva = parseFloat(parsed.total) - parseFloat(parsed.subtotal)
      parsed.iva = iva.toFixed(2)

      setXmlParsed(parsed)
      setForm(prev => ({
        ...prev,
        proveedor: parsed.nombre_emisor || parsed.rfc_emisor,
        subtotal: parsed.subtotal,
        iva: parsed.iva,
        total: parsed.total,
        fecha: parsed.fecha || prev.fecha,
        concepto: `Factura ${parsed.serie}${parsed.folio}`,
      }))
    } catch (e) {
      setXmlError(`Error al leer XML: ${e instanceof Error ? e.message : 'desconocido'}`)
    }
  }

  async function markPaid(id: string) {
    await fetch(`${SUPABASE_URL}/rest/v1/pos_gastos?id=eq.${id}`, {
      method: 'PATCH', headers: { ...hdrs(), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'pagado', fecha_pago: new Date().toISOString().slice(0, 10) }),
    })
    loadGastos()
  }

  const statusColor: Record<string, string> = {
    pendiente: 'bg-amber-500/15 text-amber-500',
    pagado: 'bg-emerald-500/15 text-emerald-500',
    parcial: 'bg-blue-500/15 text-blue-500',
  }

  return (
    <>
      <PageHeader title="Gastos" subtitle="Facturas de proveedores, caja chica y carga de XML" eyebrow="Finanzas" />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Gastos del mes" value={formatCurrency(totalGastos)} icon={TrendingDown} accentClass="kpi-accent-pink" index={0} subtitle={`${gastos.length} registros`} />
        <KPICard label="Pendiente de pago" value={formatCurrency(totalPendiente)} icon={Receipt} accentClass="kpi-accent-amber" index={1} />
        <KPICard label="Pagado" value={formatCurrency(totalPagado)} icon={DollarSign} accentClass="kpi-accent-green" index={2} />
        <KPICard label="Facturas / Caja chica" value={`${facturas.length} / ${cajaChica.length}`} icon={FileText} accentClass="kpi-accent-blue" index={3} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 border border-[var(--line)]">
          {([
            { key: 'facturas' as Tab, label: 'Facturas proveedor' },
            { key: 'caja-chica' as Tab, label: 'Caja chica' },
            { key: 'xml' as Tab, label: 'Cargar XML' },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-emerald-600 text-white' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
            className="pl-9 pr-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] w-48" />
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors">
          <Plus size={14} /> {tab === 'caja-chica' ? 'Gasto caja chica' : 'Nueva factura'}
        </button>
      </div>

      {/* XML Upload Tab */}
      {tab === 'xml' && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-6 mb-6">
          <h3 className="font-semibold text-[var(--text-1)] mb-3 flex items-center gap-2"><Upload size={18} /> Cargar factura XML (CFDI)</h3>
          <div className="border-2 border-dashed border-[var(--line)] rounded-xl p-8 text-center cursor-pointer hover:border-emerald-500/50 transition-colors"
            onClick={() => document.getElementById('xml-input')?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleXmlUpload(f) }}>
            <input id="xml-input" type="file" accept=".xml" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleXmlUpload(f) }} />
            <FileText size={32} className="mx-auto mb-3 text-[var(--text-4)]" />
            {xmlFile ? (
              <p className="text-sm text-[var(--text-1)]">{xmlFile.name}</p>
            ) : (
              <p className="text-sm text-[var(--text-3)]">Arrastra un XML aquí o haz click para seleccionar</p>
            )}
          </div>
          {xmlError && <p className="text-sm text-red-500 mt-3">{xmlError}</p>}
          {xmlParsed && (
            <div className="mt-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
              <p className="text-sm font-semibold text-emerald-500 mb-2">CFDI parseado correctamente</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-[var(--text-3)]">Emisor:</span> <span className="text-[var(--text-1)]">{xmlParsed.nombre_emisor}</span></div>
                <div><span className="text-[var(--text-3)]">RFC:</span> <span className="text-[var(--text-1)]">{xmlParsed.rfc_emisor}</span></div>
                <div><span className="text-[var(--text-3)]">Subtotal:</span> <span className="text-[var(--text-1)]">${xmlParsed.subtotal}</span></div>
                <div><span className="text-[var(--text-3)]">IVA:</span> <span className="text-[var(--text-1)]">${xmlParsed.iva}</span></div>
                <div><span className="text-[var(--text-3)]">Total:</span> <span className="font-bold text-[var(--text-1)]">${xmlParsed.total}</span></div>
                <div><span className="text-[var(--text-3)]">UUID:</span> <span className="text-[var(--text-1)] text-xs">{xmlParsed.uuid}</span></div>
              </div>
              <button onClick={() => { setShowAdd(true); setTab('facturas') }}
                className="mt-3 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500">
                Registrar como gasto
              </button>
            </div>
          )}
        </div>
      )}

      {/* Gastos list */}
      {tab !== 'xml' && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Wallet size={40} className="mx-auto mb-3 text-[var(--text-4)]" />
              <p className="text-[var(--text-2)] font-medium">Sin gastos registrados</p>
              <p className="text-sm text-[var(--text-4)] mt-1">Agrega un gasto o carga un XML de factura</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text-3)]">
                  <th className="text-left px-5 py-3 font-medium">Fecha</th>
                  <th className="text-left px-5 py-3 font-medium">Proveedor</th>
                  <th className="text-left px-5 py-3 font-medium">Concepto</th>
                  <th className="text-left px-5 py-3 font-medium">Categoría</th>
                  <th className="text-right px-5 py-3 font-medium">Subtotal</th>
                  <th className="text-right px-5 py-3 font-medium">IVA</th>
                  <th className="text-right px-5 py-3 font-medium">Total</th>
                  <th className="text-center px-5 py-3 font-medium">Status</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(g => (
                  <tr key={g.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-5 py-3 text-[var(--text-2)]">{g.fecha}</td>
                    <td className="px-5 py-3 text-[var(--text-1)] font-medium">{g.proveedor}</td>
                    <td className="px-5 py-3 text-[var(--text-2)]">{g.concepto}</td>
                    <td className="px-5 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-3)]">{g.categoria}</span></td>
                    <td className="px-5 py-3 text-right text-[var(--text-2)] tabular-nums">{formatCurrency(g.subtotal)}</td>
                    <td className="px-5 py-3 text-right text-[var(--text-3)] tabular-nums">{formatCurrency(g.iva)}</td>
                    <td className="px-5 py-3 text-right text-[var(--text-1)] font-semibold tabular-nums">{formatCurrency(g.total)}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${statusColor[g.status]}`}>{g.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      {g.status === 'pendiente' && (
                        <button onClick={() => markPaid(g.id)} className="text-xs text-emerald-500 hover:text-emerald-400">Pagar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--line)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg)' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
              <h3 className="text-base font-semibold text-[var(--text-1)]">
                {tab === 'caja-chica' ? 'Nuevo gasto caja chica' : 'Nueva factura proveedor'}
              </h3>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Proveedor *</label>
                  <input type="text" list="proveedores-list" value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })}
                    placeholder="Escribe o selecciona..."
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]" />
                  <datalist id="proveedores-list">
                    {proveedores.map(p => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Fecha</label>
                  <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">Concepto</label>
                <input type="text" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Subtotal</label>
                  <input type="number" step="0.01" value={form.subtotal} onChange={e => setForm({ ...form, subtotal: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">IVA</label>
                  <input type="number" step="0.01" value={form.iva} onChange={e => setForm({ ...form, iva: e.target.value })} placeholder="Auto 16%"
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Total</label>
                  <input type="number" step="0.01" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} placeholder="Auto"
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Categoría</label>
                  <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]">
                    {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as GastoStatus })}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)]">
                    <option value="pendiente">Pendiente</option>
                    <option value="pagado">Pagado</option>
                    <option value="parcial">Parcial</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">Notas</label>
                <textarea value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] resize-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--line)]">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[var(--text-3)]">Cancelar</button>
              <button onClick={handleSave} disabled={!form.proveedor}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
