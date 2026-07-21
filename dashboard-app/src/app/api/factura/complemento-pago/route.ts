// POST /api/factura/complemento-pago — Timbra complemento de pago (CFDI tipo P)
// Para facturas emitidas como PPD (pago diferido/parcialidades)

import { NextResponse, NextRequest } from 'next/server'
import { stampPaymentComplement, type PaymentComplementRequest } from '@/lib/facturama'
import { requireAuth } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr

  try {
    const body = await request.json() as PaymentComplementRequest

    // Validate required fields
    if (!body.relatedUuid) return NextResponse.json({ error: 'Falta UUID del CFDI original' }, { status: 400 })
    if (!body.receiverRfc) return NextResponse.json({ error: 'Falta RFC del receptor' }, { status: 400 })
    if (!body.amount || body.amount <= 0) return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    if (!body.paymentForm) return NextResponse.json({ error: 'Falta forma de pago' }, { status: 400 })
    if (!body.paymentDate) return NextResponse.json({ error: 'Falta fecha de pago' }, { status: 400 })

    const result = await stampPaymentComplement(body)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({
      ok: true,
      facturamaId: result.facturamaId,
      uuid: result.uuid,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
