import { createElement, useState, type ChangeEvent } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import TecladoTactilGlobal from '@/components/pos/TecladoTactilGlobal'

afterEach(cleanup)

function Campo({ modo = 'decimal', tipo }: { modo?: 'decimal' | 'text'; tipo?: 'email' | 'password' }) {
  const [value, setValue] = useState('')
  return createElement('div', null,
    createElement('label', { htmlFor: 'campo' }, 'Importe de prueba'),
    createElement('input', { id: 'campo', type: tipo, inputMode: modo, value, onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value) }),
    createElement(TecladoTactilGlobal),
  )
}

function tocar(texto: string) {
  for (const caracter of texto) fireEvent.click(screen.getByRole('button', { name: `Escribir ${caracter}` }))
}

it('un toque abre el pad, escribe en el input controlado y Listo restaura el campo', () => {
  render(createElement(Campo))
  const input = screen.getByLabelText('Importe de prueba') as HTMLInputElement
  fireEvent.pointerDown(input)
  expect(screen.getByRole('dialog', { name: 'Teclado en pantalla para Importe de prueba' })).toBeTruthy()
  expect(input.readOnly).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Escribir 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Escribir 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Escribir punto decimal' }))
  fireEvent.click(screen.getByRole('button', { name: 'Escribir 5' }))
  expect(input.value).toBe('12.5')
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(input.readOnly).toBe(false)
})

it('Cancelar devuelve el valor anterior y el teclado de texto incluye espacio y borrar', () => {
  render(createElement(Campo, { modo: 'text' }))
  const input = screen.getByLabelText('Importe de prueba') as HTMLInputElement
  fireEvent.pointerDown(input)
  fireEvent.click(screen.getByRole('button', { name: 'Escribir A' }))
  fireEvent.click(screen.getByRole('button', { name: 'Espacio' }))
  fireEvent.click(screen.getByRole('button', { name: 'Escribir 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
  expect(input.value).toBe('A ')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(input.value).toBe('')
})

it('enfocar por código no abre el teclado ni vuelve readonly el campo', () => {
  render(createElement(Campo))
  const input = screen.getByLabelText('Importe de prueba') as HTMLInputElement
  fireEvent.focus(input)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(input.readOnly).toBe(false)
})

it('escribe un correo completo usando solamente teclas táctiles', () => {
  render(createElement(Campo, { modo: 'text', tipo: 'email' }))
  const input = screen.getByLabelText('Importe de prueba') as HTMLInputElement

  fireEvent.pointerDown(input)
  tocar('factura@empresa.com')
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))

  expect(input.value).toBe('factura@empresa.com')
}, 10_000)

it('escribe una credencial opaca con minúsculas, guión bajo y guión usando solamente teclas táctiles', () => {
  render(createElement(Campo, { modo: 'text', tipo: 'password' }))
  const input = screen.getByLabelText('Importe de prueba') as HTMLInputElement

  fireEvent.pointerDown(input)
  tocar('clave')
  fireEvent.click(screen.getByRole('button', { name: 'Símbolos' }))
  tocar('_-')
  fireEvent.click(screen.getByRole('button', { name: 'Letras' }))
  tocar('privada')

  expect(input.value).toBe('clave_-privada')
}, 10_000)

it('alterna entre minúsculas y mayúsculas sin agregar otra fila al teclado', () => {
  render(createElement(Campo, { modo: 'text' }))
  const input = screen.getByLabelText('Importe de prueba') as HTMLInputElement

  fireEvent.pointerDown(input)
  tocar('A')
  fireEvent.click(screen.getByRole('button', { name: 'Minúsculas' }))
  tocar('a')

  expect(input.value).toBe('Aa')
  expect(screen.getAllByRole('button', { name: /^Escribir / })).toHaveLength(40)
  expect(screen.getByRole('dialog').className).toContain('fixed')
  expect(screen.getByRole('dialog').className).toContain('bottom-0')
})
