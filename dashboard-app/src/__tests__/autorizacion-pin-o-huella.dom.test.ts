import { createElement, useState, type ReactElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AutorizacionPinOHuella, { type AutorizacionPinOHuellaProps } from '@/components/pos/AutorizacionPinOHuella'

afterEach(cleanup)

type Resultado = Record<string, unknown>
const Autorizacion = AutorizacionPinOHuella<Resultado>

function renderCaso(props: Partial<AutorizacionPinOHuellaProps<Resultado>> = {}) {
  function Caso(): ReactElement {
    const [pin, setPin] = useState('')
    return createElement(Autorizacion, {
      pin,
      onPinChange: setPin,
      onPin: vi.fn(async value => ({ metodo: 'pin', value })),
      onHuella: vi.fn(async () => ({ metodo: 'huella', actor: 'gerente' })),
      onAuthorized: vi.fn(),
      huellaDisponible: true,
      ...props,
    })
  }
  return render(createElement(Caso))
}

it('siempre muestra la huella y explica por qué está deshabilitada', () => {
  const onHuella = vi.fn(async () => ({ metodo: 'huella' }))
  renderCaso({
    huellaDisponible: false,
    motivoHuellaNoDisponible: 'Lector desconectado.',
    onHuella,
  })

  const huella = screen.getByRole('button', { name: 'Autorizar con huella' }) as HTMLButtonElement
  expect(huella.disabled).toBe(true)
  expect(huella.className).toContain('min-h-[56px]')
  expect(screen.getByText('Huella no disponible: Lector desconectado.')).toBeTruthy()
  fireEvent.click(huella)
  expect(onHuella).not.toHaveBeenCalled()
})

it('entrega al consumidor el resultado opaco de la huella', async () => {
  const resultado = { kind: 'caja', token: 'firmado-por-caja' }
  const onHuella = vi.fn(async () => resultado)
  const onAuthorized = vi.fn()
  renderCaso({ onHuella, onAuthorized })

  fireEvent.click(screen.getByRole('button', { name: 'Autorizar con huella' }))

  await waitFor(() => expect(onAuthorized).toHaveBeenCalledWith(resultado))
  expect(onHuella).toHaveBeenCalledOnce()
})

it('normaliza el PIN numérico y entrega el resultado del callback', async () => {
  const onPin = vi.fn(async (pin: string) => ({ kind: 'legacy', pin }))
  const onAuthorized = vi.fn()
  renderCaso({ onPin, onAuthorized })

  const input = screen.getByLabelText('PIN de autorización') as HTMLInputElement
  const submit = screen.getByRole('button', { name: 'Autorizar con PIN' }) as HTMLButtonElement
  expect(input.className).toContain('min-h-[56px]')
  expect(submit.className).toContain('min-h-[56px]')
  expect(submit.disabled).toBe(true)

  fireEvent.change(input, { target: { value: '12a34' } })
  expect(input.value).toBe('1234')
  fireEvent.click(submit)

  await waitFor(() => expect(onPin).toHaveBeenCalledWith('1234'))
  expect(onAuthorized).toHaveBeenCalledWith({ kind: 'legacy', pin: '1234' })
})

it('bloquea dobles autorizaciones y presenta el error del adaptador', async () => {
  let reject: (cause: Error) => void = () => {}
  const onHuella = vi.fn(() => new Promise<Resultado>((_, fail) => { reject = fail }))
  renderCaso({ onHuella })

  const huella = screen.getByRole('button', { name: 'Autorizar con huella' })
  fireEvent.click(huella)
  fireEvent.click(huella)
  expect(onHuella).toHaveBeenCalledOnce()

  reject(new Error('Caja rechazó la evidencia biométrica.'))
  expect((await screen.findByRole('alert')).textContent).toBe('Caja rechazó la evidencia biométrica.')
})
