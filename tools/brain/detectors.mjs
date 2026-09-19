// Los detectores de los siete agentes construibles hoy.
//
// POR QUÉ UN SOLO ARCHIVO Y NO SIETE
//   Los siete hacen lo mismo: leen observaciones deterministas, aplican reglas
//   puras y devuelven hallazgos. Siete archivos casi idénticos serían siete
//   sitios donde olvidar la misma regla. Aquí la regla vive una vez.
//
// TODOS SON PUROS
//   No leen disco, no tocan red, no consultan la base. Reciben `obs` —lo que
//   alguien más capturó en sólo lectura— y devuelven hallazgos. Por eso se
//   pueden probar sin entorno, que es lo que la autoprueba hace.
//
// LA REGLA QUE COMPARTEN
//   Sin observación no hay veredicto: se devuelve UNKNOWN con su motivo. Ningún
//   detector produce OK por omisión.

import { ESTADOS, sinEvidencia, edadMin } from './lib/artifact.mjs'

const hallazgo = (id, state, summary, evidence = [], extra = {}) =>
  ({ id, state, summary, evidence, ...extra })

/** ¿La observación existe y trae datos? Si no, el detector se declara ciego. */
const ciego = (v, que) => (v === undefined || v === null) ? sinEvidencia(`no se observó ${que}`) : null

// ─────────────────────────────────────────────────────────────────────────────
export const RELEASE_GUARDIAN = {
  id: 'RELEASE_GUARDIAN', level: 'L1',
  run(obs, ctx) {
    const f = []
    const c = ciego(obs.serving, 'qué SHA está sirviendo')
    if (c) f.push(hallazgo('serving_sha', c.state, c.reason))
    else {
      const art = (ctx.releaseArtifacts || []).find(a => a.what_shipped?.code_sha === obs.serving.code_sha)
      f.push(art
        ? hallazgo('serving_sha', ESTADOS.OK, `el SHA servido tiene artefacto de release`,
            [{ artifact: art.artifact_kind, sha: obs.serving.code_sha }])
        : hallazgo('serving_sha', ESTADOS.ALERT, 'el SHA servido NO tiene artefacto de release',
            [{ sha: obs.serving.code_sha }],
            { why: 'sin artefacto no se puede contestar qué se liberó ni con qué evidencia' }))
    }
    const anc = ciego(obs.p0a_ancestor, 'si P0A_FINAL_SHA sigue siendo ancestro')
    if (anc) f.push(hallazgo('p0a_ancestor', anc.state, anc.reason))
    else f.push(obs.p0a_ancestor
      ? hallazgo('p0a_ancestor', ESTADOS.OK, 'P0A_FINAL_SHA sigue siendo ancestro de la línea')
      : hallazgo('p0a_ancestor', ESTADOS.ALERT, 'P0A_FINAL_SHA dejó de ser ancestro: la línea certificada se rompió'))
    return f
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export const DATA_TRUTH_GUARDIAN = {
  id: 'DATA_TRUTH_GUARDIAN', level: 'L1',
  run(obs) {
    const f = []
    const c = ciego(obs.tenant_freshness, 'la frescura por tenant')
    if (c) return [hallazgo('freshness', c.state, c.reason)]
    for (const t of obs.tenant_freshness) {
      const edad = edadMin(t.last_order_at, obs.now_ms)
      if (edad === null) { f.push(hallazgo(`freshness:${t.tenant}`, ESTADOS.UNKNOWN, 'sin fecha legible de última orden')); continue }
      const horas = Math.round(edad / 60)
      // 72 h contempla fin de semana: es el umbral que /api/health ya usa.
      if (horas > 72) f.push(hallazgo(`freshness:${t.tenant}`, ESTADOS.DEGRADED,
        `sin órdenes desde hace ${horas} h`, [{ tenant: t.tenant, last: t.last_order_at }]))
      else f.push(hallazgo(`freshness:${t.tenant}`, ESTADOS.OK, `última orden hace ${horas} h`))
    }
    return f
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export const SOURCE_AUTHORITY_GUARDIAN = {
  id: 'SOURCE_AUTHORITY_GUARDIAN', level: 'L1',
  run(obs) {
    const c = ciego(obs.contract_tables, 'qué tablas tienen contrato de RPC')
    if (c) return [hallazgo('bypass', c.state, c.reason)]
    const f = []
    for (const t of obs.contract_tables) {
      // Un contrato se cumple cuando es el ÚNICO camino, no cuando es el recomendado.
      if (t.in_proxy_allow) f.push(hallazgo(`bypass:${t.table}`, ESTADOS.ALERT,
        `tiene RPC de contrato (${t.rpc}) y sigue expuesta por el proxy`,
        [{ table: t.table, rpc: t.rpc, min_role: t.min_role ?? 'cualquiera' }],
        { invariant: 'INV-07' }))
      else f.push(hallazgo(`bypass:${t.table}`, ESTADOS.OK, `sólo se escribe por ${t.rpc}`))
    }
    return f
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export const SECURITY_CONFIG_GUARDIAN = {
  id: 'SECURITY_CONFIG_GUARDIAN', level: 'L1',
  run(obs) {
    const f = []
    const c = ciego(obs.enrolled_terminal_flag, 'el flag pos.require_enrolled_terminal')
    if (c) f.push(hallazgo('enrolled_terminal_trap', c.state, c.reason))
    else {
      const tablaFalta = obs.pos_terminals_exists === false
      for (const t of obs.enrolled_terminal_flag) {
        if (t.value === true && tablaFalta) f.push(hallazgo(`enrolled_terminal_trap:${t.tenant}`, ESTADOS.ALERT,
          'flag ENCENDIDO y la tabla pos_terminals no existe: el login de nube responde 503',
          [{ tenant: t.tenant }], { severity: 'CRITICAL' }))
        else if (tablaFalta) f.push(hallazgo(`enrolled_terminal_trap:${t.tenant}`, ESTADOS.DEGRADED,
          'trampa armada: el flag existe apagado y su tabla no existe',
          [{ tenant: t.tenant, value: t.value }],
          { rule: 'ningún agente, en ningún nivel, cambia esta configuración' }))
        else f.push(hallazgo(`enrolled_terminal_trap:${t.tenant}`, ESTADOS.OK, 'la tabla existe'))
      }
    }
    const rl = ciego(obs.receipt_ledger_writable, 'si el libro de recibos es escribible por el proxy')
    if (rl) f.push(hallazgo('receipt_ledger', rl.state, rl.reason))
    else f.push(obs.receipt_ledger_writable
      ? hallazgo('receipt_ledger', ESTADOS.ALERT, 'pos_save_operations es escribible por el proxy con cualquier rol',
          [], { note: 'hallazgo estático, sin reproducir en runtime' })
      : hallazgo('receipt_ledger', ESTADOS.OK, 'el libro de recibos no es escribible por el cliente'))
    return f
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export const CASH_AND_SHIFT_GUARDIAN = {
  id: 'CASH_AND_SHIFT_GUARDIAN', level: 'L1',
  run(obs) {
    const f = []
    const c = ciego(obs.open_shifts, 'los turnos abiertos')
    if (c) return [hallazgo('open_shifts', c.state, c.reason)]
    const porTenant = {}
    for (const s of obs.open_shifts) (porTenant[s.tenant] ||= []).push(s)
    for (const [tenant, lista] of Object.entries(porTenant)) {
      if (lista.length > 1) f.push(hallazgo(`multiple_open:${tenant}`, ESTADOS.ALERT,
        `${lista.length} turnos abiertos a la vez`, lista.map(s => ({ shift: s.id })),
        { severity: 'CRITICAL', why: 'el Corte Z cierra uno y el otro queda abierto para siempre' }))
      const viejo = lista.filter(s => (edadMin(s.opened_at, obs.now_ms) ?? 0) > 24 * 60)
      for (const s of viejo) f.push(hallazgo(`stale_open:${tenant}:${s.id}`, ESTADOS.DEGRADED,
        `turno abierto hace ${Math.round(edadMin(s.opened_at, obs.now_ms) / 60)} h`))
      if (lista.length === 1 && viejo.length === 0) f.push(hallazgo(`open_shifts:${tenant}`, ESTADOS.OK, 'un turno abierto'))
    }
    const inv = ciego(obs.open_shift_index_exists, 'si existe el índice de turno único')
    if (inv) f.push(hallazgo('open_shift_invariant', inv.state, inv.reason))
    else f.push(obs.open_shift_index_exists
      ? hallazgo('open_shift_invariant', ESTADOS.OK, 'el índice único impide dos turnos abiertos')
      : hallazgo('open_shift_invariant', ESTADOS.ALERT,
          'no existe el índice: nada impide dos turnos abiertos', [], { blocker: 'CURRENT_RELEASE' }))
    const cm = ciego(obs.cash_movements_without_op_id, 'movimientos de caja sin client_op_id')
    if (cm) f.push(hallazgo('cash_identity', cm.state, cm.reason))
    else f.push(obs.cash_movements_without_op_id > 0
      ? hallazgo('cash_identity', ESTADOS.DEGRADED,
          `${obs.cash_movements_without_op_id} movimientos de caja sin identidad lógica`)
      : hallazgo('cash_identity', ESTADOS.OK, 'todo movimiento de caja lleva client_op_id'))
    return f
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export const INCIDENT_TRIAGE_AGENT = {
  id: 'INCIDENT_TRIAGE_AGENT', level: 'L1',
  // Las seis clases son del arnés (cert/CONTRATO-v1.md). No se inventa ninguna.
  CLASES: ['EXPECTED_BEHAVIOR', 'PRECONDITION_FAILURE', 'ENVIRONMENT_ERROR', 'HARNESS_ERROR', 'NOT_OBSERVED', 'PRODUCT_DEFECT'],
  run(obs) {
    const c = ciego(obs.findings, 'hallazgos por clasificar')
    if (c) return [hallazgo('triage', c.state, c.reason)]
    const f = []
    for (const h of obs.findings) {
      if (!this.CLASES.includes(h.class)) {
        f.push(hallazgo(`triage:${h.id}`, ESTADOS.ALERT, `clase fuera del contrato: ${h.class}`)); continue
      }
      // La regla que más se rompe, y la que más caro sale.
      if (h.class === 'NOT_OBSERVED' && h.treated_as === 'PASS')
        f.push(hallazgo(`triage:${h.id}`, ESTADOS.ALERT, 'NOT_OBSERVED tratado como PASS', [{ finding: h.id }],
          { rule: 'NOT_OBSERVED nunca es PASS' }))
      else if (h.class === 'PRODUCT_DEFECT' && h.reproduced !== true)
        f.push(hallazgo(`triage:${h.id}`, ESTADOS.DEGRADED, 'declarado PRODUCT_DEFECT sin reproducir',
          [{ finding: h.id }], { rule: 'STATIC FINDING != PRODUCT DEFECT' }))
      else f.push(hallazgo(`triage:${h.id}`, ESTADOS.OK, `clasificado ${h.class}`))
    }
    return f
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export const AI_OPERATIONS_ANALYST = {
  id: 'AI_OPERATIONS_ANALYST', level: 'L1',
  /** No detecta: interpreta. Toda frase rinde el artefacto del que salió. */
  run(_obs, ctx) {
    const arts = ctx.artifacts || []
    if (arts.length === 0) return [hallazgo('brief', ESTADOS.UNKNOWN, 'no hay artefactos que interpretar')]
    const alertas = arts.flatMap(a => (a.findings || []).filter(x => x.state === ESTADOS.ALERT)
      .map(x => ({ artifact: a.artifact_kind, id: x.id, summary: x.summary })))
    const desconocidos = arts.flatMap(a => (a.findings || []).filter(x => x.state === ESTADOS.UNKNOWN).length)
      .reduce((s, n) => s + n, 0)
    return [hallazgo('brief', alertas.length ? ESTADOS.ALERT : ESTADOS.OK,
      `${alertas.length} alerta(s) · ${desconocidos} sin evidencia, de ${arts.length} artefactos`,
      alertas, { rule: 'toda afirmación cita su artefacto; sin artefacto, UNKNOWN' })]
  },
}

export const AGENTES = {
  RELEASE_GUARDIAN, DATA_TRUTH_GUARDIAN, SOURCE_AUTHORITY_GUARDIAN,
  SECURITY_CONFIG_GUARDIAN, CASH_AND_SHIFT_GUARDIAN, INCIDENT_TRIAGE_AGENT, AI_OPERATIONS_ANALYST,
}
