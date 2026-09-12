type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>

export type BorradorPOS = {
  items: unknown[]
  orderId: string
  mesero: string
  personas: number
}

/** Keep the draft age tied to an operator edit, not to restoring the editor. */
export function guardarBorradorPOS(
  mesa: number,
  payload: BorradorPOS,
  storage: DraftStorage = localStorage,
  now = Date.now(),
): void {
  const key = `pos_draft_${mesa}`
  let ts = now
  const previousRaw = storage.getItem(key)
  if (previousRaw) {
    try {
      const previous = JSON.parse(previousRaw)
      const previousPayload = {
        items: previous?.items,
        orderId: previous?.orderId,
        mesero: previous?.mesero,
        personas: previous?.personas,
      }
      if (typeof previous?.ts === 'number' && JSON.stringify(previousPayload) === JSON.stringify(payload)) {
        ts = previous.ts
      }
    } catch { /* replace a corrupt draft below */ }
  }
  storage.setItem(key, JSON.stringify({ ...payload, ts }))
}
