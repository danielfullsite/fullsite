import { createElement, useEffect } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AppShell from '@/components/AppShell'

const navigation = vi.hoisted(() => ({ path: '/pos/mesas', push: vi.fn(), replace: vi.fn() }))
const auth = vi.hoisted(() => ({ user: null as null | { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }, loading: true, role: null as string | null }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.path, useRouter: () => navigation }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/components/Sidebar', () => ({ default: () => null }))
vi.mock('@/components/ChatWidget', () => ({ default: () => null }))
vi.mock('@/components/NotificationBell', () => ({ default: () => null }))
vi.mock('@/components/ActAsBanner', () => ({ default: () => null }))
vi.mock('@/components/motion', () => ({ PageTransition: ({ children }: { children: unknown }) => children }))
afterEach(() => {
  cleanup(); vi.clearAllMocks()
  auth.user = null; auth.loading = true; auth.role = null
})

it('mounts the POS PIN gate while cloud authentication is still waiting', () => {
  navigation.path = '/pos/mesas'
  render(createElement(AppShell, { children: createElement('button', {}, 'Ingresar con PIN en Caja') }))
  expect(screen.getByRole('button', { name: 'Ingresar con PIN en Caja' })).toBeTruthy()
  expect(navigation.push).not.toHaveBeenCalled()
})

it('keeps the dashboard behind its cloud authentication loader', () => {
  navigation.path = '/dashboard'
  render(createElement(AppShell, { children: 'Datos privados del dashboard' }))
  expect(screen.queryByText('Datos privados del dashboard')).toBeNull()
  expect(screen.getByText('Cargando...')).toBeTruthy()
})

it('never mounts private dashboard children after auth resolves without a user', () => {
  navigation.path = '/'
  auth.loading = false
  const privateFetch = vi.fn()
  function PrivateDashboard() {
    useEffect(() => { privateFetch('/api/private-dashboard') }, [])
    return createElement('div', {}, 'Consulta privada montada')
  }
  render(createElement(AppShell, { children: createElement(PrivateDashboard) }))
  expect(screen.queryByText('Consulta privada montada')).toBeNull()
  expect(privateFetch).not.toHaveBeenCalled()
  expect(screen.getByText('Cargando...')).toBeTruthy()
  expect(navigation.push).toHaveBeenCalledWith('/login')
})
