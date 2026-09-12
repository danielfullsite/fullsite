function report() {
  const checks = {
    client_id: Boolean(process.env.RAPPI_CLIENT_ID),
    client_secret: Boolean(process.env.RAPPI_CLIENT_SECRET),
    webhook_secret: Boolean(process.env.RAPPI_WEBHOOK_SECRET),
    supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabase_service_key: Boolean(process.env.SUPABASE_SERVICE_KEY),
  }
  return {
    service: 'rappi-integration',
    ready: Object.values(checks).every(Boolean),
    checks,
    note: 'Health de integración; el PING por tienda se responde en /webhook.',
  }
}

function response() {
  const body = report()
  return Response.json(body, { status: body.ready ? 200 : 503 })
}

export async function GET() { return response() }
export async function POST() { return response() }
