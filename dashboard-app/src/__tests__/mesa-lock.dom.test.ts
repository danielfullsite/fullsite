import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MesaLockGuard from '@/components/pos/MesaLockGuard'
import { adquirirMesa, liberarMesa } from '@/lib/mesa-lock'
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { POS_MESA_EXIT_EVENT, type PosMesaExitDetail } from '@/lib/pos-navigation'

const navigation = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/pos', query: 'mesa=7' }))
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace }),
}))
vi.mock('@/lib/pedro-cliente', () => ({ requiereCaja: () => true }))
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://caja.test' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
const network = vi.mocked(localNetworkFetch)

const ok = (commandId: string) => Response.json({ results: [{
  event: { id: 'event', payload: { command_id: commandId } },
  receipt: { command_id: commandId, sequence: 1 },
}] })

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  network.mockImplementation(async (_url, init) => {
    const command = JSON.parse(String(init?.body))
    return ok(command.command_id)
  })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('protocolo de lock de mesa', () => {
  it('adquiere y libera por la Caja sin aceptar una identidad escrita por el navegador', async () => {
    await adquirirMesa(7)
    await liberarMesa(7)
    expect(network).toHaveBeenCalledTimes(2)
    const acquire = JSON.parse(String(network.mock.calls[0][1]?.body))
    const release = JSON.parse(String(network.mock.calls[1][1]?.body))
    expect(acquire).toMatchObject({ command_type: 'MESA_LOCK', mesa: 7 })
    expect(acquire).not.toHaveProperty('expires_ms')
    expect(acquire).not.toHaveProperty('client_id')
    expect(release).toMatchObject({ command_type: 'MESA_UNLOCK', mesa: 7 })
    expect(release).not.toHaveProperty('client_id')
  })

  it('conserva el código de conflicto que devuelve Caja', async () => {
    network.mockResolvedValue(Response.json({ results: [{ error: 'locked', code: 'MESA_LOCK_CONFLICT' }] }))
    await expect(adquirirMesa(7)).rejects.toMatchObject({ code: 'MESA_LOCK_CONFLICT', incierto: false })
  })
})

describe('guardia del editor POS', () => {
  it('falla cerrado también en el render inicial anterior a los effects', () => {
    const html = renderToString(createElement(MesaLockGuard, { enabled: true }, createElement('button', null, 'Editar comanda')))
    expect(html).not.toContain('Editar comanda')
    expect(html).toContain('Confirmando mesa 7 con Caja')
  })

  it('no deja tocar la orden hasta adquirir, renueva y libera al salir', async () => {
    vi.useFakeTimers()
    const view = render(createElement(MesaLockGuard, { enabled: true }, createElement('button', null, 'Editar comanda')))
    expect(screen.queryByRole('button', { name: 'Editar comanda' })).toBeNull()
    expect(screen.getByText('Confirmando mesa 7 con Caja…')).toBeTruthy()
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Editar comanda' })).toBeTruthy()
    expect(network).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(network).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => {})
    expect(network).toHaveBeenCalledTimes(3)
    expect(JSON.parse(String(network.mock.calls[2][1]?.body)).command_type).toBe('MESA_UNLOCK')
  })

  it('muestra el conflicto al mesero y mantiene bloqueado el editor', async () => {
    network.mockResolvedValue(Response.json({ results: [{ error: 'locked', code: 'MESA_LOCK_CONFLICT' }] }))
    render(createElement(MesaLockGuard, { enabled: true }, createElement('button', null, 'Editar comanda')))
    expect(await screen.findByText('Mesa 7 en uso')).toBeTruthy()
    expect(screen.getByText(/otra terminal está editando esta mesa/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Editar comanda' })).toBeNull()
  })

  it('un fallo de red no se convierte en bypass offline', async () => {
    network.mockRejectedValue(new TypeError('Failed to fetch'))
    render(createElement(MesaLockGuard, { enabled: true }, createElement('button', null, 'Editar comanda')))
    expect(await screen.findByText('Caja no confirmó la mesa')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Editar comanda' })).toBeNull()
  })

  it('vuelve inerte el editor y navega sólo después del ACK de unlock', async () => {
    let confirmarUnlock!: () => void
    network
      .mockImplementationOnce(async (_url, init) => ok(JSON.parse(String(init?.body)).command_id))
      .mockImplementationOnce(async (_url, init) => new Promise<Response>(resolve => {
        const id = JSON.parse(String(init?.body)).command_id
        confirmarUnlock = () => resolve(ok(id))
      }))
    const view = render(createElement(MesaLockGuard, { enabled: true }, createElement('button', null, 'Editar comanda')))
    await act(async () => {})
    const navigate = vi.fn()

    await act(async () => {
      window.dispatchEvent(new CustomEvent<PosMesaExitDetail>(POS_MESA_EXIT_EVENT, {
        cancelable: true, detail: { mesa: 7, navigate },
      }))
      await Promise.resolve()
    })

    expect(screen.queryByRole('button', { name: 'Editar comanda' })).toBeNull()
    expect(screen.getByText('Liberando mesa 7…')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(network).toHaveBeenCalledTimes(2)
    const repeatedNavigate = vi.fn()
    expect(window.dispatchEvent(new CustomEvent<PosMesaExitDetail>(POS_MESA_EXIT_EVENT, {
      cancelable: true, detail: { mesa: 7, navigate: repeatedNavigate },
    }))).toBe(false)
    await act(async () => { confirmarUnlock() })
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(repeatedNavigate).not.toHaveBeenCalled()
    view.unmount()
    await act(async () => {})
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('espera un renew en vuelo, lo deshace y no deja un segundo unlock tardío', async () => {
    vi.useFakeTimers()
    let confirmarRenew!: () => void
    network
      .mockImplementationOnce(async (_url, init) => ok(JSON.parse(String(init?.body)).command_id))
      .mockImplementationOnce(async (_url, init) => new Promise<Response>(resolve => {
        const id = JSON.parse(String(init?.body)).command_id
        confirmarRenew = () => resolve(ok(id))
      }))
      .mockImplementationOnce(async (_url, init) => ok(JSON.parse(String(init?.body)).command_id))
    const view = render(createElement(MesaLockGuard, { enabled: true }, createElement('button', null, 'Editar comanda')))
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    const navigate = vi.fn()

    act(() => {
      window.dispatchEvent(new CustomEvent<PosMesaExitDetail>(POS_MESA_EXIT_EVENT, {
        cancelable: true, detail: { mesa: 7, navigate },
      }))
    })
    expect(screen.getByText('Liberando mesa 7…')).toBeTruthy()
    expect(network).toHaveBeenCalledTimes(2)
    await act(async () => { confirmarRenew(); await Promise.resolve() })
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(JSON.parse(String(network.mock.calls[2][1]?.body)).command_type).toBe('MESA_UNLOCK')
    view.unmount()
    await act(async () => {})
    expect(network).toHaveBeenCalledTimes(3)
  })
})
