'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, Clock, Loader2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { aMinutos, describirFranja, type Franja, type FilaFranja } from '@/lib/dayparts'

// Horarios de venta: cada restaurante define sus franjas (brunch, lunch, dinner…)
// según SU operación. La IA y los reportes reparten las ventas con esto.

interface FranjaForm { nombre: string; inicio: string; fin: string; alCierre: boolean }
interface Resumen { desde: string; hasta: string; filas: FilaFranja[]; sucursales: { id: string; name: string }[]; error: boolean }

const COLORES = ['#10B981', '#0EA5E9', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#EC4899', '#64748B']
const mxn = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`

function aForm(f: Franja): FranjaForm {
  return { nombre: f.nombre, inicio: f.inicio, fin: f.fin ?? '', alCierre: f.fin === null }
}

export default function HorariosVentaPage() {
  const [franjas, setFranjas] = useState<FranjaForm[]>([])
  const [guardadas, setGuardadas] = useState<Franja[]>([])
  const [esDefault, setEsDefault] = useState(false)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [inicioDia, setInicioDia] = useState('05:00')
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [sucursal, setSucursal] = useState<string>('__todas__')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch('/api/owner/dayparts?resumen=1&dias=30', { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setFranjas(data.config.franjas.map(aForm))
      setGuardadas(data.config.franjas)
      setEsDefault(data.esDefault)
      setPuedeEditar(data.puedeEditar)
      setInicioDia(data.inicioDia)
      setResumen(data.resumen)
    } catch {
      setMsg({ t: 'No se pudieron cargar los horarios', ok: false })
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const guardar = async () => {
    setGuardando(true); setMsg(null)
    try {
      const res = await fetch('/api/owner/dayparts', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franjas: franjas.map(f => ({ nombre: f.nombre, inicio: f.inicio, fin: f.alCierre ? null : f.fin })) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ t: data.error || 'No se pudo guardar', ok: false }); return }
      setMsg({ t: 'Horarios guardados — el histórico ya se recalculó con ellos', ok: true })
      await cargar()
    } finally {
      setGuardando(false)
    }
  }

  const set = (i: number, patch: Partial<FranjaForm>) =>
    setFranjas(fs => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  // ── Vista previa: % por franja con lo que está GUARDADO ─────────────────────
  const barras = useMemo(() => {
    if (!resumen) return null
    const filas = sucursal === '__todas__' ? resumen.filas : resumen.filas.filter(f => f.location_id === sucursal)
    const tot = filas.reduce((s, r) => s + r.venta, 0)
    const com = filas.reduce((s, r) => s + r.venta_comida, 0)
    const keys = [...guardadas.map(g => g.key), '__fuera__']
    return {
      tot, com,
      items: keys.map((k, i) => {
        const rs = filas.filter(f => f.franja === k)
        const v = rs.reduce((s, r) => s + r.venta, 0)
        const c = rs.reduce((s, r) => s + r.venta_comida, 0)
        const o = rs.reduce((s, r) => s + r.ordenes, 0)
        const g = guardadas.find(x => x.key === k)
        return { key: k, nombre: g?.nombre ?? 'Fuera de horario', rango: g ? describirFranja(g) : '', v, c, o, color: g ? COLORES[i % COLORES.length] : '#94A3B8' }
      }).filter(x => x.key !== '__fuera__' || x.v > 0),
    }
  }, [resumen, sucursal, guardadas])

  // Línea de 24h (de inicio de jornada a inicio de jornada) con las franjas.
  const d0 = aMinutos(inicioDia)
  const pos = (hhmm: string) => (((aMinutos(hhmm) - d0 + 1440) % 1440) / 1440) * 100

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Configuración"
        title="Horarios de venta"
        subtitle="Define las franjas de tu operación (brunch, lunch, merienda, dinner… las que uses). Tus reportes y el Chat IA reparten las ventas con estos horarios."
        action={puedeEditar ? (
          <button onClick={guardar} disabled={guardando || cargando}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
          </button>
        ) : undefined}
      />

      {esDefault && !cargando && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm text-[var(--text-1)]">
          Estás viendo horarios genéricos. Ajústalos a tu operación y guarda.
        </div>
      )}
      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${msg.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-[var(--text-1)]' : 'bg-red-500/10 border border-red-500/20 text-red-600'}`}>
          {msg.t}
        </div>
      )}

      {cargando ? (
        <p className="text-center py-12 text-[var(--text-3)] text-sm">Cargando…</p>
      ) : (
        <>
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm p-5 mb-6">
            <div className="relative h-9 rounded-lg bg-[var(--surface-2)] overflow-hidden mb-2">
              {franjas.map((f, i) => {
                if (!f.inicio) return null
                const a = pos(f.inicio)
                const b = f.alCierre || !f.fin ? 100 : pos(f.fin) + 100 / 1440
                return (
                  <div key={i} className="absolute top-0 bottom-0 flex items-center justify-center text-[11px] font-semibold text-white truncate px-1"
                    style={{ left: `${a}%`, width: `${Math.max(0.5, b - a)}%`, background: COLORES[i % COLORES.length] }}>
                    {f.nombre}
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between text-[10.5px] font-mono text-[var(--text-3)] mb-5">
              <span>{inicioDia}</span><span>jornada de 24 h</span><span>{inicioDia}</span>
            </div>

            <div className="space-y-2">
              {franjas.map((f, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="w-3 h-3 rounded-full flex-none" style={{ background: COLORES[i % COLORES.length] }} />
                  <input value={f.nombre} disabled={!puedeEditar} onChange={e => set(i, { nombre: e.target.value })}
                    placeholder="Nombre (ej. Brunch)" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm w-44 bg-transparent" />
                  <input type="time" value={f.inicio} disabled={!puedeEditar} onChange={e => set(i, { inicio: e.target.value })}
                    className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm bg-transparent" />
                  <span className="text-[var(--text-3)] text-sm">a</span>
                  {f.alCierre ? (
                    <span className="px-3 py-2 text-sm text-[var(--text-2)] w-[118px]">cierre</span>
                  ) : (
                    <input type="time" value={f.fin} disabled={!puedeEditar} onChange={e => set(i, { fin: e.target.value })}
                      className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm bg-transparent" />
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
                    <input type="checkbox" checked={f.alCierre} disabled={!puedeEditar} onChange={e => set(i, { alCierre: e.target.checked })} />
                    hasta el cierre
                  </label>
                  {puedeEditar && (
                    <button onClick={() => setFranjas(fs => fs.filter((_, j) => j !== i))}
                      className="ml-auto w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/15 text-red-500 flex items-center justify-center" aria-label="Quitar franja">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {puedeEditar && franjas.length < 8 && (
              <button onClick={() => setFranjas(fs => [...fs, { nombre: '', inicio: '12:00', fin: '15:00', alCierre: false }])}
                className="mt-4 px-3 py-2 rounded-lg border border-dashed border-[var(--line)] text-sm text-[var(--text-2)] flex items-center gap-1.5 hover:bg-[var(--surface-2)]">
                <Plus size={14} /> Agregar franja
              </button>
            )}
            <p className="mt-4 text-xs text-[var(--text-3)] flex items-center gap-1.5">
              <Clock size={12} /> La hora de fin cuenta completa (13:00 incluye 1:00 pm). Tu jornada empieza a las {inicioDia}: lo vendido después de medianoche cuenta en la última franja.
            </p>
          </div>

          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--text-1)]">Cómo se reparte tu venta</h3>
                <p className="text-xs text-[var(--text-3)]">Últimos 30 días{resumen ? ` · ${resumen.desde} a ${resumen.hasta}` : ''} · con los horarios guardados</p>
              </div>
              {resumen && resumen.sucursales.length > 1 && (
                <select value={sucursal} onChange={e => setSucursal(e.target.value)}
                  className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm bg-transparent">
                  <option value="__todas__">Todas las sucursales</option>
                  {resumen.sucursales.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            {!barras || barras.tot === 0 ? (
              <p className="text-sm text-[var(--text-3)] py-6 text-center">
                {resumen?.error ? 'No se pudo calcular (¿falta aplicar la migración?).' : 'Aún no hay órdenes con hora en este periodo.'}
              </p>
            ) : (
              <div className="space-y-3">
                {barras.items.map(b => (
                  <div key={b.key}>
                    <div className="flex items-baseline justify-between text-sm mb-1">
                      <span className="font-medium text-[var(--text-1)]">{b.nombre} <span className="text-xs text-[var(--text-3)] font-normal">{b.rango}</span></span>
                      <span className="font-mono text-[var(--text-1)]">{((b.v / barras.tot) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(b.v / barras.tot) * 100}%`, background: b.color }} />
                    </div>
                    <div className="text-[11.5px] text-[var(--text-3)] mt-1">
                      {mxn(b.v)} · {b.o} órdenes · ticket {mxn(b.o ? b.v / b.o : 0)} · comida {barras.com ? ((b.c / barras.com) * 100).toFixed(1) : '0'}% de toda la comida
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
