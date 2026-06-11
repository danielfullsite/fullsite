'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Camera, X, Plus, Minus, Search, Save, Loader2, ScanBarcode, PackageCheck, Trash2 } from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import { sbPost } from '@/lib/supabase-helpers'

// ── Types ───────────────────────────────────────────────────────────

interface ProductOption {
  Text: string
  Value: string
}

interface ScannedItem {
  id: string
  code: string
  name: string
  productValue: string
  type: 'entrada' | 'salida'
  quantity: number
  timestamp: string
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

function nowTime() {
  return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function nowKey() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

// ── Component ───────────────────────────────────────────────────────

export default function BarcodePage() {
  // Data
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)

  // Barcode input
  const [barcodeInput, setBarcodeInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Camera scanner
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Matched product
  const [matchedProduct, setMatchedProduct] = useState<ProductOption | null>(null)
  const [actionType, setActionType] = useState<'entrada' | 'salida'>('entrada')
  const [quantity, setQuantity] = useState(1)

  // Running log
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null)

  // ── Load product catalog ──────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const prodResult = await getWansoftDataLatest('products_catalog')
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
        console.error('[Barcode] Error loading catalog:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Auto-focus input ──────────────────────────────────────────────

  useEffect(() => {
    if (!loading && inputRef.current) {
      inputRef.current.focus()
    }
  }, [loading])

  // ── Barcode search ────────────────────────────────────────────────

  const searchBarcode = useCallback((code: string) => {
    const q = code.trim().toLowerCase()
    if (!q) {
      setMatchedProduct(null)
      return
    }

    // Search by code in parentheses, e.g. "ACEITE VEGETAL (ABA001)"
    const match = products.find(p => {
      const codeMatch = p.Text.match(/\(([^)]+)\)/)
      const productCode = codeMatch ? codeMatch[1].toLowerCase() : ''
      return productCode === q || p.Value.toLowerCase() === q || p.Text.toLowerCase().includes(q)
    })

    setMatchedProduct(match || null)
  }, [products])

  const handleBarcodeSubmit = useCallback(() => {
    searchBarcode(barcodeInput)
  }, [barcodeInput, searchBarcode])

  // ── Camera scanner ────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setCameraError('')
    setCameraOpen(true)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }

      // Check BarcodeDetector API availability
      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'],
        })

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState !== 4) return
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0) {
              const value = barcodes[0].rawValue
              setBarcodeInput(value)
              searchBarcode(value)
              stopCamera()
            }
          } catch { /* frame not ready */ }
        }, 300)
      } else {
        setCameraError('BarcodeDetector API no disponible en este navegador. Usa Chrome en Android o escribe el codigo manualmente.')
      }
    } catch (err) {
      console.error('[Camera]', err)
      setCameraError('No se pudo acceder a la camara. Verifica los permisos.')
      setCameraOpen(false)
    }
  }, [searchBarcode])

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraOpen(false)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  // ── Add to log ────────────────────────────────────────────────────

  const addToLog = useCallback(() => {
    if (!matchedProduct) return

    const codeMatch = matchedProduct.Text.match(/\(([^)]+)\)/)
    const code = codeMatch ? codeMatch[1] : ''
    const name = matchedProduct.Text.replace(/\s*\([^)]+\)\s*$/, '').trim()

    setScannedItems(prev => [{
      id: uid(),
      code,
      name,
      productValue: matchedProduct.Value,
      type: actionType,
      quantity,
      timestamp: nowTime(),
    }, ...prev])

    // Reset for next scan
    setMatchedProduct(null)
    setBarcodeInput('')
    setQuantity(1)
    setActionType('entrada')
    inputRef.current?.focus()
  }, [matchedProduct, actionType, quantity])

  const removeFromLog = useCallback((id: string) => {
    setScannedItems(prev => prev.filter(i => i.id !== id))
  }, [])

  // ── Save ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (scannedItems.length === 0) return
    setSaving(true)
    setSaveResult(null)

    const payload = {
      fecha: todayStr(),
      items: scannedItems.map(i => ({
        code: i.code,
        name: i.name,
        productValue: i.productValue,
        type: i.type,
        quantity: i.type === 'salida' ? -i.quantity : i.quantity,
        timestamp: i.timestamp,
      })),
      totalEntradas: scannedItems.filter(i => i.type === 'entrada').reduce((s, i) => s + i.quantity, 0),
      totalSalidas: scannedItems.filter(i => i.type === 'salida').reduce((s, i) => s + i.quantity, 0),
      createdAt: new Date().toISOString(),
    }

    try {
      const clientId = getActiveClientSlug()
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: `barcode_scan_${todayStr()}`,
        fecha: todayStr(),
        data: payload,
      })
      setSaveResult(ok ? 'ok' : 'error')
      if (ok) {
        setScannedItems([])
      }
    } catch {
      setSaveResult('error')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-[var(--text-3)]">
        <Loader2 className="animate-spin" size={20} />
        Cargando catalogo...
      </div>
    )
  }

  const totalEntradas = scannedItems.filter(i => i.type === 'entrada').reduce((s, i) => s + i.quantity, 0)
  const totalSalidas = scannedItems.filter(i => i.type === 'salida').reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Codigo de Barras"
        subtitle="Entrada y salida rapida"
        eyebrow="Inventario"
      />

      {/* ── Barcode Input ─────────────────────────────────────────── */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-6">
        <label className="block text-xs font-medium text-[var(--text-3)] mb-2">
          Escanea o escribe el codigo
        </label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <ScanBarcode className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-3)]" size={22} />
            <input
              ref={inputRef}
              type="text"
              value={barcodeInput}
              onChange={e => {
                setBarcodeInput(e.target.value)
                if (e.target.value.length >= 3) searchBarcode(e.target.value)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleBarcodeSubmit()
              }}
              placeholder="Codigo de barras..."
              autoFocus
              className="w-full h-16 pl-14 pr-4 rounded-xl bg-[var(--bg)] border-2 border-[var(--border)] text-[var(--text-1)] text-2xl font-mono tracking-widest placeholder:text-[var(--text-3)] placeholder:text-lg placeholder:font-sans placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40"
            />
          </div>
          <button
            onClick={() => handleBarcodeSubmit()}
            className="h-16 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            <Search size={22} />
          </button>
          <button
            onClick={startCamera}
            className="h-16 px-5 rounded-xl bg-[var(--bg)] border-2 border-[var(--border)] text-[var(--text-2)] hover:border-blue-500/40 hover:text-blue-400 transition-colors"
          >
            <Camera size={22} />
          </button>
        </div>
      </div>

      {/* ── Camera Modal ──────────────────────────────────────────── */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-1)]">Escaner de Camara</h3>
                <p className="text-xs text-[var(--text-3)] mt-0.5">Apunta al codigo de barras</p>
              </div>
              <button
                onClick={stopCamera}
                className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="relative aspect-video bg-black">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              {/* Scanning overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-24 border-2 border-blue-400/60 rounded-lg" />
              </div>
            </div>
            {cameraError && (
              <div className="px-5 py-3 bg-red-500/10 text-sm text-red-400">
                {cameraError}
              </div>
            )}
            <div className="px-5 py-4 text-center">
              <p className="text-xs text-[var(--text-3)]">
                O escribe el codigo manualmente arriba
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Matched Product ───────────────────────────────────────── */}
      {matchedProduct && (
        <div className="bg-[var(--surface)] rounded-xl border-2 border-emerald-500/30 p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider mb-1">Producto encontrado</p>
              <p className="text-lg font-bold text-[var(--text-1)]">{matchedProduct.Text}</p>
            </div>
            <button
              onClick={() => { setMatchedProduct(null); setBarcodeInput(''); inputRef.current?.focus() }}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[var(--border)] text-[var(--text-3)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Action type toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setActionType('entrada')}
              className={`flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
                actionType === 'entrada'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text-2)] hover:border-emerald-500/40'
              }`}
            >
              <Plus size={18} />
              Entrada
            </button>
            <button
              onClick={() => setActionType('salida')}
              className={`flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
                actionType === 'salida'
                  ? 'bg-orange-500 text-white'
                  : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text-2)] hover:border-orange-500/40'
              }`}
            >
              <Minus size={18} />
              Salida
            </button>
          </div>

          {/* Quantity + confirm */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-[var(--text-3)]">Cantidad:</label>
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              className="h-10 w-10 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center text-[var(--text-2)] hover:border-blue-500/40 transition-colors"
            >
              <Minus size={16} />
            </button>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-10 w-20 text-center rounded-lg bg-[var(--bg)] border border-[var(--border)] text-lg font-bold text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button
              onClick={() => setQuantity(q => q + 1)}
              className="h-10 w-10 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center text-[var(--text-2)] hover:border-blue-500/40 transition-colors"
            >
              <Plus size={16} />
            </button>

            <button
              onClick={addToLog}
              className={`ml-auto h-12 px-6 rounded-xl font-semibold text-sm text-white flex items-center gap-2 transition-colors ${
                actionType === 'entrada' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-orange-600 hover:bg-orange-500'
              }`}
            >
              <PackageCheck size={18} />
              Registrar
            </button>
          </div>
        </div>
      )}

      {/* ── No match message ──────────────────────────────────────── */}
      {barcodeInput.length >= 3 && !matchedProduct && (
        <div className="bg-[var(--surface)] rounded-xl border border-orange-500/20 p-5 text-center">
          <p className="text-sm text-orange-400 font-medium">
            No se encontro producto con codigo &quot;{barcodeInput}&quot;
          </p>
          <p className="text-xs text-[var(--text-3)] mt-1">
            Verifica el codigo o agrega el producto al catalogo
          </p>
        </div>
      )}

      {/* ── Running Log ───────────────────────────────────────────── */}
      {scannedItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text-1)]">
              Registro del dia ({scannedItems.length} {scannedItems.length === 1 ? 'movimiento' : 'movimientos'})
            </h3>
            <div className="flex gap-3 text-xs">
              <span className="text-emerald-400 font-medium">+{totalEntradas} entradas</span>
              <span className="text-orange-400 font-medium">-{totalSalidas} salidas</span>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            {scannedItems.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-4 px-4 py-3 bg-[var(--surface)] border-b border-[var(--border)] last:border-b-0"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  item.type === 'entrada' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-orange-500/10 text-orange-400'
                }`}>
                  {item.type === 'entrada' ? <Plus size={16} /> : <Minus size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-1)] truncate">{item.name}</p>
                  <p className="text-xs text-[var(--text-3)]">
                    {item.code} &middot; {item.timestamp}
                  </p>
                </div>
                <div className={`text-sm font-bold tabular-nums ${
                  item.type === 'entrada' ? 'text-emerald-400' : 'text-orange-400'
                }`}>
                  {item.type === 'entrada' ? '+' : '-'}{item.quantity}
                </div>
                <button
                  onClick={() => removeFromLog(item.id)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-[var(--text-3)] hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {scannedItems.length === 0 && !matchedProduct && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] gap-3">
          <ScanBarcode size={40} strokeWidth={1.2} />
          <p className="text-sm">Escanea o escribe un codigo de barras para comenzar</p>
        </div>
      )}

      {/* ── Save Button ───────────────────────────────────────────── */}
      {scannedItems.length > 0 && (
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-12 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center gap-2 transition-colors"
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Save size={18} />
            )}
            {saving ? 'Guardando...' : 'Guardar Movimientos'}
          </button>

          {saveResult === 'ok' && (
            <span className="text-sm text-emerald-400 font-medium">
              Movimientos guardados correctamente
            </span>
          )}
          {saveResult === 'error' && (
            <span className="text-sm text-red-400 font-medium">
              Error al guardar. Intenta de nuevo.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
