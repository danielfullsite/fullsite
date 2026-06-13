// Facturama (PAC) — timbrado CFDI 4.0 vía API Web mono-emisor.
// SOLO servidor (usa credenciales Basic). Sandbox por default; producción
// con FACTURAMA_ENV=production una vez cargado el CSD real de AMALAY.
//
// Env requeridas:
//   FACTURAMA_USER / FACTURAMA_PASSWORD — credenciales de la cuenta
//   FACTURAMA_EXPEDITION_PLACE          — CP del emisor (lugar de expedición)
//   FACTURAMA_ENV                       — 'production' | (default: sandbox)
//
// Sandbox: se usa la ruta multiemisor (/api-lite) con el CSD de pruebas del
// SAT (CACX7605101P8) porque las cuentas sandbox quedan amarradas al RFC del
// registro y los RFCs de prueba ya están todos registrados por otros usuarios.
// El CSD de pruebas se carga una sola vez vía POST /api-lite/csds.
// Producción: ruta mono-emisor (/3/cfdis) con el CSD real de AMALAY cargado
// en la cuenta (verificado 2026-06-12: AFO200806JI0, vigente a 2028-05-31).
//   FACTURAMA_LITE_ISSUER_RFC / _NAME / _REGIMEN — emisor api-lite (sandbox)

export interface CfdiRequestRow {
  id: string
  rfc: string
  razon_social: string
  regimen_fiscal: string
  uso_cfdi: string
  codigo_postal: string
  email: string
  subtotal: number | null
  iva: number | null
  total: number | null
}

export interface FacturamaResult {
  ok: boolean
  facturamaId?: string
  uuid?: string
  error?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function facturamaBaseUrl(): string {
  return process.env.FACTURAMA_ENV === 'production'
    ? 'https://api.facturama.mx'
    : 'https://apisandbox.facturama.mx'
}

/** En sandbox timbramos vía multiemisor (api-lite); en producción mono-emisor. */
export function isLiteMode(): boolean {
  return process.env.FACTURAMA_ENV !== 'production'
}

function liteIssuer() {
  return {
    Rfc: process.env.FACTURAMA_LITE_ISSUER_RFC || 'CACX7605101P8',
    Name: process.env.FACTURAMA_LITE_ISSUER_NAME || 'XOCHILT CASAS CHAVEZ',
    FiscalRegime: process.env.FACTURAMA_LITE_ISSUER_REGIMEN || '612',
  }
}

export function isFacturamaConfigured(): boolean {
  return Boolean(
    process.env.FACTURAMA_USER &&
    process.env.FACTURAMA_PASSWORD &&
    process.env.FACTURAMA_EXPEDITION_PLACE
  )
}

function authHeader(): string {
  const user = process.env.FACTURAMA_USER!
  const pass = process.env.FACTURAMA_PASSWORD!
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

/**
 * Construye el body del CFDI 4.0 de Ingreso (consumo de restaurante).
 * Pura — testeable sin red. Los montos se recalculan desde el total
 * (las solicitudes del QR público no traen subtotal/iva).
 */
export function buildCfdiBody(req: CfdiRequestRow, expeditionPlace: string, paymentForm = '01') {
  const total = round2(Number(req.total ?? 0))
  if (!(total > 0)) throw new Error('La solicitud no tiene monto total')
  const subtotal = round2(total / 1.16)
  const iva = round2(total - subtotal)

  const rfc = req.rfc.toUpperCase().trim()
  const now = new Date()
  return {
    CfdiType: 'I',
    NameId: '1',
    ExpeditionPlace: expeditionPlace,
    PaymentForm: paymentForm, // 01 efectivo, 04 TC, 28 TD
    PaymentMethod: 'PUE',
    Currency: 'MXN',
    Exportation: '01',
    // CFDI 4.0: factura global a público en general exige GlobalInformation
    ...(rfc === 'XAXX010101000' && {
      GlobalInformation: {
        Periodicity: '01',
        Months: String(now.getMonth() + 1).padStart(2, '0'),
        Year: now.getFullYear(),
      },
    }),
    Receiver: {
      Rfc: req.rfc.toUpperCase(),
      Name: req.razon_social.toUpperCase().trim(),
      CfdiUse: req.uso_cfdi,
      FiscalRegime: req.regimen_fiscal,
      TaxZipCode: req.codigo_postal,
    },
    Items: [
      {
        ProductCode: '90101501', // SAT: establecimientos para comer y beber
        Description: 'Consumo de alimentos y bebidas',
        UnitCode: 'ACT',
        Unit: 'Actividad',
        Quantity: 1,
        UnitPrice: subtotal,
        Subtotal: subtotal,
        TaxObject: '02',
        Taxes: [
          { Name: 'IVA', Rate: 0.16, Base: subtotal, Total: iva, IsRetention: false, IsFederalTax: true },
        ],
        Total: total,
      },
    ],
  }
}

/** Timbra un CFDI. Devuelve el Id de Facturama (para PDF/XML/email) y el UUID SAT. */
export async function stampCfdi(req: CfdiRequestRow, paymentForm?: string): Promise<FacturamaResult> {
  if (!isFacturamaConfigured()) {
    return { ok: false, error: 'Facturama no configurado (FACTURAMA_USER/PASSWORD/EXPEDITION_PLACE)' }
  }
  const body: Record<string, unknown> = buildCfdiBody(req, process.env.FACTURAMA_EXPEDITION_PLACE!, paymentForm)
  if (isLiteMode()) {
    // api-lite exige Serie/Folio explícitos y nodo Issuer
    body.Serie = 'POS'
    body.Folio = String(Date.now())
    body.Issuer = liteIssuer()
  }
  const endpoint = isLiteMode() ? '/api-lite/3/cfdis' : '/3/cfdis'
  const res = await fetch(`${facturamaBaseUrl()}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    console.error('[facturama] stamp failed:', res.status, txt.slice(0, 500))
    return { ok: false, error: extractFacturamaError(txt, res.status) }
  }
  const data = await res.json()
  return {
    ok: true,
    facturamaId: String(data.Id ?? ''),
    uuid: String(data.Complement?.TaxStamp?.Uuid ?? ''),
  }
}

/** Descarga PDF/XML de un CFDI emitido. Devuelve los bytes decodificados. */
export async function fetchCfdiFile(facturamaId: string, format: 'pdf' | 'xml'): Promise<Uint8Array | null> {
  const kind = isLiteMode() ? 'issuedLite' : 'issued'
  const res = await fetch(
    `${facturamaBaseUrl()}/cfdi/${format}/${kind}/${encodeURIComponent(facturamaId)}`,
    { headers: { Authorization: authHeader() } }
  )
  if (!res.ok) {
    console.error('[facturama] file fetch failed:', format, res.status)
    return null
  }
  const data = await res.json()
  if (!data.Content) return null
  return new Uint8Array(Buffer.from(String(data.Content), 'base64'))
}

/** Envía el CFDI por email (best-effort — no truena el timbrado si falla). */
export async function emailCfdi(facturamaId: string, email: string): Promise<boolean> {
  try {
    const cfdiType = isLiteMode() ? 'issuedLite' : 'issued'
    const url = `${facturamaBaseUrl()}/cfdi?cfdiType=${cfdiType}&cfdiId=${encodeURIComponent(facturamaId)}&email=${encodeURIComponent(email)}`
    const res = await fetch(url, { method: 'POST', headers: { Authorization: authHeader() } })
    if (!res.ok) console.warn('[facturama] email failed:', res.status, (await res.text()).slice(0, 200))
    return res.ok
  } catch (e) {
    console.warn('[facturama] email error:', e)
    return false
  }
}

/** Los errores de Facturama vienen como {Message, ModelState:{campo:[msgs]}}. */
function extractFacturamaError(txt: string, status: number): string {
  try {
    const j = JSON.parse(txt)
    const parts: string[] = []
    if (j.Message) parts.push(String(j.Message))
    if (j.ModelState && typeof j.ModelState === 'object') {
      for (const msgs of Object.values(j.ModelState as Record<string, unknown>)) {
        if (Array.isArray(msgs)) parts.push(...msgs.map(String))
      }
    }
    if (parts.length) return parts.join(' | ').slice(0, 300)
  } catch { /* texto plano */ }
  return `Facturama HTTP ${status}: ${txt.slice(0, 200)}`
}
