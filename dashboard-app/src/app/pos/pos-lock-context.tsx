'use client'
import { createContext, useContext } from 'react'

interface POSLockContextValue {
  lock: () => void
}

// Safe no-op default — context is only meaningful when rendered inside POSLayout
export const POSLockContext = createContext<POSLockContextValue>({ lock: () => {} })
export const usePOSLock = () => useContext(POSLockContext)
