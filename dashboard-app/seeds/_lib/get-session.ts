/**
 * Helper: sign in with demo credentials and return a valid Supabase session
 * for injection into Playwright's browser localStorage.
 */
import { getAdminClient } from './supabase.ts'

/**
 * Credenciales del usuario demo SIEMPRE desde el entorno (contención V-A10, 2026-09-23).
 * Antes vivían literales en este archivo: cualquiera con lectura del repo podía iniciar
 * sesión como el dueño demo contra Supabase. La contraseña vieja sigue en el HISTORIAL de
 * git — está comprometida y debe rotarse (ver ROTATION-RUNBOOK.md del informe).
 *
 *   SEED_DEMO_EMAIL     correo del usuario demo
 *   SEED_DEMO_PASSWORD  su contraseña (nunca en el repo; en .env.local o en el shell)
 */
export function requireDemoCredentials(): { email: string; password: string } {
  const email = process.env.SEED_DEMO_EMAIL?.trim()
  const password = process.env.SEED_DEMO_PASSWORD
  const faltan = [!email && 'SEED_DEMO_EMAIL', !password && 'SEED_DEMO_PASSWORD'].filter(Boolean)
  if (faltan.length) {
    throw new Error(
      `Faltan variables de entorno para el usuario demo: ${faltan.join(', ')}. ` +
      'Defínelas en .env.local o en el shell (la contraseña nunca va en el repo).',
    )
  }
  return { email: email as string, password: password as string }
}

export async function getDemoSession() {
  const { email, password } = requireDemoCredentials()
  // Use the admin client's createClient with anon key to sign in
  // (admin client uses service key, can't use for auth.signIn — need anon client)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  if (!url || !anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Auth failed: ${res.status} ${err}`)
  }

  const session = await res.json()
  // Extract project ref from URL: https://PROJECTREF.supabase.co
  const projectRef = url.replace('https://', '').split('.')[0]

  return { session, projectRef, anonKey }
}
