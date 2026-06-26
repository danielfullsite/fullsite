'use client'

import { useState, useEffect } from 'react'
import { X, ArrowRight, ArrowLeft, Check, AlertTriangle, Printer, DollarSign } from 'lucide-react'
import { formatMXN, verifyManagerPinWithRole, logAudit } from '@/lib/pos-data'
import { hasPermission } from '@/lib/pos-permissions'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

// Mexican denominations
const BILLETES = [
  { value: 1000, label: '$1,000' },
  { value: 500, label: '$500' },
  { value: 200, label: '$200' },
  { value: 100, label: '$100' },
  { value: 50, label: '$50' },
  { value: 20, label: '$20' },
]

const MONEDAS = [
  { value: 10, label: '$10' },
  { value: 5, label: '$5' },
  { value: 2, label: '$2' },
  { value: 1, label: '$1' },
  { value: 0.5, label: '$0.50' },
]

interface CierreData {
  billetes: Record<number, number>
  monedas: Record<number, number>
  totalContado: number
  efectivoSistema: number
  tarjetaSistema: number
  transferenciasSistema: number
  diferencia: number
  fondoInicial: number
  totalVentas: number
  ticketsCount: number
  cancelaciones: number
  descuentos: number
  propinas: number
}

interface CierreCajaWizardProps {
  turnoId: string
  turnoOpenedAt: string
  fondoInicial: number
  onClose: () => void
  onComplete: () => void
}

export default function CierreCajaWizard({
  turnoId,
  turnoOpenedAt,
  fondoInicial,
  onClose,
  onComplete,
}: CierreCajaWizardProps) {
  const [step, setStep] = useState(1)
  const [billetes, setBilletes] = useState<Record<number, number>>({})
  const [monedas, setMonedas] = useState<Record<number, number>>({})
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [managerName, setManagerName] = useState('')
  const [notas, setNotas] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [systemData, setSystemData] = useState({
    efectivo: 0,
    tarjeta: 0,
    transferencias: 0,
    totalVentas: 0,
    ticketsCount: 0,
    cancelaciones: 0,
    descuentos: 0,
    propinas: 0,
    depositos: 0,
    retiros: 0,
  })

  // Fetch system sales data for this shift
  useEffect(() => {
    async function fetchShiftData() {
      try {
        const queryUrl = `${SUPABASE_URL}/rest/v1/pos_orders?select=total,metodo_pago,status,descuento,propina&client_id=eq.${_cid()}&created_at=gte.${turnoOpenedAt}`
        console.log('[CierreCaja] Fetching orders:', queryUrl)
        console.log('[CierreCaja] turnoOpenedAt:', turnoOpenedAt)
        console.log('[CierreCaja] Using key:', SUPABASE_KEY?.substring(0, 20) + '...')
        const res = await fetch(queryUrl,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
        )
        console.log('[CierreCaja] Response status:', res.status)
        if (res.ok) {
          const orders = await res.json()
          console.log('[CierreCaja] Orders received:', orders.length)
          console.log('[CierreCaja] Orders detail:', JSON.stringify(orders))
          let efectivo = 0, tarjeta = 0, transferencias = 0, totalVentas = 0
          let ticketsCount = 0, cancelaciones = 0, descuentos = 0, propinas = 0

          for (const order of orders) {
            console.log('[CierreCaja] Processing order:', order.status, order.total, order.metodo_pago)
            if (order.status === 'cancelada') {
              cancelaciones++
              continue
            }
            if (order.status === 'cerrada') {
              ticketsCount++
              totalVentas += Number(order.total) || 0
              descuentos += Number(order.descuento) || 0
              propinas += Number(order.propina) || 0

              const method = (order.metodo_pago || '').toLowerCase()
              if (method.includes('efectivo') || method.includes('cash')) {
                efectivo += Number(order.total) || 0
              } else if (method.includes('transferencia')) {
                transferencias += Number(order.total) || 0
              } else {
                tarjeta += Number(order.total) || 0
              }
            }
          }
          console.log('[CierreCaja] Final calc:', { efectivo, tarjeta, transferencias, totalVentas, ticketsCount, cancelaciones })

          // Fetch cash movements (depositos / retiros) for this turno
          let depositos = 0, retiros = 0
          try {
            const movRes = await fetch(
              `${SUPABASE_URL}/rest/v1/pos_cash_movements?turno_id=eq.${turnoId}&select=type,amount`,
              { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
            )
            if (movRes.ok) {
              const movements = await movRes.json()
              for (const m of movements) {
                if (m.type === 'deposito') depositos += Number(m.amount) || 0
                else if (m.type === 'retiro') retiros += Number(m.amount) || 0
              }
            }
          } catch { /* */ }

          setSystemData({ efectivo, tarjeta, transferencias, totalVentas, ticketsCount, cancelaciones, descuentos, propinas, depositos, retiros })
        }
      } catch { /* */ }
      setLoading(false)
    }
    fetchShiftData()
  }, [turnoOpenedAt])

  const totalBilletes = Object.entries(billetes).reduce((sum, [denom, qty]) => sum + (Number(denom) * qty), 0)
  const totalMonedas = Object.entries(monedas).reduce((sum, [denom, qty]) => sum + (Number(denom) * qty), 0)
  const totalContado = totalBilletes + totalMonedas
  const efectivoEsperado = fondoInicial + systemData.efectivo + systemData.depositos - systemData.retiros
  const diferencia = totalContado - efectivoEsperado

  const handleSave = async () => {
    const result = await verifyManagerPinWithRole(pin)
    if (!result) {
      setPinError('PIN invalido')
      return
    }
    if (!hasPermission(result.role, 'corte_z')) {
      setPinError('Este PIN no tiene permiso para cerrar turno')
      return
    }
    const manager = result.name
    setManagerName(manager)
    setPinError('')
    setSaving(true)

    const cierreId = `cierre-${Date.now().toString(36)}`
    const cierreData = {
      id: cierreId,
      client_id: _cid(),
      turno_id: turnoId,
      fecha: new Date().toISOString().split('T')[0],
      fondo_inicial: fondoInicial,
      billetes: JSON.stringify(billetes),
      monedas: JSON.stringify(monedas),
      total_contado: totalContado,
      efectivo_sistema: efectivoEsperado,
      tarjeta_sistema: systemData.tarjeta,
      transferencias_sistema: systemData.transferencias,
      diferencia,
      total_ventas: systemData.totalVentas,
      tickets_count: systemData.ticketsCount,
      cancelaciones: systemData.cancelaciones,
      descuentos: systemData.descuentos,
      propinas: systemData.propinas,
      notas: notas || null,
      closed_by: manager,
      approved_by: manager,
      created_at: new Date().toISOString(),
    }

    try {
      // Save cierre
      const cierreRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_cierres`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(cierreData),
      })
      if (!cierreRes.ok) {
        setPinError(`Error al guardar cierre (${cierreRes.status})`)
        setSaving(false)
        return
      }

      // Close the turno
      const turnoRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_turnos?id=eq.${turnoId}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          closed_by: manager,
          fondo_final: totalContado,
          efectivo_sistema: efectivoEsperado,
          diferencia,
          closed_at: new Date().toISOString(),
          notas: notas || null,
        }),
      })
      if (!turnoRes.ok) {
        setPinError(`Error al cerrar turno (${turnoRes.status}). El cierre se registró pero el turno no se cerró.`)
        setSaving(false)
        return
      }

      // Audit log
      logAudit({
        action: 'status_changed',
        actor: manager,
        details: {
          type: 'cierre_caja',
          cierre_id: cierreId,
          total_contado: totalContado,
          esperado: efectivoEsperado,
          diferencia,
          ventas: systemData.totalVentas,
          tickets: systemData.ticketsCount,
        },
      })

      onComplete()
    } catch {
      setPinError('Error de conexión al guardar cierre')
    }
    setSaving(false)
  }

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=400,height=600')
    if (!printWindow) return
    const now = new Date()
    printWindow.document.write(`
      <html><head><title>Cierre de Caja</title>
      <style>
        body{font-family:monospace;font-size:12px;padding:20px;max-width:300px;margin:0 auto}
        h2{text-align:center;margin:0 0 10px}
        .line{border-top:1px dashed #000;margin:8px 0}
        .row{display:flex;justify-content:space-between;margin:3px 0}
        .total{font-weight:bold;font-size:14px}
        .diff{font-size:16px;font-weight:bold;text-align:center;padding:8px;margin:8px 0;border:2px solid ${diferencia >= 0 ? '#16a34a' : '#dc2626'};color:${diferencia >= 0 ? '#16a34a' : '#dc2626'}}
      </style></head><body>
      <h2>AMALAY</h2>
      <p style="text-align:center;margin:0">Coffee & Market</p>
      <p style="text-align:center;font-size:11px;margin:2px 0 8px">CIERRE DE CAJA</p>
      <p style="text-align:center">${now.toLocaleDateString('es-MX')} ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p>
      <div class="line"></div>
      <p style="font-weight:bold;margin:4px 0">VENTAS POR FORMA DE PAGO</p>
      <div class="row"><span>Efectivo:</span><span>${formatMXN(systemData.efectivo)}</span></div>
      <div class="row"><span>Tarjeta:</span><span>${formatMXN(systemData.tarjeta)}</span></div>
      <div class="row"><span>Transferencia:</span><span>${formatMXN(systemData.transferencias)}</span></div>
      <div class="row total"><span>Total ventas:</span><span>${formatMXN(systemData.totalVentas)}</span></div>
      <div class="line"></div>
      <p style="font-weight:bold;margin:4px 0">CONTROL DE EFECTIVO</p>
      <div class="row"><span>Fondo inicial:</span><span>${formatMXN(fondoInicial)}</span></div>
      <div class="row"><span>+ Ventas efectivo:</span><span>${formatMXN(systemData.efectivo)}</span></div>
      <div class="row"><span>+ Propinas efectivo:</span><span>${formatMXN(systemData.propinas)}</span></div>
      ${systemData.depositos > 0 ? `<div class="row"><span>+ Depósitos:</span><span>${formatMXN(systemData.depositos)}</span></div>` : ''}
      ${systemData.retiros > 0 ? `<div class="row"><span>- Retiros:</span><span>${formatMXN(systemData.retiros)}</span></div>` : ''}
      <div class="row total"><span>= Efectivo esperado:</span><span>${formatMXN(efectivoEsperado)}</span></div>
      <div class="row"><span>Efectivo contado:</span><span>${formatMXN(totalContado)}</span></div>
      <div class="diff">Diferencia: ${diferencia >= 0 ? '+' : ''}${formatMXN(diferencia)}</div>
      <div class="line"></div>
      <p style="font-weight:bold;margin:4px 0">OPERACIÓN</p>
      <div class="row"><span>Tickets:</span><span>${systemData.ticketsCount}</span></div>
      <div class="row"><span>Cancelaciones:</span><span>${systemData.cancelaciones}</span></div>
      <div class="row"><span>Descuentos:</span><span>${formatMXN(systemData.descuentos)}</span></div>
      <div class="row"><span>Propinas:</span><span>${formatMXN(systemData.propinas)}</span></div>
      ${notas ? `<div class="line"></div><p>Notas: ${notas}</p>` : ''}
      <div class="line"></div>
      <p style="text-align:center;font-size:10px">Cerrado por: ${managerName || '---'}</p>
      </body></html>
    `)
    printWindow.document.close()
    printWindow.print()
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2">
      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-3xl max-h-[96vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <DollarSign size={24} className="text-emerald-400" />
            <div>
              <h2 className="text-lg font-bold text-[var(--text-1)]">Cierre de Caja</h2>
              <p className="text-xs text-[var(--text-3)]">Paso {step} de 4</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--line)]">
            <X size={20} className="text-[var(--text-3)]" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-[var(--line)]">
          <div
            className="h-1 bg-emerald-500 transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        <div className="p-5">
          {/* Step 1: Count bills */}
          {step === 1 && (
            <div>
              <h3 className="font-bold text-[var(--text-1)] mb-4">Contar billetes</h3>
              <div className="grid grid-cols-2 gap-3">
                {BILLETES.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-2 bg-[var(--line)] rounded-xl px-4 py-3">
                    <span className="text-sm font-medium text-[var(--text-2)] w-16">{label}</span>
                    <span className="text-[var(--text-3)]">×</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={billetes[value] || ''}
                      onChange={(e) => setBilletes(prev => ({ ...prev, [value]: Number(e.target.value) || 0 }))}
                      placeholder="0"
                      className="flex-1 bg-transparent text-center text-lg font-bold text-[var(--text-1)] focus:outline-none w-16"
                    />
                    {(billetes[value] || 0) > 0 && (
                      <span className="text-xs text-emerald-400 font-medium">
                        {formatMXN(value * (billetes[value] || 0))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 text-right">
                <span className="text-sm text-[var(--text-3)]">Subtotal billetes: </span>
                <span className="text-lg font-bold text-[var(--text-1)]">{formatMXN(totalBilletes)}</span>
              </div>
            </div>
          )}

          {/* Step 2: Count coins */}
          {step === 2 && (
            <div>
              <h3 className="font-bold text-[var(--text-1)] mb-4">Contar monedas</h3>
              <div className="grid grid-cols-2 gap-3">
                {MONEDAS.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-2 bg-[var(--line)] rounded-xl px-4 py-3">
                    <span className="text-sm font-medium text-[var(--text-2)] w-16">{label}</span>
                    <span className="text-[var(--text-3)]">×</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={monedas[value] || ''}
                      onChange={(e) => setMonedas(prev => ({ ...prev, [value]: Number(e.target.value) || 0 }))}
                      placeholder="0"
                      className="flex-1 bg-transparent text-center text-lg font-bold text-[var(--text-1)] focus:outline-none w-16"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 text-right">
                <span className="text-sm text-[var(--text-3)]">Subtotal monedas: </span>
                <span className="text-lg font-bold text-[var(--text-1)]">{formatMXN(totalMonedas)}</span>
              </div>
              <div className="mt-2 text-right">
                <span className="text-sm text-[var(--text-3)]">Total contado: </span>
                <span className="text-xl font-bold text-emerald-400">{formatMXN(totalContado)}</span>
              </div>
            </div>
          )}

          {/* Step 3: System summary & discrepancy */}
          {step === 3 && (
            <div>
              <h3 className="font-bold text-[var(--text-1)] mb-2">Resumen del sistema</h3>

              <div className="space-y-1 mb-3">
                <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--text-3)]">Fondo inicial</span>
                  <span className="text-[var(--text-1)] font-medium">{formatMXN(fondoInicial)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--text-3)]">Ventas en efectivo</span>
                  <span className="text-[var(--text-1)] font-medium">{formatMXN(systemData.efectivo)}</span>
                </div>
                {systemData.depositos > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                    <span className="text-[var(--text-3)]">Depósitos</span>
                    <span className="text-emerald-400 font-medium">+{formatMXN(systemData.depositos)}</span>
                  </div>
                )}
                {systemData.retiros > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                    <span className="text-[var(--text-3)]">Retiros</span>
                    <span className="text-red-400 font-medium">-{formatMXN(systemData.retiros)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--text-3)]">Ventas tarjeta</span>
                  <span className="text-[var(--text-1)] font-medium">{formatMXN(systemData.tarjeta)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--text-3)]">Transferencias</span>
                  <span className="text-[var(--text-1)] font-medium">{formatMXN(systemData.transferencias)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--text-3)]">Tickets cerrados</span>
                  <span className="text-[var(--text-1)] font-medium">{systemData.ticketsCount}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--text-3)]">Cancelaciones</span>
                  <span className="text-red-400 font-medium">{systemData.cancelaciones}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                  <span className="text-[var(--text-3)]">Descuentos</span>
                  <span className="text-amber-400 font-medium">{formatMXN(systemData.descuentos)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[var(--line)] text-lg">
                  <span className="font-bold text-[var(--text-1)]">Total ventas</span>
                  <span className="font-bold text-emerald-400">{formatMXN(systemData.totalVentas)}</span>
                </div>
              </div>

              {/* Discrepancy card */}
              <div className={`rounded-xl p-4 border-2 ${
                Math.abs(diferencia) <= 10
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : Math.abs(diferencia) <= 50
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-[var(--text-3)]">Efectivo esperado</span>
                  <span className="font-medium text-[var(--text-1)]">{formatMXN(efectivoEsperado)}</span>
                </div>
                <div className="flex justify-between mb-3">
                  <span className="text-sm text-[var(--text-3)]">Efectivo contado</span>
                  <span className="font-medium text-[var(--text-1)]">{formatMXN(totalContado)}</span>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-white/10">
                  <span className="font-bold text-[var(--text-1)]">Diferencia</span>
                  <span className={`text-2xl font-bold ${
                    Math.abs(diferencia) <= 10 ? 'text-emerald-400' :
                    Math.abs(diferencia) <= 50 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {diferencia >= 0 ? '+' : ''}{formatMXN(diferencia)}
                  </span>
                </div>
                {Math.abs(diferencia) > 50 && (
                  <div className="flex items-center gap-2 mt-3 text-sm text-red-400">
                    <AlertTriangle size={16} />
                    <span>Diferencia mayor a $50 — requiere explicacion</span>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="mt-4">
                <label className="text-sm text-[var(--text-3)] block mb-1">Notas del cierre (opcional)</label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Ej: Faltaron $20 por error en cambio en mesa 5"
                  rows={2}
                  className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-2 text-[var(--text-1)] text-sm focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 4: Approve & sign */}
          {step === 4 && (
            <div>
              <h3 className="font-bold text-[var(--text-1)] mb-4">Aprobar y firmar</h3>

              <div className="bg-[var(--line)] rounded-xl p-4 mb-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-[var(--text-3)]">Total contado</span>
                    <p className="font-bold text-lg text-[var(--text-1)]">{formatMXN(totalContado)}</p>
                  </div>
                  <div>
                    <span className="text-[var(--text-3)]">Diferencia</span>
                    <p className={`font-bold text-lg ${diferencia >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {diferencia >= 0 ? '+' : ''}{formatMXN(diferencia)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--text-3)]">Total ventas</span>
                    <p className="font-bold text-lg text-emerald-400">{formatMXN(systemData.totalVentas)}</p>
                  </div>
                  <div>
                    <span className="text-[var(--text-3)]">Tickets</span>
                    <p className="font-bold text-lg text-[var(--text-1)]">{systemData.ticketsCount}</p>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="text-sm text-[var(--text-3)] block mb-2">PIN de gerente para aprobar</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setPinError('') }}
                  placeholder="••••"
                  className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-center text-2xl tracking-[0.5em] text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
                />
                {pinError && <p className="text-red-400 text-sm mt-1">{pinError}</p>}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handlePrint}
                  disabled={!pin || pin.length < 4}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--line)] transition-colors disabled:opacity-30"
                >
                  <Printer size={18} />
                  Imprimir
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !pin || pin.length < 4}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <><Check size={18} /> Cerrar turno</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        {step < 4 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--line)]">
            <button
              onClick={() => setStep(s => s - 1)}
              disabled={step === 1}
              className="flex items-center gap-1 text-sm text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30"
            >
              <ArrowLeft size={16} /> Anterior
            </button>
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600"
            >
              Siguiente <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
