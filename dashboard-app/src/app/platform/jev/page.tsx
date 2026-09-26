import { BrainCircuit, Eye, LockKeyhole } from 'lucide-react'

export default function JevPage() {
  return (
    <main className="mx-auto max-w-3xl pb-10">
      <header className="mb-8 border-b border-[var(--line)] pb-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-violet-400/25 bg-violet-400/10 text-violet-300">
            <BrainCircuit size={20} />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-1)]">JEV</h1>
            <p className="mt-1 text-sm text-[var(--text-3)]">Auditoría interna</p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
        <div className="flex items-start gap-3">
          <Eye size={19} className="mt-0.5 shrink-0 text-violet-300" />
          <div>
            <p className="text-sm font-semibold text-[var(--text-1)]">Observa el sistema; no lo opera</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-3)]">
              JEV revisará evidencia aprobada de POS, dashboard y agentes para detectar contradicciones, riesgos y gates incompletos. Sus resultados aparecerán aquí como hallazgos verificables.
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-4)]">Estado</p>
          <p className="mt-2 text-sm text-[var(--text-2)]">Modo observación · integración de evidencia en preparación</p>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <LockKeyhole size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <p className="text-sm leading-6 text-[var(--text-3)]">
            No recibe secretos, PINs, PII ni transcripciones sin depurar. No ejecuta cambios, mensajes, despliegues o acciones de negocio.
          </p>
        </div>
      </section>
    </main>
  )
}
