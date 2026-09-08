'use client'

import { useState, useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'

/** Un solo lugar decide cómo se aplica el tema al documento. */
function aplicarTema(tema: 'light' | 'dark') {
  if (tema === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    // Claro es el arranque. Oscuro es una elección explícita, guardada como
    // 'dark'. El mismo criterio vive en el script de arranque de layout.tsx,
    // que lo aplica antes del primer pintado para que no haya destello.
    const oscuro = localStorage.getItem('theme') === 'dark'
    setTheme(oscuro ? 'dark' : 'light')
    aplicarTema(oscuro ? 'dark' : 'light')
  }, [])

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try { localStorage.setItem('theme', next) } catch {}
    aplicarTema(next)
  }

  return { theme, toggle }
}

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md transition-colors text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]"
      title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  )
}
