export async function POST(request: Request) {
  const { password } = await request.json()
  const correct = process.env.INTERNAL_ADMIN_PASSWORD || '03Soccer2003!'
  if (password === correct) {
    return Response.json({ ok: true })
  }
  return Response.json({ error: 'Wrong password' }, { status: 401 })
}
