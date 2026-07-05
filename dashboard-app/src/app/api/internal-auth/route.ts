export async function POST(request: Request) {
  const { password } = await request.json()
  const correct = process.env.INTERNAL_ADMIN_PASSWORD
  if (!correct) return Response.json({ error: 'Not configured' }, { status: 500 })
  if (password === correct) {
    return Response.json({ ok: true })
  }
  return Response.json({ error: 'Wrong password' }, { status: 401 })
}
