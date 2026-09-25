/**
 * Motor de la capa de decisión Jev — modo shadow.
 *
 *   entrada → instantánea (copia plana) → redacción (rechaza) → hash
 *           → policy gate previo → reglas locales (siempre) → Jev (opina, si procede)
 *           → policy gate posterior (sólo reglas) → auditoría → recomendación
 *
 * En shadow la decisión vigente es SIEMPRE la de reglas, y la autoridad y la
 * política dependen sólo de la entrada y de las reglas: la salida es la misma
 * con Jev disponible, caído o apagado. Lo que Jev opina y lo que habría escalado
 * se registra al lado (`jev`, `agreement`, `shadow_notes`). No existe otro modo.
 * Nada aquí ejecuta acciones: la salida es una recomendación `executable: false`.
 *
 * `evaluateDecision` no lanza: ante cualquier falla devuelve una recomendación
 * bloqueada, para que ningún llamador dependa de Jev.
 */
import type { Authority, DecisionInput, EffectDomain, JevOutcome, Recommendation, UseCaseOrInvalid } from './contract'
import { FORBIDDEN_DOMAINS, JEV_CONTRACT_VERSION, JEV_MODEL_ID } from './contract'
import type { JevAdapter } from './adapter'
import { sanitizeDetail } from './adapter'
import type { AuditSink } from './audit'
import { postGate, preGate, shadowNotes } from './policy-gate'
import { TENANT_REF_RE, checkInput, hashInput, isUseCase, snapshotInput } from './redaction'
import { USE_CASE_SPECS } from './use-cases'

export interface EngineDeps {
  jev: JevAdapter
  audit: AuditSink
}

const blockedJev = (reason: NonNullable<JevOutcome['block_reason']>, detail: string | null): JevOutcome => ({
  status: 'blocked',
  decision: null,
  distribution: null,
  block_reason: reason,
  detail: detail === null ? null : sanitizeDetail(detail),
  latency_ms: null,
  input_tokens: null,
  cost_usd: null,
  provider: null,
  model: JEV_MODEL_ID,
})

function rejected(useCase: UseCaseOrInvalid, authority: Authority, policy: string[], detail: string): Recommendation {
  return {
    contract_version: JEV_CONTRACT_VERSION,
    mode: 'shadow',
    executable: false,
    use_case: useCase,
    authority,
    policy_applied: policy,
    input_hash: '',
    effective: null,
    effective_source: null,
    rules: null,
    jev: blockedJev('input_rejected', detail),
    agreement: 'not_compared',
    shadow_notes: [],
  }
}

export async function evaluateDecision(rawInput: unknown, deps: EngineDeps): Promise<Recommendation> {
  try {
    return await evaluateUnsafe(rawInput, deps)
  } catch (e) {
    // Última red: una falla inesperada no se convierte en excepción del llamador.
    const rec = rejected('invalid', 'HUMAN_REQUIRED', ['reject:internal_error'], e instanceof Error ? e.name : 'error')
    return auditOrEscalate(rec, 'invalid', deps)
  }
}

async function evaluateUnsafe(rawInput: unknown, deps: EngineDeps): Promise<Recommendation> {
  const snap = snapshotInput(rawInput)
  if (snap === null) {
    // Ilegible (circular, getters que lanzan, no serializable): no sabemos qué dominios toca → falla cerrado.
    return auditOrEscalate(rejected('invalid', 'FORBIDDEN', ['forbidden:unreadable_input'], 'entrada no serializable'), 'invalid', deps)
  }

  const check = checkInput(snap)
  if (!check.ok) {
    // La entrada rechazada no se hashea ni se audita con su contenido: sólo el motivo.
    const raw = (snap && typeof snap === 'object' ? snap : {}) as Partial<DecisionInput>
    const useCase: UseCaseOrInvalid = isUseCase(raw.use_case) ? raw.use_case : 'invalid'
    // Un rechazo nunca baja la autoridad: si declaró un dominio prohibido, sale FORBIDDEN.
    const declared = Array.isArray(raw.effect_domains) ? raw.effect_domains : []
    const forbidden = declared.filter((d): d is EffectDomain => FORBIDDEN_DOMAINS.includes(d as EffectDomain))
    const rec =
      forbidden.length > 0
        ? rejected(useCase, 'FORBIDDEN', ['reject:redaction', ...forbidden.map((d) => `forbidden:${d}`)], check.violations.slice(0, 5).join('; '))
        : rejected(useCase, 'HUMAN_REQUIRED', ['reject:redaction'], check.violations.slice(0, 5).join('; '))
    const tenant = typeof raw.tenant_ref === 'string' && TENANT_REF_RE.test(raw.tenant_ref) ? raw.tenant_ref : 'invalid'
    return auditOrEscalate(rec, tenant, deps)
  }

  const input = snap as DecisionInput
  const input_hash = hashInput(input)
  const spec = USE_CASE_SPECS[input.use_case]
  const pre = preGate(input)

  if (pre.authority === 'FORBIDDEN') {
    const rec: Recommendation = {
      contract_version: JEV_CONTRACT_VERSION,
      mode: 'shadow',
      executable: false,
      use_case: input.use_case,
      authority: 'FORBIDDEN',
      policy_applied: pre.policy,
      input_hash,
      effective: null,
      effective_source: null,
      rules: null,
      jev: blockedJev('forbidden_authority', null),
      agreement: 'not_compared',
      shadow_notes: [],
    }
    return auditOrEscalate(rec, input.tenant_ref, deps)
  }

  let rules = null
  try {
    rules = spec.rules(input.state)
  } catch {
    rules = null
  }
  let jev: JevOutcome
  try {
    // Jev recibe su propia copia: nada de lo que haga el adaptador toca el estado de las reglas.
    jev = await deps.jev.evaluate(JSON.parse(JSON.stringify(input.state)), spec)
  } catch (e) {
    jev = blockedJev('network_error', e instanceof Error ? e.message : 'error')
  }
  const post = postGate(pre, rules)
  const notes = shadowNotes(rules, jev.status === 'ok' ? jev.decision : null)
  if (jev.status !== 'ok') notes.push(`jev:blocked:${jev.block_reason}`)
  const rec: Recommendation = {
    contract_version: JEV_CONTRACT_VERSION,
    mode: 'shadow',
    executable: false,
    use_case: input.use_case,
    authority: post.authority,
    policy_applied: post.policy,
    input_hash,
    effective: rules,
    effective_source: rules ? 'rules' : null,
    rules,
    jev,
    agreement:
      rules && jev.status === 'ok' && jev.decision ? (rules.label === jev.decision.label ? 'agree' : 'disagree') : 'not_compared',
    shadow_notes: notes,
  }
  return auditOrEscalate(rec, input.tenant_ref, deps)
}

function auditOrEscalate(rec: Recommendation, tenant_ref: string, deps: EngineDeps): Recommendation {
  try {
    deps.audit.append({
      contract_version: JEV_CONTRACT_VERSION,
      use_case: rec.use_case,
      tenant_ref,
      input_hash: rec.input_hash,
      authority: rec.authority,
      policy_applied: rec.policy_applied,
      model: JEV_MODEL_ID,
      provider: rec.jev.provider,
      latency_ms: rec.jev.latency_ms,
      input_tokens: rec.jev.input_tokens,
      cost_usd: rec.jev.cost_usd,
      jev_status: rec.jev.status,
      jev_block_reason: rec.jev.block_reason,
      jev_decision: rec.jev.decision,
      rules_decision: rec.rules,
      effective_source: rec.effective_source,
      agreement: rec.agreement,
      shadow_notes: rec.shadow_notes,
    })
    return rec
  } catch {
    // Si no se pudo auditar, la recomendación no sale como AUTO.
    return {
      ...rec,
      authority: rec.authority === 'FORBIDDEN' ? 'FORBIDDEN' : 'HUMAN_REQUIRED',
      policy_applied: [...rec.policy_applied, 'human:audit_failed'],
    }
  }
}
