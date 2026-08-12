// Export de tablas en el cliente (esqueleton de cada tenant): Excel / CSV / JSON,
// sin librerías y sin server (los datos ya están cargados y RLS-scopeados por tenant).
export type ExportFormat = 'xls' | 'csv' | 'json'

type Row = Record<string, unknown>

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}
function cols(rows: Row[]): string[] {
  return Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s }, new Set<string>()))
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return ''
  const cs = cols(rows)
  const esc = (v: unknown) => { const s = cell(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cs.join(','), ...rows.map(r => cs.map(c => esc(r[c])).join(','))].join('\n')
}

function toXls(rows: Row[], title = 'Reporte'): string {
  const esc = (v: unknown) => cell(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const cs = rows.length ? cols(rows) : []
  const n = cs.length || 1
  let clientId = ''
  try { clientId = localStorage.getItem('fullsite_client_id') || '' } catch { /* SSR */ }
  const stamp = new Date().toLocaleString('es-MX')
  // Encabezado de marca Fullsite (esqueleton de reporte, consistente en toda la app).
  const brand =
    `<tr><td colspan="${n}" style="font-family:Arial;font-size:20px;font-weight:bold;color:#0f9d6e;padding:8px 6px 2px">fullsite</td></tr>` +
    `<tr><td colspan="${n}" style="font-family:Arial;font-size:11px;color:#555;padding:0 6px 8px">${esc(title)}${clientId ? ` · ${esc(clientId)}` : ''} · Generado ${esc(stamp)}</td></tr>` +
    `<tr><td colspan="${n}"></td></tr>`
  const head = `<tr>${cs.map(c => `<th style="background:#0f9d6e;color:#fff;text-align:left;padding:4px 6px">${esc(c)}</th>`).join('')}</tr>`
  const body = rows.map(r => `<tr>${cs.map(c => `<td style="padding:3px 6px">${esc(r[c])}</td>`).join('')}</tr>`).join('')
  return `<html><head><meta charset="utf-8"></head><body><table border="1" cellspacing="0" style="font-family:Arial">${brand}${head}${body}</table></body></html>`
}

/** Genera y descarga un archivo con las filas dadas. */
export function downloadTable(rows: Row[], filename: string, format: ExportFormat = 'xls'): void {
  const title = filename.charAt(0).toUpperCase() + filename.slice(1).replace(/[-_]/g, ' ')
  let content = '', mime = 'text/plain', ext: string = format
  if (format === 'json') { content = JSON.stringify(rows, null, 2); mime = 'application/json' }
  else if (format === 'csv') { content = toCsv(rows); mime = 'text/csv;charset=utf-8' }
  else { content = toXls(rows, title); mime = 'application/vnd.ms-excel;charset=utf-8'; ext = 'xls' }

  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob(['﻿', content], { type: mime }) // BOM → acentos correctos en Excel
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${stamp}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
