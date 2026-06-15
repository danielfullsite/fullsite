// Parser de CFDI XML del SAT — extrae datos de facturas de proveedores
// El XML sigue el estándar CFDI 4.0/3.3 del SAT México
// Funciona 100% en el browser (no necesita servidor)

export interface CfdiConcept {
  claveProdServ: string
  descripcion: string
  cantidad: number
  unidad: string
  claveUnidad: string
  valorUnitario: number
  importe: number
  descuento: number
}

export interface CfdiParsed {
  // Emisor (proveedor)
  emisorRfc: string
  emisorNombre: string
  emisorRegimen: string
  // Receptor (AMALAY)
  receptorRfc: string
  receptorNombre: string
  // Comprobante
  uuid: string
  serie: string
  folio: string
  fecha: string
  formaPago: string
  metodoPago: string // PUE o PPD
  moneda: string
  subtotal: number
  descuento: number
  total: number
  // IVA
  ivaTraslado: number
  ivaRetenido: number
  // Items
  conceptos: CfdiConcept[]
  // Raw
  xmlRaw: string
}

/** Parsea un archivo XML de CFDI del SAT. Funciona en browser. */
export function parseCfdiXml(xmlString: string): CfdiParsed {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'text/xml')

  // Check for parse errors
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('XML inválido: ' + parseError.textContent?.slice(0, 100))

  // CFDI namespaces vary — try both cfdi: and tfd: prefixes, and also no prefix
  const getEl = (parent: Element | Document, ...names: string[]): Element | null => {
    for (const name of names) {
      // Try with namespace prefixes
      for (const prefix of ['cfdi:', 'tfd:', '']) {
        const el = parent.querySelector(prefix + name) ||
                   parent.getElementsByTagNameNS('*', name)[0]
        if (el) return el
      }
    }
    return null
  }

  const getAttr = (el: Element | null, attr: string): string => el?.getAttribute(attr) || ''
  const getNum = (el: Element | null, attr: string): number => Number(el?.getAttribute(attr)) || 0

  const comprobante = getEl(doc, 'Comprobante')
  if (!comprobante) throw new Error('No se encontró el nodo Comprobante en el XML')

  const emisor = getEl(comprobante, 'Emisor')
  const receptor = getEl(comprobante, 'Receptor')
  const complemento = getEl(comprobante, 'Complemento')
  const timbre = complemento ? getEl(complemento, 'TimbreFiscalDigital') : null

  // Parse conceptos
  const conceptosNode = getEl(comprobante, 'Conceptos')
  const conceptoEls = conceptosNode
    ? Array.from(conceptosNode.getElementsByTagNameNS('*', 'Concepto'))
    : []

  const conceptos: CfdiConcept[] = conceptoEls.map(c => ({
    claveProdServ: getAttr(c, 'ClaveProdServ'),
    descripcion: getAttr(c, 'Descripcion'),
    cantidad: getNum(c, 'Cantidad'),
    unidad: getAttr(c, 'Unidad') || getAttr(c, 'ClaveUnidad'),
    claveUnidad: getAttr(c, 'ClaveUnidad'),
    valorUnitario: getNum(c, 'ValorUnitario'),
    importe: getNum(c, 'Importe'),
    descuento: getNum(c, 'Descuento'),
  }))

  // Parse impuestos
  const impuestos = getEl(comprobante, 'Impuestos')
  let ivaTraslado = 0, ivaRetenido = 0
  if (impuestos) {
    const traslados = impuestos.getElementsByTagNameNS('*', 'Traslado')
    for (const t of Array.from(traslados)) {
      if (getAttr(t, 'Impuesto') === '002') ivaTraslado += getNum(t, 'Importe')
    }
    const retenciones = impuestos.getElementsByTagNameNS('*', 'Retencion')
    for (const r of Array.from(retenciones)) {
      if (getAttr(r, 'Impuesto') === '002') ivaRetenido += getNum(r, 'Importe')
    }
  }

  return {
    emisorRfc: getAttr(emisor, 'Rfc'),
    emisorNombre: getAttr(emisor, 'Nombre'),
    emisorRegimen: getAttr(emisor, 'RegimenFiscal'),
    receptorRfc: getAttr(receptor, 'Rfc'),
    receptorNombre: getAttr(receptor, 'Nombre'),
    uuid: getAttr(timbre, 'UUID'),
    serie: getAttr(comprobante, 'Serie'),
    folio: getAttr(comprobante, 'Folio'),
    fecha: getAttr(comprobante, 'Fecha'),
    formaPago: getAttr(comprobante, 'FormaPago'),
    metodoPago: getAttr(comprobante, 'MetodoPago'),
    moneda: getAttr(comprobante, 'Moneda') || 'MXN',
    subtotal: getNum(comprobante, 'SubTotal'),
    descuento: getNum(comprobante, 'Descuento'),
    total: getNum(comprobante, 'Total'),
    ivaTraslado,
    ivaRetenido,
    conceptos,
    xmlRaw: xmlString,
  }
}

/** Busca el mejor match de un concepto CFDI contra ingredientes de la BD */
export function matchConceptToIngredient(
  concepto: CfdiConcept,
  ingredients: { id: string; name: string; unit: string; cost_per_unit?: number }[],
): { ingredient: typeof ingredients[0]; confidence: number } | null {
  const desc = concepto.descripcion.toLowerCase()
  let bestMatch: { ingredient: typeof ingredients[0]; confidence: number } | null = null

  for (const ing of ingredients) {
    const name = ing.name.toLowerCase()
    // Exact match
    if (desc === name) return { ingredient: ing, confidence: 1.0 }

    // Containment match
    if (desc.includes(name) || name.includes(desc)) {
      const score = Math.min(desc.length, name.length) / Math.max(desc.length, name.length)
      if (!bestMatch || score > bestMatch.confidence) {
        bestMatch = { ingredient: ing, confidence: score }
      }
    }

    // Word overlap
    const descWords = desc.split(/\s+/).filter(w => w.length > 2)
    const nameWords = name.split(/\s+/).filter(w => w.length > 2)
    const overlap = descWords.filter(w => nameWords.some(nw => nw.includes(w) || w.includes(nw))).length
    if (overlap > 0) {
      const score = overlap / Math.max(descWords.length, nameWords.length) * 0.8
      if (!bestMatch || score > bestMatch.confidence) {
        bestMatch = { ingredient: ing, confidence: score }
      }
    }
  }

  return bestMatch && bestMatch.confidence > 0.3 ? bestMatch : null
}
