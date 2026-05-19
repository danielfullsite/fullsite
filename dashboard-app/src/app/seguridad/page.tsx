import { Shield, Lock, Server, Eye, Database, Brain, HardDrive, Fingerprint, Globe, FileCheck } from 'lucide-react'

const sections = [
  {
    icon: Lock,
    title: 'Encriptacion en transito y reposo',
    description:
      'Todos los datos se transmiten con TLS 1.3 (HTTPS). Los datos en reposo estan encriptados con AES-256 en Supabase. Las credenciales y tokens se almacenan encriptados y nunca se exponen en logs ni respuestas de API.',
  },
  {
    icon: Fingerprint,
    title: 'Autenticacion multi-capa',
    description:
      'Dashboard: autenticacion por email y contrasena con tokens JWT de expiracion automatica. POS: autenticacion por PIN individual por empleado con roles (mesero, cajero, gerente, admin). Acciones criticas (cancelaciones, voids, cortes) requieren PIN de gerente.',
  },
  {
    icon: Database,
    title: 'Aislamiento de datos (multi-tenant)',
    description:
      'Cada cliente tiene acceso unicamente a sus propios datos. Implementamos Row Level Security (RLS) a nivel de base de datos en Supabase, garantizando aislamiento completo. No es posible acceder a datos de otro cliente, ni siquiera con acceso directo a la API.',
  },
  {
    icon: Server,
    title: 'Infraestructura certificada',
    description:
      'Vercel (SOC 2): hosting de la aplicacion con CDN global. Supabase (SOC 2 Type II): base de datos PostgreSQL con backups automaticos. Cloudflare: proteccion DDoS, WAF y DNS con DNSSEC. Anthropic (SOC 2): procesamiento de IA con zero-retention policy en API comercial.',
  },
  {
    icon: Eye,
    title: 'Audit trail completo',
    description:
      'Cada accion en el POS se registra en un trail de auditoria inmutable: quien hizo que, cuando, y con que autorizacion. Cancelaciones, descuentos, voids, cambios de mesa, reabrir cuentas — todo queda registrado con timestamp y PIN del operador.',
  },
  {
    icon: Brain,
    title: 'Procesamiento de IA seguro',
    description:
      'Las consultas de IA se envian a Anthropic Claude via API comercial con zero-retention: Anthropic no almacena prompts ni respuestas. Los datos operativos se envian unicamente durante la sesion de consulta. No entrenamos modelos con datos de clientes.',
  },
  {
    icon: HardDrive,
    title: 'Backups y recuperacion',
    description:
      'Backups automaticos diarios de la base de datos con retencion de 30 dias. Point-in-time recovery disponible en Supabase. Los datos del cliente pueden exportarse en cualquier momento en formato CSV.',
  },
  {
    icon: Globe,
    title: 'Proteccion de red',
    description:
      'Cloudflare WAF (Web Application Firewall) protege contra inyeccion SQL, XSS y ataques OWASP Top 10. Rate limiting en APIs publicas. Proteccion DDoS incluida. Todas las conexiones forzadas a HTTPS.',
  },
  {
    icon: FileCheck,
    title: 'Cumplimiento normativo',
    description:
      'Cumplimos con la Ley Federal de Proteccion de Datos Personales en Posesion de los Particulares (LFPDPPP) y su Reglamento. Implementamos derechos ARCO completos. Nuestros proveedores de infraestructura cuentan con certificaciones SOC 2 y controles de seguridad auditados.',
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
          <p className="text-xs text-text-muted mt-2">Ultima actualizacion: 18 de mayo de 2026</p>
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

        {/* Responsible disclosure */}
        <div className="mt-8 bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">Divulgacion responsable</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Si descubres una vulnerabilidad de seguridad en nuestra plataforma, te pedimos que nos la
            reportes de manera responsable a{' '}
            <a href="mailto:seguridad@fullsite.mx" className="text-accent hover:underline">
              seguridad@fullsite.mx
            </a>
            . Nos comprometemos a investigar y responder dentro de 48 horas habiles. No tomaremos
            acciones legales contra investigadores de seguridad que actuen de buena fe.
          </p>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-text-muted">
            Preguntas sobre seguridad?{' '}
            <a href="mailto:seguridad@fullsite.mx" className="text-accent hover:underline">
              seguridad@fullsite.mx
            </a>
          </p>
          <div className="mt-4 flex justify-center gap-4 text-xs text-text-muted">
            <a href="/privacidad" className="hover:text-accent transition-colors">Privacidad</a>
            <span>|</span>
            <a href="/terminos" className="hover:text-accent transition-colors">Terminos</a>
          </div>
        </div>
      </div>
    </div>
  )
}
