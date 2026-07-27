// Local QR code generation — no external network requests.
// Works offline and in air-gapped LAN environments.
// Uses the `qrcode` npm package (already in node_modules).
//
// Two functions:
//   qrToDataURL(text)  → data:image/png;base64,... (for <img src>)
//   qrToSVG(text)      → SVG string (for inline or ESC/POS embedding)

import QRCode from 'qrcode'

const DEFAULT_OPTS: QRCode.QRCodeToDataURLOptions = {
  margin: 1,
  width: 200,
  color: { dark: '#000000', light: '#ffffff' },
  errorCorrectionLevel: 'M',
}

/**
 * Returns a data URL (PNG) for the given text.
 * Safe to use as `<img src={url} />` or embedded in print HTML.
 */
export async function qrToDataURL(text: string, opts?: QRCode.QRCodeToDataURLOptions): Promise<string> {
  return QRCode.toDataURL(text, { ...DEFAULT_OPTS, ...opts })
}

/**
 * Returns an SVG string for the given text.
 * Useful for inline rendering or embedding in receipts.
 */
export async function qrToSVG(text: string, opts?: QRCode.QRCodeToStringOptions): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1, ...opts })
}
