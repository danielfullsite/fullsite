export default function CocinaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div style={{
      background: '#0a0a0f',
      color: '#fff',
      minHeight: '100dvh',
      overflow: 'auto',
      colorScheme: 'dark',
    }}>
      {children}
    </div>
  )
}
