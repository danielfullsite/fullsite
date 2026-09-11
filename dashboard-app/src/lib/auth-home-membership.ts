import type { SupabaseClient } from '@supabase/supabase-js'

/** Browser home selection only. API authorization still resolves its own tenant.
 * Never combine the preferred tenant with another membership's role. */
export async function readAuthHomeMembership(
  client: Pick<SupabaseClient, 'from'>, userId: string, preferredClientId?: string,
  appMetadata?: Record<string, unknown>,
): Promise<{ clientId: string | null; role: string }> {
  const fallback = {
    clientId: preferredClientId || null,
    role: preferredClientId && appMetadata?.client_id === preferredClientId && typeof appMetadata.role === 'string' ? appMetadata.role : 'staff',
  }
  try {
    let query = client.from('client_users').select('client_id,role').eq('user_id', userId).neq('role', 'platform_actas')
    if (preferredClientId) query = query.eq('client_id', preferredClientId)
    const { data, error } = await query.order('client_id', { ascending: true }).limit(1).maybeSingle()
    if (error || !data || typeof data.client_id !== 'string' || !data.client_id || data.role === 'platform_actas' || (preferredClientId && data.client_id !== preferredClientId)) return fallback
    return { clientId: data.client_id, role: typeof data.role === 'string' && data.role ? data.role : 'staff' }
  } catch { return fallback }
}
