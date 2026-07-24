import { getAdminClient } from '../_lib/supabase.ts'
import { seedRestaurant } from '../_lib/seed-restaurant.ts'
import { config } from './config.ts'

export async function seed() {
  const sb = getAdminClient()
  await seedRestaurant(sb, config)
}
