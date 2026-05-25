'use client'

import CoachPanel from '@/components/CoachPanel'
import { Sparkles } from 'lucide-react'

export default function CoachPage() {
  return (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Coach</h2>
            <p className="text-sm text-[var(--text-3)]">Tu socio operativo que nunca deja de pensar en tu negocio</p>
          </div>
        </div>
      </div>

      <CoachPanel />
    </>
  )
}
