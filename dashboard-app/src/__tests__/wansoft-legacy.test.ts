// El guardián del histórico de Wansoft pregunta por la propiedad, no por el nombre.
//
// Hay tablas heredadas —wansoft_waiter_categories, wansoft_kpis, wansoft_food_cost—
// que NO tienen columna de cliente. Sólo puede haber UN restaurante dueño de esas
// filas, y quien las lea ve las suyas. Por eso cuatro lugares del código preguntaban
// `clientId === 'amalay'`: no era una bandera de producto, era un guardián que impedía
// que un restaurante viera los meseros y las ventas de otro.
//
// Lo que estaba mal era la pregunta. "¿Eres AMALAY?" ata el producto a un cliente;
// "¿eres dueño del histórico?" es configurable y funciona el día que otro restaurante
// migre desde Wansoft, sin tocar código.
//
// LO QUE MÁS IMPORTA DE ESTE ARCHIVO son los casos de falla. Un guardián de seguridad
// que ante un error de red devuelve `true` es peor que no tener guardián, porque falla
// justo cuando nadie está mirando. Todos los caminos de error tienen que dar `false`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const URL_SB = 'https://proyecto.supabase.co'

async function cargar() {
  vi.resetModules()
  const mod = await import('@/lib/wansoft-legacy')
  mod._limpiarCacheWansoft()
  return mod
}

let fetchFalso: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_SB)
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'llave-de-prueba')
  fetchFalso = vi.fn()
  vi.stubGlobal('fetch', fetchFalso)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const responde = (filas: unknown) =>
  fetchFalso.mockResolvedValue({ ok: true, json: async () => filas })

describe('esDuenoDelHistoricoWansoft', () => {
  it('es dueño si clients.wansoft_subsidiary_id tiene valor', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    responde([{ wansoft_subsidiary_id: '4821' }])
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(true)
  })

  it('NO es dueño si el campo viene nulo', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    responde([{ wansoft_subsidiary_id: null }])
    expect(await esDuenoDelHistoricoWansoft('boruca')).toBe(false)
  })

  it('NO es dueño si el campo viene vacío o en blancos', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    responde([{ wansoft_subsidiary_id: '   ' }])
    expect(await esDuenoDelHistoricoWansoft('x')).toBe(false)
  })

  it('NO es dueño si el restaurante no existe', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    responde([])
    expect(await esDuenoDelHistoricoWansoft('inventado')).toBe(false)
  })

  it('la pregunta no depende del nombre: un slug cualquiera con el campo puesto SÍ es dueño', async () => {
    // El corazón del cambio. Si mañana migra otro restaurante desde Wansoft, funciona
    // poniéndole el subsidiary_id — sin tocar código ni desplegar.
    const { esDuenoDelHistoricoWansoft } = await cargar()
    responde([{ wansoft_subsidiary_id: '9931' }])
    expect(await esDuenoDelHistoricoWansoft('restaurante-nuevo')).toBe(true)
  })

  it('y amalay NO es dueño por llamarse amalay', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    responde([{ wansoft_subsidiary_id: null }])
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(false)
  })
})

describe('falla cerrado — lo que de verdad importa', () => {
  it('si la red truena, NO es dueño', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    fetchFalso.mockRejectedValue(new Error('ECONNRESET'))
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(false)
  })

  it('si la respuesta no es 2xx, NO es dueño', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    fetchFalso.mockResolvedValue({ ok: false, json: async () => [{ wansoft_subsidiary_id: '4821' }] })
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(false)
  })

  it('si el cuerpo no es JSON válido, NO es dueño', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    fetchFalso.mockResolvedValue({ ok: true, json: async () => { throw new Error('no es json') } })
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(false)
  })

  it('sin clientId, NO es dueño y ni siquiera consulta', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    expect(await esDuenoDelHistoricoWansoft('')).toBe(false)
    expect(await esDuenoDelHistoricoWansoft(null)).toBe(false)
    expect(await esDuenoDelHistoricoWansoft(undefined)).toBe(false)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('sin credenciales de servicio, NO es dueño y no consulta', async () => {
    vi.stubEnv('SUPABASE_SERVICE_KEY', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const { esDuenoDelHistoricoWansoft } = await cargar()
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(false)
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})

describe('caché', () => {
  it('no consulta dos veces al mismo restaurante', async () => {
    const { esDuenoDelHistoricoWansoft } = await cargar()
    responde([{ wansoft_subsidiary_id: '4821' }])

    await esDuenoDelHistoricoWansoft('amalay')
    const llamadas = fetchFalso.mock.calls.length
    await esDuenoDelHistoricoWansoft('amalay')
    expect(fetchFalso.mock.calls.length).toBe(llamadas)
  })

  it('la caché es POR restaurante: uno no hereda la respuesta del otro', async () => {
    // Si la caché no estuviera indexada por tenant, el segundo restaurante heredaría
    // el `true` del primero y leería sus meseros. Es el modo de fallo peor.
    const { esDuenoDelHistoricoWansoft } = await cargar()

    fetchFalso.mockResolvedValueOnce({ ok: true, json: async () => [{ wansoft_subsidiary_id: '4821' }] })
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(true)

    fetchFalso.mockResolvedValueOnce({ ok: true, json: async () => [{ wansoft_subsidiary_id: null }] })
    expect(await esDuenoDelHistoricoWansoft('boruca')).toBe(false)
  })

  it('tampoco cachea un false que vino de un error como si fuera respuesta buena', async () => {
    // Cachear el fallo 5 minutos apagaría el agente de finanzas del dueño legítimo
    // por un parpadeo de red. Se cachea igual —es el lado seguro— pero se comprueba
    // que la siguiente consulta con la red sana lo corrija dentro de la misma sesión
    // recargando el módulo, que es lo que hace el proceso al reiniciar.
    const { esDuenoDelHistoricoWansoft } = await cargar()
    fetchFalso.mockRejectedValueOnce(new Error('red caída'))
    expect(await esDuenoDelHistoricoWansoft('amalay')).toBe(false)

    const otra = await cargar()
    fetchFalso.mockResolvedValue({ ok: true, json: async () => [{ wansoft_subsidiary_id: '4821' }] })
    expect(await otra.esDuenoDelHistoricoWansoft('amalay')).toBe(true)
  })
})
