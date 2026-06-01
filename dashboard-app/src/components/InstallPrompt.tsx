'use client'

import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSPrompt, setShowIOSPrompt] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check if already dismissed
    if (localStorage.getItem('pwa_prompt_dismissed')) return

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) return

    // Android/Chrome — capture beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS — show custom prompt
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isInStandalone = ('standalone' in navigator) && (navigator as unknown as { standalone: boolean }).standalone
    if (isIOS && !isInStandalone) {
      // Delay iOS prompt to not be annoying
      const timer = setTimeout(() => setShowIOSPrompt(true), 30000) // 30s after page load
      return () => { clearTimeout(timer); window.removeEventListener('beforeinstallprompt', handler) }
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setDeferredPrompt(null)
    }
    dismiss()
  }

  const dismiss = () => {
    setDismissed(true)
    setDeferredPrompt(null)
    setShowIOSPrompt(false)
    localStorage.setItem('pwa_prompt_dismissed', Date.now().toString())
  }

  // Android prompt
  if (deferredPrompt && !dismissed) {
    return (
      <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-2xl p-4 animate-in slide-in-from-bottom">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-emerald-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
            <Download size={20} className="text-emerald-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-[var(--text-1)]">Instalar Fullsite</p>
            <p className="text-xs text-[var(--text-3)] mt-0.5">Acceso directo desde tu pantalla. Mas rapido.</p>
          </div>
          <button onClick={dismiss} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={handleInstall} className="flex-1 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-500">
            Instalar
          </button>
          <button onClick={dismiss} className="px-4 py-2 text-[var(--text-3)] text-sm font-medium hover:text-[var(--text-1)]">
            Ahora no
          </button>
        </div>
      </div>
    )
  }

  // iOS prompt
  if (showIOSPrompt && !dismissed) {
    return (
      <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
            <Download size={20} className="text-blue-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-[var(--text-1)]">Instalar Fullsite</p>
            <p className="text-xs text-[var(--text-3)] mt-1 leading-relaxed">
              Toca <span className="inline-block px-1 py-0.5 bg-[var(--surface-2)] rounded text-[var(--text-2)] font-mono text-[10px]">Compartir</span> y luego <span className="font-semibold text-[var(--text-2)]">Agregar a inicio</span>
            </p>
          </div>
          <button onClick={dismiss} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  return null
}
