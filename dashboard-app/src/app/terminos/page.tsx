export default function TerminosPage() {
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
          <h1 className="text-2xl font-bold text-text mb-2">Terminos de Servicio</h1>
          <p className="text-xs text-text-muted">Ultima actualizacion: 13 de mayo de 2026</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Descripcion del servicio */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">1. Descripcion del servicio</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite es una plataforma de analytics y operaciones para restaurantes. El servicio
            incluye dashboards de ventas, analisis de meseros, reportes automatizados y un
            asistente de inteligencia artificial para consultas operativas.
          </p>
        </section>

        {/* Uso aceptable */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">2. Uso aceptable</h2>
          <p className="text-sm text-text-soft leading-relaxed">El usuario se compromete a:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>Utilizar la plataforma unicamente para fines de gestion de su restaurante</li>
            <li>No compartir sus credenciales de acceso con personas no autorizadas</li>
            <li>No intentar acceder a datos de otros clientes</li>
            <li>No utilizar la plataforma para actividades ilegales o no autorizadas</li>
            <li>No intentar comprometer la seguridad o integridad del sistema</li>
          </ul>
        </section>

        {/* Propiedad intelectual */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">3. Propiedad intelectual</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            La plataforma Fullsite, incluyendo su codigo fuente, diseno, logotipos y contenido, es
            propiedad de Fullsite. El acceso al servicio no otorga ningun derecho de propiedad
            intelectual sobre la plataforma.
          </p>
        </section>

        {/* Limitacion de responsabilidad */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">
            4. Limitacion de responsabilidad
          </h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite proporciona el servicio &quot;tal cual&quot; y no garantiza que el servicio sea
            ininterrumpido o libre de errores. Fullsite no sera responsable por danos indirectos,
            incidentales o consecuentes derivados del uso o la imposibilidad de uso del servicio.
          </p>
          <p className="text-sm text-text-soft leading-relaxed mt-2">
            Los datos mostrados en la plataforma provienen del sistema de punto de venta del
            cliente. Fullsite no es responsable por la exactitud de los datos de origen.
          </p>
        </section>

        {/* Datos del cliente */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">5. Datos del cliente</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            El cliente es propietario de todos sus datos. Fullsite actua unicamente como procesador
            de datos en nombre del cliente. El cliente puede solicitar la exportacion de sus datos
            en cualquier momento.
          </p>
        </section>

        {/* Cancelacion */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">6. Cancelacion</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            El cliente puede cancelar su suscripcion en cualquier momento sin penalizacion. Una vez
            cancelado el servicio, los datos del cliente seran eliminados permanentemente dentro de
            los 30 dias siguientes a la cancelacion. El cliente puede solicitar una exportacion de
            sus datos antes de la eliminacion.
          </p>
        </section>

        {/* Modificaciones */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">7. Modificaciones</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite se reserva el derecho de modificar estos terminos en cualquier momento. Los
            cambios seran notificados por correo electronico con al menos 15 dias de anticipacion.
            El uso continuado del servicio despues de los cambios constituye la aceptacion de los
            nuevos terminos.
          </p>
        </section>

        {/* Ley aplicable */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">8. Ley aplicable</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Estos terminos se regiran e interpretaran de acuerdo con las leyes de los Estados Unidos
            Mexicanos. Cualquier controversia sera sometida a los tribunales competentes de
            Monterrey, Nuevo Leon, Mexico.
          </p>
        </section>

        {/* Contacto */}
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">9. Contacto</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Para cualquier duda sobre estos terminos, contacte a:{' '}
            <a href="mailto:legal@fullsite.mx" className="text-accent hover:underline">
              legal@fullsite.mx
            </a>
          </p>
        </section>

        {/* Footer */}
        <div className="text-center pt-4">
          <div className="flex justify-center gap-4 text-xs text-text-muted">
            <a href="/privacidad" className="hover:text-accent transition-colors">
              Privacidad
            </a>
            <span>|</span>
            <a href="/seguridad" className="hover:text-accent transition-colors">
              Seguridad
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
