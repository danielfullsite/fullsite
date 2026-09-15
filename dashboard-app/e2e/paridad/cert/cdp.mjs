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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TIMEOUT_MS = Number(process.env.CERT_CDP_TIMEOUT_MS || 1500)

/** Puertos donde suele escuchar un Chrome/Electron con depuración abierta. */
const CANDIDATOS = [9222, 9223, 9224, 9225, 9226, 9229, 8315, 8316]

/* ── LA FUENTE AUTORITATIVA: `DevToolsActivePort` ────────────────────────────
   Adivinar entre puertos habituales es el último recurso, y ya falló una vez:
   la terminal de certificación escuchaba en 9225, que no estaba en la lista, y
   el preflight reportó «ningún navegador con CDP» teniendo uno vivo enfrente.

   Chromium y Electron escriben el puerto real en `<userData>/DevToolsActivePort`
   —primera línea el puerto, segunda la ruta del navegador—. Leerlo de ahí no
   adivina nada: es la terminal diciendo dónde está. */
export function puertoDeclarado(userDataDir) {
  if (!userDataDir) return null
  try {
    const crudo = readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8')
    const puerto = Number(String(crudo).split('\n')[0].trim())
    return Number.isInteger(puerto) && puerto > 0 ? puerto : null
  } catch { return null }
}

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
export async function detectarCDP({
  explicito = process.env.FULLSITE_CDP || null,
  userDataDir = process.env.CERT_USER_DATA_DIR || null,
} = {}) {
  if (explicito) {
    const r = await sondear(explicito)
    return r ? { ...r, origen: 'FULLSITE_CDP' }
             : { error: `FULLSITE_CDP apunta a ${explicito} y ahí no responde ningún navegador`, url: explicito }
  }

  // 1 · Lo que la propia terminal declara. Gana sobre la lista de candidatos:
  //     es un dato, no una corazonada.
  const declarado = puertoDeclarado(userDataDir)
  if (declarado) {
    const r = await sondear(`http://127.0.0.1:${declarado}`)
    if (r) return { ...r, origen: `DevToolsActivePort de ${userDataDir} (:${declarado})` }
    return { error: `la terminal declara el puerto ${declarado} en DevToolsActivePort pero ahí no responde `
      + '(el navegador se cerró y el archivo quedó)', url: `http://127.0.0.1:${declarado}` }
  }

  // 2 · Sólo si nadie declaró nada: los puertos habituales.
  for (const puerto of CANDIDATOS) {
    const r = await sondear(`http://127.0.0.1:${puerto}`)
    if (r) return { ...r, origen: `detectado en :${puerto}` }
  }
  return { error: `ningún navegador con CDP en ${CANDIDATOS.join(', ')}`
    + (userDataDir ? ` ni declarado en ${userDataDir}` : ' y ningún CERT_USER_DATA_DIR que preguntar'), url: null }
}
