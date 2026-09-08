'use client'
/**
 * Las piezas de las que está hecho el panel.
 *
 * Antes cada tarjeta se escribía a mano: `rounded-[14px] border
 * border-[var(--line)] p-[18px]` repetido por toda la página, con variantes de
 * 12px y 16px según quién la escribió. El resultado es un panel donde nada
 * está mal pero nada coincide del todo, que es lo que se siente como "hecho a
 * pedazos".
 *
 * Aquí viven la superficie, el encabezado, la cifra, el control segmentado y
 * los esqueletos. Todo sale de los tokens del tema, así que funciona igual en
 * claro y en oscuro sin escribir un color dos veces.
 */
import type { ReactNode } from 'react'

// ── Tarjeta ──────────────────────────────────────────────────────────────────

export function Tarjeta({
  children, className = '', padding = true, comoSeccion = false, ...resto
}: {
  children: ReactNode
  className?: string
  /** Apagar cuando la tarjeta contiene una tabla que llega hasta el borde. */
  padding?: boolean
  comoSeccion?: boolean
} & React.HTMLAttributes<HTMLElement>) {
  const Etiqueta = comoSeccion ? 'section' : 'div'
  return (
    <Etiqueta
      className={`rounded-xl border ${padding ? 'p-5' : ''} ${className}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
      {...resto}
    >
      {children}
    </Etiqueta>
  )
}

/** Título de tarjeta con su acción opcional a la derecha. */
export function TarjetaEncabezado({
  titulo, ayuda, derecha, className = '',
}: { titulo: ReactNode; ayuda?: ReactNode; derecha?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>{titulo}</h3>
        {ayuda && <p className="mt-0.5 text-[12px] leading-tight" style={{ color: 'var(--text-3)' }}>{ayuda}</p>}
      </div>
      {derecha && <div className="shrink-0">{derecha}</div>}
    </div>
  )
}

// ── Cifra ────────────────────────────────────────────────────────────────────

/**
 * La cifra grande de una tarjeta de resumen.
 *
 * `valor` a null significa "no hay dato" y se pinta como raya. Es distinto de
 * cero, que es un dato: un día sin ventas dice $0.00, y un día que todavía no
 * se puede leer dice raya. Antes convivían tres formas de decir esto en la
 * misma pantalla.
 */
export function Cifra({
  etiqueta, valor, tono = 'neutro', nota, icono, className = '',
}: {
  etiqueta: string
  valor: string | null
  tono?: 'neutro' | 'bien' | 'aviso' | 'grave'
  nota?: ReactNode
  icono?: ReactNode
  className?: string
}) {
  const color = valor === null ? 'var(--text-4)' : {
    neutro: 'var(--text-1)', bien: 'var(--ok-ink)',
    aviso: 'var(--warn-ink)', grave: 'var(--crit-ink)',
  }[tono]
  return (
    <Tarjeta className={className}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-3)' }}>{etiqueta}</span>
        {icono && <span className="shrink-0" style={{ color: 'var(--text-4)' }}>{icono}</span>}
      </div>
      <div
        className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight"
        style={{ color }}
      >
        {valor ?? '—'}
      </div>
      {nota && <div className="mt-2 text-[12px] leading-snug" style={{ color: 'var(--text-3)' }}>{nota}</div>}
    </Tarjeta>
  )
}

// ── Control segmentado ───────────────────────────────────────────────────────

/** El de Capital/Total y MXN/USD: dos o tres opciones, una activa. */
export function Segmentado<T extends string>({
  opciones, valor, alCambiar, etiquetaAria, tamano = 'md',
}: {
  opciones: { id: T; texto: string }[]
  valor: T
  alCambiar: (id: T) => void
  etiquetaAria: string
  tamano?: 'sm' | 'md'
}) {
  const alto = tamano === 'sm' ? 'h-7 text-[12px] px-2.5' : 'h-8 text-[12.5px] px-3'
  return (
    <div
      role="tablist"
      aria-label={etiquetaAria}
      className="inline-flex items-center gap-0.5 rounded-lg border p-0.5"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
    >
      {opciones.map(o => {
        const activo = o.id === valor
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={activo}
            onClick={() => alCambiar(o.id)}
            className={`${alto} rounded-[6px] font-medium transition-colors`}
            style={activo
              ? { background: 'var(--panel)', color: 'var(--text-1)', boxShadow: 'var(--shadow-soft)' }
              : { color: 'var(--text-3)' }}
          >
            {o.texto}
          </button>
        )
      })}
    </div>
  )
}

// ── Etiqueta de estado ───────────────────────────────────────────────────────

export function Pastilla({
  children, tono = 'neutro',
}: { children: ReactNode; tono?: 'neutro' | 'bien' | 'aviso' | 'grave' | 'info' }) {
  const paleta = {
    neutro: { background: 'var(--surface-2)', color: 'var(--text-2)' },
    bien: { background: 'var(--ok-soft)', color: 'var(--ok-ink)' },
    aviso: { background: 'var(--warn-soft)', color: 'var(--warn-ink)' },
    grave: { background: 'var(--crit-soft)', color: 'var(--crit-ink)' },
    info: { background: 'var(--info-soft)', color: 'var(--info-ink)' },
  }[tono]
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap"
      style={paleta}
    >
      {children}
    </span>
  )
}

// ── Esqueletos ───────────────────────────────────────────────────────────────

/**
 * Un esqueleto sirve si ocupa el MISMO espacio que lo que va a llegar. Si mide
 * de menos, la página salta cuando entran los datos, que es justo lo que se
 * quería evitar mostrando nada. Por eso cada esqueleto de abajo copia la altura
 * de su bloque real en vez de ser una caja genérica.
 *
 * `aria-hidden` a propósito: quien usa lector de pantalla oye "cargando" una
 * vez, desde la región viva, no veinte rectángulos sin nombre.
 */
export function Hueso({ className = '', ancho }: { className?: string; ancho?: string }) {
  return (
    <span
      aria-hidden
      className={`block rounded animate-pulse ${className}`}
      style={{ background: 'var(--surface-2)', width: ancho }}
    />
  )
}

export function CifraEsqueleto() {
  return (
    <Tarjeta>
      <Hueso className="h-3" ancho="42%" />
      <Hueso className="mt-3 h-7" ancho="68%" />
      <Hueso className="mt-3 h-2.5" ancho="55%" />
    </Tarjeta>
  )
}

export function TarjetaEsqueleto({ alto = 'h-[220px]' }: { alto?: string }) {
  return (
    <Tarjeta>
      <Hueso className="h-3.5" ancho="34%" />
      <Hueso className={`mt-4 ${alto}`} />
    </Tarjeta>
  )
}

/**
 * Filas de lista.
 *
 * La altura de la fila es EXPLÍCITA en vez de salir de la suma de sus partes.
 * Calcularla por dentro se veía razonable y fallaba: la fila real de «Quién
 * vendió» mide 44 px por el interlineado del nombre, y el esqueleto armado a
 * base de rectángulos daba 31, así que la página saltaba 81 px al llegar los
 * datos. Con la altura declarada, el esqueleto mide lo que va a medir el dato.
 *
 * `conBarra` replica el patrón de nombre e importe arriba, barra de avance
 * abajo. Sin barra queda la fila simple con avatar.
 */
export function FilasEsqueleto({
  filas = 5, conBarra = true, altoFila = 44, conAyuda = false,
}: { filas?: number; conBarra?: boolean; altoFila?: number; conAyuda?: boolean }) {
  return (
    <>
      {conAyuda && <Hueso className="mb-4 h-2.5" ancho="46%" />}
      <div className="space-y-3">
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} style={{ height: altoFila }} className="flex flex-col justify-center">
            <div className="flex items-center gap-3">
              {!conBarra && <Hueso className="h-8 w-8 shrink-0 rounded-full" />}
              <Hueso className="h-3.5" ancho={`${64 - i * 6}%`} />
              <Hueso className="ml-auto h-3.5 w-20 shrink-0" />
            </div>
            {conBarra && (
              <div className="mt-2 flex items-center gap-2">
                <Hueso className="h-1.5 flex-1 rounded-full" />
                <Hueso className="h-2.5 w-16 shrink-0" />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * El anuncio para lectores de pantalla mientras carga. Va UNA vez por región,
 * acompañando a los esqueletos que están marcados como decorativos.
 */
export function Cargando({ que }: { que: string }) {
  return <span role="status" aria-live="polite" className="sr-only">Cargando {que}…</span>
}
