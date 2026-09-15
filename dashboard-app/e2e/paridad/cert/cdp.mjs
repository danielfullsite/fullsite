// ¿DÓNDE ESTÁ EL NAVEGADOR DE CERTIFICACIÓN?
//
// `9222` era una constante escrita a mano. Cuando el navegador estaba en otro
// puerto —o simplemente no estaba— el conductor moría con `ECONNREFUSED` en su
// primera línea, y el veredicto se convertía en «el comando falló»: un fallo del
// arnés disfrazado de nada.
//
// Aquí se BUSCA y se dice qué se encontró. Si no hay navegador en ninguna parte,
// eso también es un dato con su motivo, no una excepción.
//
// SEGURIDAD: sólo se habla con el loopback y sólo se lee `/json/version`, que no
// expone contenido de páginas ni cookies.

const TIMEOUT_MS = Number(process.env.CERT_CDP_TIMEOUT_MS || 1500)

/** Puertos donde suele escuchar un Chrome/Electron con depuración abierta. */
const CANDIDATOS = [9222, 9223, 9229, 8315, 8316]

async function sondear(url) {
  try {
    const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) return null
    const v = await r.json().catch(() => ({}))
    return { url, navegador: v.Browser ?? null, protocolo: v['Protocol-Version'] ?? null }
  } catch { return null }
}

/**
 * Devuelve `{ url, navegador, origen }` o `{ error }`.
 *
 * Un `FULLSITE_CDP` explícito NO se adivina ni se sustituye: si quien corre la
 * certificación nombró un puerto y ahí no hay nadie, eso es lo que se reporta.
 * Sustituirlo en silencio por otro navegador sería certificar una terminal
 * distinta de la que se pidió — la misma clase de error que medir la máquina
 * del desarrollador y llamarla «la Caja».
 */
export async function detectarCDP({ explicito = process.env.FULLSITE_CDP || null } = {}) {
  if (explicito) {
    const r = await sondear(explicito)
    return r ? { ...r, origen: 'FULLSITE_CDP' }
             : { error: `FULLSITE_CDP apunta a ${explicito} y ahí no responde ningún navegador`, url: explicito }
  }
  for (const puerto of CANDIDATOS) {
    const r = await sondear(`http://127.0.0.1:${puerto}`)
    if (r) return { ...r, origen: `detectado en :${puerto}` }
  }
  return { error: `ningún navegador con CDP en ${CANDIDATOS.join(', ')}`, url: null }
}
