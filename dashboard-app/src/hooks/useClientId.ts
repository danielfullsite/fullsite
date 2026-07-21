'use client'

import { useAuth } from '@/contexts/AuthContext'

/**
 * Returns the current client_id from auth context.
 *
 * For authenticated dashboard pages, this is the canonical way to get client_id.
 * Returns null if not authenticated — callers must handle this (show login, not data).
 */
export function useClientId(): string | null {
  const { clientId } = useAuth()
  return clientId
}
