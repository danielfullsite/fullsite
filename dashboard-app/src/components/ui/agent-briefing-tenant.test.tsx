// P0: el briefing de agentes enseñaba las alertas de OTRO restaurante.
//
// Observado en producción: el dashboard de coffee-shop mostrando
// "ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo", "19 issues: 0 critical,
// 11 high" y "1 issues" — las tres son filas de agent_results con
// client_id = 'amalay'. coffee-shop tiene CERO filas propias.
//
// La causa no era el filtro de la consulta (getDeepTable sí acota por tenant),
// sino CUÁNDO se consultaba: `useEffect(..., [])`, una sola vez al montar. Al
// entrar a otro restaurante el componente no se desmonta, así que las alertas
// del anterior se quedaban en pantalla — debajo del banner que ya decía
// "Estás viendo coffee-shop".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const getDeepTable = vi.fn()
let clienteActivo: string | null = 'amalay'

vi.mock('@/lib/data', () => ({ getDeepTable: (...a: unknown[]) => getDeepTable(...a) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ clientId: clienteActivo }) }))
vi.mock('@/lib/agent-names', () => ({ agentName: (id: string) => id }))

import AgentBriefing from '@/components/AgentBriefing'

const FILAS_AMALAY = [
  { agent_id: 'stock-alert', client_id: 'amalay', priority: 'critical', fecha: '2026-08-25', summary: 'ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo' },
  { agent_id: 'hermes', client_id: 'amalay', priority: 'warning', fecha: '2026-08-25', summary: '19 issues: 0 critical, 11 high' },
]

beforeEach(() => {
  getDeepTable.mockReset()
  clienteActivo = 'amalay'
})
afterEach(cleanup)

describe('AgentBriefing — aislamiento entre restaurantes', () => {
  it('pinta las alertas del restaurante activo', async () => {
    getDeepTable.mockResolvedValue(FILAS_AMALAY)
    render(<AgentBriefing />)
    await waitFor(() => expect(screen.getByText(/225 sin stock/)).toBeTruthy())
  })

  it('NUNCA pinta una fila de otro restaurante, aunque la consulta la devuelva', async () => {
    // Candado 2: si por lo que sea el filtro de la consulta fallara, la fila
    // ajena se descarta igual al pintar.
    clienteActivo = 'coffee-shop'
    getDeepTable.mockResolvedValue(FILAS_AMALAY)
    const { container } = render(<AgentBriefing />)
    await waitFor(() => expect(getDeepTable).toHaveBeenCalled())
    expect(screen.queryByText(/225 sin stock/)).toBeNull()
    expect(screen.queryByText(/19 issues/)).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('al cambiar de restaurante vuelve a consultar', async () => {
    // El defecto: useEffect con arreglo de dependencias vacío.
    getDeepTable.mockResolvedValue(FILAS_AMALAY)
    const { rerender } = render(<AgentBriefing />)
    await waitFor(() => expect(getDeepTable).toHaveBeenCalledTimes(1))

    clienteActivo = 'coffee-shop'
    getDeepTable.mockResolvedValue([])
    rerender(<AgentBriefing />)
    await waitFor(() => expect(getDeepTable).toHaveBeenCalledTimes(2))
  })

  it('mientras llega la respuesta del nuevo restaurante NO deja las del anterior', async () => {
    // Candado 1: el estado guarda para qué tenant se resolvió. Este es el caso
    // exacto de la captura de producción.
    getDeepTable.mockResolvedValue(FILAS_AMALAY)
    const { rerender } = render(<AgentBriefing />)
    await waitFor(() => expect(screen.getByText(/225 sin stock/)).toBeTruthy())

    // Se cambia de restaurante y la nueva consulta se queda colgada.
    clienteActivo = 'coffee-shop'
    getDeepTable.mockReturnValue(new Promise(() => {}))
    rerender(<AgentBriefing />)

    // La alerta de amalay tiene que desaparecer YA, no cuando llegue la otra.
    expect(screen.queryByText(/225 sin stock/)).toBeNull()
  })

  it('sin restaurante activo no consulta ni pinta — falla cerrado', async () => {
    clienteActivo = null
    getDeepTable.mockResolvedValue(FILAS_AMALAY)
    const { container } = render(<AgentBriefing />)
    expect(getDeepTable).not.toHaveBeenCalled()
    expect(container.firstChild).toBeNull()
  })
})
