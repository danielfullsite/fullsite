// Uber Eats — Reporting: request a report + fetch the generated report file.
//
// Flow (Uber Reporting API Suite):
//   1. POST /v1/eats/report  → 200 { workflow_id }        (scope eats.report)
//   2. Uber generates the CSV asynchronously and fires the `eats.report.success`
//      webhook with a pre-signed download_url (see webhook/route.ts).
//   3. Get Report file = GET that pre-signed URL (no auth — it is pre-signed).
//
// Uber's spec is not machine-fetchable (SPA docs, *.yaml 404), so path/scope/
// report_type are env-overridable with best-known defaults — same convention as
// promotions.ts / oauth.getOrderFulfillmentScope. Confirm in the Uber Dashboard
// API reference and set UBER_REPORT_PATH / UBER_REPORT_SCOPE / UBER_REPORT_TYPE
// if they differ.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

const reportPath = (): string => (process.env.UBER_REPORT_PATH || '/v1/eats/report').trim()
const reportScope = (): string => (process.env.UBER_REPORT_SCOPE || 'eats.report').trim()

export interface ReportRequest {
  /** e.g. 'PAYMENT_DETAILS_REPORT' | 'ORDER_HISTORY_REPORT' | 'MENU_ITEM_FEEDBACK_REPORT'. */
  report_type: string
  start_date: string // YYYY-MM-DD
  end_date: string   // YYYY-MM-DD
  store_uuids: string[]
}

/** A last-7-days report request for certification testing. */
export function buildSampleReportRequest(storeId: string): ReportRequest {
  const end = new Date()
  const start = new Date(Date.now() - 7 * 86400000)
  return {
    report_type: process.env.UBER_REPORT_TYPE || 'PAYMENT_DETAILS_REPORT',
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    store_uuids: [storeId],
  }
}

export async function requestReport(
  req: ReportRequest,
  correlationId: string
): Promise<{ ok: boolean; status: number; workflow_id?: string; body?: unknown; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(reportPath(), {
        method: 'POST',
        tokenType: 'marketplace',
        scope: reportScope(),
        body: JSON.stringify(req),
      }),
      { maxAttempts: 3, baseDelayMs: 800 }
    )
    const text = await r.text()
    let parsed: Record<string, unknown> | undefined
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : undefined } catch { /* keep raw */ }
    const workflowId = (parsed?.workflow_id ?? parsed?.report_id) as string | undefined
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'reporting.request',
      request: { report_type: req.report_type, stores: req.store_uuids.length },
      response: r.ok ? { workflow_id: workflowId } : { error: text?.slice(0, 500) },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return { ok: r.ok, status: r.status, workflow_id: workflowId, body: parsed ?? text, error: r.ok ? undefined : text?.slice(0, 500) }
  } catch (e) {
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'reporting.request',
      request: { report_type: req.report_type }, response: { error: String(e) }, duration_ms: Date.now() - t0,
    })
    return { ok: false, status: 0, error: String(e) }
  }
}

/** Download a finished report from its pre-signed URL (delivered by eats.report.success). */
export async function getReportFile(
  downloadUrl: string,
  correlationId: string
): Promise<{ ok: boolean; status: number; bytes?: number; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(() => fetch(downloadUrl), { maxAttempts: 3, baseDelayMs: 800 })
    const buf = r.ok ? await r.arrayBuffer() : undefined
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'reporting.get_file',
      request: { has_url: true },
      response: r.ok ? { bytes: buf?.byteLength } : { status: r.status },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return { ok: r.ok, status: r.status, bytes: buf?.byteLength }
  } catch (e) {
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'reporting.get_file',
      response: { error: String(e) }, duration_ms: Date.now() - t0,
    })
    return { ok: false, status: 0, error: String(e) }
  }
}
