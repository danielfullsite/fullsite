// REPORT.md — derivado del sobre, nunca escrito a mano.
//
// Si el reporte se redactara aparte, tarde o temprano diría algo que el
// `run.json` no dice, y no habría forma de saber cuál de los dos mintió. Una
// sola fuente: esto es una proyección, no un documento.

import { writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const ICONO = {
  EXPECTED_BEHAVIOR: 'ok',
  PRODUCT_DEFECT: 'DEFECTO',
  HARNESS_ERROR: 'ARNÉS',
  ENVIRONMENT_ERROR: 'ENTORNO',
  PRECONDITION_FAILURE: 'PRECONDICIÓN',
  NOT_OBSERVED: 'NO OBSERVADO',
}

export function generar(sobre, dir) {
  const L = []
  const P = (s = '') => L.push(s)

  P(`# ${sobre.journey_id} · ${sobre.verdict}`)
  P()
  P(`> ${sobre.verdict_razon ?? ''}`)
  P()
  P('| | |')
  P('|---|---|')
  P(`| journey | ${sobre.journey_id} — ${sobre.journey_nombre} |`)
  P(`| run_id | \`${sobre.run_id}\` |`)
  P(`| inicio | ${sobre.started_at} |`)
  P(`| fin | ${sobre.finished_at ?? '—'} |`)
  P(`| contrato | Evidence Contract v${sobre.contract_version} |`)
  P()

  // ── Identidad ──────────────────────────────────────────────────────────────
  P('## Identidad de lo que se certificó')
  P()
  if (!sobre.identity) {
    P('No se pudo leer la identidad del build. **Sin esto el veredicto no se puede citar**: no se sabe sobre qué código se emitió.')
  } else {
    const i = sobre.identity
    P('| campo | valor |')
    P('|---|---|')
    for (const [k, v] of Object.entries(i)) P(`| ${k} | ${fmt(v)} |`)
  }
  P()

  // ── Precondiciones ─────────────────────────────────────────────────────────
  P('## Precondiciones (L0)')
  P()
  P(`**preconditions_satisfied = ${sobre.preconditions_satisfied}**`)
  P()
  const gates = (sobre.observations || []).filter(o => o.fase === 'preflight')
  if (gates.length) {
    P('| compuerta | clase | esperado | observado |')
    P('|---|---|---|---|')
    for (const g of gates) {
      P(`| ${g.id} · ${g.descripcion} | ${ICONO[g.classification] ?? g.classification} | ${fmt(g.esperado)} | ${fmt(g.observado)} |`)
    }
  }
  P()

  // ── Pasos ──────────────────────────────────────────────────────────────────
  P('## El guion')
  P()
  P(`**driver.executed = ${sobre.driver?.executed}** · pasos ${sobre.driver?.steps_ok ?? '—'}/${sobre.driver?.steps_total ?? '—'}`)
  P()
  if (sobre.steps?.length) {
    P('| # | paso | resultado | motivo | evidencia |')
    P('|---|---|---|---|---|')
    for (const s of sobre.steps) {
      const ev = s.evidencia ? `\`${basename(s.evidencia)}\`` : '—'
      P(`| ${s.n} | ${s.etiqueta} | ${s.ok ? 'ok' : 'FALLÓ'} | ${s.motivo ?? '—'} | ${ev} |`)
    }
    const fallado = sobre.steps.find(s => !s.ok)
    if (fallado?.enPantalla?.length) {
      P()
      P(`Controles en pantalla cuando falló el paso ${fallado.n}:`)
      P()
      P('```')
      P(fallado.enPantalla.join(' | '))
      P('```')
    }
  } else {
    P('El guion no se ejecutó.')
  }
  P()

  // ── Paridad y mutaciones ───────────────────────────────────────────────────
  P('## Paridad y mutaciones')
  P()
  if (sobre.parity) {
    P(`- V1 vs V1 → **${sobre.parity.diferencias} diferencias** ${sobre.parity.diferencias === 0 ? '(ZERO DELTA)' : ''}`)
    for (const d of sobre.parity.detalle ?? []) P(`  - \`${d.categoria}\`: ${d.motivo}`)
  } else {
    P('- paridad: no evaluada')
  }
  if (sobre.mutation) {
    const m = sobre.mutation
    P(`- mutaciones detectadas: **${m.detected}/${m.total}**`)
    for (const r of m.detalle ?? []) {
      P(`  - ${r.detectada ? 'detectada' : 'NO DETECTADA'} · \`${r.id}\` ${r.nombre}${r.aplicable === false ? ' — **NO APLICABLE**' : ''}`)
    }
    if (m.no_aplicables?.length) {
      P()
      P(`> **${m.no_aplicables.join(', ')} no se pudieron aplicar.** Una mutación no aplicable no es un aprobado: es una categoría de efectos que nadie está mirando. Cuenta como fallo.`)
    }
  } else {
    P('- mutaciones: no evaluadas')
  }
  P()
  if (sobre.manifest_effects) {
    P(`Efectos capturados por categoría: ${Object.entries(sobre.manifest_effects).filter(([, n]) => n > 0).map(([k, n]) => `\`${k}\`=${n}`).join(' · ') || '(ninguno)'}`)
    P()
  }

  // ── Oráculos ───────────────────────────────────────────────────────────────
  P('## Oráculos')
  P()
  const ors = Object.entries(sobre.oracles ?? {})
  if (!ors.length) P('Ninguno evaluado en esta corrida.')
  else {
    P('| oráculo | estado | detalle |')
    P('|---|---|---|')
    for (const [k, v] of ors) P(`| ${k} | ${v?.estado ?? '—'} | ${fmt(v?.detalle)} |`)
  }
  P()

  // ── Correlación ────────────────────────────────────────────────────────────
  P('## Correlación')
  P()
  P('```')
  P(`run_id  ${sobre.correlation?.run_id}`)
  for (const [k, v] of Object.entries(sobre.correlation ?? {})) {
    if (k === 'run_id') continue
    P(`  └─ ${k.padEnd(20)} ${v ?? '(no apareció en esta corrida)'}`)
  }
  P('```')
  P()

  // ── Resumen ────────────────────────────────────────────────────────────────
  P('## Resumen por clase')
  P()
  P('| clase | n |')
  P('|---|---|')
  for (const [k, v] of Object.entries(sobre.summary ?? {})) if (v) P(`| ${k} | ${v} |`)
  P()
  P(`Artefactos en \`${sobre.artifacts_dir ?? '—'}\`.`)
  P()

  const texto = L.join('\n')
  const ruta = join(dir, 'REPORT.md')
  writeFileSync(ruta, texto)
  return ruta
}

function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return '`' + JSON.stringify(v).slice(0, 160) + '`'
  return String(v).replace(/\|/g, '\\|').slice(0, 200)
}
