'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import { LAYER } from './layers'

/**
 * Tabla compartida.
 *
 * Sale de un barrido de 95 `<table>` sueltas (2026-08-24). No existía ningún
 * componente compartido: cada página traía su propio markup, y por eso hay tres
 * dialectos de icono de orden, cuatro formas de estado vacío y una fila de totales
 * que unas veces vive en `<tfoot>` y otras en `<tbody>`.
 *
 * El contrato cubre lo que esas 95 hacen HOY. Toda prop de aquí existe porque hay
 * al menos una página real que la necesita; nada es especulativo. Siete tablas
 * quedan fuera a propósito (matrices NxM de modificadores, el visor de CSV, la
 * anidada polimórfica de movimientos) y conservan su markup propio: está dicho en
 * el PR, no es un olvido.
 *
 * Regla de la casa: cero pérdida de información. Si una tabla hoy ordena, tras
 * migrar ordena; si tiene 14 columnas, siguen siendo 14.
 */

export type Align = 'left' | 'center' | 'right'
export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl'

/**
 * Contexto de toda celda. `rows` es el array visible completo, y es lo que permite
 * celdas que dependen de la fila vecina sin salirse del contrato: la variación %
 * de cortes compara contra `rows[index + 1]`, y el saldo corrido de
 * control-efectivo necesita las anteriores.
 */
export interface CellContext<TRow> {
  row: TRow
  index: number
  rows: readonly TRow[]
  isFirst: boolean
  isLast: boolean
}

export interface ColumnDef<TRow, TValue = unknown> {
  id: string
  header: ReactNode
  headerTitle?: string
  accessor?: (row: TRow, index: number) => TValue
  render?: (ctx: CellContext<TRow>) => ReactNode

  /** Declarativo y explícito. Nunca derivado del texto del header — hoy
   *  `admin/tienda/articulos:118` alinea comparando `h === 'Precio'`, y basta
   *  renombrar la columna para descuadrar los números. */
  align?: Align
  /** Atajo de `align:'right'` + `tabular-nums`, en el `<th>` y en el `<td>`. */
  numeric?: boolean

  width?: string
  minWidth?: string
  truncate?: string

  /** Oculta la columna por debajo del breakpoint. Se propaga SOLO a la celda de
   *  footer de esta misma columna — hoy eso se repite a mano y `toma-fisica:419`
   *  ya tiene la fila de totales corrida en móvil por olvidarlo. */
  hideBelow?: Breakpoint

  sortable?: boolean
  sortAccessor?: (row: TRow) => string | number | Date | null | undefined

  headerClassName?: string
  cellClassName?: string | ((ctx: CellContext<TRow>) => string)

  /** Pinta la celda sólo cuando cambia respecto de la fila anterior: agrupación
   *  visual sin `rowSpan` (cierre-inventario:390). */
  collapseRepeated?: boolean

  footer?: ReactNode | ((rows: readonly TRow[]) => ReactNode)
}

export interface SortState {
  columnId: string
  dir: 'asc' | 'desc'
}

export type EmptyMode = 'row' | 'replace' | 'sibling' | 'hidden' | 'none'
export type LoadingMode = 'replace' | 'rows' | 'block' | 'none'
export type Scroll = 'none' | 'x' | 'y' | 'both'

export interface TableProps<TRow> {
  rows: readonly TRow[]
  /** `unknown` y no `any`: `TValue` sólo aparece en posición de retorno
   *  (`accessor`), así que una `ColumnDef<Fila, string>` sigue siendo asignable
   *  aquí por covarianza, y de paso no se apaga el chequeo de tipos. */
  columns: ReadonlyArray<ColumnDef<TRow, unknown>>
  /** Obligatorio. De esto depende que un `<input>` dentro de una celda no pierda
   *  el foco al reordenar o al re-renderizar: si la key cambia, React desmonta la
   *  fila y el cursor se va. En toma física eso hace imposible contar. */
  rowKey: (row: TRow, index: number) => string | number

  sort?: SortState | null
  onSortChange?: (next: SortState) => void
  defaultSort?: SortState
  /** `'directional'` refleja columna y sentido; `'static'` es el icono fijo que
   *  hoy usan food-cost e inventario. Se migra 1:1 con `'static'` y se corrige aparte. */
  sortIndicator?: 'directional' | 'static'
  /** El orden de las filas ES dato (saldo corrido, variación contra la siguiente).
   *  Con esto en true, una columna `sortable` es un bug: se avisa en desarrollo. */
  rowOrderIsMeaningful?: boolean

  loading?: boolean
  loadingMode?: LoadingMode
  loadingNode?: ReactNode
  error?: ReactNode
  onRetry?: () => void
  empty?: ReactNode
  emptyMode?: EmptyMode

  scroll?: Scroll
  maxHeight?: string
  minWidth?: string
  stickyHeader?: boolean

  rowClassName?: (ctx: CellContext<TRow>) => string
  striped?: boolean
  /** No dispara si el clic nace de un control: sin esto, editar una celda
   *  abriría el detalle de la fila. */
  onRowClick?: (ctx: CellContext<TRow>) => void

  expandable?: {
    isExpanded: (row: TRow, index: number) => boolean
    mode?: 'row' | 'inline-cell'
    render: (ctx: CellContext<TRow>, colSpan: number) => ReactNode
  }

  showFooterRow?: boolean
  footerPlacement?: 'tfoot' | 'tbody'
  footerRowClassName?: string
  /** Slot libre en el pie. `recetas:295` tiene un formulario de alta ahí, no un resumen. */
  renderFooter?: (colSpan: number) => ReactNode

  /** Emite la tabla oculta bajo el breakpoint + un hermano con tarjetas.
   *  El estado vacío se duplica solo en las dos ramas. */
  mobileCard?: (ctx: CellContext<TRow>) => ReactNode
  mobileBreakpoint?: Breakpoint

  limit?: number
  limitNotice?: (shown: number, total: number) => ReactNode

  caption?: string
  className?: string
  tableClassName?: string
  theadClassName?: string
  tbodyClassName?: string
  'data-testid'?: string
}

const HIDE_BELOW: Record<Breakpoint, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}

const MOBILE_HIDE: Record<Breakpoint, string> = {
  sm: 'hidden sm:block',
  md: 'hidden md:block',
  lg: 'hidden lg:block',
  xl: 'hidden xl:block',
}

const MOBILE_SHOW: Record<Breakpoint, string> = {
  sm: 'sm:hidden',
  md: 'md:hidden',
  lg: 'lg:hidden',
  xl: 'xl:hidden',
}

const ALIGN_CLASS: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

function alignOf<TRow>(c: ColumnDef<TRow>): Align {
  return c.align ?? (c.numeric ? 'right' : 'left')
}

function cellClasses<TRow>(c: ColumnDef<TRow>, ctx: CellContext<TRow> | null): string {
  const extra =
    typeof c.cellClassName === 'function' ? (ctx ? c.cellClassName(ctx) : '') : (c.cellClassName ?? '')
  return [
    ALIGN_CLASS[alignOf(c)],
    c.numeric ? 'tabular-nums' : '',
    c.hideBelow ? HIDE_BELOW[c.hideBelow] : '',
    c.width ?? '',
    c.minWidth ?? '',
    c.truncate ? `${c.truncate} truncate` : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ')
}

function isNil(v: unknown): boolean {
  // NaN cuenta como ausente. Si no, `a - b` devuelve NaN, el comparador se vuelve
  // inconsistente y V8 no sólo coloca mal ese valor: desordena la tabla entera.
  // Un `parseFloat('')` en un costo de inventario basta para provocarlo.
  if (typeof v === 'number' && Number.isNaN(v)) return true
  return v === null || v === undefined || v === ''
}

/** Compara sólo valores presentes. Los nulos NO se manejan aquí a propósito:
 *  van fuera del comparador para que invertir el sentido no los suba al principio. */
function defaultCompare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  return String(a).localeCompare(String(b), 'es-MX', { numeric: true, sensitivity: 'base' })
}

export function Table<TRow>({
  rows,
  columns,
  rowKey,
  sort,
  onSortChange,
  defaultSort,
  sortIndicator = 'directional',
  rowOrderIsMeaningful = false,
  loading = false,
  loadingMode = 'none',
  loadingNode,
  error,
  onRetry,
  empty,
  emptyMode = 'row',
  scroll = 'x',
  maxHeight,
  minWidth,
  stickyHeader = false,
  rowClassName,
  striped = false,
  onRowClick,
  expandable,
  showFooterRow = false,
  footerPlacement = 'tfoot',
  footerRowClassName = '',
  renderFooter,
  mobileCard,
  mobileBreakpoint = 'sm',
  limit,
  limitNotice,
  caption,
  className = '',
  tableClassName = '',
  theadClassName = '',
  tbodyClassName = '',
  'data-testid': testId,
}: TableProps<TRow>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(defaultSort ?? null)
  const activeSort = sort !== undefined ? sort : internalSort

  if (process.env.NODE_ENV !== 'production' && rowOrderIsMeaningful) {
    const offender = columns.find(c => c.sortable)
    if (offender) {
      console.error(
        `[Table] rowOrderIsMeaningful=true pero la columna "${offender.id}" es sortable. ` +
          'El orden de estas filas es dato (saldo corrido, variación contra la fila siguiente): ' +
          'reordenar produce números incorrectos, no sólo un orden distinto.',
      )
    }
  }

  /** El colSpan se calcula sobre las columnas que existen en el DOM. Hoy
   *  `pos/inventario-market:237` tiene la fila de vacío con un `<td>` sin colSpan. */
  const colSpan = columns.length

  const sorted = useMemo(() => {
    if (!activeSort) return rows
    const col = columns.find(c => c.id === activeSort.columnId)
    if (!col) return rows
    // Se precalcula el valor de orden por índice: así el comparador no hace
    // indexOf() (O(n) por comparación, y ambiguo si hay filas repetidas).
    const keyed = rows.map((row, i) => ({
      row,
      v: col.sortAccessor ? col.sortAccessor(row) : col.accessor ? col.accessor(row, i) : undefined,
    }))
    // Copia. Hoy `nomina:664` y `estado-resultados:297` hacen .sort() sobre el
    // array de estado DENTRO del render, que lo muta. Ordenar sobre copia corrige
    // eso; queda declarado en el PR porque cambia el comportamiento observable.
    keyed.sort((a, b) => {
      // Los nulos van al final SIEMPRE — antes de aplicar el sentido, o al
      // invertir a descendente se subirían al principio.
      const an = isNil(a.v)
      const bn = isNil(b.v)
      if (an && bn) return 0
      if (an) return 1
      if (bn) return -1
      const r = defaultCompare(a.v, b.v)
      return activeSort.dir === 'asc' ? r : -r
    })
    return keyed.map(k => k.row)
  }, [rows, activeSort, columns])

  const limited = limit != null ? sorted.slice(0, limit) : sorted
  const ctxOf = (row: TRow, i: number): CellContext<TRow> => ({
    row,
    index: i,
    rows: limited,
    isFirst: i === 0,
    isLast: i === limited.length - 1,
  })

  function toggleSort(id: string) {
    const next: SortState =
      activeSort?.columnId === id
        ? { columnId: id, dir: activeSort.dir === 'asc' ? 'desc' : 'asc' }
        : { columnId: id, dir: 'asc' }
    if (onSortChange) onSortChange(next)
    if (sort === undefined) setInternalSort(next)
  }

  const isEmpty = !loading && !error && limited.length === 0

  // ── Estados que reemplazan la tabla entera ─────────────────────────
  if (error) {
    return (
      <div className={className} data-testid={testId}>
        <div className="p-8 text-center text-sm text-[var(--text-3)]">
          {error}
          {onRetry && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onRetry}
                className="px-3 py-1.5 rounded-lg border border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)] text-sm"
              >
                Reintentar
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading && loadingMode === 'replace') {
    return (
      <div className={className} data-testid={testId}>
        {loadingNode ?? <div className="h-48 grid place-items-center text-[var(--text-3)] text-sm">Cargando…</div>}
      </div>
    )
  }

  if (isEmpty && emptyMode === 'hidden') return null
  if (isEmpty && emptyMode === 'replace') {
    return (
      <div className={className} data-testid={testId}>
        {empty}
      </div>
    )
  }

  // ── Cabecera ───────────────────────────────────────────────────────
  const thead = (
    <thead className={theadClassName}>
      <tr>
        {columns.map(c => {
          const sortableHere = c.sortable && !rowOrderIsMeaningful
          const isActive = activeSort?.columnId === c.id
          return (
            <th
              key={c.id}
              scope="col"
              title={c.headerTitle}
              aria-sort={isActive ? (activeSort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              onClick={sortableHere ? () => toggleSort(c.id) : undefined}
              // Ordenar tiene que poder hacerse con teclado: en la caja hay teclado
              // físico, y anunciar aria-sort para una acción que sólo responde al
              // ratón es prometer algo que no se cumple.
              tabIndex={sortableHere ? 0 : undefined}
              onKeyDown={
                sortableHere
                  ? e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSort(c.id)
                      }
                    }
                  : undefined
              }
              style={stickyHeader ? { zIndex: LAYER.stickyHeader } : undefined}
              className={[
                'px-3 py-2 text-xs font-semibold text-[var(--text-3)] whitespace-nowrap',
                ALIGN_CLASS[alignOf(c)],
                c.numeric ? 'tabular-nums' : '',
                c.hideBelow ? HIDE_BELOW[c.hideBelow] : '',
                c.width ?? '',
                c.minWidth ?? '',
                sortableHere ? 'cursor-pointer select-none hover:text-[var(--text-1)]' : '',
                stickyHeader ? 'sticky top-0 bg-[var(--surface-2)]' : '',
                c.headerClassName ?? '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className={`inline-flex items-center gap-1 ${alignOf(c) === 'right' ? 'flex-row-reverse' : ''}`}>
                {c.header}
                {sortableHere &&
                  (sortIndicator === 'static' ? (
                    <ArrowUpDown size={12} aria-hidden="true" className="opacity-50" />
                  ) : isActive ? (
                    activeSort!.dir === 'asc' ? (
                      <ChevronUp size={12} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={12} aria-hidden="true" />
                    )
                  ) : (
                    <ArrowUpDown size={12} aria-hidden="true" className="opacity-30" />
                  ))}
              </span>
            </th>
          )
        })}
      </tr>
    </thead>
  )

  // ── Filas ──────────────────────────────────────────────────────────
  function renderBodyRows() {
    if (isEmpty && (emptyMode === 'row' || emptyMode === 'sibling')) {
      if (emptyMode === 'sibling') return null
      return (
        <tr>
          <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-[var(--text-3)]">
            {empty}
          </td>
        </tr>
      )
    }

    if (loading && loadingMode === 'rows') {
      return Array.from({ length: 3 }).map((_, i) => (
        <tr key={`sk-${i}`} className="animate-pulse">
          {columns.map(c => (
            <td key={c.id} className={`px-3 py-3 ${c.hideBelow ? HIDE_BELOW[c.hideBelow] : ''}`}>
              <div className="h-3 rounded bg-[var(--surface-2)]" />
            </td>
          ))}
        </tr>
      ))
    }

    return limited.map((row, i) => {
      const ctx = ctxOf(row, i)
      const key = rowKey(row, i)
      const expanded = expandable?.isExpanded(row, i) ?? false
      const inlineExpand = expandable?.mode === 'inline-cell'

      const tr = (
        <tr
          key={key}
          onClick={
            onRowClick
              ? e => {
                  // Un clic nacido de un control no es un clic de fila. Sin esto,
                  // escribir en una celda editable abriría el detalle.
                  const t = e.target as HTMLElement
                  // Incluye controles NO nativos: un `<div role="button">Eliminar</div>`
                  // disparaba el borrado Y además abría el detalle de la fila.
                  if (
                    t.closest(
                      'input,select,textarea,button,a,label,summary,[role="button"],[role="checkbox"],[contenteditable],[data-no-row-click]',
                    )
                  )
                    return
                  onRowClick(ctx)
                }
              : undefined
          }
          className={[
            'border-b border-[var(--line-soft)] last:border-0',
            onRowClick ? 'cursor-pointer' : '',
            rowClassName?.(ctx) ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {columns.map((c, ci) => {
            let content: ReactNode
            if (c.render) content = c.render(ctx)
            else if (c.accessor) {
              const v = c.accessor(row, i)
              content = v === null || v === undefined ? '' : String(v)
            } else content = ''

            // collapseRepeated necesita un valor comparable. Con sólo `render`, los
            // dos lados son elementos de React y `String()` los vuelve
            // "[object Object]": colapsaría SIEMPRE y borraría filas legítimas
            // (Carnes/Carnes/Bebidas quedaba como Carnes/·/·). Se exige accessor.
            if (c.collapseRepeated && i > 0 && c.accessor) {
              const prevVal = c.accessor(limited[i - 1], i - 1)
              const curVal = c.accessor(row, i)
              if (!isNil(prevVal) && Object.is(prevVal, curVal)) content = ''
            }

            return (
              <td key={c.id} className={`px-3 py-2.5 text-sm ${cellClasses(c, ctx)}`}>
                {content}
                {inlineExpand && expanded && ci === 0 && expandable!.render(ctx, colSpan)}
              </td>
            )
          })}
        </tr>
      )

      if (expanded && expandable && !inlineExpand) {
        return [
          tr,
          <tr key={`${key}-exp`} className="border-b border-[var(--line-soft)]">
            <td colSpan={colSpan} className="px-3 py-3 bg-[var(--surface-2)]">
              {expandable.render(ctx, colSpan)}
            </td>
          </tr>,
        ]
      }
      return tr
    })
  }

  // ── Pie ────────────────────────────────────────────────────────────
  const footerCells =
    showFooterRow && !isEmpty ? (
      <tr className={`border-t-2 border-[var(--line)] font-semibold ${footerRowClassName}`}>
        {columns.map(c => (
          <td
            key={c.id}
            className={[
              'px-3 py-2.5 text-sm',
              ALIGN_CLASS[alignOf(c)],
              c.numeric ? 'tabular-nums' : '',
              // La propagación de hideBelow al pie es justo lo que hoy se olvida.
              c.hideBelow ? HIDE_BELOW[c.hideBelow] : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {/* `sorted`, NO `limited`: el pie suma TODAS las filas, no la página
                visible. Con limit=2 sobre 320/410/55 el total daba 730 en vez de
                785 — un descuadre de caja que el software imprime sin avisar. */}
            {typeof c.footer === 'function' ? c.footer(sorted) : c.footer}
          </td>
        ))}
      </tr>
    ) : null

  const freeFooter = renderFooter ? renderFooter(colSpan) : null

  const table = (
    <table className={`w-full border-collapse ${striped ? 'table-striped' : ''} ${tableClassName}`}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {thead}
      <tbody className={tbodyClassName}>
        {renderBodyRows()}
        {footerPlacement === 'tbody' && footerCells}
        {footerPlacement === 'tbody' && freeFooter}
      </tbody>
      {footerPlacement === 'tfoot' && (footerCells || freeFooter) && (
        <tfoot>
          {footerCells}
          {freeFooter}
        </tfoot>
      )}
    </table>
  )

  const scrollClass = [
    scroll === 'x' || scroll === 'both' ? 'overflow-x-auto' : '',
    scroll === 'y' || scroll === 'both' ? 'overflow-y-auto' : '',
    maxHeight ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const tableBranch = (
    <div className={scrollClass || undefined}>
      <div className={minWidth}>{table}</div>
    </div>
  )

  return (
    <div className={className} data-testid={testId}>
      {mobileCard ? (
        <>
          <div className={MOBILE_HIDE[mobileBreakpoint]}>{tableBranch}</div>
          <div className={`${MOBILE_SHOW[mobileBreakpoint]} divide-y divide-[var(--line-soft)]`}>
            {isEmpty ? (
              <div className="px-3 py-10 text-center text-sm text-[var(--text-3)]">{empty}</div>
            ) : (
              limited.map((row, i) => <div key={rowKey(row, i)}>{mobileCard(ctxOf(row, i))}</div>)
            )}
          </div>
        </>
      ) : (
        tableBranch
      )}

      {isEmpty && emptyMode === 'sibling' && <div>{empty}</div>}

      {loading && loadingMode === 'block' && (
        <div className="mt-2 p-3 border border-dashed border-[var(--line)] rounded-lg text-center text-sm text-[var(--text-3)]">
          {loadingNode ?? 'Cargando…'}
        </div>
      )}

      {limit != null && sorted.length > limit && limitNotice && (
        <div className="px-3 py-2 text-xs text-[var(--text-3)]">{limitNotice(limited.length, sorted.length)}</div>
      )}
    </div>
  )
}
