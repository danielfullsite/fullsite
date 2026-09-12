export interface CancelWatchOrder {
  id: string
  status: string
  platform: string
  platform_order_id: string | null
  customer_name: string
  total: number
}

const IN_PROGRESS = new Set(['nueva', 'aceptada', 'preparando', 'lista', 'en_ruta', 'recibida'])

export interface ExternalCancellation {
  id: string
  platform: string
  platform_order_id: string | null
  customer_name: string
  total: number
  previousStatus: string
  kitchenInProgress: boolean
}

export function detectExternalCancellations(
  previous: CancelWatchOrder[],
  current: CancelWatchOrder[],
  cancelledLocally: ReadonlySet<string> = new Set(),
  alerted: ReadonlySet<string> = new Set(),
): ExternalCancellation[] {
  if (!previous.length) return []
  const before = new Map(previous.map(order => [order.id, order]))
  const result: ExternalCancellation[] = []
  for (const order of current) {
    if (order.status !== 'cancelada' || cancelledLocally.has(order.id) || alerted.has(order.id)) continue
    const prior = before.get(order.id)
    if (!prior || prior.status === 'cancelada') continue
    result.push({
      id: order.id,
      platform: order.platform,
      platform_order_id: order.platform_order_id,
      customer_name: order.customer_name,
      total: order.total,
      previousStatus: prior.status,
      kitchenInProgress: IN_PROGRESS.has(prior.status),
    })
  }
  return result
}

export function cancellationMessage(cancellation: ExternalCancellation): string {
  const platform = cancellation.platform === 'ubereats' ? 'Uber Eats' : cancellation.platform === 'rappi' ? 'Rappi' : cancellation.platform
  const customer = cancellation.customer_name && cancellation.customer_name !== 'Cliente Uber' ? ` de ${cancellation.customer_name}` : ''
  return cancellation.kitchenInProgress
    ? `${platform} CANCELÓ la orden${customer} — avisa a cocina, puede estar preparándose.`
    : `${platform} canceló la orden${customer}.`
}

export function soundCancellationAlert(times = 3): void {
  try {
    const owner = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Context = owner.AudioContext ?? owner.webkitAudioContext
    if (!Context) return
    const context = new Context()
    for (let i = 0; i < times; i++) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = 880
      gain.gain.value = 0.08
      oscillator.connect(gain)
      gain.connect(context.destination)
      const at = context.currentTime + i * 0.45
      oscillator.start(at)
      oscillator.stop(at + 0.22)
    }
  } catch { /* the persistent visual alert remains */ }
}
