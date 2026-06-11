'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Upload, FileText, CheckCircle, AlertTriangle, Search, Save, Loader2, Link2, PackageCheck, Trash2, ArrowRight, X } from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import { sbPost } from '@/lib/supabase-helpers'

// ── Types ───────────────────────────────────────────────────────────

interface CFDIData {
  uuid: string
  emisor: { rfc: string; nombre: string }
  receptor: { rfc: string; nombre: string }
  fecha: string
  subtotal: number
  iva: number
  total: number
  conceptos: { descripcion: string; cantidad: number; unitario: number; importe: number }[]
}

interface Supplier {
  clave: string
  nombre: string
  rfc: string
  giro: string
}

interface ProductOption {
  Text: string
  Value: string
}

interface ConceptoMapping {
  id: string
  descripcion: string
  cantidad: number
  unitario: number
  importe: number
  matchedProduct: ProductOption | null
  adjustedQuantity: number
  adjustedCost: number
}

// ── Helpers ─────────────────────────────────────────────────────────

function deepParse(raw: unknown): unknown {
  let parsed = raw
  for (let i = 0; i < 5; i++) {
    if (typeof parsed !== 'string') break
    try { parsed = JSON.parse(parsed) } catch { break }
  }
  return parsed
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function nowKey() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

/** Simple fuzzy match — tokenize both strings and check overlap */
function fuzzyScore(a: string, b: string): number {
  const tokensA = a.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, ' ').split(/\s+/).filter(Boolean)
  const tokensB = b.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, ' ').split(/\s+/).filter(Boolean)
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  let matches = 0
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta === tb) { matches += 2; break }
      if (ta.includes(tb) || tb.includes(ta)) { matches += 1; break }
    }
  }
  return matches / Math.max(tokensA.length, tokensB.length)
}

function parseCFDI(xml: string): CFDIData | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')

    const comp = doc.querySelector('Comprobante') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Comprobante')[0]
    if (!comp) return null

    const emisorEl = comp.querySelector('Emisor') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Emisor')[0]
    const receptorEl = comp.querySelector('Receptor') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Receptor')[0]
    const tfdEl = doc.querySelector('TimbreFiscalDigital') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/TimbreFiscalDigital', 'TimbreFiscalDigital')[0]

    const conceptosEls = comp.querySelectorAll('Concepto').length > 0
      ? comp.querySelectorAll('Concepto')
      : doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Concepto')

    const conceptos = Array.from(conceptosEls).map(c => ({
      descripcion: c.getAttribute('Descripcion') || c.getAttribute('descripcion') || '',
      cantidad: Number(c.getAttribute('Cantidad') || c.getAttribute('cantidad') || 0),
      unitario: Number(c.getAttribute('ValorUnitario') || c.getAttribute('valorUnitario') || 0),
      importe: Number(c.getAttribute('Importe') || c.getAttribute('importe') || 0),
    }))

    return {
      uuid: tfdEl?.getAttribute('UUID') || tfdEl?.getAttribute('uuid') || 'N/A',
      emisor: {
        rfc: emisorEl?.getAttribute('Rfc') || emisorEl?.getAttribute('rfc') || '',
        nombre: emisorEl?.getAttribute('Nombre') || emisorEl?.getAttribute('nombre') || '',
      },
      receptor: {
        rfc: receptorEl?.getAttribute('Rfc') || receptorEl?.getAttribute('rfc') || '',
        nombre: receptorEl?.getAttribute('Nombre') || receptorEl?.getAttribute('nombre') || '',
      },
      fecha: comp.getAttribute('Fecha') || comp.getAttribute('fecha') || '',
      subtotal: Number(comp.getAttribute('SubTotal') || comp.getAttribute('subTotal') || 0),
      iva: Number(comp.getAttribute('Total') || 0) - Number(comp.getAttribute('SubTotal') || 0),
      total: Number(comp.getAttribute('Total') || comp.getAttribute('total') || 0),
      conceptos,
    }
  } catch (e) {
    console.error('Error parsing CFDI:', e)
    return null
  }
}

// ── Component ───────────────────────────────────────────────────────

export default function EntradasFacturaPage() {
  // Catalogs
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)

  // CFDI
  const [cfdi, setCfdi] = useState<CFDIData | null>(null)
  const [xmlError, setXmlError] = useState('')
  const [dragging, setDragging] = useState(false)

  // Mapping
  const [matchedSupplier, setMatchedSupplier] = useState<Supplier | null>(null)
  const [mappings, setMappings] = useState<ConceptoMapping[]>([])

  // Product search per concepto
  const [searchingId, setSearchingId] = useState<string | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const productSearchRef = useRef<HTMLDivElement>(null)

  // Save
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null)

  // ── Load catalogs ─────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [suppResult, prodResult] = await Promise.all([
          getWansoftDataLatest('proveedores_catalog'),
          getWansoftDataLatest('products_catalog'),
        ])

        if (suppResult?.data) {
          const parsed = deepParse(suppResult.data)
          const arr = Array.isArray(parsed) ? parsed : []
          setSuppliers(arr.map((s: any) => ({
            clave: s.clave || '',
            nombre: s.nombre || '',
            rfc: s.rfc || '',
            giro: s.giro || '',
          })))
        }

        if (prodResult?.data) {
          const parsed = deepParse(prodResult.data)
          let arr: ProductOption[] = []
          if (Array.isArray(parsed)) {
            arr = parsed
          } else if (parsed && typeof parsed === 'object' && 'products' in (parsed as any)) {
            arr = (parsed as any).products || []
          }
          setProducts(arr.map((p: any) => ({
            Text: p.Text || p.text || '',
            Value: p.Value || p.value || '',
          })))
        }
      } catch (err) {
        console.error('[EntradasFactura] Error loading catalogs:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Click outside for product search ──────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setSearchingId(null)
        setProductSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Handle XML upload ─────────────────────────────────────────────

  const handleXML = useCallback((fileList: FileList) => {
    setXmlError('')
    const file = fileList[0]
    if (!file) return
    if (!file.name.endsWith('.xml')) {
      setXmlError('Solo archivos XML de CFDI')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const xml = e.target?.result as string
      const parsed = parseCFDI(xml)
      if (!parsed) {
        setXmlError('No se pudo leer el XML. Verifica que sea un CFDI valido.')
        return
      }
      setCfdi(parsed)

      // Auto-match supplier by RFC
      const rfcMatch = suppliers.find(s => s.rfc && s.rfc.toLowerCase() === parsed.emisor.rfc.toLowerCase())
      setMatchedSupplier(rfcMatch || null)

      // Auto-map conceptos to products using fuzzy matching
      const newMappings: ConceptoMapping[] = parsed.conceptos.map(c => {
        // Find best fuzzy match
        let bestMatch: ProductOption | null = null
        let bestScore = 0

        for (const p of products) {
          const productName = p.Text.replace(/\s*\([^)]+\)\s*$/, '').trim()
          const score = fuzzyScore(c.descripcion, productName)
          if (score > bestScore && score >= 0.3) {
            bestScore = score
            bestMatch = p
          }
        }

        return {
          id: uid(),
          descripcion: c.descripcion,
          cantidad: c.cantidad,
          unitario: c.unitario,
          importe: c.importe,
          matchedProduct: bestMatch,
          adjustedQuantity: c.cantidad,
          adjustedCost: c.unitario,
        }
      })

      setMappings(newMappings)
      setSaveResult(null)
    }
    reader.readAsText(file)
  }, [suppliers, products])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleXML(e.dataTransfer.files)
  }, [handleXML])

  // ── Mapping actions ───────────────────────────────────────────────

  const setMappingProduct = useCallback((mappingId: string, product: ProductOption | null) => {
    setMappings(prev => prev.map(m => m.id === mappingId ? { ...m, matchedProduct: product } : m))
    setSearchingId(null)
    setProductSearch('')
  }, [])

  const updateMappingField = useCallback((id: string, field: 'adjustedQuantity' | 'adjustedCost', value: number) => {
    setMappings(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }, [])

  const removeMappingProduct = useCallback((id: string) => {
    setMappings(prev => prev.map(m => m.id === id ? { ...m, matchedProduct: null } : m))
  }, [])

  // Filtered products for inline search
  const filteredProducts = products.filter(p => {
    const q = productSearch.toLowerCase()
    if (!q) return true
    return p.Text.toLowerCase().includes(q)
  }).slice(0, 30)

  const mappedCount = mappings.filter(m => m.matchedProduct).length
  const grandTotal = mappings.reduce((s, m) => s + m.adjustedQuantity * m.adjustedCost, 0)

  // ── Save ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!cfdi || mappedCount === 0) return
    setSaving(true)
    setSaveResult(null)

    const fecha = cfdi.fecha.slice(0, 10) || todayStr()

    const payload = {
      invoice: {
        uuid: cfdi.uuid,
        emisor: cfdi.emisor,
        receptor: cfdi.receptor,
        fecha: cfdi.fecha,
        subtotal: cfdi.subtotal,
        iva: cfdi.iva,
        total: cfdi.total,
      },
      supplier: matchedSupplier ? {
        clave: matchedSupplier.clave,
        nombre: matchedSupplier.nombre,
        rfc: matchedSupplier.rfc,
      } : {
        clave: '',
        nombre: cfdi.emisor.nombre,
        rfc: cfdi.emisor.rfc,
      },
      items: mappings
        .filter(m => m.matchedProduct)
        .map(m => {
          const codeMatch = m.matchedProduct!.Text.match(/\(([^)]+)\)/)
          const code = codeMatch ? codeMatch[1] : ''
          const name = m.matchedProduct!.Text.replace(/\s*\([^)]+\)\s*$/, '').trim()
          return {
            invoiceDescripcion: m.descripcion,
            code,
            name,
            productValue: m.matchedProduct!.Value,
            quantity: m.adjustedQuantity,
            unitCost: m.adjustedCost,
            total: m.adjustedQuantity * m.adjustedCost,
            originalQuantity: m.cantidad,
            originalUnitario: m.unitario,
          }
        }),
      grandTotal,
      createdAt: new Date().toISOString(),
    }

    try {
      const clientId = getActiveClientSlug()
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: `invoice_entry_${nowKey()}`,
        fecha,
        data: payload,
      })
      setSaveResult(ok ? 'ok' : 'error')
      if (ok) {
        setCfdi(null)
        setMappings([])
        setMatchedSupplier(null)
      }
    } catch {
      setSaveResult('error')
    } finally {
      setSaving(false)
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────

  const handleReset = () => {
    setCfdi(null)
    setMappings([])
    setMatchedSupplier(null)
    setXmlError('')
    setSaveResult(null)
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-[var(--text-3)]">
        <Loader2 className="animate-spin" size={20} />
        Cargando catalogos...
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Entrada con Factura"
        subtitle="Vincular factura XML a entrada de inventario"
        eyebrow="Inventario"
      />

      {/* ── Upload XML ────────────────────────────────────────────── */}
      {!cfdi && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-colors ${
            dragging ? 'border-blue-500 bg-blue-500/5' : 'border-[var(--border)] hover:border-[var(--text-3)]'
          }`}
        >
          <Upload size={32} className="mx-auto mb-3 text-[var(--text-3)]" />
          <p className="text-sm font-medium text-[var(--text-1)] mb-1">
            Arrastra tu XML de CFDI aqui
          </p>
          <p className="text-xs text-[var(--text-3)] mb-4">o haz click para seleccionar</p>
          <input
            type="file"
            accept=".xml"
            className="hidden"
            id="xml-invoice-upload"
            onChange={(e) => e.target.files && handleXML(e.target.files)}
          />
          <label
            htmlFor="xml-invoice-upload"
            className="inline-block px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold cursor-pointer hover:bg-blue-500 transition-colors"
          >
            Seleccionar XML
          </label>
        </div>
      )}

      {xmlError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertTriangle size={16} className="text-red-400" />
          <span className="text-sm text-red-400">{xmlError}</span>
        </div>
      )}

      {/* ── Parsed Invoice Preview ────────────────────────────────── */}
      {cfdi && (
        <>
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <FileText size={20} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[var(--text-1)]">Factura CFDI</p>
                  <p className="text-xs text-[var(--text-3)]">UUID: {cfdi.uuid}</p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="h-8 px-3 rounded-lg text-xs font-medium text-[var(--text-3)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Cambiar XML
              </button>
            </div>

            {/* Invoice details grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
              <div>
                <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Proveedor</p>
                <p className="text-sm font-bold text-[var(--text-1)]">{cfdi.emisor.nombre || cfdi.emisor.rfc}</p>
                <p className="text-xs text-[var(--text-3)]">RFC: {cfdi.emisor.rfc}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Fecha</p>
                <p className="text-sm font-bold text-[var(--text-1)]">{cfdi.fecha.slice(0, 10)}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Subtotal</p>
                <p className="text-sm font-bold text-[var(--text-1)]">{formatCurrency(cfdi.subtotal)}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Total</p>
                <p className="text-sm font-bold text-emerald-400">{formatCurrency(cfdi.total)}</p>
              </div>
            </div>

            {/* Supplier match */}
            <div className="px-5 pb-4">
              {matchedSupplier ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                  <span className="text-xs text-emerald-400 font-medium">
                    Proveedor vinculado: {matchedSupplier.nombre} ({matchedSupplier.clave})
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                  <AlertTriangle size={16} className="text-orange-400 shrink-0" />
                  <span className="text-xs text-orange-400 font-medium">
                    RFC {cfdi.emisor.rfc} no coincide con ningun proveedor registrado
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Mapping Section ──────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--text-1)]">
                Mapeo de Conceptos ({mappedCount}/{mappings.length} vinculados)
              </h3>
              <p className="text-xs text-[var(--text-3)]">
                Total ajustado: <span className="font-bold text-[var(--text-1)]">{formatCurrency(grandTotal)}</span>
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              {mappings.map((m) => (
                <div
                  key={m.id}
                  className="bg-[var(--surface)] border-b border-[var(--border)] last:border-b-0"
                >
                  {/* Concepto header */}
                  <div className="px-4 py-3 flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      m.matchedProduct ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[var(--bg)] text-[var(--text-3)]'
                    }`}>
                      {m.matchedProduct ? <Link2 size={16} /> : <Search size={16} />}
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Invoice concepto */}
                      <div>
                        <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-0.5">Factura</p>
                        <p className="text-sm font-medium text-[var(--text-1)] truncate">{m.descripcion}</p>
                        <p className="text-xs text-[var(--text-3)] tabular-nums">
                          {m.cantidad} x {formatCurrency(m.unitario)} = {formatCurrency(m.importe)}
                        </p>
                      </div>

                      {/* Arrow + matched product */}
                      {m.matchedProduct ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <ArrowRight size={14} className="text-emerald-400 shrink-0" />
                            <p className="text-sm text-emerald-400 font-medium truncate">{m.matchedProduct.Text}</p>
                            <button
                              onClick={() => removeMappingProduct(m.id)}
                              className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-500/10 text-[var(--text-3)] hover:text-red-400 transition-colors shrink-0"
                            >
                              <X size={12} />
                            </button>
                          </div>

                          {/* Editable quantity + cost */}
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[10px] text-[var(--text-3)] mb-1">Cantidad</label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={m.adjustedQuantity || ''}
                                onChange={e => updateMappingField(m.id, 'adjustedQuantity', parseFloat(e.target.value) || 0)}
                                className="h-10 w-full text-center px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-[var(--text-3)] mb-1">Costo Unit.</label>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-sm">$</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={m.adjustedCost || ''}
                                  onChange={e => updateMappingField(m.id, 'adjustedCost', parseFloat(e.target.value) || 0)}
                                  className="h-10 w-full text-center px-2 pl-5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[10px] text-[var(--text-3)] mb-1">Total</label>
                              <div className="h-10 flex items-center justify-center text-sm font-medium text-[var(--text-1)] tabular-nums">
                                {formatCurrency(m.adjustedQuantity * m.adjustedCost)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Product search for unmatched concepto */
                        <div ref={searchingId === m.id ? productSearchRef : undefined} className="relative">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" size={14} />
                            <input
                              type="text"
                              value={searchingId === m.id ? productSearch : ''}
                              onChange={e => {
                                setSearchingId(m.id)
                                setProductSearch(e.target.value)
                              }}
                              onFocus={() => setSearchingId(m.id)}
                              placeholder="Buscar producto en catalogo..."
                              className="w-full h-9 pl-9 pr-3 rounded-lg bg-[var(--bg)] border border-dashed border-[var(--border)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-solid"
                            />
                          </div>
                          {searchingId === m.id && productSearch.length >= 2 && filteredProducts.length > 0 && (
                            <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl">
                              {filteredProducts.map(p => (
                                <button
                                  key={p.Value}
                                  onClick={() => setMappingProduct(m.id, p)}
                                  className="w-full text-left px-3 py-2 hover:bg-[var(--border)] transition-colors border-b border-[var(--border)] last:border-b-0 text-xs text-[var(--text-1)]"
                                >
                                  {p.Text}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Summary row */}
              {mappings.length > 0 && (
                <div className="flex items-center justify-between px-4 py-4 bg-[var(--surface)] border-t-2 border-blue-500/30">
                  <div className="text-sm font-semibold text-[var(--text-1)]">
                    {mappedCount} de {mappings.length} conceptos vinculados
                  </div>
                  <div className="text-lg font-bold text-[var(--text-1)] tabular-nums">
                    {formatCurrency(grandTotal)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Save Button ───────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={saving || mappedCount === 0}
              className="h-12 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center gap-2 transition-colors"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} />
              )}
              {saving ? 'Guardando...' : 'Confirmar y Guardar Entrada'}
            </button>

            {saveResult === 'ok' && (
              <span className="text-sm text-emerald-400 font-medium">
                Entrada con factura registrada correctamente
              </span>
            )}
            {saveResult === 'error' && (
              <span className="text-sm text-red-400 font-medium">
                Error al guardar. Intenta de nuevo.
              </span>
            )}
          </div>
        </>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {!cfdi && !xmlError && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-3">
          <FileText size={40} strokeWidth={1.2} />
          <p className="text-sm">Sube un XML de CFDI para vincular la factura a una entrada de inventario</p>
        </div>
      )}
    </div>
  )
}
