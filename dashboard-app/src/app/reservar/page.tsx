'use client'

import { useState, useMemo } from 'react'
import { Calendar, Users, MapPin, Clock, ChefHat, CreditCard, Check, ArrowRight, ArrowLeft, Phone, User, AlertTriangle, Cake } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3
type EspacioId = 'terraza' | 'jardin' | 'salon' | ''

interface FormData {
  nombre: string
  telefono: string
  fecha: string
  espacio: EspacioId
  horario_inicio: string
  horario_fin: string
  guests: number
  paquete: string
  platoFuerte: string
  postre: boolean
  deco: string
  notas: string
}

// ── Config: Espacios reales de AMALAY ────────────────────────────────────────
const ESPACIOS = [
  {
    id: 'terraza' as const,
    name: 'Terraza privada con balcon',
    icon: '🌿',
    min: 10, max: 24,
    desc: 'Segundo piso · Sin renta · Solo consumo + 18% servicio',
    available: 'Disponible todo el dia',
  },
  {
    id: 'jardin' as const,
    name: 'Jardin interior privado',
    icon: '🌳',
    min: 25, max: 44,
    desc: 'Rodeado de vegetacion · Intimo y exclusivo',
    available: 'Disponible desde las 2:30pm',
  },
  {
    id: 'salon' as const,
    name: 'Salon interior',
    icon: '🏛️',
    min: 45, max: 50,
    desc: 'A partir de 2:30pm · Comidas, meriendas y cenas',
    available: 'Disponible desde las 2:30pm',
  },
]

// ── Config: Paquetes reales — todos $480/pp ──────────────────────────────────
const PAQUETES = [
  {
    id: 'Brunch',
    name: 'Brunch',
    price: 480,
    horario: '8:00am — 1:30pm',
    includes: 'Plato de fruta mixta + plato fuerte a elegir + bebidas refill (cafe, te, limonada natural, pepino, frutos rojos, mineral o jamaica)',
    options: [
      { name: 'Avo Toast con huevo pochado', img: null },
      { name: 'Chilaquiles verdes con pollo', img: null },
      { name: 'Enchiladas suizas', img: null },
    ],
  },
  {
    id: 'Merienda / Cena',
    name: 'Merienda / Cena',
    price: 480,
    horario: 'A partir de 1:30pm',
    includes: 'Plato fuerte a elegir + bebidas refill (cafe, te, limonada natural, pepino, frutos rojos, mineral o jamaica)',
    options: [
      { name: '1/2 Ensalada Amalay + 1/2 Panini a eleccion + 1/2 Sopa tomate + postre', img: null },
      { name: '4 Enchiladas suizas + postre', img: null },
      { name: '3 Taquitos Amalay de RibEye + postre', img: null },
      { name: 'Pizza & Pasta: Pasta Mamarosa + Pizza Margarita o Pepperoni + postre', img: null },
    ],
  },
  {
    id: 'Pizza & Pasta',
    name: 'Pizza & Pasta',
    price: 480,
    horario: 'A partir de 1:30pm · Todos los dias',
    includes: 'Pasta Mamarosa + 1 Pizza Margarita o de Pepperoni (Prosciutto +$50) + postre + bebidas refill',
    options: [],
  },
]

const POSTRES = ['Pay manzana', 'Brownie', 'Blueberry Cheesecake', 'Carrot Cake']
const POSTRE_EXTRA = 80

const ANTICIPO_PCT = 0.30

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatMXN(n: number): string {
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function getMinDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  return d.toISOString().split('T')[0]
}

function getHorarios(espacio: EspacioId): string[] {
  if (espacio === 'terraza') {
    return ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
  }
  // Jardin y salon desde 2:30pm
  return ['14:30', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ReservarPage() {
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState<FormData>({
    nombre: '',
    telefono: '',
    fecha: '',
    espacio: '',
    horario_inicio: '',
    horario_fin: '',
    guests: 20,
    paquete: '',
    platoFuerte: '',
    postre: false,
    deco: '',
    notas: '',
  })

  const set = (field: keyof FormData, value: string | number | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const selectedEspacio = ESPACIOS.find(e => e.id === form.espacio)
  const guestError = useMemo(() => {
    if (!selectedEspacio) return ''
    if (form.guests < selectedEspacio.min) return `Tu grupo de ${form.guests} personas esta por debajo del minimo de ${selectedEspacio.min}.`
    if (form.guests > selectedEspacio.max) return `Tu grupo de ${form.guests} personas excede el maximo de ${selectedEspacio.max}.`
    return ''
  }, [form.guests, selectedEspacio])

  const selectedPaquete = PAQUETES.find(p => p.id === form.paquete)
  const total = useMemo(() => {
    if (!selectedPaquete) return 0
    let t = selectedPaquete.price * (form.guests || 1)
    if (form.postre) t += POSTRE_EXTRA * (form.guests || 1)
    return t
  }, [selectedPaquete, form.guests, form.postre])
  const anticipo = Math.round(total * ANTICIPO_PCT)

  const horarios = useMemo(() => getHorarios(form.espacio as EspacioId), [form.espacio])

  const canStep2 = form.nombre && form.telefono && form.fecha && form.espacio && form.horario_inicio && form.horario_fin && !guestError && form.guests > 0
  const canStep3 = form.paquete !== ''

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const codigo = 'AMA-' + String(Math.floor(Math.random() * 9000) + 1000)

      const body = {
        codigo_reserva: codigo,
        nombre: form.nombre,
        telefono: form.telefono,
        fecha: form.fecha,
        espacio: form.espacio,
        horario_inicio: form.horario_inicio,
        horario_fin: form.horario_fin,
        guests: form.guests,
        paquete: form.paquete,
        pastel: form.postre ? 'Postre incluido' : null,
        entradas: form.platoFuerte ? [form.platoFuerte] : null,
        deco: form.deco || null,
        total: total,
        status: 'pending',
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/amalay_reservaciones`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error('Error al guardar')
      setSubmitted(true)
    } catch {
      alert('Error al enviar la reservacion. Intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-black text-black mb-3">Reservacion enviada</h1>
          <p className="text-black mb-2">
            Nos pondremos en contacto contigo para confirmar los detalles y coordinar el anticipo.
          </p>
          <p className="text-sm text-black/60 mb-6">
            Revisa tu WhatsApp — te enviaremos un mensaje al {form.telefono}
          </p>
          <a
            href={`https://wa.me/528115324371?text=Hola%2C%20acabo%20de%20hacer%20una%20reservacion%20para%20${encodeURIComponent(form.nombre)}%20el%20${form.fecha}`}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-full font-bold hover:bg-emerald-700 transition-colors"
          >
            Confirmar por WhatsApp
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gray-950 text-white">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <a href="https://cafeamalay.com" className="inline-block mb-6">
            <span className="font-black text-xl tracking-tight">
              AMALAY
            </span>
          </a>
          <h1 className="text-2xl font-black mb-1">Eventos Privados</h1>
          <p className="text-white/60 text-sm font-medium">Baby showers · Despedidas · Bodas · Cumpleanos</p>

          {/* Progress */}
          <div className="flex items-center gap-2 mt-8">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step >= s ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'
                }`}>
                  {step > s ? <Check className="w-4 h-4" /> : s}
                </div>
                <span className={`text-xs font-bold hidden sm:inline ${step >= s ? 'text-white' : 'text-white/40'}`}>
                  {s === 1 ? 'Espacio' : s === 2 ? 'Paquete' : 'Anticipo'}
                </span>
                {s < 3 && <div className={`w-8 h-px ${step > s ? 'bg-emerald-500' : 'bg-white/10'}`} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* ── STEP 1: Datos + Espacio ─────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-black flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              Datos del evento
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-black mb-1">
                  <User className="w-3.5 h-3.5 inline mr-1" />Nombre completo
                </label>
                <input
                  type="text" value={form.nombre} onChange={e => set('nombre', e.target.value)}
                  placeholder="Tu nombre"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-black mb-1">
                  <Phone className="w-3.5 h-3.5 inline mr-1" />Telefono / WhatsApp
                </label>
                <input
                  type="tel" value={form.telefono} onChange={e => set('telefono', e.target.value)}
                  placeholder="81 1234 5678"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-black mb-1">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" />Fecha del evento
                </label>
                <input
                  type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)}
                  min={getMinDate()}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-black mb-1">
                  <Users className="w-3.5 h-3.5 inline mr-1" />Numero de invitados
                </label>
                <input
                  type="number" value={form.guests}
                  onChange={e => set('guests', parseInt(e.target.value) || 0)}
                  min={10} max={50}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Espacios */}
            <div>
              <label className="block text-sm font-bold text-black mb-3">
                <MapPin className="w-3.5 h-3.5 inline mr-1" />Espacio
              </label>
              <div className="space-y-3">
                {ESPACIOS.map(esp => {
                  const tooFew = form.guests > 0 && form.guests < esp.min
                  const tooMany = form.guests > 0 && form.guests > esp.max
                  const disabled = tooFew || tooMany
                  return (
                    <div key={esp.id}>
                      <button
                        onClick={() => { if (!disabled) { set('espacio', esp.id); set('horario_inicio', ''); set('horario_fin', '') } }}
                        disabled={disabled}
                        className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
                          form.espacio === esp.id
                            ? 'border-emerald-500 bg-emerald-50'
                            : disabled
                            ? 'border-gray-100 bg-gray-50 opacity-60'
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-black text-black text-base flex items-center gap-2">
                              <span className="text-lg">{esp.icon}</span>
                              {esp.name}
                            </div>
                            <div className="text-sm text-black/70 mt-1">{esp.desc}</div>
                            <div className="text-xs text-black/50 mt-1">{esp.available}</div>
                          </div>
                          <div className="text-sm font-bold text-black/60 bg-gray-100 px-3 py-1 rounded-full whitespace-nowrap">
                            {esp.min}–{esp.max} personas
                          </div>
                        </div>
                        {form.espacio === esp.id && (
                          <div className="absolute top-2 right-2">
                            <Check className="w-5 h-5 text-emerald-600" />
                          </div>
                        )}
                      </button>
                      {disabled && form.guests > 0 && (
                        <div className="mt-1 px-4 py-2 bg-red-50 border border-red-100 rounded-lg">
                          <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Tu grupo de {form.guests} personas esta {tooFew ? `por debajo del minimo de ${esp.min}` : `por encima del maximo de ${esp.max}`}.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Horario — solo si hay espacio seleccionado */}
            {form.espacio && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-black mb-1">
                    <Clock className="w-3.5 h-3.5 inline mr-1" />Hora inicio
                  </label>
                  <select
                    value={form.horario_inicio} onChange={e => set('horario_inicio', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                  >
                    <option value="">Seleccionar</option>
                    {horarios.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-black mb-1">
                    <Clock className="w-3.5 h-3.5 inline mr-1" />Hora fin
                  </label>
                  <select
                    value={form.horario_fin} onChange={e => set('horario_fin', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                  >
                    <option value="">Seleccionar</option>
                    {horarios.filter(h => h > form.horario_inicio).map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
            )}

            <button
              onClick={() => setStep(2)} disabled={!canStep2}
              className="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Siguiente: elegir paquete
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── STEP 2: Paquete ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-black flex items-center gap-2">
              <ChefHat className="w-5 h-5 text-emerald-600" />
              Nuestros paquetes
            </h2>
            <p className="text-sm text-black/70">
              Todos los paquetes cuestan <span className="font-bold text-black">$480 por persona</span> e incluyen bebida suave refill.
            </p>

            <div className="space-y-4">
              {PAQUETES.map(paq => (
                <button
                  key={paq.id}
                  onClick={() => { set('paquete', paq.id); set('platoFuerte', '') }}
                  className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
                    form.paquete === paq.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-black text-black text-base">{paq.name}</div>
                    <div className="text-emerald-700 font-bold text-sm">{formatMXN(paq.price)} p/p</div>
                  </div>
                  <div className="text-xs font-bold text-black/50 mb-2">{paq.horario}</div>
                  <div className="text-sm text-black/70">{paq.includes}</div>
                  {paq.options.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <div className="text-xs font-bold text-black/50 uppercase tracking-wide">Plato fuerte a elegir:</div>
                      {paq.options.map((opt, i) => (
                        <div key={i} className="text-sm text-black/80">· {opt.name}</div>
                      ))}
                    </div>
                  )}
                  {form.paquete === paq.id && (
                    <div className="mt-3 inline-flex items-center gap-1 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                      <Check className="w-3 h-3" /> Seleccionado
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Plato fuerte — si el paquete tiene opciones */}
            {selectedPaquete && selectedPaquete.options.length > 0 && form.paquete && (
              <div>
                <label className="block text-sm font-bold text-black mb-2">Plato fuerte principal</label>
                <p className="text-xs text-black/50 mb-3">Se permite combinar hasta 2 opciones si se indica con anticipacion la cantidad exacta.</p>
                <div className="space-y-2">
                  {selectedPaquete.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => set('platoFuerte', form.platoFuerte === opt.name ? '' : opt.name)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm transition-all ${
                        form.platoFuerte === opt.name
                          ? 'border-emerald-500 bg-emerald-50 font-bold text-black'
                          : 'border-gray-200 bg-white text-black/80 hover:border-gray-300'
                      }`}
                    >
                      {opt.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Postre opcional */}
            <div className="bg-white rounded-xl border-2 border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cake className="w-5 h-5 text-amber-600" />
                  <div>
                    <div className="text-sm font-bold text-black">Postre opcional +{formatMXN(POSTRE_EXTRA)} p/p</div>
                    <div className="text-xs text-black/50">Pay manzana, Brownie, Blueberry Cheesecake o Carrot Cake</div>
                  </div>
                </div>
                <button
                  onClick={() => set('postre', !form.postre)}
                  className={`w-12 h-7 rounded-full transition-colors relative ${form.postre ? 'bg-emerald-500' : 'bg-gray-200'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-1 transition-transform ${form.postre ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              {form.postre && (
                <div className="mt-3 text-xs text-emerald-700 font-bold">
                  +{formatMXN(POSTRE_EXTRA * form.guests)} ({form.guests} personas x {formatMXN(POSTRE_EXTRA)})
                </div>
              )}
            </div>

            {/* Deco */}
            <div>
              <label className="block text-sm font-bold text-black mb-1">Decoracion (opcional)</label>
              <input
                type="text" value={form.deco} onChange={e => set('deco', e.target.value)}
                placeholder="Ej: globos rosa y dorado, tematica tropical..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>

            {/* Notas */}
            <div>
              <label className="block text-sm font-bold text-black mb-1">Notas adicionales</label>
              <textarea
                value={form.notas} onChange={e => set('notas', e.target.value)} rows={3}
                placeholder="Alergias, restricciones alimentarias, requerimientos especiales..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-black text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)}
                className="px-6 py-3.5 rounded-xl font-bold text-sm border border-gray-200 text-black hover:bg-gray-50 transition-colors flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Atras
              </button>
              <button onClick={() => setStep(3)} disabled={!canStep3}
                className="flex-1 py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-700">
                Siguiente: confirmar y pagar anticipo
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Resumen + Anticipo ──────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-black flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-600" />
              Confirmar y pagar anticipo
            </h2>

            {/* Resumen */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <h3 className="text-sm font-black text-black">Resumen del evento</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-black/40 text-xs font-bold">Nombre</div>
                  <div className="text-black font-bold">{form.nombre}</div>
                </div>
                <div>
                  <div className="text-black/40 text-xs font-bold">Telefono</div>
                  <div className="text-black font-bold">{form.telefono}</div>
                </div>
                <div>
                  <div className="text-black/40 text-xs font-bold">Fecha</div>
                  <div className="text-black font-bold">{form.fecha}</div>
                </div>
                <div>
                  <div className="text-black/40 text-xs font-bold">Horario</div>
                  <div className="text-black font-bold">{form.horario_inicio} - {form.horario_fin}</div>
                </div>
                <div>
                  <div className="text-black/40 text-xs font-bold">Espacio</div>
                  <div className="text-black font-bold">{selectedEspacio?.name}</div>
                </div>
                <div>
                  <div className="text-black/40 text-xs font-bold">Invitados</div>
                  <div className="text-black font-bold">{form.guests} personas</div>
                </div>
                <div>
                  <div className="text-black/40 text-xs font-bold">Paquete</div>
                  <div className="text-black font-bold">{form.paquete}</div>
                </div>
                {form.platoFuerte && (
                  <div>
                    <div className="text-black/40 text-xs font-bold">Plato fuerte</div>
                    <div className="text-black font-bold">{form.platoFuerte}</div>
                  </div>
                )}
                {form.postre && (
                  <div>
                    <div className="text-black/40 text-xs font-bold">Postre</div>
                    <div className="text-black font-bold">Incluido (+{formatMXN(POSTRE_EXTRA)}/pp)</div>
                  </div>
                )}
                {form.deco && (
                  <div className="col-span-2">
                    <div className="text-black/40 text-xs font-bold">Decoracion</div>
                    <div className="text-black font-bold">{form.deco}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Desglose */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="text-sm font-black text-black mb-4">Desglose de pago</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-black/70">
                  <span>{form.paquete} x {form.guests} personas</span>
                  <span className="font-bold text-black">{formatMXN((selectedPaquete?.price || 0) * form.guests)}</span>
                </div>
                {form.postre && (
                  <div className="flex justify-between text-black/70">
                    <span>Postre x {form.guests} personas</span>
                    <span className="font-bold text-black">{formatMXN(POSTRE_EXTRA * form.guests)}</span>
                  </div>
                )}
                <div className="border-t border-gray-100 pt-2 flex justify-between">
                  <span className="text-black/70">Total del evento</span>
                  <span className="font-black text-black">{formatMXN(total)}</span>
                </div>
              </div>

              <div className="mt-4 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm font-black text-emerald-800">Anticipo (30%)</div>
                    <div className="text-xs text-emerald-600 font-medium mt-0.5">Para confirmar tu reservacion</div>
                  </div>
                  <div className="text-xl font-black text-emerald-700">{formatMXN(anticipo)}</div>
                </div>
              </div>

              <div className="mt-3 text-xs text-black/40 font-medium">
                El resto ({formatMXN(total - anticipo)}) se cubre el dia del evento.
              </div>
            </div>

            {/* Pasarelas */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="text-sm font-black text-black mb-4">Metodo de pago del anticipo</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all group">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <span className="text-blue-600 font-black text-xs">MP</span>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-black text-black group-hover:text-emerald-700">MercadoPago</div>
                    <div className="text-xs text-black/50">Tarjeta, OXXO, transferencia</div>
                  </div>
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all group relative">
                  <div className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">NUEVO</div>
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                    <span className="text-purple-600 font-black text-xs">S</span>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-black text-black group-hover:text-emerald-700">Stripe</div>
                    <div className="text-xs text-black/50">Tarjeta internacional, Apple Pay</div>
                  </div>
                </button>
              </div>
              <p className="text-xs text-black/40 mt-3 text-center font-medium">
                Tu pago esta protegido con encriptacion bancaria. Nunca almacenamos datos de tarjeta.
              </p>
            </div>

            <button onClick={() => setStep(2)}
              className="w-full px-6 py-3 rounded-xl font-bold text-sm border border-gray-200 text-black hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Modificar paquete
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-black/40 font-medium">
            AMALAY Monterrey · <a href="https://wa.me/528115324371" className="text-emerald-600 hover:underline">WhatsApp</a> · <a href="https://app.fullsite.mx/privacidad" className="text-emerald-600 hover:underline">Privacidad</a>
          </p>
        </div>
      </div>
    </div>
  )
}
