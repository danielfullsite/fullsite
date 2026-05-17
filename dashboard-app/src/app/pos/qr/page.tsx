'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, QrCode } from 'lucide-react'

export default function QRPage() {
  const [baseUrl] = useState(() => {
    if (typeof window !== 'undefined') return window.location.origin
    return 'https://dashboard-app-eight-zeta.vercel.app'
  })

  const tables = Array.from({ length: 16 }, (_, i) => i + 1)

  return (
    <div className="h-screen flex flex-col text-white bg-slate-900">
      <header className="flex items-center gap-4 px-6 py-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <Link href="/pos" className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <QrCode size={24} className="text-emerald-400" />
          <h1 className="text-xl font-bold">QR por mesa</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-slate-400 text-sm mb-6">
          Cada QR lleva al cliente al menu de la mesa. El pedido llega directo a cocina.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tables.map(mesa => {
            const url = `${baseUrl}/menu/${mesa}`
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`
            return (
              <div key={mesa} className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
                <p className="text-white font-bold text-lg mb-3">Mesa {mesa}</p>
                <img
                  src={qrUrl}
                  alt={`QR Mesa ${mesa}`}
                  className="w-40 h-40 mx-auto rounded-lg bg-white p-2"
                />
                <p className="text-slate-500 text-xs mt-2 break-all">{url}</p>
                <a
                  href={qrUrl}
                  download={`qr-mesa-${mesa}.png`}
                  className="mt-2 inline-block px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg"
                >
                  Descargar
                </a>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
