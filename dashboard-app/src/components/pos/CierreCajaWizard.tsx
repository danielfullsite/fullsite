'use client'

import { useState, useEffect, useRef } from 'react'
import { Fingerprint, X, ArrowRight, ArrowLeft, Check, AlertTriangle, Printer, DollarSign, ShieldAlert } from 'lucide-react'
import { formatMXN, verifyManagerPinWithRole, verifyManagerHuella, hayHuellasDadasDeAlta, logAudit } from '@/lib/pos-data'
import { hasPermission } from '@/lib/pos-permissions'
import { getActiveClientSlug as _cid } from '@/lib/data'
import {
  closeCachedTurno,
  queueOperation,
  getCachedOrdersByTurno,
  getCachedCashMovsByTurno,
} from '@/lib/pos-offline-db'
import { getPosConfigSync } from '@/lib/pos-config'
import { computeOrderSummary, summaryToArqueoInput, calcEfectivoEsperado } from '@/lib/pos-arqueo'
import {
  filterOpenOrders,
  validateEscalationNota,
  withEscalationPayload,
  openOrderStatusLabel,
  type OpenOrder,
} from '@/lib/pos-cierre-guard'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!


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
  const [cashInput, setCashInput] = useState('')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [managerName, setManagerName] = useState('')
  const [notas, setNotas] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const closingRef = useRef(false)
  // GUARD-08: stable UUID across retries within this wizard session
  const cierreIdRef = useRef<string>(crypto.randomUUID())
  // GUARD-08: open orders check
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([])
  const [openOrdersLoaded, setOpenOrdersLoaded] = useState(false)
  // GUARD-08: manager escalation
  const [escalationActive, setEscalationActive] = useState(false)
  const [escalationPin, setEscalationPin] = useState('')
  const [escalationNota, setEscalationNota] = useState('')
  const [escalationError, setEscalationError] = useState('')
  const [escalationAuthorizedBy, setEscalationAuthorizedBy] = useState<string | null>(null)
  const [escalationSaving, setEscalationSaving] = useState(false)
  const [systemData, setSystemData] = useState({
    efectivo: 0,
    tarjeta: 0,
    transferencias: 0,
    totalVentas: 0,
    ticketsCount: 0,
    cancelaciones: 0,
    descuentos: 0,
    propinas: 0,
    propinaEfectivo: 0,
    propinasNoEfectivo: 0,
    depositos: 0,
    retiros: 0,
  })

  // Fetch system sales data for this shift — IDB-first, Supabase best-effort
  useEffect(() => {
    async function fetchShiftData() {
      let orders: Record<string, unknown>[] = []
      let fromNetwork = false

      // Try Supabase with a hard timeout so degraded LAN doesn't freeze the wizard.
      // Include pagos for accurate split-payment propina attribution.
      try {
        const queryUrl = `${SUPABASE_URL}/rest/v1/pos_orders?select=total,metodo_pago,status,descuento,propina,pagos&client_id=eq.${_cid()}&turno_id=eq.${turnoId}`
        const res = await fetch(queryUrl, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          orders = await res.json()
          fromNetwork = true
        }
      } catch { /* fall through to IDB */ }

      // IDB fallback — use orders already cached for this turno
      if (!fromNetwork) {
        try {
          orders = await getCachedOrdersByTurno(turnoId)
        } catch { /* IDB unavailable */ }
      }

      // Cash movements — Supabase first, IDB fallback
      let cashMovements: { type: string; amount: number }[] = []
      try {
        const movRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_cash_movements?turno_id=eq.${turnoId}&select=type,amount`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: AbortSignal.timeout(4000) }
        )
        if (movRes.ok) cashMovements = await movRes.json()
      } catch { /* fall through */ }

      if (cashMovements.length === 0) {
        try {
          cashMovements = await getCachedCashMovsByTurno(turnoId)
        } catch { /* IDB unavailable */ }
      }

      // Use the shared computeOrderSummary — same logic as Corte page
      const summary = computeOrderSummary(
        orders as unknown as Parameters<typeof computeOrderSummary>[0],
        cashMovements,
      )

      setSystemData({
        efectivo: summary.efectivo,
        tarjeta: summary.tarjeta,
        transferencias: summary.transferencias,
        totalVentas: summary.totalVentas,
        ticketsCount: summary.ticketsCount,
        cancelaciones: summary.cancelaciones,
        descuentos: summary.descuentos,
        propinas: summary.propinas,
        propinaEfectivo: summary.propinaEfectivo,
        propinasNoEfectivo: summary.propinasNoEfectivo,
        depositos: summary.depositos,
        retiros: summary.retiros,
      })
      setDataLoaded(true)

      // GUARD-08: fetch open orders for this turno (best-effort — offline skips guard)
      try {
        const openRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_orders?select=id,mesa,mesero,status,total&client_id=eq.${_cid()}&turno_id=eq.${turnoId}&status=in.(enviada,preparando,lista)`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: AbortSignal.timeout(4000) }
        )
        if (openRes.ok) {
          const raw = await openRes.json()
          setOpenOrders(filterOpenOrders(raw))
        }
      } catch { /* offline — allow close without guard */ }
      setOpenOrdersLoaded(true)

      setLoading(false)
    }
    fetchShiftData()
  }, [turnoId])

  const totalContado = Number(cashInput) || 0
  const { efectivoEsperado, diferencia } = calcEfectivoEsperado(
    summaryToArqueoInput(systemData, fondoInicial),
    totalContado,
  )

  // Huella para cerrar turno. Pedido por Daniel el 2026-08-31 ("tambien para cierre
  // de caja"). La identidad entra por el MISMO embudo que el PIN: se sigue exigiendo
  // `hasPermission(role, 'corte_z')` abajo, asi que la huella no salta el permiso.
  const [huellaDisponible, setHuellaDisponible] = useState(false)
  const [huellaVerificando, setHuellaVerificando] = useState(false)

  useEffect(() => { hayHuellasDadasDeAlta().then(setHuellaDisponible).catch(() => {}) }, [])

  const cerrarConHuella = async () => {
    if (huellaVerificando || closingRef.current || saving) return
    setHuellaVerificando(true)
    setPinError('')
    const g = await verifyManagerHuella('gerente')
    setHuellaVerificando(false)
    if (!g) { setPinError('Huella no reconocida o sin permiso de gerente'); return }
    await handleSave(g)
  }

  /** `identidad` viene de la huella; sin ella se valida el PIN escrito. */
  const handleSave = async (identidad?: { name: string; role: string }) => {
    // Prevent double-tap / concurrent close attempts
    if (closingRef.current || saving) return
    closingRef.current = true
    setSaving(true)
    setPinError('')

    const result = identidad ?? await verifyManagerPinWithRole(pin)
    if (!result) {
      setPinError(identidad ? 'Huella no reconocida' : 'PIN invalido')
      setSaving(false)
      closingRef.current = false
      return
    }
    if (!hasPermission(result.role, 'corte_z')) {
      setPinError(`${identidad ? 'Esta huella' : 'Este PIN'} no tiene permiso para cerrar turno`)
      setSaving(false)
      closingRef.current = false
      return
    }
    const manager = result.name
    setManagerName(manager)

    // Stable UUID — generated once at wizard mount, same across all retries
    const cierreId = cierreIdRef.current
    const now = new Date().toISOString()
    const cierreData = withEscalationPayload(
      {
        id: cierreId,
        client_id: _cid(),
        turno_id: turnoId,
        fecha: now.split('T')[0],
        fondo_inicial: fondoInicial,
        billetes: JSON.stringify({}),
        monedas: JSON.stringify({}),
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
        created_at: now,
      },
      openOrders,
      escalationAuthorizedBy,
      escalationNota.trim() || null,
    )

    const turnoClosePayload = {
      closed_by: manager,
      fondo_final: totalContado,
      efectivo_sistema: efectivoEsperado,
      diferencia,
      closed_at: now,
      notas: notas || null,
    }

    // 1. Close turno in IDB immediately — survives any network failure
    try {
      await closeCachedTurno(turnoId, totalContado, notas || undefined)
    } catch { /* IDB unavailable — continue */ }

    // 2. Enqueue both writes to the durable sync queue
    try {
      await queueOperation('pos_cierres', 'POST', cierreData, undefined, undefined, 'SUPABASE_REST')
      await queueOperation('pos_turnos', 'PATCH', turnoClosePayload, undefined, `pos_turnos?id=eq.${turnoId}`, 'SUPABASE_REST')
    } catch { /* sync queue unavailable — proceed */ }

    // 3. Best-effort Supabase — we don't block onComplete on network
    try {
      const [cierreRes, turnoRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/pos_cierres`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(cierreData),
          signal: AbortSignal.timeout(6000),
        }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_turnos?id=eq.${turnoId}`, {
          method: 'PATCH',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(turnoClosePayload),
          signal: AbortSignal.timeout(6000),
        }),
      ])
      // If both succeeded, the sync queue items will be deduplicated on next sync
      if (!cierreRes.ok || !turnoRes.ok) { /* queued — will sync later */ }
    } catch { /* offline — queued */ }

    // 4. Audit log (best-effort)
    try {
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
    } catch { /* non-blocking */ }

    // 5. Infer salida for staff still clocked in — best-effort
    try {
      const clientId = _cid()
      const attRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_attendance?client_id=eq.${clientId}&order=registered_at.desc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store', signal: AbortSignal.timeout(4000) }
      )
      if (attRes.ok) {
        const events = await attRes.json()
        const latestByStaff = new Map<string, { type: string; staff_name: string }>()
        for (const e of events) {
          if (!latestByStaff.has(e.staff_id)) latestByStaff.set(e.staff_id, { type: e.type, staff_name: e.staff_name })
        }
        const openEntries = [...latestByStaff.entries()].filter(([, v]) => v.type === 'entrada')
        for (const [staffId, { staff_name }] of openEntries) {
          fetch(`${SUPABASE_URL}/rest/v1/pos_attendance`, {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ client_id: clientId, staff_id: staffId, staff_name, type: 'salida', method: 'inferred_cierre' }),
          }).catch(() => {/* queued manually if needed */})
        }
      }
    } catch { /* non-blocking */ }

    // 6. Clear the turnoId from localStorage so next session starts clean
    try { localStorage.removeItem('pos_turno_id') } catch { /* */ }

    // 7. Always complete — the restaurant must be able to close the shift offline
    onComplete()
  }

  // GUARD-08: verify manager PIN + note before allowing close with open orders
  const handleEscalation = async () => {
    setEscalationError('')
    const notaValidation = validateEscalationNota(escalationNota)
    if (!notaValidation.valid) {
      setEscalationError(notaValidation.error!)
      return
    }
    if (!escalationPin || escalationPin.length < 4) {
      setEscalationError('PIN inválido')
      return
    }
    setEscalationSaving(true)
    const result = await verifyManagerPinWithRole(escalationPin)
    if (!result) {
      setEscalationError('PIN inválido')
      setEscalationSaving(false)
      return
    }
    if (!hasPermission(result.role, 'corte_z')) {
      setEscalationError('Este PIN no tiene permiso para autorizar el cierre')
      setEscalationSaving(false)
      return
    }
    setEscalationAuthorizedBy(result.name)
    setEscalationSaving(false)
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
      <h2>${getPosConfigSync().name || 'Restaurante'}</h2>
      <p style="text-align:center;margin:0">${getPosConfigSync().subtitle || ''}</p>
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
      ${systemData.propinaEfectivo > 0 ? `<div class="row"><span>+ Propinas efectivo:</span><span>${formatMXN(systemData.propinaEfectivo)}</span></div>` : ''}
      ${systemData.depositos > 0 ? `<div class="row"><span>+ Depósitos:</span><span>${formatMXN(systemData.depositos)}</span></div>` : ''}
      ${systemData.retiros > 0 ? `<div class="row"><span>- Retiros:</span><span>${formatMXN(systemData.retiros)}</span></div>` : ''}
      ${systemData.propinasNoEfectivo > 0 ? `<div class="row"><span>- Propinas tarj/transf:</span><span>${formatMXN(systemData.propinasNoEfectivo)}</span></div>` : ''}
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
              <p className="text-xs text-[var(--text-3)]">
                {openOrdersLoaded && openOrders.length > 0 && !escalationAuthorizedBy
                  ? 'Verificación previa'
                  : `Paso ${step} de 2`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--line)]">
            <X size={20} className="text-[var(--text-3)]" />
          </button>
        </div>

        {/* GUARD-08: show open-orders screen before letting the wizard proceed */}
        {openOrdersLoaded && openOrders.length > 0 && !escalationAuthorizedBy ? (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <ShieldAlert size={22} className="flex-shrink-0" />
              <div>
                <p className="font-bold">Hay órdenes abiertas en este turno</p>
                <p className="text-xs text-[var(--text-3)] mt-0.5">
                  No puedes cerrar el turno mientras existan órdenes activas.
                </p>
              </div>
            </div>

            {/* Open orders list */}
            <div className="bg-[var(--line)] rounded-xl overflow-hidden">
              <div className="grid grid-cols-4 text-xs text-[var(--text-3)] px-4 py-2 border-b border-[var(--surface-2)]">
                <span>Mesa</span><span>Mesero</span><span>Estado</span><span className="text-right">Total</span>
              </div>
              {openOrders.map((o) => (
                <div key={o.id} className="grid grid-cols-4 text-sm px-4 py-2.5 border-b border-[var(--surface-2)] last:border-0">
                  <span className="font-medium text-[var(--text-1)]">{o.mesa || '—'}</span>
                  <span className="text-[var(--text-2)] truncate">{o.mesero}</span>
                  <span className="text-amber-400 text-xs">{openOrderStatusLabel(o.status)}</span>
                  <span className="text-right font-medium text-[var(--text-1)]">{formatMXN(o.total)}</span>
                </div>
              ))}
            </div>

            {/* Option A */}
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--line)] transition-colors text-sm font-medium"
            >
              Volver al POS y cerrar las órdenes
            </button>

            {/* Option B: manager escalation */}
            {!escalationActive ? (
              <button
                onClick={() => setEscalationActive(true)}
                className="w-full py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors text-sm font-medium flex items-center justify-center gap-2"
              >
                <ShieldAlert size={16} />
                Autorizar cierre con órdenes abiertas (Gerente)
              </button>
            ) : (
              <div className="bg-[var(--line)] rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-amber-400">Autorización de gerente requerida</p>
                <p className="text-xs text-[var(--text-3)]">
                  Las órdenes abiertas quedarán registradas en el cierre. El turno que abra a continuación verá una alerta.
                </p>
                <div>
                  <label className="text-xs text-[var(--text-3)] block mb-1">PIN de gerente</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={10}
                    value={escalationPin}
                    onChange={(e) => { setEscalationPin(e.target.value.replace(/\D/g, '')); setEscalationError('') }}
                    placeholder="PIN"
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-4 py-2.5 text-center text-xl tracking-[0.4em] text-[var(--text-1)] focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] block mb-1">
                    Motivo del cierre (mínimo 10 caracteres)
                  </label>
                  <textarea
                    value={escalationNota}
                    onChange={(e) => { setEscalationNota(e.target.value); setEscalationError('') }}
                    placeholder="Ej: Cliente abandonó la orden. Turno siguiente debe revisar mesa 5."
                    rows={2}
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2 text-sm text-[var(--text-1)] focus:outline-none focus:border-amber-500 resize-none"
                  />
                </div>
                {escalationError && (
                  <p className="text-red-400 text-xs flex items-center gap-1">
                    <AlertTriangle size={12} />
                    {escalationError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEscalationActive(false); setEscalationPin(''); setEscalationNota(''); setEscalationError('') }}
                    className="flex-1 py-2.5 rounded-lg border border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] text-sm transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleEscalation}
                    disabled={escalationSaving || escalationPin.length < 4 || !escalationNota.trim()}
                    className="flex-1 py-2.5 rounded-lg bg-amber-500 text-black font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
                  >
                    {escalationSaving ? (
                      <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin inline-block" />
                    ) : (
                      'Confirmar autorización'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
        {/* Progress bar */}
        <div className="h-1 bg-[var(--line)]">
          <div
            className="h-1 bg-emerald-500 transition-all duration-300"
            style={{ width: `${(step / 2) * 100}%` }}
          />
        </div>

        <div className="p-5">
          {/* Step 1: How much cash? */}
          {step === 1 && (
            <div>
              <h3 className="font-bold text-[var(--text-1)] mb-2">¿Cuánto efectivo hay en caja?</h3>
              <p className="text-sm text-[var(--text-3)] mb-6">Cuenta todo el efectivo (billetes + monedas) y escribe el total.</p>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-[var(--text-3)]">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-[var(--line)] border border-[var(--line)] rounded-xl pl-10 pr-4 py-5 text-3xl font-bold text-center text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="mt-4 text-center text-sm text-[var(--text-3)]">
                Efectivo esperado por el sistema: <span className="text-emerald-400 font-bold">{formatMXN(efectivoEsperado)}</span>
              </div>
            </div>
          )}

          {/* Step 2: Review + Approve (combined old steps 3+4) */}
          {step === 2 && (
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

          {/* Approve section (part of step 2) */}
          {step === 2 && (
            <>
              <div className="mt-6 mb-4">
                <label className="text-sm text-[var(--text-3)] block mb-2">
                  {huellaDisponible ? 'Huella o PIN de gerente para aprobar' : 'PIN de gerente para aprobar'}
                </label>
                {/* El label ya prometia huella desde antes, pero no habia boton: la
                    unica forma de aprobar era el PIN. Reportado por Daniel el
                    2026-08-31 ("tambien para cierre de caja"). */}
                {huellaDisponible && (
                  <>
                    <button
                      onClick={cerrarConHuella}
                      disabled={huellaVerificando || saving}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold py-3 rounded-xl transition-colors mb-3"
                    >
                      <Fingerprint size={20} className={huellaVerificando ? 'animate-pulse' : ''} />
                      {huellaVerificando ? 'Esperando huella...' : 'Aprobar con huella'}
                    </button>
                    <p className="text-xs text-[var(--text-4)] mb-2">o con PIN</p>
                  </>
                )}
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={10}
                  value={pin}
                  onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setPinError('') }}
                  placeholder="PIN"
                  className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-center text-2xl tracking-[0.5em] text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
                />
                {pinError && <p className="text-red-400 text-sm mt-1">{pinError}</p>}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handlePrint}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--line)] transition-colors"
                >
                  <Printer size={18} />
                  Imprimir
                </button>
                <button
                  onClick={() => { void handleSave() }}
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
            </>
          )}
        </div>

        {/* Footer navigation */}
        {step < 2 && (
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
          </>
        )}
      </div>
    </div>
  )
}
