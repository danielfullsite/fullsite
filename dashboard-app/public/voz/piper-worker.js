// Worker de la voz natural (Piper) del modo voz. Corre FUERA del hilo principal:
// la síntesis (ONNX en WebAssembly) no congela la pantalla ni el detector de voz.
//
// Es un archivo ESTÁTICO a propósito: ni él ni la librería pasan por el bundler de
// Next, así que nada de esto llega al bundle principal y no hay sorpresas del
// empaquetador con WebAssembly. La librería y los .wasm los copia
// scripts/copiar-motor-voz.mjs a /voz/vendor/<paquete>-<versión>/ (cache inmutable);
// las rutas llegan en el mensaje 'cargar' (salen de /voz/motor.json).
//
// El modelo (~63 MB) se baja UNA vez de Hugging Face y queda en OPFS
// (navigator.storage.getDirectory(), carpeta "piper"), que es justo donde la librería
// lo busca antes de volver a descargarlo. Se escribe en streaming con
// createSyncAccessHandle (sólo existe en workers; Safari incluido) para no tener
// 63 MB dos veces en memoria.
//
// Protocolo (main → worker):
//   { tipo: 'cargar', id, rutas, modelos: [{ id, ruta, bytesOnnx, bytesJson }] }
//   { tipo: 'descargar', id, modelo }          // precarga: sólo baja a OPFS
//   { tipo: 'sintetizar', id, texto, prioridad: 'alta' | 'baja' }
//   { tipo: 'cancelar' }                        // tira lo que está en cola
// (worker → main):
//   { tipo: 'progreso', id, cargado, total }
//   { tipo: 'iniciando', id, modelo }
//   { tipo: 'listo', id, modelo }
//   { tipo: 'aviso', id, modelo, mensaje }      // ese modelo falló; se prueba el siguiente
//   { tipo: 'audio', id, wav }                  // ArrayBuffer transferido
//   { tipo: 'error', id, mensaje }

const HF_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main'

let libreria = null
let sesion = null
let rutas = null
const cola = []
let ocupado = false

const enviar = (m, transferir) => self.postMessage(m, transferir || [])

async function dirPiper() {
  try {
    if (!self.navigator?.storage?.getDirectory) return null
    const raiz = await self.navigator.storage.getDirectory()
    return await raiz.getDirectoryHandle('piper', { create: true })
  } catch {
    return null
  }
}

async function tamanoEnCache(dir, nombre) {
  try {
    const fh = await dir.getFileHandle(nombre)
    return (await fh.getFile()).size
  } catch {
    return -1
  }
}

/** Abre un escritor secuencial sobre OPFS (sync access handle si se puede). */
async function abrirEscritor(dir, nombre) {
  const fh = await dir.getFileHandle(nombre, { create: true })
  if (typeof fh.createSyncAccessHandle === 'function') {
    const h = await fh.createSyncAccessHandle()
    h.truncate(0)
    let pos = 0
    return {
      escribir: async (trozo) => { pos += h.write(trozo, { at: pos }) },
      cerrar: async () => { h.flush(); h.close() },
      abortar: async () => { try { h.truncate(0); h.close() } catch { /* */ } },
    }
  }
  const w = await fh.createWritable()
  return {
    escribir: (trozo) => w.write(trozo),
    cerrar: () => w.close(),
    abortar: async () => { try { await w.abort() } catch { /* */ } },
  }
}

/**
 * Baja un archivo a OPFS en streaming. Si ya está completo (tamaño esperado), no
 * hace nada. Lanza Error si la red o el tamaño fallan (nunca deja un archivo a medias
 * con el nombre final: se trunca).
 */
async function asegurarArchivo(dir, url, nombre, esperado, alProgreso) {
  if ((await tamanoEnCache(dir, nombre)) === esperado) return
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`descarga ${res.status}`)
  const total = Number(res.headers.get('content-length')) || esperado
  const escritor = await abrirEscritor(dir, nombre)
  let cargado = 0
  try {
    const lector = res.body.getReader()
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      await escritor.escribir(value)
      cargado += value.byteLength
      alProgreso?.(cargado, total)
    }
    if (cargado !== esperado) throw new Error(`tamaño ${cargado} ≠ ${esperado}`)
    await escritor.cerrar()
  } catch (err) {
    await escritor.abortar()
    throw err
  }
}

/** Deja el modelo en OPFS. Devuelve false si OPFS no sirve (la librería lo bajará sin cache). */
async function asegurarModelo(modelo, id) {
  const dir = await dirPiper()
  if (!dir) return false
  const base = `${HF_BASE}/${modelo.ruta}`
  const nombre = modelo.ruta.split('/').at(-1)
  await asegurarArchivo(dir, `${base}.json`, `${nombre}.json`, modelo.bytesJson)
  await asegurarArchivo(dir, base, nombre, modelo.bytesOnnx, (cargado, total) => enviar({ tipo: 'progreso', id, cargado, total }))
  return true
}

async function cargarLibreria() {
  if (!libreria) libreria = await import(rutas.piper)
  return libreria
}

async function cargar(m) {
  rutas = m.rutas
  let ultimo = 'sin modelos'
  for (const modelo of m.modelos) {
    try {
      const conCache = await asegurarModelo(modelo, m.id)
      enviar({ tipo: 'iniciando', id: m.id, modelo: modelo.id })
      const { TtsSession } = await cargarLibreria()
      // La librería es un singleton que se queda con el primer modelo: se limpia.
      TtsSession._instance = null
      sesion = await TtsSession.create({
        voiceId: modelo.id,
        progress: conCache ? undefined : (p) => {
          if (p && p.url && p.url.endsWith('.onnx')) enviar({ tipo: 'progreso', id: m.id, cargado: p.loaded, total: p.total || modelo.bytesOnnx })
        },
        wasmPaths: { onnxWasm: rutas.ortPrefijo, piperData: rutas.piperData, piperWasm: rutas.piperWasm },
      })
      enviar({ tipo: 'listo', id: m.id, modelo: modelo.id })
      return
    } catch (err) {
      ultimo = err && err.message ? String(err.message) : 'error'
      sesion = null
      try { if (libreria) libreria.TtsSession._instance = null } catch { /* */ }
      enviar({ tipo: 'aviso', id: m.id, modelo: modelo.id, mensaje: ultimo })
    }
  }
  enviar({ tipo: 'error', id: m.id, mensaje: ultimo })
}

async function descargar(m) {
  try {
    await asegurarModelo(m.modelo, m.id)
    enviar({ tipo: 'listo', id: m.id, modelo: m.modelo.id })
  } catch (err) {
    enviar({ tipo: 'error', id: m.id, mensaje: err && err.message ? String(err.message) : 'error' })
  }
}

async function bombear() {
  if (ocupado) return
  ocupado = true
  try {
    while (cola.length) {
      // Primero lo que el dueño está esperando; lo "de fondo" (acuses) después.
      const i = cola.findIndex(t => t.prioridad === 'alta')
      const t = cola.splice(i >= 0 ? i : 0, 1)[0]
      try {
        if (!sesion) throw new Error('sin sesión')
        const wav = await (await sesion.predict(t.texto)).arrayBuffer()
        enviar({ tipo: 'audio', id: t.id, wav }, [wav])
      } catch (err) {
        enviar({ tipo: 'error', id: t.id, mensaje: err && err.message ? String(err.message) : 'error' })
      }
    }
  } finally {
    ocupado = false
  }
}

self.onmessage = (e) => {
  const m = e.data || {}
  switch (m.tipo) {
    case 'cargar': void cargar(m); break
    case 'descargar': void descargar(m); break
    case 'sintetizar': cola.push(m); void bombear(); break
    case 'cancelar':
      for (const t of cola.splice(0)) enviar({ tipo: 'error', id: t.id, mensaje: 'cancelado' })
      break
    default: break
  }
}
