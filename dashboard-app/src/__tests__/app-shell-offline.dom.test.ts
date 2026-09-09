import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AppShell from '@/components/AppShell'

const navigation = vi.hoisted(() => ({ path: '/pos/mesas', push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.path, useRouter: () => navigation }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: true, role: null }) }))
vi.mock('@/components/Sidebar', () => ({ default: () => null }))
vi.mock('@/components/ChatWidget', () => ({ default: () => null }))
vi.mock('@/components/NotificationBell', () => ({ default: () => null }))
vi.mock('@/components/ActAsBanner', () => ({ default: () => null }))
vi.mock('@/components/motion', () => ({ PageTransition: () => null }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

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
