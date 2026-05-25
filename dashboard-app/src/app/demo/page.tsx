'use client'

import { useState, FormEvent } from 'react'

const posOptions = ['Wansoft', 'Soft Restaurant', 'Toast', 'Otro']

export default function DemoPage() {
  const [form, setForm] = useState({
    nombre: '',
    restaurante: '',
    email: '',
    telefono: '',
    pos: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Error al enviar')
      setSubmitted(true)
    } catch {
      setError('Hubo un error. Intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  const scrollToForm = () => {
    document.getElementById('contacto')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--text-1)]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-[var(--surface)]/90 backdrop-blur border-b border-[var(--line-soft)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-[#1a1a1a] font-black text-2xl tracking-tight">
            fullsite
            <span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
          </span>
          <button
            onClick={scrollToForm}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            Solicitar demo
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 lg:pt-28 lg:pb-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight mb-6">
              Inteligencia artificial para tu restaurante
            </h1>
            <p className="text-lg text-[var(--text-2)] mb-8 leading-relaxed">
              Ventas, meseros, platillos, tendencias — preguntale lo que quieras a tu asistente IA
            </p>
            <button
              onClick={scrollToForm}
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-base px-8 py-3.5 rounded-lg transition-colors shadow-lg shadow-emerald-500/20"
            >
              Solicitar demo gratis
            </button>
          </div>
          <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl p-12 flex items-center justify-center min-h-[320px]">
            <p className="text-[var(--text-3)] text-sm font-medium">Dashboard preview</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-[var(--surface-2)] py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl lg:text-3xl font-bold text-center mb-4">
            Todo lo que necesitas en un solo lugar
          </h2>
          <p className="text-[var(--text-2)] text-center mb-12 max-w-2xl mx-auto">
            Conectamos tu POS y te damos inteligencia accionable en tiempo real
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: '\ud83d\udcca',
                title: 'Dashboard en tiempo real',
                desc: 'Ventas, tickets, meseros, categorias — todo actualizado',
              },
              {
                icon: '\ud83e\udd16',
                title: 'Chat IA 24/7',
                desc: 'Preguntale cualquier cosa por Telegram o WhatsApp',
              },
              {
                icon: '\ud83d\udcf1',
                title: 'Reportes automaticos',
                desc: '3 reportes diarios directo a tu celular',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-8 hover:shadow-md transition-shadow"
              >
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-[var(--text-2)] text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl lg:text-3xl font-bold text-center mb-4">
            Como funciona
          </h2>
          <p className="text-[var(--text-2)] text-center mb-12 max-w-2xl mx-auto">
            Tres pasos para transformar la operacion de tu restaurante
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                title: 'Conectamos tu POS',
                desc: 'Wansoft, Soft Restaurant, Toast — cualquier sistema',
              },
              {
                step: '2',
                title: 'La IA aprende tu negocio',
                desc: 'Historial, meseros, platillos, tendencias',
              },
              {
                step: '3',
                title: 'Pregunta lo que quieras',
                desc: 'Por chat, por Telegram, o en el dashboard',
              },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="w-12 h-12 bg-emerald-500 text-white font-bold text-lg rounded-full flex items-center justify-center mx-auto mb-4">
                  {s.step}
                </div>
                <h3 className="font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-[var(--text-2)] text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-[var(--surface-2)] py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl lg:text-3xl font-bold text-center mb-4">Planes</h2>
          <p className="text-[var(--text-2)] text-center mb-12">Precios en MXN + IVA</p>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                name: 'Starter',
                price: '$1,500',
                features: ['Dashboard en tiempo real', 'Reportes automaticos', 'Soporte por email'],
                highlighted: false,
              },
              {
                name: 'Pro',
                price: '$3,000',
                features: [
                  'Todo de Starter',
                  'Chat IA 24/7',
                  'Analisis mesero x platillo',
                  'Soporte prioritario',
                ],
                highlighted: true,
              },
              {
                name: 'Enterprise',
                price: '$5,000',
                features: [
                  'Todo de Pro',
                  'Deteccion anti-fraude',
                  'Onboarding dedicado',
                  'SLA garantizado',
                ],
                highlighted: false,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-8 flex flex-col ${
                  plan.highlighted
                    ? 'border-emerald-500 bg-[var(--surface)] shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500'
                    : 'border-[var(--line)] bg-[var(--surface)]'
                }`}
              >
                <h3 className="font-bold text-lg mb-1">{plan.name}</h3>
                <div className="mb-6">
                  <span className="text-3xl font-extrabold">{plan.price}</span>
                  <span className="text-[var(--text-2)] text-sm">/mes</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-[var(--text-2)]">
                      <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={scrollToForm}
                  className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                    plan.highlighted
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                      : 'bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-1)]'
                  }`}
                >
                  Solicitar demo
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section id="contacto" className="py-20">
        <div className="max-w-xl mx-auto px-6">
          <h2 className="text-2xl lg:text-3xl font-bold text-center mb-4">
            Solicita tu demo gratuita
          </h2>
          <p className="text-[var(--text-2)] text-center mb-10">
            Dejanos tus datos y te contactamos en menos de 24 horas
          </p>

          {submitted ? (
            <div className="text-center bg-emerald-50 border border-emerald-200 rounded-xl p-8">
              <div className="text-4xl mb-3">&#10003;</div>
              <h3 className="font-bold text-lg mb-2">Recibimos tu solicitud</h3>
              <p className="text-[var(--text-2)] text-sm">Te contactaremos pronto. Gracias por tu interes en Fullsite.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[var(--text-1)] mb-1.5">Nombre</label>
                <input
                  type="text"
                  required
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Tu nombre completo"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-1)] mb-1.5">Restaurante</label>
                <input
                  type="text"
                  required
                  value={form.restaurante}
                  onChange={(e) => setForm({ ...form, restaurante: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Nombre de tu restaurante"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-1)] mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="correo@restaurante.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-1)] mb-1.5">Telefono</label>
                <input
                  type="tel"
                  required
                  value={form.telefono}
                  onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="81 1234 5678"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-1)] mb-1.5">POS que usas</label>
                <select
                  required
                  value={form.pos}
                  onChange={(e) => setForm({ ...form, pos: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-[var(--surface)]"
                >
                  <option value="">Selecciona tu POS</option>
                  {posOptions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
              >
                {submitting ? 'Enviando...' : 'Solicitar demo'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--line)] py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-[#1a1a1a] font-black text-lg tracking-tight">
              fullsite
              <span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
            <div className="flex gap-4 text-sm text-[var(--text-2)]">
              <a href="/privacidad" className="hover:text-[var(--text-1)] transition-colors">Privacidad</a>
              <a href="/terminos" className="hover:text-[var(--text-1)] transition-colors">Terminos</a>
              <a href="/seguridad" className="hover:text-[var(--text-1)] transition-colors">Seguridad</a>
            </div>
          </div>
          <p className="text-sm text-[var(--text-3)]">
            &copy; 2026 Fullsite. Monterrey, NL, Mexico.
          </p>
        </div>
      </footer>
    </div>
  )
}
