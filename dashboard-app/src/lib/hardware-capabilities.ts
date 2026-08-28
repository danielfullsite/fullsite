// Autoconfiguración por capacidades + confidence score. Motor PURO.
//
// POR QUÉ
// Ya existen el descubrimiento mDNS y el adapter ESC/POS. Falta el contrato que convierte la
// evidencia cruda de un escaneo (LAN/USB/HID) en una PROPUESTA explicable con confianza, que un
// humano confirma antes de guardar. Reglas duras:
//   1. Nunca 100% para hardware desconocido: la confianza automática está topada (< 1.0).
//   2. Siempre hay fallback manual: si nada convence, se ofrece configurar a mano.
//   3. Nada se guarda sin confirmación humana: esto sólo PROPONE.
//   4. No prometer soporte universal: un adapter cubre capacidades declaradas, no "todo".

export type Capability =
  | 'print_escpos' | 'print_usb' | 'cash_drawer' | 'scanner_hid' | 'local_server'

export interface DiscoveryEvidence {
  /** Señal observada: 'mdns_service' | 'usb_vendor_match' | 'tcp_9100_open' | 'hid_descriptor' | ... */
  signal: string
  /** Peso de la señal en [0,1]. */
  weight: number
  detail?: string
}

export interface DiscoveryCandidate {
  id: string
  kind: string                 // 'printer' | 'cash_drawer' | 'scanner' | 'local_server'
  capability: Capability
  adapter: string              // qué adapter lo manejaría (por capacidad, no por marca)
  evidence: DiscoveryEvidence[]
  /** true sólo si hay una identidad de modelo positivamente reconocida. */
  knownModel?: boolean
}

// Tope de confianza para descubrimiento automático. Jamás 1.0: el hardware desconocido no se
// afirma con certeza. Un modelo reconocido llega más alto, pero sigue topado.
const CAP_UNKNOWN = 0.6
const CAP_KNOWN = 0.95

export interface ScoredCandidate extends DiscoveryCandidate {
  confidence: number           // [0, CAP_KNOWN]
  explanation: string
}

/** Combina la evidencia en una confianza topada. Determinista. Nunca ≥ 1.0. */
export function scoreConfidence(candidate: DiscoveryCandidate): number {
  const cap = candidate.knownModel ? CAP_KNOWN : CAP_UNKNOWN
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : []
  if (evidence.length === 0) return 0
  // Combinación probabilística (1 - ∏(1 - wᵢ)) acotada al tope. Más señales → más confianza,
  // pero nunca supera el tope de su categoría.
  let acc = 1
  for (const e of evidence) {
    const w = typeof e.weight === 'number' && e.weight >= 0 && e.weight <= 1 ? e.weight : 0
    acc *= (1 - w)
  }
  const raw = 1 - acc
  return Math.min(raw, cap)
}

export function scoreCandidate(candidate: DiscoveryCandidate): ScoredCandidate {
  const confidence = scoreConfidence(candidate)
  const señales = (candidate.evidence || []).map((e) => e.signal).join(', ') || 'sin señales'
  const explanation = candidate.knownModel
    ? `Modelo reconocido para ${candidate.capability} (adapter ${candidate.adapter}). Señales: ${señales}.`
    : `Hardware compatible con ${candidate.capability} (adapter ${candidate.adapter}), no identificado con certeza. Señales: ${señales}.`
  return { ...candidate, confidence, explanation }
}

export interface HardwareProposal {
  best: ScoredCandidate | null
  alternatives: ScoredCandidate[]
  /** Siempre presente: configurar a mano si la propuesta no convence. */
  manualFallback: { adapter: 'manual'; label: string }
  /** Siempre true: nada se guarda sin que un humano confirme. */
  requiresConfirmation: true
}

/**
 * Construye la propuesta a partir de candidatos. Ordena por confianza (desc). Siempre incluye el
 * fallback manual y exige confirmación. Con cero candidatos, best=null y sólo queda el manual.
 */
export function buildProposal(candidates: DiscoveryCandidate[]): HardwareProposal {
  const scored = (Array.isArray(candidates) ? candidates : [])
    .map(scoreCandidate)
    .sort((a, b) => b.confidence - a.confidence)
  return {
    best: scored[0] ?? null,
    alternatives: scored.slice(1),
    manualFallback: { adapter: 'manual', label: 'Configurar manualmente' },
    requiresConfirmation: true,
  }
}
