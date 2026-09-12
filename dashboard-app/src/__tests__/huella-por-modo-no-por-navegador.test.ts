import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  decidirHuella, normalizarAutoridad, causaDeFalloDeHuella, mensajeDeFalloDeHuella,
  recordarAutoridad, modoDeAutoridadRecordado, olvidarAutoridadRecordada,
} from '@/lib/modo-autoridad'

// El guard de la huella preguntaba `requiereCaja()`, que responde por el
// userAgent: bajo Electron es SIEMPRE verdadero. O sea preguntaba «¿soy una
// aplicación de escritorio?» cuando lo que necesita saber es «¿esta instalación
// exige un permiso firmado por Caja?». Con eso, la huella quedó rechazada en las
// tres terminales de AMALAY, que tiene tres lectores instalados y la usa a
// diario. En la versión que corre hoy en producción ese guard no existe.

describe('con qué se decide si la huella basta', () => {
  it('en cualquier modo la huella identifica y el PIN firma la sesión', () => {
    for (const modo of ['legacy', 'caja', 'desconocido'] as const) {
      expect(decidirHuella(modo)).toBe('identificar-y-pedir-pin')
    }
  })
})

describe('qué cuenta como respuesta sobre el modo', () => {
  it('sólo los dos valores del contrato', () => {
    expect(normalizarAutoridad('caja')).toBe('caja')
    expect(normalizarAutoridad('legacy')).toBe('legacy')
  })

  it('cualquier otra cosa es silencio, no un modo', () => {
    for (const basura of [undefined, null, '', 'CAJA', 'Caja', 0, 1, true, {}, ['caja']]) {
      expect(normalizarAutoridad(basura)).toBeNull()
    }
  })
})

// Estas pruebas corren en Node, donde no hay almacenamiento del navegador. Se
// simula el mínimo que el módulo usa. El caso de que NO exista se prueba aparte.
function simularAlmacenamiento() {
  const datos = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, String(v)) },
    removeItem: (k: string) => { datos.delete(k) },
    clear: () => datos.clear(),
  }
}
function quitarAlmacenamiento() {
  delete (globalThis as { localStorage?: unknown }).localStorage
}

describe('memoria del modo', () => {
  beforeEach(() => { olvidarAutoridadRecordada(); simularAlmacenamiento() })
  afterEach(() => { olvidarAutoridadRecordada(); quitarAlmacenamiento() })

  it('sin haber leído nada, el modo es desconocido', () => {
    expect(modoDeAutoridadRecordado()).toBe('desconocido')
  })

  it('recuerda lo que Pedro reportó', () => {
    recordarAutoridad('caja')
    expect(modoDeAutoridadRecordado()).toBe('caja')
  })

  it('una lectura fallida NO degrada lo que ya se sabía', () => {
    // Éste es el caso peligroso: si un /state que no contesta borrara el modo,
    // una caja con autoridad pasaría a «desconocido» y la huella entraría.
    recordarAutoridad('caja')
    recordarAutoridad(undefined)
    recordarAutoridad(null)
    recordarAutoridad('')
    expect(modoDeAutoridadRecordado()).toBe('caja')
    expect(decidirHuella(modoDeAutoridadRecordado())).toBe('identificar-y-pedir-pin')
  })

  it('sobrevive a un refresco de la pantalla', () => {
    recordarAutoridad('caja')
    olvidarAutoridadRecordada()   // como recargar la página
    expect(modoDeAutoridadRecordado()).toBe('caja')
  })
})

describe('sin almacenamiento del navegador', () => {
  // Ventana privada, almacenamiento bloqueado, o el propio acceso lanzando.
  // Nada de esto puede tumbar la pantalla de acceso.
  beforeEach(() => { olvidarAutoridadRecordada(); quitarAlmacenamiento() })
  afterEach(() => { olvidarAutoridadRecordada() })

  it('no truena y responde desconocido', () => {
    expect(() => recordarAutoridad('caja')).not.toThrow()
    expect(modoDeAutoridadRecordado()).toBe('caja')  // la memoria del proceso alcanza
  })

  it('sin nada recordado, sigue siendo desconocido y pide PIN', () => {
    expect(modoDeAutoridadRecordado()).toBe('desconocido')
    expect(decidirHuella(modoDeAutoridadRecordado())).toBe('identificar-y-pedir-pin')
  })
})

describe('qué se le dice al mesero cuando falla el lector', () => {
  const casos = [
    { nombre: 'el servicio del lector no está corriendo', entrada: { status: 503 }, causa: 'servicio-apagado' },
    { nombre: 'no llegó la lectura a tiempo', entrada: { status: 504 }, causa: 'sin-lectura' },
    { nombre: 'la terminal no tiene credencial de red', entrada: { status: 401 }, causa: 'terminal-sin-configurar' },
    { nombre: 'no se alcanzó el servidor local', entrada: { errorDeRed: true }, causa: 'terminal-sin-configurar' },
    { nombre: 'la huella no está dada de alta', entrada: { status: 200, ok: false }, causa: 'no-reconocida' },
    { nombre: 'leyó pero no sabe quién es, con internet', entrada: { status: 200, ok: true, enLinea: true }, causa: 'sin-vinculo-con-red' },
    { nombre: 'leyó pero no sabe quién es, sin internet', entrada: { status: 200, ok: true, enLinea: false }, causa: 'sin-vinculo-sin-red' },
  ] as const

  for (const caso of casos) {
    it(`${caso.nombre}: dice qué pasó y qué hacer`, () => {
      const causa = causaDeFalloDeHuella(caso.entrada)
      expect(causa).toBe(caso.causa)
      const texto = mensajeDeFalloDeHuella(causa)
      expect(texto.length).toBeGreaterThan(20)
      // Siempre queda una salida: el PIN. Un mesero no se puede quedar parado.
      expect(texto).toMatch(/PIN/)
    })
  }

  it('el 401 no filtra jerga de red a la cara del mesero', () => {
    // Hoy se muestra el error crudo del servidor, que dice cosas como
    // «falta la credencial de la red local». Un mesero no puede hacer nada con eso.
    const texto = mensajeDeFalloDeHuella(causaDeFalloDeHuella({ status: 401 }))
    expect(texto).not.toMatch(/credencial|401|403|lan|token|bridge/i)
    expect(texto).toMatch(/soporte/)
  })
})
