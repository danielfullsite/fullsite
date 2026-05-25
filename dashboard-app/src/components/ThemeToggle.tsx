'use client'

import { useState, useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    // Dark is default (no attribute). Light = data-theme="light"
    const saved = localStorage.getItem('theme')
    if (saved === 'light') {
      setTheme('light')
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      setTheme('dark')
      document.documentElement.removeAttribute('data-theme')
    }
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme', next)
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
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
