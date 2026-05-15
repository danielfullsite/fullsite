export default function PrivacidadPage() {
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
          <h1 className="text-2xl font-bold text-text mb-2">Aviso de Privacidad</h1>
          <p className="text-text-soft text-sm">
            En cumplimiento con la Ley Federal de Proteccion de Datos Personales en Posesion de los
            Particulares (LFPDPPP).
          </p>
          <p className="text-xs text-text-muted mt-2">Ultima actualizacion: 13 de mayo de 2026</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Responsable */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">1. Responsable</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite (Daniel Ramonfaur), con domicilio en Monterrey, Nuevo Leon, Mexico, es
            responsable del tratamiento de sus datos personales.
          </p>
        </section>

        {/* Datos que recolectamos */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">2. Datos que recolectamos</h2>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside">
            <li>Correo electronico y nombre del usuario</li>
            <li>Datos de punto de venta (POS): ventas, meseros, platillos</li>
            <li>Datos operativos del restaurante para generacion de reportes</li>
          </ul>
        </section>

        {/* Finalidad */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">3. Finalidad del tratamiento</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Los datos personales seran utilizados para las siguientes finalidades:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>Proveer analytics y reportes operativos del restaurante</li>
            <li>Gestionar el acceso a la plataforma</li>
            <li>Generar insights mediante inteligencia artificial</li>
            <li>Mejorar el servicio y la experiencia del usuario</li>
          </ul>
        </section>

        {/* Terceros */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">4. Comparticion de datos</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            No compartimos tus datos personales con terceros, excepto con los proveedores de
            infraestructura necesarios para operar el servicio:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>
              <strong>Supabase</strong> — Base de datos y autenticacion (SOC 2 Type II)
            </li>
            <li>
              <strong>Vercel</strong> — Hosting de la aplicacion (SOC 2)
            </li>
            <li>
              <strong>Anthropic</strong> — Procesamiento de consultas de IA (SOC 2)
            </li>
          </ul>
        </section>

        {/* Derechos ARCO */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">5. Derechos ARCO</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Usted tiene derecho a acceder, rectificar, cancelar u oponerse al tratamiento de sus
            datos personales (derechos ARCO). Para ejercer estos derechos, envie un correo a{' '}
            <a href="mailto:privacidad@fullsite.mx" className="text-accent hover:underline">
              privacidad@fullsite.mx
            </a>{' '}
            con la siguiente informacion:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>Nombre completo y correo electronico asociado a la cuenta</li>
            <li>Descripcion clara del derecho que desea ejercer</li>
            <li>Cualquier documento que acredite su identidad</li>
          </ul>
          <p className="text-sm text-text-soft leading-relaxed mt-2">
            Responderemos a su solicitud en un plazo maximo de 20 dias habiles.
          </p>
        </section>

        {/* Seguridad */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">6. Medidas de seguridad</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Implementamos medidas de seguridad administrativas, tecnicas y fisicas para proteger sus
            datos personales contra dano, perdida, alteracion, destruccion o uso, acceso o
            tratamiento no autorizado. Para mas detalles, visite nuestra{' '}
            <a href="/seguridad" className="text-accent hover:underline">
              pagina de seguridad
            </a>
            .
          </p>
        </section>

        {/* Contacto */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">7. Contacto</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Para cualquier duda o solicitud relacionada con este aviso de privacidad, contacte a:{' '}
            <a href="mailto:privacidad@fullsite.mx" className="text-accent hover:underline">
              privacidad@fullsite.mx
            </a>
          </p>
        </section>

        {/* Footer */}
        <div className="text-center pt-4">
          <div className="flex justify-center gap-4 text-xs text-text-muted">
            <a href="/seguridad" className="hover:text-accent transition-colors">
              Seguridad
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
