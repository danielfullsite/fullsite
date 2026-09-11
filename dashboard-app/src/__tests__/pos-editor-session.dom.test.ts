import { createElement, useEffect, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { crearSesionEditorCaja } from '@/lib/pos-editor-session'

beforeEach(() => { cleanup(); localStorage.clear() })
it.each(['mover', 'anular'])('a confirmed %s cannot recreate an empty draft when a read and React persistence finish late', async action => {
  let release!: (items: string[]) => void
  const reading = new Promise<string[]>(resolve => { release = resolve })
  const session = crearSesionEditorCaja()
  const generation = session.iniciar()
  localStorage.setItem('account', JSON.stringify({ base: ['coffee', 'coffee-2'], draft: ['coffee', 'coffee-2'] }))
  function Editor() {
    const [items, setItems] = useState(['coffee', 'coffee-2'])
    const baseline = useRef(items)
    useEffect(() => {
      void reading.then(remote => {
        if (!session.vigente(generation)) return
        baseline.current = remote
        localStorage.setItem('account', JSON.stringify({ base: remote, draft: items }))
      })
    }, [])
    useEffect(() => {
      if (session.puedePersistir()) localStorage.setItem('account', JSON.stringify({ base: baseline.current, draft: items }))
    }, [items])
    return createElement('button', { onClick: () => {
      session.salir()
      setItems([])
      localStorage.removeItem('account')
    } }, action)
  }
  render(createElement(Editor))
  fireEvent.click(screen.getByRole('button', { name: action }))
  await act(async () => { release(['coffee', 'coffee-2']); await reading })
  expect(localStorage.getItem('account')).toBeNull()
  const nextVisit = session.iniciar()
  expect(session.vigente(generation)).toBe(false)
  expect(session.vigente(nextVisit)).toBe(true)
  expect(session.puedePersistir()).toBe(true)
})
