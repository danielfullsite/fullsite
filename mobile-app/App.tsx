// Fullsite POS — React Native entry point
import React from 'react'
import { usePOSStore } from './src/lib/store'
import LoginScreen from './src/screens/LoginScreen'
import POSScreen from './src/screens/POSScreen'

export default function App() {
  const staff = usePOSStore((s) => s.staff)

  if (!staff) return <LoginScreen />
  return <POSScreen />
}
