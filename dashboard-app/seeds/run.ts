#!/usr/bin/env node
/**
 * Seed runner — installs a complete restaurant from configuration.
 *
 * Usage:
 *   npx tsx seeds/run.ts demo
 *   npx tsx seeds/run.ts coffee-shop
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local
 */

const target = process.argv[2]

if (!target) {
  console.error('\nUsage: npx tsx seeds/run.ts <restaurant>\n')
  console.error('Available:')
  console.error('  demo         Café Central — restaurante de demostración')
  console.error('  coffee-shop  Espresso Lab — specialty coffee\n')
  process.exit(1)
}

const SEEDS: Record<string, () => Promise<{ seed: () => Promise<void> }>> = {
  'demo':         () => import('./demo/index.ts'),
  'coffee-shop':  () => import('./coffee-shop/index.ts'),
}

const loader = SEEDS[target]
if (!loader) {
  console.error(`\nUnknown seed: "${target}"`)
  console.error(`Available: ${Object.keys(SEEDS).join(', ')}\n`)
  process.exit(1)
}

console.log(`\n◆ Seeding "${target}" ...\n`)
const start = Date.now()

loader()
  .then(m => m.seed())
  .then(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n✓ Done in ${elapsed}s\n`)
  })
  .catch(err => {
    console.error('\n✗ Seed failed:\n', err.message || err)
    process.exit(1)
  })
