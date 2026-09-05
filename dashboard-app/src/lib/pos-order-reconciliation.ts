import type { OrderItem } from './pos-data'

export interface CuentaEditable {
  items: OrderItem[]
  mesero: string
  personas: number
  discount: number
  notas: string
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.keys(a), right = Object.keys(b)
  return left.length === right.length && left.every(k => Object.hasOwn(b, k) &&
    equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Three-way merge against the last accepted snapshot. New remote items arrive
 * while local drafts/edits survive. Concurrent changes to the same item/field
 * are explicit conflicts and may not silently advance the writable revision. */
export function reconciliarCuenta(base: CuentaEditable, local: CuentaEditable, remote: CuentaEditable): {
  cuenta: CuentaEditable; conflictos: string[]
} {
  const conflictos: string[] = []
  function pick<T>(name: string, before: T, mine: T, theirs: T): T {
    if (equal(mine, before)) return theirs
    if (equal(theirs, before) || equal(mine, theirs)) return mine
    conflictos.push(name)
    return mine
  }
  const byId = (items: OrderItem[]) => new Map(items.map(item => [item.id, item]))
  const old = byId(base.items), mine = byId(local.items), theirs = byId(remote.items)
  const ids = new Set([...theirs.keys(), ...mine.keys(), ...old.keys()])
  const items: OrderItem[] = []
  for (const id of ids) {
    const item = pick(`platillo:${id}`, old.get(id), mine.get(id), theirs.get(id))
    if (item) items.push(item)
  }
  return { cuenta: {
    items,
    mesero: pick('mesero', base.mesero, local.mesero, remote.mesero),
    personas: pick('personas', base.personas, local.personas, remote.personas),
    discount: pick('descuento', base.discount, local.discount, remote.discount),
    notas: pick('notas', base.notas, local.notas, remote.notas),
  }, conflictos }
}

export function cuentaEditableDe(orden: Record<string, unknown>): CuentaEditable {
  return {
    items: orden.items as OrderItem[],
    mesero: typeof orden.mesero === 'string' ? orden.mesero : '',
    personas: Number(orden.personas ?? 0),
    discount: Number(orden.descuento ?? 0),
    notas: typeof orden.notas === 'string' ? orden.notas : '',
  }
}
