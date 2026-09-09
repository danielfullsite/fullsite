// POST /api/factura/complemento-pago — Timbra complemento de pago (CFDI tipo P)
// Para facturas emitidas como PPD (pago diferido/parcialidades)

import { NextResponse, NextRequest } from 'next/server'
import { stampPaymentComplement, type PaymentComplementRequest } from '@/lib/facturama'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

function sbHeaders() {
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
}

export async function POST(request: NextRequest) {
  // ESTA RUTA SE QUEDO FUERA DEL BARRIDO DE FUGAS DEL 2026-08-30.
  //
  // Su hermana `timbrar/route.ts` lleva desde entonces `withPOSAuth` y un comentario
  // que explica por que: resolvia el tenant con `client_users limit=1` SIN order, y
  // para un usuario con varias membresias Postgres devolvia una fila arbitraria --
  // se timbraba un CFDI, que es una escritura fiscal IRREVERSIBLE ante el SAT,
  // contra el restaurante equivocado.
  //
  // Esta ruta hace lo mismo (timbra un complemento de pago, tambien irreversible) y
  // seguia con `requireAuth`, que solo comprueba QUE HAY UNA SESION. Sin tenant y sin
  // ninguna comprobacion sobre el UUID recibido: cualquier usuario autenticado de
  // cualquier restaurante podia timbrar un complemento contra cualquier CFDI, con el
  // RFC y el monto que quisiera, usando las credenciales del PAC de la empresa.
  //
  // Hoy ningun cliente de la app la llama -- el defecto es alcanzable, no explotado.
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const clientId = auth.clientId

  try {
    const body = await request.json() as PaymentComplementRequest

    // Validate required fields
    if (!body.relatedUuid) return NextResponse.json({ error: 'Falta UUID del CFDI original' }, { status: 400 })
    if (!body.receiverRfc) return NextResponse.json({ error: 'Falta RFC del receptor' }, { status: 400 })
    if (!body.amount || body.amount <= 0) return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    if (!body.paymentForm) return NextResponse.json({ error: 'Falta forma de pago' }, { status: 400 })
    if (!body.paymentDate) return NextResponse.json({ error: 'Falta fecha de pago' }, { status: 400 })

    // EL CFDI ORIGINAL TIENE QUE SER DE ESTE RESTAURANTE.
    //
    // `folio_fiscal` es el UUID que devolvio el PAC al timbrar. Se busca acotado por
    // `client_id`, igual que `timbrar` acota su solicitud: sin esto, el tenant del
    // token no restringiria nada, porque el UUID lo pone el cuerpo de la peticion.
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const res = await fetch(
      `${sbUrl}/rest/v1/pos_cfdi_requests` +
      `?folio_fiscal=eq.${encodeURIComponent(body.relatedUuid)}` +
      `&client_id=eq.${encodeURIComponent(clientId)}` +
      `&select=id,rfc,total,status&limit=1`,
      { headers: sbHeaders(), cache: 'no-store' }
    )
    if (!res.ok) {
      return NextResponse.json({ error: 'No se pudo verificar el CFDI original' }, { status: 502 })
    }
    const [original] = await res.json()
    if (!original) {
      // Mismo mensaje exista o no en otro restaurante: la respuesta no debe servir
      // para averiguar que UUIDs existen fuera del tenant.
      return NextResponse.json({ error: 'CFDI original no encontrado' }, { status: 404 })
    }

    // El complemento declara a quien se le cobra. Si no coincide con el receptor del
    // CFDI que dice complementar, el documento es incorrecto ante el SAT.
    if (String(original.rfc || '').toUpperCase() !== String(body.receiverRfc).toUpperCase()) {
      return NextResponse.json(
        { error: 'El RFC no coincide con el del CFDI original' }, { status: 409 })
    }

    // Un pago no puede ser mayor que la factura que paga. No se comprueba el saldo
    // acumulado de parcialidades anteriores: no hay tabla donde vivan.
    const totalOriginal = Number(original.total)
    if (Number.isFinite(totalOriginal) && totalOriginal > 0 && body.amount > totalOriginal) {
      return NextResponse.json(
        { error: 'El monto excede el total del CFDI original' }, { status: 409 })
    }

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
    console.error('[factura/complemento-pago]', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
