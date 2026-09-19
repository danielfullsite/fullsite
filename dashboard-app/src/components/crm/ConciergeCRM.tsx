'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, CheckCircle2, Clock3, Download, FileCheck2,
  Loader2, MessageCircle, Search, Sparkles, TicketCheck, Upload,
  UserRoundCheck, Users, XCircle,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'
import { getActiveClientSlug } from '@/lib/data'
import { generateDinnerCampaignMessage, generateWhatsAppLink } from '@/lib/whatsapp-crm'
import { normalizeMexicanPhone, parseContactUpload, type ImportedContact } from '@/lib/contact-import'
import WhatsAppAutomationPanel from '@/components/crm/WhatsAppAutomationPanel'
import WhatsAppOperationsStrip from '@/components/crm/WhatsAppOperationsStrip'
import {
  campaignEconomics, normalizeReservationStatus, requestedWithinDays, reservationMetrics,
  revenueProjection, segmentFromLastVisit, type ReactivationSegment,
  type ReservationRecord,
} from '@/lib/reservation-crm'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function headers() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
}

const statusMeta = {
  created: { label: 'Creada', className: 'bg-indigo-500/12 text-indigo-400 border-indigo-500/20' },
  completed: { label: 'Completada', className: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/20' },
  cancelled: { label: 'Cancelada', className: 'bg-rose-500/12 text-rose-400 border-rose-500/20' },
  no_show: { label: 'No show', className: 'bg-amber-500/12 text-amber-400 border-amber-500/20' },
} as const

function displayDate(value?: string | null, includeTime = false) {
  if (!value) return '—'
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-MX', includeTime
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function downloadReservations(rows: ReservationRecord[]) {
  const columns: Array<[string, keyof ReservationRecord]> = [
    ['Huésped', 'nombre'], ['Teléfono', 'telefono'], ['Solicitada', 'created_at'],
    ['Visita', 'fecha'], ['Hora', 'horario_inicio'], ['Personas', 'guests'],
    ['Área', 'espacio'], ['Estado', 'status'],
  ]
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [columns.map(([label]) => escape(label)).join(','), ...rows.map(row =>
    columns.map(([, key]) => escape(row[key])).join(','),
  )].join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `reservaciones-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ReservationsView() {
  const [rows, setRows] = useState<ReservationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | keyof typeof statusMeta>('all')
  const [averageTicket, setAverageTicket] = useState(500)
  const client = getActiveClientSlug()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fields = 'id,codigo_reserva,nombre,telefono,fecha,espacio,horario_inicio,guests,total,status,created_at,updated_at'
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/reservaciones?client_id=eq.${encodeURIComponent(client)}&select=${fields}&order=created_at.desc&limit=1000`,
        { headers: headers(), cache: 'no-store' },
      )
      if (!response.ok) throw new Error(`Reservaciones ${response.status}`)
      setRows(await response.json())
    } catch (error) {
      console.error('[CRM reservations]', error)
    } finally {
      setLoading(false)
    }
  }, [client])

  // Data fetching is intentionally triggered on tenant changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const periodRows = useMemo(() => rows.filter(row => requestedWithinDays(row, days)), [rows, days])
  const visibleRows = useMemo(() => periodRows.filter(row => {
    const normalized = normalizeReservationStatus(row.status)
    if (status !== 'all' && normalized !== status) return false
    if (!search.trim()) return true
    const needle = search.toLowerCase()
    return [row.nombre, row.telefono, row.codigo_reserva, row.espacio]
      .some(value => String(value || '').toLowerCase().includes(needle))
  }), [periodRows, search, status])
  const metrics = useMemo(() => reservationMetrics(periodRows), [periodRows])
  const revenue = useMemo(() => revenueProjection(periodRows, averageTicket), [periodRows, averageTicket])

  const visitDays = useMemo(() => {
    const grouped = new Map<string, { reservations: number; guests: number }>()
    for (const row of periodRows) {
      if (!row.fecha) continue
      const current = grouped.get(row.fecha) || { reservations: 0, guests: 0 }
      current.reservations += 1
      current.guests += Number(row.guests) || 0
      grouped.set(row.fecha, current)
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14)
  }, [periodRows])

  const maxDayGuests = Math.max(1, ...visitDays.map(([, value]) => value.guests))
  const statusRows = [
    ['created', metrics.future, metrics.futureGuests],
    ['completed', metrics.completed, metrics.completedGuests],
    ['cancelled', metrics.cancelled, metrics.cancelledGuests],
    ['no_show', metrics.noShow, metrics.noShowGuests],
  ] as const

  return (
    <div>
      <PageHeader
        eyebrow={`CRM · ${client.toUpperCase()}`}
        title="Reservas & Concierge"
        subtitle="La operación de Revvia, integrada al CRM de Fullsite y conectada a tus reservaciones."
        action={(
          <div className="flex gap-2">
            <button onClick={() => downloadReservations(visibleRows)} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]">
              <Download size={14} /> Exportar CSV
            </button>
            <button onClick={load} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Actualizar</button>
          </div>
        )}
      />

      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-2)] p-1">
          {[7, 30, 90].map(value => (
            <button key={value} onClick={() => setDays(value)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${days === value ? 'bg-[var(--bg)] text-[var(--text-1)] shadow-sm' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>{value}d</button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-4)]">Solicitudes de los últimos {days} días · {periodRows.length} movimientos</span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard label="Reservaciones" value={String(metrics.reservations)} subtitle={`${metrics.guests} personas`} icon={TicketCheck} accentClass="kpi-accent-blue" />
        <KPICard label="Personas" value={String(metrics.guests)} subtitle="en el periodo" icon={Users} accentClass="kpi-accent-purple" index={1} />
        <KPICard label="Grupo promedio" value={metrics.averageParty.toFixed(1)} subtitle="personas" icon={UserRoundCheck} accentClass="kpi-accent-amber" index={2} />
        <KPICard label="Completadas" value={String(metrics.completed)} subtitle={`${metrics.completedGuests} personas`} icon={CheckCircle2} accentClass="kpi-accent-green" index={3} />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.14em] text-[var(--text-4)]">Resumen del periodo</p>
              <h3 className="mt-1 text-lg font-bold text-[var(--text-1)]">Estado de reservaciones</h3>
            </div>
            <Sparkles size={18} className="text-emerald-400" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statusRows.map(([key, count, guests]) => {
              const meta = statusMeta[key]
              const percent = metrics.reservations ? Math.round(count / metrics.reservations * 100) : 0
              return <button key={key} onClick={() => setStatus(status === key ? 'all' : key)} className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 ${meta.className} ${status === key ? 'ring-2 ring-current/30' : ''}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider">{meta.label}</p>
                <p className="mt-2 text-2xl font-black">{count}</p>
                <p className="mt-1 text-[11px] opacity-70">{percent}% · {guests} personas</p>
              </button>
            })}
          </div>
          <p className="mt-4 text-xs text-[var(--text-4)]">{metrics.modified} reservación{metrics.modified === 1 ? '' : 'es'} modificada{metrics.modified === 1 ? '' : 's'} después de crearse.</p>
        </section>

        <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-[var(--surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.14em] text-emerald-400">Ingreso potencial</p>
              <p className="mt-2 text-3xl font-black text-[var(--text-1)]">{formatCurrency(revenue.potential)}</p>
            </div>
            <label className="text-right text-[10px] uppercase tracking-wider text-[var(--text-4)]">
              Ticket por persona
              <input type="number" min="0" step="50" value={averageTicket} onChange={event => setAverageTicket(Math.max(0, Number(event.target.value) || 0))} className="mt-1 block w-28 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-right text-sm font-bold text-[var(--text-1)] outline-none focus:border-emerald-500/50" />
            </label>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 text-xs">
            <div><p className="text-[var(--text-4)]">Generado</p><p className="mt-1 font-bold text-emerald-400">{formatCurrency(revenue.generated)}</p><p className="text-[10px] text-[var(--text-4)]">{revenue.completedGuests} personas</p></div>
            <div><p className="text-[var(--text-4)]">Proyectado</p><p className="mt-1 font-bold text-indigo-400">{formatCurrency(revenue.projected)}</p><p className="text-[10px] text-[var(--text-4)]">{revenue.futureGuests} personas</p></div>
          </div>
        </section>
      </div>

      <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar huésped, teléfono, código o área…" className="w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-1)] outline-none focus:border-emerald-500/50" />
          </div>
          <select value={status} onChange={event => setStatus(event.target.value as typeof status)} className="rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text-2)] outline-none">
            <option value="all">Todos los estados</option>
            {Object.entries(statusMeta).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="text-[10px] uppercase tracking-[.13em] text-[var(--text-4)]"><tr>{['Huésped', 'Solicitada', 'Visita', 'Personas', 'Hora', 'Área', 'Estado'].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {visibleRows.map(row => {
                const normalized = normalizeReservationStatus(row.status)
                return <tr key={row.id} className="text-sm hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3"><p className="font-semibold text-[var(--text-1)]">{row.nombre || 'Sin nombre'}</p><p className="mt-0.5 font-mono text-[11px] text-[var(--text-4)]">{row.telefono || row.codigo_reserva || '—'}</p></td>
                  <td className="px-4 py-3 text-[var(--text-3)]">{displayDate(row.created_at, true)}</td>
                  <td className="px-4 py-3 font-medium text-[var(--text-2)]">{displayDate(row.fecha)}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-2)]">{row.guests || 0}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-2)]">{row.horario_inicio?.slice(0, 5) || '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-3)]">{row.espacio || '—'}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${statusMeta[normalized].className}`}>{statusMeta[normalized].label}</span></td>
                </tr>
              })}
            </tbody>
          </table>
          {!loading && visibleRows.length === 0 && <div className="px-6 py-12 text-center text-sm text-[var(--text-4)]">No hay reservaciones para estos filtros.</div>}
          {loading && <div className="px-6 py-12 text-center text-sm text-[var(--text-4)]">Cargando reservaciones…</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="mb-5 flex items-center gap-2"><CalendarDays size={17} className="text-emerald-400" /><h3 className="font-bold text-[var(--text-1)]">Calendario por fecha de visita</h3></div>
        {visitDays.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {visitDays.map(([date, value]) => <div key={date} className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
            <div className="absolute inset-x-0 bottom-0 bg-emerald-500/10" style={{ height: `${Math.max(8, value.guests / maxDayGuests * 100)}%` }} />
            <div className="relative"><p className="text-[10px] uppercase text-[var(--text-4)]">{displayDate(date)}</p><p className="mt-3 text-xl font-black text-[var(--text-1)]">{value.reservations}</p><p className="text-[10px] text-[var(--text-3)]">{value.guests} personas</p></div>
          </div>)}
        </div> : <p className="py-8 text-center text-sm text-[var(--text-4)]">El calendario aparecerá cuando existan visitas en el periodo.</p>}
      </section>
    </div>
  )
}

interface CRMGuest {
  id: number
  name: string
  phone: string | null
  last_visit: string | null
  total_visits: number
  avg_ticket: number
  tags?: string[]
}

const segmentMeta: Record<ReactivationSegment, { label: string; range: string; incentive: string; tone: string }> = {
  recent: { label: 'Reciente', range: '0–30 días', incentive: 'Sin incentivo', tone: 'text-emerald-400' },
  active: { label: 'Activo', range: '31–90 días', incentive: 'Detalle de cortesía', tone: 'text-blue-400' },
  warm: { label: 'Tibio', range: '91–179 días', incentive: 'Bebida de cortesía', tone: 'text-amber-400' },
  inactive: { label: 'Inactivo', range: '180+ días', incentive: 'Beneficio de regreso', tone: 'text-rose-400' },
}

export function ReactivationView() {
  const [guests, setGuests] = useState<CRMGuest[]>([])
  const [loading, setLoading] = useState(true)
  const [stagedContacts, setStagedContacts] = useState<ImportedContact[]>([])
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [segment, setSegment] = useState<ReactivationSegment>('inactive')
  const [incentive, setIncentive] = useState('una botella de vino tinto de 375 ml')
  const [validDays, setValidDays] = useState('jueves a sábado a partir de las 7:00 p.m.; consumo mínimo de $430 MXN por persona')
  const [providerReady, setProviderReady] = useState(false)
  const [sendingId, setSendingId] = useState<number | null>(null)
  const client = getActiveClientSlug()

  const loadGuests = useCallback(async () => {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers?client_id=eq.${encodeURIComponent(client)}&select=id,name,phone,last_visit,total_visits,avg_ticket,tags&order=last_visit.asc.nullsfirst&limit=1000`, { headers: headers(), cache: 'no-store' })
      if (!response.ok) throw new Error(`Clientes ${response.status}`)
      setGuests(await response.json())
    } catch (error) { console.error('[CRM reactivation]', error) }
    finally { setLoading(false) }
  }, [client])

  useEffect(() => {
    // Data fetching is intentionally triggered on tenant changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGuests()
    fetch('/api/crm/whatsapp/status').then(response => response.ok ? response.json() : null)
      .then(status => setProviderReady(Boolean(status?.enabled && status?.configured)))
      .catch(() => setProviderReady(false))
  }, [loadGuests])

  const segmented = useMemo(() => {
    const result: Record<ReactivationSegment, CRMGuest[]> = { recent: [], active: [], warm: [], inactive: [] }
    guests.forEach(guest => result[segmentFromLastVisit(guest.last_visit)].push(guest))
    return result
  }, [guests])
  const selected = segmented[segment].filter(guest => guest.phone)

  const readContactFile = async (file?: File) => {
    if (!file) return
    setImportMessage('')
    const parsed = await parseContactUpload(file)
    const existing = new Set(guests.map(guest => normalizeMexicanPhone(guest.phone || '')).filter(Boolean))
    const fresh = parsed.filter(contact => !existing.has(contact.phone))
    setStagedContacts(fresh)
    setImportMessage(parsed.length
      ? `${parsed.length} contactos detectados; ${fresh.length} son nuevos.`
      : 'No encontré una columna de teléfono válida en el archivo.')
  }

  const importContacts = async () => {
    if (!stagedContacts.length) return
    setImporting(true)
    setImportMessage('Guardando contactos…')
    try {
      const body = stagedContacts.map(contact => ({
        name: contact.name,
        phone: contact.phone,
        email: contact.email || null,
        last_visit: contact.lastVisit || null,
        total_visits: contact.totalVisits || 0,
        birthday: contact.birthday || null,
        tags: ['brunch', contact.source === 'xlsx' ? 'amalay-export' : 'iphone-alay', 'optin-pendiente'],
        notes: 'Importado para campaña de cenas de Amalay; consentimiento de WhatsApp pendiente.',
      }))
      const batchSize = 400
      for (let index = 0; index < body.length; index += batchSize) {
        const path = encodeURIComponent('pos_customers?on_conflict=client_id,phone')
        const response = await fetch(`/api/pos/db?path=${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(body.slice(index, index + batchSize)),
        })
        if (!response.ok) throw new Error(`Importación ${response.status}`)
        setImportMessage(`Guardando contactos… ${Math.min(index + batchSize, body.length).toLocaleString('es-MX')} de ${body.length.toLocaleString('es-MX')}`)
      }
      setImportMessage(`${stagedContacts.length} contactos agregados al CRM de ${client.toUpperCase()}.`)
      setStagedContacts([])
      await loadGuests()
    } catch (error) {
      console.error('[CRM contact import]', error)
      setImportMessage('No se pudieron guardar. Revisa el formato o inténtalo de nuevo.')
    } finally { setImporting(false) }
  }

  const openWhatsApp = (guest: CRMGuest) => {
    if (!guest.phone || !guest.tags?.includes('whatsapp-optin')) return
    const message = generateDinnerCampaignMessage({ clientName: guest.name, phone: guest.phone, incentive, restaurantName: client.toUpperCase(), validDays })
    window.open(generateWhatsAppLink(guest.phone, message), '_blank', 'noopener,noreferrer')
  }

  const sendWhatsApp = async (guest: CRMGuest) => {
    if (!providerReady) return openWhatsApp(guest)
    if (!window.confirm(`Enviar ahora la plantilla aprobada de Amalay a ${guest.name}?`)) return
    setSendingId(guest.id)
    try {
      const response = await fetch('/api/crm/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: guest.id }),
      })
      const result = await response.json()
      setImportMessage(response.ok ? `Mensaje de WhatsApp en cola para ${guest.name}.` : result.error || 'No se pudo enviar el mensaje.')
    } finally { setSendingId(null) }
  }

  const registerOptIn = async (guest: CRMGuest) => {
    if (!window.confirm(`Confirma que ${guest.name} autorizó expresamente recibir promociones por WhatsApp.`)) return
    const response = await fetch('/api/crm/consent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: guest.id }),
    })
    const result = await response.json()
    if (response.ok) setGuests(current => current.map(item => item.id === guest.id ? { ...item, tags: result.tags } : item))
    else setImportMessage(result.error || 'No se pudo registrar el consentimiento.')
  }

  return <div>
    <PageHeader
      eyebrow={`CRM · ${client.toUpperCase()}`}
      title="Reactivación por WhatsApp"
      subtitle="Importa la agenda de Alay, segmenta por última visita y convierte clientes de brunch en cenas."
      action={<label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--surface-2)]">
        <Upload size={14} /> Importar contactos
        <input type="file" accept=".vcf,.csv,.xlsx,text/vcard,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={event => { readContactFile(event.target.files?.[0]); event.target.value = '' }} />
      </label>}
    />

    {importMessage && <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/8 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><FileCheck2 size={18} className="shrink-0 text-blue-400" /><div><p className="text-sm font-semibold text-[var(--text-1)]">Agenda de Alay</p><p className="text-xs text-[var(--text-3)]">{importMessage}</p></div></div>
      {stagedContacts.length > 0 && <button onClick={importContacts} disabled={importing} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50">
        {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Agregar {stagedContacts.length} al CRM
      </button>}
    </div>}

    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {(Object.keys(segmentMeta) as ReactivationSegment[]).map(key => {
        const meta = segmentMeta[key]
        return <button key={key} onClick={() => setSegment(key)} className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${segment === key ? 'border-emerald-500/40 bg-emerald-500/8 ring-2 ring-emerald-500/10' : 'border-[var(--line)] bg-[var(--surface)]'}`}>
          <p className={`text-xs font-bold uppercase tracking-wider ${meta.tone}`}>{meta.label}</p>
          <p className="mt-2 text-3xl font-black text-[var(--text-1)]">{segmented[key].length}</p>
          <p className="mt-1 text-[11px] text-[var(--text-4)]">{meta.range} · {meta.incentive}</p>
        </button>
      })}
    </div>

    <WhatsAppOperationsStrip />
    <WhatsAppAutomationPanel segment={segment} audienceSize={selected.length} />

    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center gap-2"><MessageCircle size={17} className="text-emerald-400" /><h3 className="font-bold text-[var(--text-1)]">Mensaje de regreso</h3></div>
        <label className="block text-xs text-[var(--text-3)]">Incentivo<input value={incentive} onChange={event => setIncentive(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text-1)] outline-none focus:border-emerald-500/50" /></label>
        <label className="mt-4 block text-xs text-[var(--text-3)]">Vigencia<input value={validDays} onChange={event => setValidDays(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text-1)] outline-none focus:border-emerald-500/50" /></label>
        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-4 text-sm leading-6 text-[var(--text-2)]">
          <p className="whitespace-pre-line">{generateDinnerCampaignMessage({ clientName: 'Nombre', phone: '', incentive, restaurantName: client.toUpperCase(), validDays })}</p>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-[var(--text-4)]">Fullsite abre WhatsApp con el texto listo. Solo se habilita para contactos cuyo consentimiento de marketing esté registrado.</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] p-4"><div><h3 className="font-bold text-[var(--text-1)]">{segmentMeta[segment].label}</h3><p className="text-xs text-[var(--text-4)]">{selected.length} contactos con WhatsApp disponible</p></div><Clock3 size={17} className={segmentMeta[segment].tone} /></div>
        <div className="max-h-[520px] divide-y divide-[var(--line-soft)] overflow-y-auto">
          {selected.map(guest => {
            const hasOptIn = guest.tags?.includes('whatsapp-optin')
            return <div key={guest.id} className="flex items-center gap-3 p-4 hover:bg-[var(--surface-2)]">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-sm font-black text-[var(--text-2)]">{guest.name.charAt(0).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[var(--text-1)]">{guest.name}</p><p className="mt-0.5 text-[11px] text-[var(--text-4)]">Última visita {displayDate(guest.last_visit)} · {guest.total_visits || 0} visitas</p></div>
            {hasOptIn
              ? <button onClick={() => sendWhatsApp(guest)} disabled={sendingId === guest.id} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{sendingId === guest.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}<span className="hidden sm:inline">{providerReady ? 'Enviar plantilla' : 'Abrir WhatsApp'}</span></button>
              : <button onClick={() => registerOptIn(guest)} title="Confirma que el cliente autorizó recibir promociones por WhatsApp" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/15"><CheckCircle2 size={14} /><span className="hidden sm:inline">Registrar permiso</span></button>}
          </div>})}
          {!loading && selected.length === 0 && <div className="px-6 py-12 text-center"><XCircle size={28} className="mx-auto mb-2 text-[var(--text-4)]" /><p className="text-sm text-[var(--text-3)]">No hay contactos con teléfono en este segmento.</p></div>}
          {loading && <div className="px-6 py-12 text-center text-sm text-[var(--text-4)]">Segmentando huéspedes…</div>}
        </div>
      </section>
    </div>
  </div>
}

export function MonthlyCampaignReport() {
  const [inputs, setInputs] = useState({
    contacts: 1000,
    responses: 150,
    reservations: 40,
    attended: 25,
    averageTicket: 480,
    foodCostRate: 30,
    monthlyFee: 1500,
    seatedFee: 320,
    courtesyUnits: 4,
    courtesyUnitCost: 160.33,
  })
  const report = campaignEconomics({ ...inputs, foodCostRate: inputs.foodCostRate / 100 })
  const update = (key: keyof typeof inputs, value: number) => setInputs(current => ({ ...current, [key]: Math.max(0, value || 0) }))
  const month = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date())
  const funnel = [
    ['Contactados', inputs.contacts, 1],
    ['Respondieron', inputs.responses, report.responseRate],
    ['Reservaron', inputs.reservations, report.reservationRate],
    ['Asistieron', inputs.attended, report.attendanceRate],
  ] as const

  return <div>
    <PageHeader
      eyebrow="CRM · AMALAY"
      title="Reporte mensual de campaña"
      subtitle="Una sola página para demostrar ventas, costos y utilidad incremental."
      action={<button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500"><Download size={14} /> Guardar como PDF</button>}
    />

    <div className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 print:hidden">
      <p className="mb-3 text-sm font-bold text-[var(--text-1)]">Datos del mes</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([
          ['contacts', 'Contactados'], ['responses', 'Respondieron'], ['reservations', 'Reservaron'],
          ['attended', 'Asistieron'], ['averageTicket', 'Ticket promedio'],
          ['foodCostRate', 'Costo comida %'], ['monthlyFee', 'Fee mensual'], ['seatedFee', 'Fee sentados'],
          ['courtesyUnits', 'Botellas'], ['courtesyUnitCost', 'Costo por botella'],
        ] as Array<[keyof typeof inputs, string]>).map(([key, label]) => <label key={key} className="text-[11px] text-[var(--text-3)]">{label}<input type="number" min="0" step={key === 'courtesyUnitCost' ? '0.01' : '1'} value={inputs[key]} onChange={event => update(key, Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-2 text-sm font-semibold text-[var(--text-1)] outline-none focus:border-emerald-500/50" /></label>)}
      </div>
    </div>

    <article className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[#f4f5f1] text-[#10231c] shadow-[var(--shadow-soft)] print:rounded-none print:border-0 print:shadow-none">
      <header className="flex items-start justify-between border-b border-[#ccd4ce] px-6 py-5 sm:px-8">
        <div><p className="text-2xl font-black tracking-tight">fullsite<span className="text-emerald-600">.</span></p><p className="mt-1 text-[10px] font-semibold tracking-[.14em] text-[#65736c]">RESTAURANT REVENUE INTELLIGENCE</p></div>
        <div className="text-right"><p className="text-[10px] font-bold tracking-[.13em] text-[#65736c]">REPORTE DE DESEMPEÑO</p><h2 className="mt-1 text-xl font-black">Amalay</h2><p className="capitalize text-xs text-[#65736c]">{month}</p></div>
      </header>

      <div className="grid grid-cols-2 border-b border-[#ccd4ce] md:grid-cols-5">
        {[
          ['Comensales generados', String(inputs.attended)],
          ['Ventas atribuidas', formatCurrency(report.revenue)],
          ['Utilidad incremental', formatCurrency(report.incrementalProfit)],
          ['Margen incremental', `${(report.margin * 100).toFixed(1)}%`],
          ['ROI de campaña', `${report.roi.toFixed(2)}x`],
        ].map(([label, value], index) => <div key={label} className={`px-5 py-5 ${index > 0 ? 'border-l border-[#ccd4ce]' : ''}`}><p className="text-[10px] font-semibold text-[#65736c]">{label}</p><p className="mt-2 text-2xl font-black tabular-nums">{value}</p></div>)}
      </div>

      <div className="grid border-b border-[#ccd4ce] lg:grid-cols-[1.1fr_1fr_1fr]">
        <section className="p-6 sm:p-6">
          <h3 className="text-xs font-black">Embudo de la campaña</h3>
          <div className="mt-5 flex items-center">
            {funnel.map(([label, value, rate], index) => <div key={label} className="flex min-w-0 flex-1 items-center"><div className="min-w-0 flex-1"><p className="text-[9px] text-[#65736c]">{label}</p><p className="mt-1 text-lg font-black">{value.toLocaleString('es-MX')}</p><p className="text-[9px] text-[#65736c]">{(rate * 100).toFixed(index === 0 ? 0 : 1)}%</p></div>{index < funnel.length - 1 && <span className="mr-2 text-[#97a39c]">→</span>}</div>)}
          </div>
        </section>
        <section className="border-t border-[#ccd4ce] p-5 lg:border-l lg:border-t-0">
          <h3 className="text-xs font-black">Desglose de costos</h3>
          <dl className="mt-4 space-y-2 text-[11px]">{[
            ['Costo de comida', report.foodCost], ['Fee mensual Fullsite', inputs.monthlyFee],
            ['Fee por personas sentadas', inputs.seatedFee], ['Botellas de cortesía', report.courtesyCost],
          ].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-3"><dt className="text-[#65736c]">{label}</dt><dd className="font-bold">{formatCurrency(Number(value))}</dd></div>)}<div className="flex justify-between border-t border-[#ccd4ce] pt-2"><dt className="font-bold">Costo total</dt><dd className="font-black">{formatCurrency(report.totalCost)}</dd></div></dl>
        </section>
        <section className="border-t border-[#ccd4ce] p-5 lg:border-l lg:border-t-0">
          <h3 className="text-xs font-black">Resultado financiero</h3>
          <dl className="mt-4 space-y-2 text-[11px]"><div className="flex justify-between"><dt className="text-[#65736c]">Ventas atribuidas</dt><dd className="font-bold">{formatCurrency(report.revenue)}</dd></div><div className="flex justify-between"><dt className="text-[#65736c]">Costo total</dt><dd className="font-bold">({formatCurrency(report.totalCost)})</dd></div><div className="flex justify-between border-t border-[#ccd4ce] pt-2"><dt className="font-bold">Utilidad incremental</dt><dd className="font-black text-emerald-700">{formatCurrency(report.incrementalProfit)}</dd></div></dl>
        </section>
      </div>

      <div className="grid md:grid-cols-[1fr_1fr_1fr_1.4fr]">
        {[
          ['Costo de adquisición', formatCurrency(report.acquisitionCost)],
          ['Margen bruto por comensal', formatCurrency(report.grossMarginPerGuest)],
          ['Inversión de campaña', formatCurrency(report.campaignInvestment)],
        ].map(([label, value]) => <div key={label} className="border-b border-[#ccd4ce] p-5 md:border-b-0 md:border-r"><p className="text-[9px] text-[#65736c]">{label}</p><p className="mt-2 text-xl font-black">{value}</p></div>)}
        <div className="bg-[#073f2d] p-5 text-white"><p className="text-[10px] text-emerald-200">El resultado</p><p className="mt-2 text-xl font-black leading-tight">Más personas.<br />Más momentos.<br /><span className="text-emerald-300">Más crecimiento.</span></p></div>
      </div>
    </article>
    <p className="mt-4 text-xs text-[var(--text-4)] print:hidden">El reporte ya reproduce el modelo de las fotos. La automatización del envío se activa cuando conectemos el número oficial y registremos eventos de entrega, respuesta, reserva y asistencia.</p>
  </div>
}
