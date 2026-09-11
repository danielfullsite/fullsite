import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TenantOnboardingCredentials } from '@/components/platform/TenantOnboardingCredentials'
afterEach(cleanup)
const base = { tenantId: 'cafe', email: 'owner@example.com', initialPassword: 'new-unsubmitted-or-existing-password', ownerCredentialCreated: false, staffSetupRequired: true, staffPins: [], localServer: null, existingServiceCredential: true, onDone: vi.fn(), onNotice: vi.fn() }
it('reintento no muestra ni copia como vigente una contraseña que no cambió', async () => {
  const writeText = vi.fn(async (_text: string) => undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(React.createElement(TenantOnboardingCredentials, base))
  expect(screen.queryByText(base.initialPassword)).toBeNull()
  expect(screen.getByText(/conserva su contraseña anterior/)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Falta configurar personal real')
  fireEvent.click(screen.getByRole('button', { name: 'Copiar credenciales' }))
  await waitFor(() => expect(writeText).toHaveBeenCalled())
  expect(writeText.mock.calls[0][0]).not.toContain(base.initialPassword)
})
it('alta nueva distingue credenciales guardadas de plantillas inactivas', () => {
  render(React.createElement(TenantOnboardingCredentials, { ...base, ownerCredentialCreated: true, staffPins: [{ role: 'gerente', pin: '1234567890' }], localServer: { email: 'service@example.com', password: 'synthetic-service-password' }, existingServiceCredential: false }))
  expect(screen.getByText(base.initialPassword)).toBeTruthy()
  expect(screen.getByText('Plantillas inactivas — no permiten operar')).toBeTruthy()
  expect(screen.getByText('synthetic-service-password')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Terminales' }).getAttribute('href')).toBe('/platform/terminales')
})
