import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Fullsite KDS — Cocina',
}

export default function KdsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body style={{ margin: 0, padding: 0, background: '#000', overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  )
}
