'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, QrCode } from 'lucide-react'
import { getMesasConfig } from '@/lib/pos-data'
import { getActiveClientSlug as _cid } from '@/lib/data'
import { qrToDataURL } from '@/lib/qr'

export default function QRPage() {
  const [baseUrl] = useState(() => {
    if (typeof window !== 'undefined') return window.location.origin
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullsite.mx'
  })
  const [qrDataURLs, setQrDataURLs] = useState<Map<number, string>>(new Map())

  const tables = getMesasConfig(_cid(), 16).map(m => m.number)

  useEffect(() => {
    async function generateQRs() {
      const map = new Map<number, string>()
      await Promise.all(tables.map(async mesa => {
        const url = `${baseUrl}/menu/${mesa}`
        try {
          map.set(mesa, await qrToDataURL(url, { width: 200 }))
        } catch { /* QR generation failed for this table */ }
      }))
      setQrDataURLs(new Map(map))
    }
    generateQRs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  return (
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      <header className="flex items-center gap-4 px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <QrCode size={24} className="text-emerald-400" />
          <h1 className="text-xl font-bold">QR por mesa</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-[var(--text-3)] text-sm mb-6">
          Cada QR lleva al cliente al menu de la mesa. El pedido llega directo a cocina.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tables.map(mesa => {
            const url = `${baseUrl}/menu/${mesa}`
            const dataUrl = qrDataURLs.get(mesa)
            return (
              <div key={mesa} className="bg-[var(--surface-2)] border border-slate-700 rounded-xl p-4 text-center">
                <p className="text-white font-bold text-lg mb-3">Mesa {mesa}</p>
                {dataUrl ? (
                  <img
                    src={dataUrl}
                    alt={`QR Mesa ${mesa}`}
                    className="w-40 h-40 mx-auto rounded-lg bg-white p-1"
                  />
                ) : (
                  <div className="w-40 h-40 mx-auto rounded-lg bg-[var(--line)] flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <p className="text-[var(--text-2)] text-xs mt-2 break-all">{url}</p>
                {dataUrl && (
                  <a
                    href={dataUrl}
                    download={`qr-mesa-${mesa}.png`}
                    className="mt-2 inline-block px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg"
                  >
                    Descargar
                  </a>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
