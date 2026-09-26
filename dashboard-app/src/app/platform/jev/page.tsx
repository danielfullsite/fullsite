import {
  ArrowRight,
  BrainCircuit,
  CircleDashed,
  ClipboardCheck,
  Database,
  Eye,
  FileSearch,
  LockKeyhole,
  MonitorCheck,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react'

const coverage = [
  { icon: MonitorCheck, title: 'POS y operación offline', detail: 'Recibos, rondas, recuperación y handoffs' },
  { icon: Database, title: 'Plataforma y seguridad', detail: 'Cambios, migraciones, alertas y controles' },
  { icon: Waypoints, title: 'Agentes y automatizaciones', detail: 'Ejecuciones, límites y evidencia de resultados' },
]

const safeguards = [
  'No recibe secretos, PINs, PII ni transcripciones crudas.',
  'No cambia datos, publica, despliega ni envía mensajes.',
  'Una recomendación no sustituye una prueba o aprobación humana.',
  'Cada conclusión debe conservar su evidencia y sus límites.',
]

export default function JevPage() {
  return (
    <main className="mx-auto max-w-6xl pb-12">
      <header className="mb-8 flex flex-col gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-400/30 bg-violet-400/10 text-violet-300 shadow-[0_8px_30px_rgba(139,92,246,0.09)]">
            <BrainCircuit size={23} />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-1)]">JEV</h1>
            <p className="mt-1 text-sm text-[var(--text-3)]">Centro interno de decisiones y evidencia</p>
          </div>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-sm font-medium text-violet-300">
          <Eye size={15} />
          Modo sombra · no ejecuta acciones
        </div>
      </header>

      <section className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
        <div className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] bg-[linear-gradient(120deg,rgba(139,92,246,0.13),transparent_58%)] px-6 py-6">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-sm font-medium text-violet-300">Próximo veredicto</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-1)]">Esperando evidencia aprobada</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-3)]">
                  JEV no inventa señales. Cuando se conecten paquetes verificados, contrastará el estado declarado contra las pruebas y límites registrados.
                </p>
              </div>
              <CircleDashed size={23} className="mt-1 shrink-0 text-violet-300" />
            </div>
          </div>

          <div className="grid divide-y divide-[var(--line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Stat label="Fuentes conectadas" value="0" detail="Aún no se consulta producción." />
            <Stat label="Decisiones registradas" value="0" detail="No hay veredictos pendientes de revisar." />
            <Stat label="Cambios ejecutados" value="0" detail="Por diseño, JEV no opera el sistema." accent />
          </div>
        </div>

        <aside className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2 text-[var(--text-1)]">
            <ClipboardCheck size={18} className="text-emerald-300" />
            <h2 className="font-semibold">Cómo trabaja</h2>
          </div>
          <ol className="mt-5 space-y-4">
            {[
              ['Recibe una fuente aprobada', 'Reportes, pruebas o artefactos sin datos sensibles.'],
              ['Evalúa contradicciones', 'Relaciona alcance, resultados, límites y riesgos.'],
              ['Devuelve un veredicto', 'Sugiere el siguiente gate, siempre con trazabilidad.'],
            ].map(([title, detail], index) => (
              <li key={title} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--line)] text-xs font-semibold text-[var(--text-3)]">{index + 1}</span>
                <div>
                  <p className="text-sm font-medium text-[var(--text-1)]">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-4)]">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[var(--text-1)]">Cobertura preparada</h2>
              <p className="mt-1 text-sm text-[var(--text-3)]">Tres dominios que entrarán uno a uno, con contrato explícito.</p>
            </div>
            <Sparkles size={18} className="text-violet-300" />
          </div>
          <div className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {coverage.map(({ icon: Icon, title, detail }) => (
              <div key={title} className="flex items-center gap-4 py-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-violet-300"><Icon size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-1)]">{title}</p>
                  <p className="mt-1 text-xs text-[var(--text-4)]">{detail}</p>
                </div>
                <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--text-3)]">Preparando fuente</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2 text-[var(--text-1)]">
            <LockKeyhole size={18} className="text-amber-300" />
            <h2 className="font-semibold">Límites de seguridad</h2>
          </div>
          <ul className="mt-5 space-y-3">
            {safeguards.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-[var(--text-3)]">
                <ShieldCheck size={16} className="mt-1 shrink-0 text-emerald-300" />
                {item}
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-7 text-center">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--text-3)]"><FileSearch size={20} /></span>
        <h2 className="mt-3 font-semibold text-[var(--text-1)]">Bandeja de hallazgos vacía</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--text-3)]">
          Cuando una fuente pase su validación, los hallazgos aparecerán aquí con su evidencia, nivel de confianza y siguiente paso recomendado.
        </p>
        <p className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-300">La primera integración será de solo lectura <ArrowRight size={15} /></p>
      </section>
    </main>
  )
}

function Stat({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div className="p-5">
      <p className="text-sm text-[var(--text-3)]">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight ${accent ? 'text-emerald-300' : 'text-[var(--text-1)]'}`}>{value}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--text-4)]">{detail}</p>
    </div>
  )
}
