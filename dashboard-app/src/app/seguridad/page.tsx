import { Shield, Lock, Server, Eye, Database, Brain, HardDrive } from 'lucide-react'

const sections = [
  {
    icon: Lock,
    title: 'Encriptacion',
    description:
      'Todos los datos se transmiten con TLS 1.3 (HTTPS). Los datos en reposo estan encriptados con AES-256 en Supabase.',
  },
  {
    icon: Shield,
    title: 'Autenticacion',
    description:
      'Acceso protegido con autenticacion por email y contrasena. Sesiones con tokens JWT con expiracion automatica.',
  },
  {
    icon: Database,
    title: 'Aislamiento de datos',
    description:
      'Cada cliente tiene acceso unicamente a sus propios datos. Implementamos Row Level Security (RLS) a nivel de base de datos.',
  },
  {
    icon: Server,
    title: 'Infraestructura',
    description:
      'Hosted en Vercel (SOC 2 compliant) y Supabase (SOC 2 Type II certified). Servidores en US con 99.99% uptime.',
  },
  {
    icon: Eye,
    title: 'Monitoreo',
    description:
      'Registro de todas las acciones del sistema. Alertas automaticas ante comportamiento inusual.',
  },
  {
    icon: Brain,
    title: 'AI',
    description:
      'Las consultas de IA se procesan con Anthropic Claude (SOC 2 certified). No almacenamos prompts ni respuestas de forma permanente.',
  },
  {
    icon: HardDrive,
    title: 'Backups',
    description:
      'Backups automaticos diarios de la base de datos con retencion de 30 dias.',
  },
]

export default function SeguridadPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-white border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <a href="/login" className="inline-block mb-6">
            <span className="text-[#1a1a1a] font-black text-2xl tracking-tight">
              fullsite
              <span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </a>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-text">Seguridad</h1>
          </div>
          <p className="text-text-soft text-sm max-w-2xl">
            La seguridad de los datos de nuestros clientes es nuestra maxima prioridad.
            Estas son las medidas que implementamos para proteger tu informacion.
          </p>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid gap-4">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <div
                key={section.title}
                className="bg-card rounded-xl border border-border card-shadow p-6 flex gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-text mb-1">{section.title}</h2>
                  <p className="text-sm text-text-soft leading-relaxed">{section.description}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-text-muted">
            Preguntas sobre seguridad? Contacta a{' '}
            <a href="mailto:seguridad@fullsite.mx" className="text-accent hover:underline">
              seguridad@fullsite.mx
            </a>
          </p>
          <div className="mt-4 flex justify-center gap-4 text-xs text-text-muted">
            <a href="/privacidad" className="hover:text-accent transition-colors">
              Privacidad
            </a>
            <span>|</span>
            <a href="/terminos" className="hover:text-accent transition-colors">
              Terminos
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
