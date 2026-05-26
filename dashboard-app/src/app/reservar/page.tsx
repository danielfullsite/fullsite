'use client'

import { useState } from 'react'
import { Calendar, Users, MapPin, Clock, ChefHat, CreditCard, Check, ArrowRight, ArrowLeft, Phone, User } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3

interface FormData {
  nombre: string
  telefono: string
  fecha: string
  espacio: 'jardin' | 'terraza' | ''
  horario_inicio: string
  horario_fin: string
  guests: number
  paquete: string
  pastel: string
  entradas: string[]
  deco: string
  notas: string
}

// ── Config ───────────────────────────────────────────────────────────────────
const ESPACIOS = [
  { id: 'jardin', name: 'Jardin', capacity: '20-40 personas', desc: 'Espacio al aire libre con vegetacion y luces' },
  { id: 'terraza', name: 'Terraza', capacity: '15-30 personas', desc: 'Vista panoramica, ideal para reuniones intimas' },
]

const PAQUETES = [
  { id: 'Brunch', name: 'Brunch', price: 650, desc: 'Desayuno completo con opciones dulces y saladas' },
  { id: 'Merienda / Cena', name: 'Merienda / Cena', price: 750, desc: 'Menu de tarde-noche con entradas y plato fuerte' },
  { id: 'Pizza & Pasta', name: 'Pizza & Pasta', price: 550, desc: 'Buffet de pizzas artesanales y pastas' },
  { id: 'A la Carta', name: 'A la Carta', price: 0, desc: 'Cada invitado ordena del menu regular' },
]

const PASTELES = ['Chocolate', 'Red Velvet', 'Tres Leches', 'Cheesecake', 'Sin pastel']

const HORARIOS = [
  '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00',
]

const ANTICIPO_PCT = 0.30

// ── Helpers ──────────────────────────────────────────────────────────────────
function calcTotal(data: FormData): number {
  const paq = PAQUETES.find(p => p.id === data.paquete)
  if (!paq || paq.price === 0) return 0
  return paq.price * (data.guests || 1)
}

function formatMXN(n: number): string {
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function getMinDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  return d.toISOString().split('T')[0]
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
    pastel: '',
    entradas: [],
    deco: '',
    notas: '',
  })

  const set = (field: keyof FormData, value: string | number | string[]) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const total = calcTotal(form)
  const anticipo = Math.round(total * ANTICIPO_PCT)

  const canStep2 = form.nombre && form.telefono && form.fecha && form.espacio && form.horario_inicio && form.horario_fin && form.guests >= 10
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
        pastel: form.pastel || null,
        entradas: form.entradas.length ? form.entradas : null,
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
    } catch (e) {
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
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Reservacion enviada</h1>
          <p className="text-gray-500 mb-2">
            Nos pondremos en contacto contigo para confirmar los detalles y coordinar el anticipo.
          </p>
          <p className="text-sm text-gray-400 mb-6">
            Revisa tu WhatsApp — te enviaremos un mensaje al {form.telefono}
          </p>
          <a
            href={`https://wa.me/528115324371?text=Hola%2C%20acabo%20de%20hacer%20una%20reservacion%20para%20${encodeURIComponent(form.nombre)}%20el%20${form.fecha}`}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-emerald-700 transition-colors"
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
          <a href="https://fullsite.mx" className="inline-block mb-6">
            <span className="font-black text-xl tracking-tight">
              fullsite
              <span className="inline-block w-2 h-2 bg-emerald-400 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </a>
          <h1 className="text-2xl font-bold mb-2">Reserva tu evento en AMALAY</h1>
          <p className="text-white/60 text-sm">Jardin y terraza para eventos privados en Monterrey</p>

          {/* Progress */}
          <div className="flex items-center gap-2 mt-8">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step >= s ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'
                }`}>
                  {step > s ? <Check className="w-4 h-4" /> : s}
                </div>
                <span className={`text-xs font-medium hidden sm:inline ${step >= s ? 'text-white' : 'text-white/40'}`}>
                  {s === 1 ? 'Datos' : s === 2 ? 'Paquete' : 'Confirmar'}
                </span>
                {s < 3 && <div className={`w-8 h-px ${step > s ? 'bg-emerald-500' : 'bg-white/10'}`} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* ── STEP 1: Datos del evento ────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              Datos del evento
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="w-3.5 h-3.5 inline mr-1" />Nombre completo
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => set('nombre', e.target.value)}
                  placeholder="Tu nombre"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Phone className="w-3.5 h-3.5 inline mr-1" />Telefono / WhatsApp
                </label>
                <input
                  type="tel"
                  value={form.telefono}
                  onChange={e => set('telefono', e.target.value)}
                  placeholder="81 1234 5678"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" />Fecha del evento
                </label>
                <input
                  type="date"
                  value={form.fecha}
                  onChange={e => set('fecha', e.target.value)}
                  min={getMinDate()}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Users className="w-3.5 h-3.5 inline mr-1" />Numero de invitados
                </label>
                <input
                  type="number"
                  value={form.guests}
                  onChange={e => set('guests', parseInt(e.target.value) || 0)}
                  min={10}
                  max={60}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Espacio */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <MapPin className="w-3.5 h-3.5 inline mr-1" />Espacio
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ESPACIOS.map(esp => (
                  <button
                    key={esp.id}
                    onClick={() => set('espacio', esp.id)}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      form.espacio === esp.id
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="font-semibold text-gray-900 text-sm">{esp.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{esp.capacity}</div>
                    <div className="text-xs text-gray-400 mt-1">{esp.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Horario */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Clock className="w-3.5 h-3.5 inline mr-1" />Hora inicio
                </label>
                <select
                  value={form.horario_inicio}
                  onChange={e => set('horario_inicio', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                >
                  <option value="">Seleccionar</option>
                  {HORARIOS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Clock className="w-3.5 h-3.5 inline mr-1" />Hora fin
                </label>
                <select
                  value={form.horario_fin}
                  onChange={e => set('horario_fin', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                >
                  <option value="">Seleccionar</option>
                  {HORARIOS.filter(h => h > form.horario_inicio).map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!canStep2}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Siguiente: elegir paquete
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── STEP 2: Paquete ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <ChefHat className="w-5 h-5 text-emerald-600" />
              Paquete y extras
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PAQUETES.map(paq => (
                <button
                  key={paq.id}
                  onClick={() => set('paquete', paq.id)}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    form.paquete === paq.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="font-semibold text-gray-900 text-sm">{paq.name}</div>
                    {paq.price > 0 && (
                      <div className="text-emerald-600 font-bold text-sm">{formatMXN(paq.price)}/pp</div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{paq.desc}</div>
                  {paq.price > 0 && form.paquete === paq.id && (
                    <div className="text-xs text-emerald-700 font-medium mt-2">
                      {form.guests} personas = {formatMXN(paq.price * form.guests)}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Pastel */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Pastel (opcional)</label>
              <div className="flex flex-wrap gap-2">
                {PASTELES.map(p => (
                  <button
                    key={p}
                    onClick={() => set('pastel', form.pastel === p ? '' : p)}
                    className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                      form.pastel === p
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Deco */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Decoracion (opcional)</label>
              <input
                type="text"
                value={form.deco}
                onChange={e => set('deco', e.target.value)}
                placeholder="Ej: globos rosa y dorado, tematica tropical..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>

            {/* Notas */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notas adicionales</label>
              <textarea
                value={form.notas}
                onChange={e => set('notas', e.target.value)}
                rows={3}
                placeholder="Alergias, restricciones alimentarias, requerimientos especiales..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3.5 rounded-xl font-semibold text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Atras
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!canStep3}
                className="flex-1 py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Siguiente: confirmar y pagar anticipo
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Resumen + Anticipo ──────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-600" />
              Confirmar y pagar anticipo
            </h2>

            {/* Resumen */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Resumen del evento</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-gray-400 text-xs">Nombre</div>
                  <div className="text-gray-900 font-medium">{form.nombre}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Telefono</div>
                  <div className="text-gray-900 font-medium">{form.telefono}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Fecha</div>
                  <div className="text-gray-900 font-medium">{form.fecha}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Horario</div>
                  <div className="text-gray-900 font-medium">{form.horario_inicio} - {form.horario_fin}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Espacio</div>
                  <div className="text-gray-900 font-medium capitalize">{form.espacio}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Invitados</div>
                  <div className="text-gray-900 font-medium">{form.guests} personas</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Paquete</div>
                  <div className="text-gray-900 font-medium">{form.paquete}</div>
                </div>
                {form.pastel && form.pastel !== 'Sin pastel' && (
                  <div>
                    <div className="text-gray-400 text-xs">Pastel</div>
                    <div className="text-gray-900 font-medium">{form.pastel}</div>
                  </div>
                )}
                {form.deco && (
                  <div className="col-span-2">
                    <div className="text-gray-400 text-xs">Decoracion</div>
                    <div className="text-gray-900 font-medium">{form.deco}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Desglose de pago */}
            {total > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Desglose de pago</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>{form.paquete} x {form.guests} personas</span>
                    <span className="font-medium text-gray-900">{formatMXN(total)}</span>
                  </div>
                  <div className="border-t border-gray-100 pt-2 flex justify-between">
                    <span className="text-gray-600">Total del evento</span>
                    <span className="font-bold text-gray-900">{formatMXN(total)}</span>
                  </div>
                </div>

                <div className="mt-4 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-sm font-semibold text-emerald-800">Anticipo (30%)</div>
                      <div className="text-xs text-emerald-600 mt-0.5">Para confirmar tu reservacion</div>
                    </div>
                    <div className="text-xl font-bold text-emerald-700">{formatMXN(anticipo)}</div>
                  </div>
                </div>

                <div className="mt-3 text-xs text-gray-400">
                  El resto ({formatMXN(total - anticipo)}) se cubre el dia del evento.
                </div>
              </div>
            )}

            {/* Pasarelas de pago */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Metodo de pago del anticipo</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all group"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <span className="text-blue-600 font-bold text-xs">MP</span>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-gray-900 group-hover:text-emerald-700">MercadoPago</div>
                    <div className="text-xs text-gray-400">Tarjeta, OXXO, transferencia</div>
                  </div>
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all group relative"
                >
                  <div className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">NUEVO</div>
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                    <span className="text-purple-600 font-bold text-xs">S</span>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-gray-900 group-hover:text-emerald-700">Stripe</div>
                    <div className="text-xs text-gray-400">Tarjeta internacional, Apple Pay</div>
                  </div>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">
                Tu pago esta protegido con encriptacion bancaria. Nunca almacenamos datos de tarjeta.
              </p>
            </div>

            {/* Si es a la carta, no hay anticipo */}
            {total === 0 && (
              <div className="bg-amber-50 rounded-2xl border border-amber-100 p-6 text-center">
                <p className="text-sm text-amber-800 font-medium">
                  El paquete "A la Carta" no requiere anticipo.
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  Cada invitado paga su consumo el dia del evento.
                </p>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="mt-4 px-6 py-3 rounded-xl font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  {submitting ? 'Enviando...' : 'Confirmar reservacion'}
                </button>
              </div>
            )}

            <button
              onClick={() => setStep(2)}
              className="w-full px-6 py-3 rounded-xl font-semibold text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Modificar paquete
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            AMALAY Monterrey · <a href="https://wa.me/528115324371" className="text-emerald-600 hover:underline">WhatsApp</a> · <a href="https://app.fullsite.mx/privacidad" className="text-emerald-600 hover:underline">Privacidad</a>
          </p>
        </div>
      </div>
    </div>
  )
}
