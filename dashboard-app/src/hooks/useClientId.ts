'use client'

import { useAuth } from '@/contexts/AuthContext'

/**
 * Returns the current client_id from auth context.
 * Falls back to 'amalay' if not authenticated or loading.
 * Use this instead of hardcoding CLIENT_ID = 'amalay'.
 */
export function useClientId(): string {
  const { clientId } = useAuth()
  return clientId || 'amalay'
}
