import { BrainCircuit, Eye } from 'lucide-react'
import JevControlPanel from '@/components/platform/JevControlPanel'

export default function JevPage() {
  return (
    <main className="mx-auto max-w-6xl pb-12">
      <header className="flex flex-col gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-400/30 bg-violet-400/10 text-violet-300"><BrainCircuit size={23} /></span>
          <div><h1 className="text-3xl font-semibold tracking-tight text-[var(--text-1)]">JEV</h1><p className="mt-1 text-sm text-[var(--text-3)]">Centro interno de decisiones y evidencia</p></div>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-sm font-medium text-violet-300"><Eye size={15} />Modo sombra · no ejecuta acciones</div>
      </header>
      <JevControlPanel />
    </main>
  )
}
