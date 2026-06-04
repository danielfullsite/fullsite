import { Shield, Lock, Server, Eye, Database, Brain, HardDrive, Fingerprint, Globe, FileCheck, CheckCircle2, Clock, ExternalLink, Download } from 'lucide-react'

const certifications = [
  {
    name: 'PCI-DSS SAQ-A',
    status: 'compliant' as const,
    description: 'Tokenización de pagos — nunca almacenamos datos de tarjeta',
    detail: 'Procesamos pagos exclusivamente a través de Stripe, Clip y MercadoPago. Los datos de tarjeta nunca tocan nuestros servidores. Cumplimos con PCI-DSS SAQ-A como comerciantes que no almacenan, procesan ni transmiten datos de tarjetahabiente.',
    doc: '/policies/pci-dss-saq-a.pdf',
  },
  {
    name: 'CFDI 4.0',
    status: 'active' as const,
    description: 'Facturación electrónica conforme al SAT',
    detail: 'Generamos CFDI 4.0 vía PAC autorizado. El cliente escanea un QR en su ticket, ingresa sus datos fiscales (RFC, régimen, CP, uso CFDI) y la factura se emite automáticamente. XML y PDF disponibles.',
  },
  {
    name: 'LFPDPPP',
    status: 'compliant' as const,
    description: 'Ley Federal de Protección de Datos Personales',
    detail: 'Cumplimos con la LFPDPPP y su Reglamento. Implementamos derechos ARCO completos (Acceso, Rectificación, Cancelación, Oposición). Aviso de privacidad publicado y accesible.',
    link: '/privacidad',
  },
  {
    name: 'SOC 2 Type II',
    status: 'in_progress' as const,
    description: '10 políticas implementadas — auditoría programada',
    detail: 'Hemos implementado las 10 políticas requeridas: Seguridad de la Información, Control de Acceso, Gestión de Incidentes, Continuidad del Negocio, Gestión de Riesgos, Gestión de Cambios, Seguridad Física, Privacidad de Datos, Gestión de Proveedores, Gestión de Activos. Auditoría con Vanta en proceso.',
  },
  {
    name: 'AES-256 + TLS 1.3',
    status: 'active' as const,
    description: 'Encriptación de grado bancario en tránsito y reposo',
    detail: 'Todos los datos se transmiten con TLS 1.3 (HTTPS forzado). Los datos en reposo están encriptados con AES-256 en Supabase PostgreSQL. Credenciales y tokens nunca se exponen en logs ni respuestas de API.',
  },
  {
    name: 'RLS (Row Level Security)',
    status: 'active' as const,
    description: 'Aislamiento total de datos entre clientes',
    detail: 'Cada cliente accede únicamente a sus propios datos. Row Level Security habilitado en las 55+ tablas de Supabase. Imposible acceder a datos de otro cliente, ni siquiera con acceso directo a la API.',
  },
]

const infrastructure = [
  { provider: 'Supabase', cert: 'SOC 2 Type II', role: 'Base de datos PostgreSQL + Auth + Storage' },
  { provider: 'Vercel', cert: 'SOC 2 Type II', role: 'Hosting + CDN global + Edge Functions' },
  { provider: 'Cloudflare', cert: 'SOC 2 Type II', role: 'DNS + WAF + DDoS protection + DNSSEC' },
  { provider: 'GitHub', cert: 'SOC 2 Type II', role: 'Código fuente + CI/CD + GitHub Actions' },
  { provider: 'Anthropic', cert: 'SOC 2 Type II', role: 'IA con zero-retention policy' },
  { provider: 'Groq', cert: 'SOC 2', role: 'Agentes autónomos + briefings' },
]

const controls = [
  { name: 'Encriptación en tránsito', status: true, detail: 'TLS 1.3 forzado en todas las conexiones' },
  { name: 'Encriptación en reposo', status: true, detail: 'AES-256 en Supabase PostgreSQL' },
  { name: 'Autenticación multi-capa', status: true, detail: 'JWT + PIN por empleado + PIN gerente para acciones críticas' },
  { name: 'Row Level Security', status: true, detail: '55+ tablas con aislamiento por cliente' },
  { name: 'Audit trail inmutable', status: true, detail: 'Cada acción POS registrada con timestamp + actor + detalles' },
  { name: 'Anti-fraude automático', status: true, detail: 'Agente IA detecta cancelaciones y descuentos sospechosos' },
  { name: 'Backups automáticos', status: true, detail: 'Diarios con retención 30 días + point-in-time recovery' },
  { name: 'WAF (Web Application Firewall)', status: true, detail: 'Cloudflare protege contra OWASP Top 10' },
  { name: 'Rate limiting', status: true, detail: 'Protección contra abuso en APIs públicas' },
  { name: 'CSP Headers', status: true, detail: 'Content Security Policy previene XSS e inyección' },
  { name: 'Zero data retention (IA)', status: true, detail: 'Anthropic/Groq no almacenan prompts ni respuestas' },
  { name: 'HTTPS Only', status: true, detail: 'Redirección automática HTTP → HTTPS' },
  { name: '5 roles de acceso', status: true, detail: 'Dueño, gerente, capitán, cajero, mesero — cada uno con permisos específicos' },
  { name: 'Aviso de privacidad LFPDPPP', status: true, detail: 'Publicado con derechos ARCO completos' },
  { name: 'Exportación de datos', status: true, detail: 'El cliente puede exportar toda su información en CSV en cualquier momento' },
  { name: 'MFA en infraestructura', status: true, detail: 'Activo en GitHub, Supabase, Vercel y Cloudflare' },
  { name: 'Rate limiting en APIs', status: true, detail: '100 requests/min por IP en rutas /api/' },
  { name: 'Input sanitization', status: true, detail: 'XSS prevention, SQL injection protection, validación de RFC/email/CP' },
  { name: 'Permissions-Policy', status: true, detail: 'Cámara, geolocation, USB, payment — restringidos por política' },
  { name: 'HSTS Preload', status: true, detail: 'Strict-Transport-Security con max-age 2 años + includeSubDomains + preload' },
  { name: 'X-Frame-Options DENY', status: true, detail: 'Previene clickjacking — el sitio no puede ser embebido en iframes' },
  { name: 'Agent Audit Trail', status: true, detail: '23 agentes registran START, SELECT, INSERT, END en log inmutable (agent_audit_log)' },
  { name: 'AI Action Controls', status: true, detail: 'Bot constreñido a 23 tablas whitelisted. SQL injection patterns bloqueados automáticamente.' },
  { name: 'Safe Execution Architecture', status: true, detail: 'Input sanitizado (2,000 chars max), ejecución aislada por agente en GitHub Actions.' },
  { name: 'Least Privilege DB Roles', status: true, detail: 'Roles fullsite_readonly (solo SELECT) y fullsite_agent (SELECT + log) creados en PostgreSQL.' },
  { name: 'Table Whitelist (Bot)', status: true, detail: 'El bot de queries solo puede leer 23 tablas específicas. Acceso a tablas fuera de lista es bloqueado y registrado.' },
  { name: 'Injection Protection', status: true, detail: 'Queries via Supabase REST parametrizado (no SQL directo). Patrones DROP/DELETE/TRUNCATE filtrados en input.' },
]

const statusConfig = {
  active: { label: 'Activo', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle2 },
  compliant: { label: 'Compliant', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle2 },
  in_progress: { label: 'En proceso', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: Clock },
}

export default function SeguridadPage() {
  const activeControls = controls.filter(c => c.status).length
  const totalControls = controls.length

  return (
    <div className="min-h-screen bg-white">
      {/* Header — Trust Center style */}
      <div className="bg-gray-950">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <a href="/login" className="inline-block mb-8">
            <span className="text-white font-black text-2xl tracking-tight">
              fullsite
              <span className="inline-block w-2.5 h-2.5 bg-emerald-400 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </a>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Trust Center</h1>
              <p className="text-white/40 text-sm">Seguridad y cumplimiento</p>
            </div>
          </div>
          <p className="text-white/60 text-base max-w-2xl leading-relaxed">
            Protegemos los datos de nuestros clientes con encriptación de grado bancario,
            aislamiento total entre cuentas, y monitoreo continuo por agentes de IA.
          </p>

          {/* Quick stats */}
          <div className="flex gap-8 mt-8">
            <div>
              <p className="text-2xl font-bold text-white">{activeControls}/{totalControls}</p>
              <p className="text-xs text-white/40">Controles activos</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">6</p>
              <p className="text-xs text-white/40">Certificaciones</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">6</p>
              <p className="text-xs text-white/40">Proveedores SOC 2</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Certifications */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Certificaciones y cumplimiento</h2>
        <div className="grid gap-4 md:grid-cols-2 mb-12">
          {certifications.map(cert => {
            const s = statusConfig[cert.status]
            const Icon = s.icon
            return (
              <div key={cert.name} className={`rounded-xl border ${s.border} p-5`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-900">{cert.name}</h3>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${s.bg} ${s.color}`}>
                    <Icon size={12} />
                    {s.label}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mb-2">{cert.description}</p>
                <p className="text-xs text-gray-400 leading-relaxed">{cert.detail}</p>
                {cert.link && (
                  <a href={cert.link} className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline mt-2 font-medium">
                    Ver documento <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )
          })}
        </div>

        {/* Infrastructure */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Infraestructura certificada</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-12">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Proveedor</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Certificación</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rol</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {infrastructure.map(inf => (
                <tr key={inf.provider} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-sm font-medium text-gray-900">{inf.provider}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600">
                      <CheckCircle2 size={10} /> {inf.cert}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">{inf.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Controls checklist */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Controles de seguridad ({activeControls}/{totalControls})</h2>
        <div className="grid gap-2 md:grid-cols-2 mb-12">
          {controls.map(ctrl => (
            <div key={ctrl.name} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${ctrl.status ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
              {ctrl.status ? (
                <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              ) : (
                <Clock size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-900">{ctrl.name}</p>
                <p className="text-xs text-gray-400">{ctrl.detail}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Responsible disclosure */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 mb-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Divulgación responsable</h2>
          <p className="text-sm text-gray-500 leading-relaxed max-w-2xl">
            Si descubres una vulnerabilidad de seguridad en nuestra plataforma, te pedimos que nos la
            reportes de manera responsable a{' '}
            <a href="mailto:seguridad@fullsite.mx" className="text-emerald-600 hover:underline font-medium">
              seguridad@fullsite.mx
            </a>
            . Nos comprometemos a investigar y responder dentro de 48 horas hábiles. No tomaremos
            acciones legales contra investigadores de seguridad que actúen de buena fe.
          </p>
        </div>

        {/* Footer */}
        <div className="pt-8 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            Última actualización: 27 de mayo de 2026
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Preguntas sobre seguridad?{' '}
            <a href="mailto:seguridad@fullsite.mx" className="text-emerald-600 hover:underline">
              seguridad@fullsite.mx
            </a>
          </p>
          <div className="mt-4 flex justify-center gap-4 text-xs text-gray-400">
            <a href="/privacidad" className="hover:text-emerald-600 transition-colors">Privacidad</a>
            <span>|</span>
            <a href="/terminos" className="hover:text-emerald-600 transition-colors">Términos</a>
            <span>|</span>
            <a href="/login" className="hover:text-emerald-600 transition-colors">Iniciar sesión</a>
          </div>
        </div>
      </div>
    </div>
  )
}
