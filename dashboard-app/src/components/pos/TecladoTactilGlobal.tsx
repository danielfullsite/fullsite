'use client'

import { useEffect, useRef, useState } from 'react'

type Campo = HTMLInputElement | HTMLTextAreaElement
type Modo = 'texto' | 'numero' | 'decimal'

interface Sesion {
  campo: Campo
  valorInicial: string
  readOnlyInicial: boolean
  inputModeInicial: string
}

const FILAS_LETRAS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '@', '.', '-'],
]

// Una segunda capa conserva el mismo alto que las letras. Incluye los signos
// necesarios para correos, contraseñas, tokens y referencias sin depender de
// copiar/pegar ni de un teclado físico.
const FILAS_SIMBOLOS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '.', '_', '-', '+', '=', '/', '\\', ':', ';'],
  ['!', '?', '#', '$', '%', '&', '*', '(', ')', "'"],
  ['"', ',', '{', '}', '[', ']', '<', '>', '°', '|'],
]

const TIPOS_SIN_TECLADO = new Set(['button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'month', 'radio', 'range', 'reset', 'submit', 'time', 'week'])

function campoCompatible(element: Element | null): element is Campo {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false
  if (element.dataset.tecladoTactil === 'nativo') return false
  return !TIPOS_SIN_TECLADO.has(element.type)
}

function modoDelCampo(campo: Campo): Modo {
  if (campo.inputMode === 'decimal' || campo instanceof HTMLInputElement && campo.type === 'number') return 'decimal'
  if (campo.inputMode === 'numeric' || campo.inputMode === 'tel') return 'numero'
  return 'texto'
}

function nombreDelCampo(campo: Campo): string {
  const aria = campo.getAttribute('aria-label')
  if (aria) return aria
  if (campo.id) {
    const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(candidate => candidate.htmlFor === campo.id)
    if (label?.textContent?.trim()) return label.textContent.trim()
  }
  const parentLabel = campo.closest('label')
  if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim()

  // Muchos formularios antiguos pintan `<label>` y `<input>` como hermanos,
  // sin `htmlFor`. Visualmente se entiende, pero el teclado no podia saber que
  // "$0.00" era el Fondo de caja. Recorremos solamente dos contenedores y solo
  // aceptamos una etiqueta inequivoca; si hay varias, no adivinamos.
  let contenedor: HTMLElement | null = campo.parentElement
  for (let profundidad = 0; contenedor && profundidad < 2; profundidad += 1) {
    const etiquetas = [...contenedor.children].filter((child): child is HTMLLabelElement =>
      child instanceof HTMLLabelElement && !child.contains(campo))
    if (etiquetas.length === 1 && etiquetas[0].textContent?.trim()) return etiquetas[0].textContent.trim()
    contenedor = contenedor.parentElement
  }
  return campo.placeholder || 'Campo de texto'
}

function fijarValor(campo: Campo, valor: string) {
  const prototype = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(campo, valor)
  campo.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Teclado de la estación completa. Sólo se abre por un pointer real sobre el
 * campo: los tests, lectores y automatizaciones que enfocan un input no quedan
 * tapados. En el pointerdown vuelve el campo readOnly antes de que Electron
 * pueda invocar un teclado del sistema; los botones escriben por el mismo evento
 * `input` que ya consume cada formulario controlado.
 */
export default function TecladoTactilGlobal() {
  const sesion = useRef<Sesion | null>(null)
  const [campo, setCampo] = useState<Campo | null>(null)
  const [modo, setModo] = useState<Modo>('texto')
  const [nombre, setNombre] = useState('Campo de texto')
  const [valorVisible, setValorVisible] = useState('')
  const [mayusculas, setMayusculas] = useState(true)
  const [simbolos, setSimbolos] = useState(false)

  const restaurar = (actual: Sesion | null, desenfocar: boolean) => {
    if (!actual) return
    actual.campo.readOnly = actual.readOnlyInicial
    actual.campo.inputMode = actual.inputModeInicial
    if (desenfocar) actual.campo.blur()
  }

  const cerrar = (aceptar: boolean) => {
    const actual = sesion.current
    if (!actual) return
    if (!aceptar) fijarValor(actual.campo, actual.valorInicial)
    restaurar(actual, true)
    sesion.current = null
    setCampo(null)
  }

  useEffect(() => {
    const abrir = (event: PointerEvent) => {
      const objetivo = event.target instanceof Element ? event.target.closest('input,textarea') : null
      if (!campoCompatible(objetivo) || objetivo.closest('[data-teclado-tactil-panel]')) return

      if (sesion.current?.campo !== objetivo) restaurar(sesion.current, false)
      const nuevoModo = modoDelCampo(objetivo)
      const nueva: Sesion = {
        campo: objetivo,
        valorInicial: objetivo.value,
        readOnlyInicial: objetivo.readOnly,
        inputModeInicial: objetivo.inputMode,
      }
      sesion.current = nueva
      // Ocurre antes del focus nativo que sigue a pointerdown: no aparece un
      // teclado ajeno debajo del nuestro en Windows, Linux, Android o iPadOS.
      objetivo.readOnly = true
      objetivo.inputMode = 'none'
      setCampo(objetivo)
      setModo(nuevoModo)
      setNombre(nombreDelCampo(objetivo))
      setValorVisible(objetivo.value)
      // Conserva el teclado textual en mayúsculas como antes, pero correos y
      // secretos empiezan en minúsculas, que es la captura habitual y evita un
      // toque extra en los dos campos donde el caso importa más.
      setMayusculas(!(objetivo instanceof HTMLInputElement && ['email', 'password', 'url'].includes(objetivo.type)))
      setSimbolos(false)
      requestAnimationFrame(() => objetivo.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
    }
    document.addEventListener('pointerdown', abrir, true)
    return () => {
      document.removeEventListener('pointerdown', abrir, true)
      restaurar(sesion.current, false)
    }
  }, [])

  const escribir = (texto: string) => {
    const actual = sesion.current?.campo
    if (!actual || !document.contains(actual)) return cerrar(true)
    const inicio = actual.selectionStart ?? actual.value.length
    const fin = actual.selectionEnd ?? inicio
    let siguiente = actual.value.slice(0, inicio) + texto + actual.value.slice(fin)
    if (actual.maxLength >= 0) siguiente = siguiente.slice(0, actual.maxLength)
    fijarValor(actual, siguiente)
    setValorVisible(siguiente)
    requestAnimationFrame(() => {
      const posicion = Math.min(inicio + texto.length, siguiente.length)
      try { actual.setSelectionRange(posicion, posicion) } catch { /* type=number */ }
    })
  }

  const borrar = () => {
    const actual = sesion.current?.campo
    if (!actual) return
    const inicio = actual.selectionStart ?? actual.value.length
    const fin = actual.selectionEnd ?? inicio
    const desde = inicio === fin ? Math.max(0, inicio - 1) : inicio
    const siguiente = actual.value.slice(0, desde) + actual.value.slice(fin)
    fijarValor(actual, siguiente)
    setValorVisible(siguiente)
    requestAnimationFrame(() => { try { actual.setSelectionRange(desde, desde) } catch { /* type=number */ } })
  }

  if (!campo) return null
  const esSecreto = campo instanceof HTMLInputElement && campo.type === 'password'
  const vistaPrevia = esSecreto ? '•'.repeat(valorVisible.length) : valorVisible
  const tecla = 'min-h-[56px] rounded-xl border border-[var(--line)] bg-[var(--raised)] px-2 text-lg font-bold text-[var(--text-1)] active:scale-95'
  const filasTexto = simbolos ? FILAS_SIMBOLOS : FILAS_LETRAS.map(fila => fila.map(caracter =>
    /^[A-ZÑ]$/.test(caracter) && !mayusculas ? caracter.toLocaleLowerCase('es-MX') : caracter))

  return <section data-teclado-tactil-panel role="dialog" aria-label={`Teclado en pantalla para ${nombre}`}
    className="fixed inset-x-0 bottom-0 z-[240] border-t border-[var(--line)] bg-[var(--surface)] p-3 shadow-[0_-18px_45px_rgba(0,0,0,.65)]">
    <div className="mx-auto max-w-5xl">
      <div className="mb-2 flex min-h-[64px] items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[var(--text-3)]">{nombre}</p>
          <output
            aria-label={esSecreto ? `${nombre}: ${valorVisible.length} digitos capturados` : `${nombre}: valor capturado`}
            className="mt-1 block min-h-8 truncate text-2xl font-bold tracking-[0.35em] text-[var(--text-1)]"
          >
            {vistaPrevia || <span className="text-base font-medium tracking-normal text-[var(--text-4)]">Sin capturar</span>}
          </output>
        </div>
        <div className="flex gap-2">
          <button type="button" className={`${tecla} px-4 text-sm`} onPointerDown={e => e.preventDefault()} onClick={() => cerrar(false)}>Cancelar</button>
          <button type="button" className={`${tecla} border-emerald-600 bg-emerald-600 px-6 text-sm text-white`} onPointerDown={e => e.preventDefault()} onClick={() => cerrar(true)}>Listo</button>
        </div>
      </div>

      {modo === 'texto' ? <div className="space-y-2">
        {filasTexto.map((fila, index) => <div key={index} className="grid grid-cols-10 gap-2">
          {fila.map(caracter => <button type="button" key={caracter} aria-label={`Escribir ${caracter}`} className={tecla}
            onPointerDown={e => e.preventDefault()} onClick={() => escribir(caracter)}>{caracter}</button>)}
        </div>)}
        <div className="grid grid-cols-[1fr_1fr_2fr_1fr_1fr] gap-2">
          <button type="button" className={tecla} onPointerDown={e => e.preventDefault()} onClick={() => { fijarValor(campo, ''); setValorVisible('') }}>Limpiar</button>
          <button type="button" aria-pressed={mayusculas} disabled={simbolos} className={`${tecla} disabled:opacity-40`}
            onPointerDown={e => e.preventDefault()} onClick={() => setMayusculas(valor => !valor)}>
            {mayusculas ? 'Minúsculas' : 'Mayúsculas'}
          </button>
          <button type="button" className={tecla} onPointerDown={e => e.preventDefault()} onClick={() => escribir(' ')}>Espacio</button>
          <button type="button" aria-pressed={simbolos} className={tecla} onPointerDown={e => e.preventDefault()}
            onClick={() => setSimbolos(valor => !valor)}>{simbolos ? 'Letras' : 'Símbolos'}</button>
          <button type="button" className={tecla} onPointerDown={e => e.preventDefault()} onClick={borrar}>Borrar</button>
        </div>
      </div> : <div className="mx-auto grid max-w-xl grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(numero => <button type="button" key={numero} aria-label={`Escribir ${numero}`} className={tecla}
          onPointerDown={e => e.preventDefault()} onClick={() => escribir(numero)}>{numero}</button>)}
        <button type="button" className={tecla} onPointerDown={e => e.preventDefault()} onClick={() => { fijarValor(campo, ''); setValorVisible('') }}>Limpiar</button>
        <button type="button" aria-label="Escribir 0" className={tecla} onPointerDown={e => e.preventDefault()} onClick={() => escribir('0')}>0</button>
        <button type="button" className={tecla} onPointerDown={e => e.preventDefault()} onClick={borrar}>Borrar</button>
        {modo === 'decimal' && <button type="button" aria-label="Escribir punto decimal" className={`${tecla} col-span-3`} onPointerDown={e => e.preventDefault()}
          onClick={() => { if (!campo.value.includes('.')) escribir('.') }}>Punto decimal</button>}
      </div>}
    </div>
  </section>
}
