'use client'

import { useState } from 'react'
import { Calculator, Banknote } from 'lucide-react'
import { formatMXN } from '@/lib/pos-data'

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]

interface SmartCashCalculatorProps {
  total: number
  onClose: () => void
}

export default function SmartCashCalculator({ total, onClose }: SmartCashCalculatorProps) {
  const [received, setReceived] = useState('')
  const receivedNum = Number(received) || 0
  const change = receivedNum - total

  // Calculate optimal denominations for change
  const getOptimalChange = (amount: number): { denom: number; count: number }[] => {
    if (amount <= 0) return []
    let remaining = Math.round(amount * 100) / 100 // fix floating point
    const result: { denom: number; count: number }[] = []
    for (const d of DENOMINATIONS) {
      if (remaining >= d) {
        const count = Math.floor(remaining / d)
        result.push({ denom: d, count })
        remaining = Math.round((remaining - d * count) * 100) / 100
      }
    }
    return result
  }

  const changeBreakdown = getOptimalChange(change)

  // Quick amount buttons
  const quickAmounts = [
    Math.ceil(total / 100) * 100,     // round up to nearest 100
    Math.ceil(total / 500) * 500,     // round up to nearest 500
    Math.ceil(total / 1000) * 1000,   // round up to nearest 1000
    total,                              // exact
  ].filter((v, i, a) => a.indexOf(v) === i && v >= total).sort((a, b) => a - b).slice(0, 4)

  return (
    <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calculator size={18} className="text-emerald-400" />
          <span className="font-bold text-[var(--text-1)]">Calculadora de cambio</span>
        </div>
        <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text-1)]">×</button>
      </div>

      <div className="text-center mb-3">
        <p className="text-sm text-[var(--text-3)]">Total a cobrar</p>
        <p className="text-2xl font-black text-emerald-400">{formatMXN(total)}</p>
      </div>

      {/* Quick amount buttons */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {quickAmounts.map(amt => (
          <button
            key={amt}
            onClick={() => setReceived(String(amt))}
            className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${
              receivedNum === amt
                ? 'bg-emerald-500 text-white'
                : 'bg-[var(--line)] text-[var(--text-2)] hover:bg-[var(--line-soft)]'
            }`}
          >
            ${amt.toLocaleString()}
          </button>
        ))}
      </div>

      {/* Manual input */}
      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] font-bold">$</span>
        <input
          type="number"
          inputMode="decimal"
          value={received}
          onChange={(e) => setReceived(e.target.value)}
          placeholder="Efectivo recibido"
          autoFocus
          className="w-full bg-[var(--line)] border border-[var(--line)] rounded-xl pl-8 pr-4 py-3 text-xl font-bold text-center text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Change display */}
      {receivedNum > 0 && (
        <div className={`rounded-xl p-4 text-center ${
          change >= 0 ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'
        }`}>
          {change >= 0 ? (
            <>
              <p className="text-sm text-[var(--text-3)] mb-1">Cambio</p>
              <p className="text-3xl font-black text-emerald-400">{formatMXN(change)}</p>
              {change > 0 && changeBreakdown.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 mt-3">
                  {changeBreakdown.map(({ denom, count }) => (
                    <div key={denom} className="flex items-center gap-1 bg-[var(--surface)]/50 rounded-lg px-2 py-1">
                      <Banknote size={12} className="text-emerald-400" />
                      <span className="text-xs font-bold text-[var(--text-1)]">
                        {count}×${denom}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-red-400 mb-1">Falta</p>
              <p className="text-3xl font-black text-red-400">{formatMXN(Math.abs(change))}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
