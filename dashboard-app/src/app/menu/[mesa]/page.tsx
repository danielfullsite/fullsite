// BUG-019-B — LEGACY AMALAY numeric-QR route. MENU READ ONLY.
// Server component: resolves tenant server-side (deployment config + mesa number),
// reads the public menu with the service role, and renders a read-only client view.
// It NEVER: trusts localStorage, accepts a browser-selected client_id/location_id,
// exposes public_token, redirects to a token URL, or serializes any token/credential
// to the client. Ordering is intentionally NOT available here (that is Batch C).
import { resolveLegacyTable, getPublicMenu, PublicMenuConfigError, type PublicMenu } from '@/lib/public-menu'
import MenuView from './MenuView'

export const dynamic = 'force-dynamic'

export default async function MenuPage({ params }: { params: Promise<{ mesa: string }> }) {
  const { mesa } = await params
  const mesaNum = parseInt(mesa, 10)

  let menu: PublicMenu | null = null
  let misconfigured = false
  try {
    const table = Number.isInteger(mesaNum) && mesaNum > 0 ? await resolveLegacyTable(mesaNum) : null
    if (table) menu = await getPublicMenu(table.client_id, table.mesa)
  } catch (err) {
    if (err instanceof PublicMenuConfigError) misconfigured = true
    else throw err
  }

  return <MenuView menu={menu} mesaNum={Number.isInteger(mesaNum) ? mesaNum : null} misconfigured={misconfigured} />
}
