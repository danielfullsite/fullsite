// EL SELLO Y LAS PRECONDICIONES — la capa 0.
//
// Antes de tocar el producto se contesta una sola pregunta: ¿este sistema está
// en condiciones de ser certificado? Si no, la corrida termina en
// PRECONDITION_FAILURE y NO se ejecuta nada más. Un arnés que corre sobre un
// sistema mal sellado produce un veredicto que no se puede citar después.
//
// El sello NO se reimplementa aquí. Pedro ya lo calcula en
// `local-server/core/identidad-de-terminal.js` y lo expone en `/identity`:
// `git_sha`, `branch`, `clean`, `etiqueta`, el sha del paquete de interfaz, y
// el chequeo de coherencia cáscara↔interfaz. Esto sólo lo lee y lo exige.
//
// SEGURIDAD: aquí no se lee ninguna credencial. Sólo HTTP a Pedro en la LAN,
// `df` local y `git` local. Ni una variable de entorno con secretos.

import { execFileSync } from 'node:child_process'
import { statfsSync } from 'node:fs'
import { ENTORNO } from './objetivo-g01.mjs'

const MIN_DISCO_MB = Number(process.env.CERT_MIN_DISCO_MB || 2048)
const TIMEOUT_MS   = Number(process.env.CERT_HTTP_TIMEOUT_MS || 4000)

async function traer(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    const cuerpo = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, cuerpo }
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) }
  } finally { clearTimeout(t) }
}

function git(args) {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim() } catch { return null }
}

/**
 * Corre las compuertas y devuelve { gates, sello, identity, seqInicial, satisfechas }.
 * Cada compuerta trae su propia `causa` para que la clasificación sepa a quién
 * imputarle el fallo: `entorno` no es lo mismo que `precondicion`.
 */
export async function preflight({ shaEsperado = process.env.CERTIFICATION_RUN_SHA || null } = {}) {
  const gates = []
  const G = (id, nombre, ok, { esperado = null, observado = null, causa = 'precondicion' } = {}) =>
    gates.push({ id, nombre, ok, esperado, observado, causa })

  // ── G-1 · El SHA congelado y el árbol limpio ──────────────────────────────
  const headLargo = git(['rev-parse', 'HEAD'])
  const sucio = git(['status', '--porcelain'])
  G('G-1a', 'HEAD legible', !!headLargo, { observado: headLargo })
  G('G-1b', 'árbol de trabajo limpio', sucio === '', {
    esperado: 'sin cambios', observado: sucio === '' ? 'limpio' : `${sucio.split('\n').length} archivos sucios`,
  })
  // G-1c · El checkout desciende del SHA certificado.
  //
  // NO se exige `HEAD === CERTIFICATION_RUN_SHA`. El arnés vive por necesidad
  // ENCIMA de la base de producto: en cuanto el rig se comitea, HEAD deja de
  // ser el SHA del build y la igualdad es imposible de cumplir. Es la misma
  // distinción que separa PRODUCT_BASE_SHA de CERTIFICATION_RUN_SHA.
  //
  // El invariante que sí importa es la descendencia: el arnés tiene que estar
  // construido sobre el código que se está certificando, no sobre una rama
  // lateral. Quién es el build lo dicen G-5e y G-5f, que comparan contra la
  // identidad que reporta Pedro — ésa es la autoridad, no el HEAD del disco.
  if (shaEsperado) {
    const desciende = !!headLargo && (
      headLargo === shaEsperado ||
      (() => { try { execFileSync('git', ['merge-base', '--is-ancestor', shaEsperado, 'HEAD']); return true } catch { return false } })()
    )
    G('G-1c', 'el checkout desciende de CERTIFICATION_RUN_SHA', desciende, {
      esperado: `descendiente de ${shaEsperado.slice(0, 12)}`,
      observado: headLargo ? `HEAD ${headLargo.slice(0, 12)}${desciende ? ' (desciende)' : ' (rama lateral)'}` : null,
    })
  }

  // ── G-2 · Disco. RM-6 midió 317 Mi libres al 99% y llegó a ENOSPC: una
  //         corrida sin disco produce fallos que parecen defectos.
  let discoMb = null
  try {
    const s = statfsSync('/')
    discoMb = Math.round((s.bsize * s.bavail) / 1048576)
  } catch { /* se reporta como no medido */ }
  G('G-2', `disco libre ≥ ${MIN_DISCO_MB} MB`, discoMb !== null && discoMb >= MIN_DISCO_MB, {
    esperado: `≥ ${MIN_DISCO_MB} MB`, observado: discoMb === null ? 'no medido' : `${discoMb} MB`,
    causa: 'entorno',
  })

  // ── G-3 · El navegador de certificación está accesible por CDP ────────────
  const cdp = await traer(`${ENTORNO.cdp}/json/version`)
  G('G-3', 'navegador accesible por CDP', cdp.ok, {
    esperado: `200 en ${ENTORNO.cdp}`, observado: cdp.ok ? 'accesible' : (cdp.error || `HTTP ${cdp.status}`),
    causa: 'entorno',
  })

  // ── G-4 · Pedro vivo, y su identidad ──────────────────────────────────────
  const ident = await traer(`${ENTORNO.bridge}/identity`)
  G('G-4', 'Pedro /identity responde', ident.ok, {
    esperado: `200 en ${ENTORNO.bridge}/identity`,
    observado: ident.ok ? 'ok' : (ident.error || `HTTP ${ident.status}`),
    causa: 'entorno',
  })

  const identidad = ident.cuerpo?.identidad ?? null
  const app = identidad?.app ?? {}
  const ui  = identidad?.ui  ?? {}
  const sello = {
    server_id:     ident.cuerpo?.server_id ?? null,
    restaurant_id: ident.cuerpo?.restaurant_id ?? null,
    version:       ident.cuerpo?.version ?? null,
    app_git_sha:   app.git_sha ?? null,
    app_branch:    app.branch ?? null,
    app_clean:     app.clean ?? null,
    app_etiqueta:  app.etiqueta ?? null,
    ui_git_sha:    ui.git_sha ?? null,
    coherente:     identidad?.coherente ?? null,
  }

  // ── G-5 · Identidad de build: los dos SHA y el árbol limpio ───────────────
  //
  // Es la compuerta que da derecho a decir QUÉ se certificó. Sin ella el
  // veredicto no se puede citar: no se sabe sobre qué código se emitió.
  if (ident.ok) {
    G('G-5a', 'identity trae el bloque «identidad»', !!identidad, {
      esperado: 'identidad presente', observado: identidad ? 'presente' : 'ausente — build sin sellar',
    })
    G('G-5b', 'app.clean === true', sello.app_clean === true, {
      esperado: true, observado: sello.app_clean,
    })
    G('G-5c', 'identity.coherente === true', sello.coherente === true, {
      esperado: true, observado: sello.coherente,
    })
    G('G-5d', 'app.git_sha === ui.git_sha', !!sello.app_git_sha && sello.app_git_sha === sello.ui_git_sha, {
      esperado: 'iguales', observado: `app=${sello.app_git_sha} ui=${sello.ui_git_sha}`,
    })
    if (shaEsperado) {
      const corto = (s) => (s || '').slice(0, 12)
      G('G-5e', 'app.git_sha === CERTIFICATION_RUN_SHA', corto(sello.app_git_sha) === corto(shaEsperado), {
        esperado: corto(shaEsperado), observado: corto(sello.app_git_sha) || null,
      })
      G('G-5f', 'ui.git_sha === CERTIFICATION_RUN_SHA', corto(sello.ui_git_sha) === corto(shaEsperado), {
        esperado: corto(shaEsperado), observado: corto(sello.ui_git_sha) || null,
      })
    }
  }

  // ── G-6 · La regla del blanco de prueba ───────────────────────────────────
  //
  // Una terminal etiquetada con el tenant de producción no certifica nada. Se
  // midió `restaurant_id: "amalay"` en terminal-golden el 15-sep; esta
  // compuerta existe para que eso no vuelva a pasar inadvertido.
  const tenant = (ENTORNO.tenant || sello.restaurant_id || '').toLowerCase()
  G('G-6', `tenant del blanco ≠ «${ENTORNO.prohibido}»`, !!tenant && tenant !== ENTORNO.prohibido, {
    esperado: `distinto de ${ENTORNO.prohibido}`, observado: tenant || 'no declarado',
  })

  // ── G-7 · Secuencia del event store: el ancla monotónica ──────────────────
  const salud = await traer(`${ENTORNO.bridge}/health`)
  const seqInicial = salud.cuerpo?.seq ?? salud.cuerpo?.last_sequence ?? null
  G('G-7', 'Pedro /health entrega la secuencia', seqInicial !== null, {
    esperado: 'seq numérica', observado: seqInicial ?? (salud.error || `HTTP ${salud.status}`),
    causa: 'entorno',
  })

  // ── G-8 · El PIN tiene que estar disponible, y no se imprime ──────────────
  G('G-8', 'PIN de certificación provisto', !!ENTORNO.pin, {
    esperado: 'FULLSITE_PIN definido', observado: ENTORNO.pin ? 'provisto (no se imprime)' : 'ausente',
  })

  return {
    gates,
    sello,
    seqInicial,
    satisfechas: gates.every(g => g.ok),
  }
}
