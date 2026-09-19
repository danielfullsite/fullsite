// Firma canónica del artefacto del guardián de esquema.
//
// DEBE producir el mismo hash que `tools/brain/lib/artifact.mjs`. Está copiada
// y no importada a propósito: el guardián corre en CI sin el cerebro al lado y
// no debe arrastrar una dependencia para firmar cinco líneas. La copia sólo es
// segura porque `selftest.mjs` compara las dos implementaciones sobre el mismo
// objeto — si divergen, falla. Vive en su propio archivo para que esa prueba
// pueda importarla sin ejecutar el guardián entero.
import { createHash } from 'node:crypto'

export function hashContenido(obj) {
  const orden = (v) => Array.isArray(v) ? v.map(orden)
    : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).filter(k => k !== 'content_sha256').sort().map(k => [k, orden(v[k])]))
      : v
  return createHash('sha256').update(JSON.stringify(orden(obj))).digest('hex')
}
