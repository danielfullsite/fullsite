import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import AppShell from '@/components/AppShell'
import PosthogInit from '@/components/PosthogInit'
import SupabasePatch from '@/components/SupabasePatch'
import InstallPrompt from '@/components/InstallPrompt'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Fullsite Dashboard',
  description: 'Restaurant Operations Dashboard - Fullsite',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Dark by default. Only set light if user chose it. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()){document.documentElement.classList.add('capacitor')}}catch(e){}})();` }} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0a0a0b" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)" />
        {/* iOS PWA — feel like native app */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Fullsite" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* iOS splash screens — prevents white flash on launch */}
        <meta name="apple-mobile-web-app-orientations" content="portrait" />
        <link rel="apple-touch-startup-image" href="/apple-touch-icon.png" />
        {/* Disable iOS quirks */}
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text-1)]">
        <PosthogInit />
        <SupabasePatch />
        <AuthProvider>
          <AppShell>{children}</AppShell>
          <InstallPrompt />
        </AuthProvider>
      </body>
    </html>
  )
}
