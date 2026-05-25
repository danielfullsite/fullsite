import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface)] px-4">
      <div className="text-center max-w-md">
        <span className="text-[#1a1a1a] font-black text-3xl tracking-tight">
          fullsite<span className="inline-block w-3 h-3 bg-emerald-500/100 ml-0.5 mb-0.5 rounded-none" />
        </span>
        <h1 className="text-6xl font-bold text-[var(--text-1)] mt-8 mb-2">404</h1>
        <p className="text-[var(--text-2)] mb-8">Esta pagina no existe o fue movida.</p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/"
            className="bg-emerald-500/100 text-white font-semibold text-sm rounded-lg px-6 py-3 hover:bg-emerald-600 transition-colors"
          >
            Ir al dashboard
          </Link>
          <Link
            href="/pos"
            className="border border-[var(--line)] text-[var(--text-1)] font-semibold text-sm rounded-lg px-6 py-3 hover:bg-[var(--surface-2)] transition-colors"
          >
            Punto de venta
          </Link>
        </div>
      </div>
    </div>
  )
}
