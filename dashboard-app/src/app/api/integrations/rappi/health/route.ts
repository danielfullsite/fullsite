// Rappi — health de la INTEGRACION.
//
// OJO: esto NO es el PING de disponibilidad de tienda. Ese vive en el webhook y se
// responde por tienda (ver lib/integrations/rappi/ping.ts). Registrar esta URL como
// webhook de PING seria un error: aqui no llega `store_id`, asi que no se puede
// afirmar nada sobre ninguna tienda concreta.
//
// QUE ESTABA MAL
//
// Respondia `{ status: 'OK' }` SIEMPRE, sin mirar nada — un literal. Eso no es un
// health check, es una constante con forma de health check: se ve verde aunque la
// integracion este completamente rota (sin credenciales, sin tienda mapeada).
//
// Ademas comparte la forma `{status:"OK"}` con la respuesta que Rappi espera del PING,
// que es justo lo que invita a registrarla por error como webhook de disponibilidad.
// Por eso ahora devuelve `service`, no `status`, cuando algo no esta listo.

import { NextResponse } from 'next/server'

interface HealthReport {
  service: 'rappi-integration'
  /** true solo si la integracion puede realmente operar. */
  ready: boolean
  checks: Record<string, boolean>
  note: string
}

function evaluar(): HealthReport {
  const checks = {
    client_id:     Boolean(process.env.RAPPI_CLIENT_ID),
    client_secret: Boolean(process.env.RAPPI_CLIENT_SECRET),
    webhook_secret: Boolean(process.env.RAPPI_WEBHOOK_SECRET),
    supabase:      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  }
  return {
    service: 'rappi-integration',
    ready: Object.values(checks).every(Boolean),
    checks,
    note: 'Health de la integracion. NO es el PING de tienda de Rappi (ese va en /webhook).',
  }
}

export async function GET() {
  const r = evaluar()
  return NextResponse.json(r, { status: r.ready ? 200 : 503 })
}

export async function POST() {
  // Se mantiene el POST porque algun monitor podria estar usandolo, pero devuelve lo
  // mismo que el GET: la verdad, no un OK de cortesia.
  const r = evaluar()
  return NextResponse.json(r, { status: r.ready ? 200 : 503 })
}
