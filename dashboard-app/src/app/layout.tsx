import type { Metadata } from 'next'
import './globals.css'
import TopNav from '@/components/TopNav'
import ChatWidget from '@/components/ChatWidget'

export const metadata: Metadata = {
  title: 'Fullsite Dashboard',
  description: 'Restaurant Operations Dashboard - Fullsite',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="h-full">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full bg-surface">
        <TopNav />
        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </main>
        <ChatWidget />
      </body>
    </html>
  )
}
