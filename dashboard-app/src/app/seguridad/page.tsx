import type { Metadata } from 'next'
import { ArrowUpRight, CircleDot, FileCheck2, Fingerprint, KeyRound, LockKeyhole, Network, Radar, ServerCog, ShieldCheck } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Seguridad y confianza | Fullsite',
  description: 'Evidencia pública, controles técnicos y alcance de seguridad de la plataforma Fullsite.',
}

const evidence = [
  { label: 'Mozilla Observatory', target: 'Aplicación', value: 'B+', detail: '80/100 · 9 de 10 controles', date: '27 ago 2026', href: 'https://developer.mozilla.org/en-US/observatory/analyze?host=app.fullsite.mx', tone: 'emerald' },
  { label: 'Qualys SSL Labs', target: 'Cifrado TLS', value: 'A', detail: 'Endpoint público evaluado', date: '27 ago 2026', href: 'https://www.ssllabs.com/ssltest/analyze.html?d=fullsite.mx', tone: 'blue' },
  { label: 'HTTPS', target: 'app.fullsite.mx', value: 'TLS', detail: 'Certificado público vigente', date: 'Verificación continua', href: 'https://app.fullsite.mx', tone: 'slate' },
] as const

const controls = [
  { icon: LockKeyhole, title: 'Cifrado en tránsito', copy: 'HTTPS obligatorio, HSTS por dos años y certificados TLS públicos vigentes.' },
  { icon: KeyRound, title: 'Acceso por función', copy: 'Roles operativos y autorización adicional para acciones sensibles del punto de venta.' },
  { icon: Network, title: 'Separación por cliente', copy: 'Las operaciones y consultas se acotan por tenant; los límites se verifican con pruebas de autorización.' },
  { icon: Radar, title: 'Trazabilidad', copy: 'Las operaciones críticas incorporan actor, momento y contexto para reconstruir qué ocurrió.' },
  { icon: ServerCog, title: 'Continuidad local', copy: 'El flujo crítico del POS puede operar por la red local cuando la conexión a Internet no está disponible.' },
  { icon: Fingerprint, title: 'Identidad operativa', copy: 'PIN individual y soporte biométrico para identificar al personal dentro de la operación.' },
] as const

const status = [
  ['Evaluaciones web públicas', 'Activo', 'Los resultados enlazan directamente al evaluador independiente.'],
  ['Revisión interna de seguridad', 'Activo', 'Pruebas de autorización, aislamiento y flujos administrativos sensibles.'],
  ['Divulgación responsable', 'Activo', 'Canal directo para reportar hallazgos de buena fe.'],
  ['Assessment de cliente', 'Disponible', 'Atendemos cuestionarios de TI y seguridad durante el proceso comercial.'],
  ['SOC 2 / ISO 27001', 'No certificado', 'No presentamos estas certificaciones como obtenidas.'],
] as const

function EvidenceCard({ item }: { item: (typeof evidence)[number] }) {
  const color = { emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-950', blue: 'border-blue-200 bg-blue-50/70 text-blue-950', slate: 'border-slate-200 bg-slate-50 text-slate-950' }[item.tone]
  return (
    <a href={item.href} target="_blank" rel="noreferrer" className={`group flex min-h-64 flex-col rounded-[1.75rem] border p-6 transition-transform hover:-translate-y-1 ${color}`}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] opacity-55">{item.label}</p><p className="mt-1 text-sm opacity-70">{item.target}</p></div>
        <ArrowUpRight className="h-4 w-4 opacity-45 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <p className="mt-8 text-6xl font-black tracking-[-0.07em]">{item.value}</p>
      <div className="mt-auto border-t border-current/10 pt-4"><p className="text-sm font-semibold">{item.detail}</p><p className="mt-1 text-xs opacity-55">{item.date}</p></div>
    </a>
  )
}

export default function SeguridadPage() {
  return (
    <main className="min-h-screen bg-[#f7f9fc] text-[#101828]">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <a href="/login" className="text-xl font-black tracking-[-0.04em]">fullsite<span className="text-emerald-500">.</span></a>
          <a href="mailto:seguridad@fullsite.mx" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold transition-colors hover:border-slate-950 hover:bg-slate-950 hover:text-white">Contactar a seguridad</a>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[#07111f] text-white">
        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="grid gap-14 lg:grid-cols-[1fr_320px] lg:items-end">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-200"><CircleDot className="h-3 w-3" /> Evidencia verificable</div>
              <h1 className="max-w-4xl text-5xl font-black leading-[0.96] tracking-[-0.06em] sm:text-6xl md:text-7xl">La confianza se demuestra.</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">Publicamos lo que está activo, quién lo evaluó y qué todavía está pendiente. Sin sellos inventados ni alcances ambiguos.</p>
            </div>
            <div className="border-l border-white/15 pl-6 font-mono text-xs leading-6 text-slate-400"><p className="text-white">Estado del centro de confianza</p><p>Actualizado: 27 agosto 2026</p><p>Superficies: web + POS</p><p>Contacto: seguridad@fullsite.mx</p></div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Resultados públicos</p><h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Evaluaciones independientes</h2></div>
          <p className="max-w-md text-sm leading-6 text-slate-500">Son evaluaciones técnicas del dominio indicado; no sustituyen una certificación corporativa SOC 2 o ISO 27001.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">{evidence.map((item) => <EvidenceCard item={item} key={item.label} />)}</div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-12 lg:grid-cols-[320px_1fr]">
            <div><ShieldCheck className="h-10 w-10 text-emerald-600" strokeWidth={1.6} /><h2 className="mt-6 text-3xl font-black tracking-[-0.04em]">Controles en operación</h2><p className="mt-4 text-sm leading-6 text-slate-500">Un resumen público. Los detalles sensibles se comparten dentro de un assessment formal con el equipo de TI del cliente.</p></div>
            <div className="grid gap-px overflow-hidden rounded-3xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
              {controls.map(({ icon: Icon, title, copy }) => <article className="bg-white p-6" key={title}><Icon className="h-5 w-5 text-emerald-600" strokeWidth={1.8} /><h3 className="mt-5 font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{copy}</p></article>)}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Alcance declarado</p><h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Estado, sin letra pequeña</h2>
            <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
              {status.map(([name, state, detail]) => <div className="grid gap-2 py-5 sm:grid-cols-[220px_130px_1fr] sm:items-start" key={name}><p className="text-sm font-bold">{name}</p><p className={`text-xs font-bold uppercase tracking-wide ${state === 'No certificado' ? 'text-slate-500' : 'text-emerald-700'}`}>{state}</p><p className="text-sm leading-6 text-slate-500">{detail}</p></div>)}
            </div>
          </div>
          <aside className="h-fit rounded-3xl bg-[#07111f] p-7 text-white"><FileCheck2 className="h-8 w-8 text-emerald-300" strokeWidth={1.6} /><h2 className="mt-6 text-2xl font-black tracking-[-0.03em]">¿Tienen un assessment?</h2><p className="mt-4 text-sm leading-6 text-slate-300">Podemos responder el cuestionario de seguridad de su organización y entregar evidencia disponible bajo confidencialidad.</p><a href="mailto:seguridad@fullsite.mx?subject=Assessment%20de%20seguridad%20Fullsite" className="mt-7 inline-flex items-center gap-2 rounded-full bg-emerald-300 px-4 py-2.5 text-sm font-bold text-emerald-950 transition-colors hover:bg-emerald-200">Solicitar assessment <ArrowUpRight className="h-4 w-4" /></a></aside>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2">
          <div><h2 className="text-xl font-black tracking-[-0.03em]">Divulgación responsable</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">Si encontraste una vulnerabilidad, repórtala de buena fe con pasos de reproducción y superficie afectada. Confirmaremos recepción en un máximo de dos días hábiles.</p><a className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-emerald-700" href="mailto:seguridad@fullsite.mx?subject=Reporte%20responsable%20de%20seguridad">seguridad@fullsite.mx <ArrowUpRight className="h-4 w-4" /></a></div>
          <div className="md:border-l md:border-slate-200 md:pl-10"><h2 className="text-xl font-black tracking-[-0.03em]">Principio de publicación</h2><p className="mt-3 text-sm leading-6 text-slate-500">Un proveedor certificado no convierte automáticamente a Fullsite en una empresa certificada. Cada evidencia en esta página identifica su emisor, fecha y alcance.</p></div>
        </div>
      </section>

      <footer className="bg-[#07111f] text-slate-400"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-5 px-6 py-8 text-xs sm:flex-row"><p>© 2026 Fullsite Technologies</p><div className="flex gap-5"><a className="hover:text-white" href="/privacidad">Privacidad</a><a className="hover:text-white" href="/terminos">Términos</a><a className="hover:text-white" href="/login">Acceso</a></div></div></footer>
    </main>
  )
}
