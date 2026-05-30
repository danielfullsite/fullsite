export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-[var(--surface)] border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <a href="/login" className="inline-block mb-6">
            <span className="text-[#1a1a1a] font-black text-2xl tracking-tight">
              fullsite
              <span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </a>
          <h1 className="text-2xl font-bold text-text mb-2">Aviso de Privacidad Integral</h1>
          <p className="text-text-soft text-sm">
            En cumplimiento con la Ley Federal de Proteccion de Datos Personales en Posesion de los
            Particulares (LFPDPPP) y su Reglamento.
          </p>
          <p className="text-xs text-text-muted mt-2">Ultima actualizacion: 24 de mayo de 2026</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">1. Identidad y domicilio del responsable</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite (&quot;el Responsable&quot;), con domicilio en
            Monterrey, Nuevo Leon, Mexico, es responsable de recabar, almacenar, usar y proteger sus
            datos personales conforme a la LFPDPPP, su Reglamento y los Lineamientos del Aviso de
            Privacidad publicados en el Diario Oficial de la Federacion.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">2. Datos personales que recabamos</h2>
          <p className="text-sm text-text-soft leading-relaxed mb-2">
            Para las finalidades senaladas en este aviso, recabamos las siguientes categorias de datos:
          </p>
          <p className="text-sm font-medium text-text mt-3 mb-1">Datos de identificacion y contacto:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>Nombre completo del titular o representante legal</li>
            <li>Correo electronico</li>
            <li>Numero de teléfono (opcional)</li>
            <li>Nombre del establecimiento comercial</li>
          </ul>
          <p className="text-sm font-medium text-text mt-3 mb-1">Datos operativos del negocio:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>Datos de punto de venta: transacciones, tickets, montos, métodos de pago</li>
            <li>Datos de personal operativo: nombres de meseros, ventas por empleado, horarios</li>
            <li>Datos de inventario: productos, ingredientes, costos, recetas</li>
            <li>Datos de clientes del restaurante: reservaciones (nombre, teléfono, fecha)</li>
            <li>Metricas operativas generadas por la plataforma</li>
          </ul>
          <p className="text-sm font-medium text-text mt-3 mb-1">Datos de uso de la plataforma:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>Dirección IP, tipo de navegador, páginas visitadas</li>
            <li>Consultas realizadas al asistente de inteligencia artificial</li>
            <li>Registros de acceso y auditoría (logs)</li>
          </ul>
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Datos sensibles:</strong> No recabamos datos sensibles conforme al artículo 3, fraccion VI de la LFPDPPP
              (datos de salud, origen étnico, creencias religiosas, orientación sexual, etc.).
            </p>
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">3. Finalidades del tratamiento</h2>
          <p className="text-sm font-medium text-text mt-1 mb-1">Finalidades primarias (necesarias):</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>Proveer acceso y funcionalidad del punto de venta (POS)</li>
            <li>Generar reportes de ventas, inventario y desempeno operativo</li>
            <li>Procesar consultas mediante inteligencia artificial para insights operativos</li>
            <li>Enviar alertas automatizadas sobre anomalias en la operación</li>
            <li>Gestionar cuentas de usuario y autenticacion</li>
            <li>Cumplir obligaciones contractuales del servicio</li>
          </ul>
          <p className="text-sm font-medium text-text mt-3 mb-1">Finalidades secundarias (no necesarias):</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>Enviar comunicaciones sobre nuevas funcionalidades del servicio</li>
            <li>Generar estadisticas agregadas y anonimizadas para mejorar el producto</li>
            <li>Realizar encuestas de satisfaccion</li>
          </ul>
          <p className="text-sm text-text-soft leading-relaxed mt-2">
            Si no desea que sus datos se utilicen para finalidades secundarias, puede manifestarlo
            enviando un correo a{' '}
            <a href="mailto:privacidad@fullsite.mx" className="text-accent hover:underline">privacidad@fullsite.mx</a>.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">4. Transferencias de datos</h2>
          <p className="text-sm text-text-soft leading-relaxed mb-2">
            Sus datos personales podran ser transferidos a los siguientes terceros para las finalidades
            indicadas, conforme al artículo 37 de la LFPDPPP:
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-semibold text-text">Tercero</th>
                  <th className="text-left py-2 pr-4 font-semibold text-text">Pais</th>
                  <th className="text-left py-2 font-semibold text-text">Finalidad</th>
                </tr>
              </thead>
              <tbody className="text-text-soft">
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4">Supabase Inc.</td>
                  <td className="py-2 pr-4">Estados Unidos</td>
                  <td className="py-2">Base de datos y autenticacion (SOC 2 Type II)</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4">Vercel Inc.</td>
                  <td className="py-2 pr-4">Estados Unidos</td>
                  <td className="py-2">Hosting de la aplicacion (SOC 2)</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4">Anthropic PBC</td>
                  <td className="py-2 pr-4">Estados Unidos</td>
                  <td className="py-2">Procesamiento de consultas de IA (SOC 2)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Cloudflare Inc.</td>
                  <td className="py-2 pr-4">Estados Unidos</td>
                  <td className="py-2">CDN, Workers y proteccion DDoS</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-text-soft leading-relaxed mt-3">
            Todas las transferencias se realizan con proveedores que cuentan con certificaciones de
            seguridad y politicas de privacidad compatibles. Anthropic no utiliza los datos enviados
            a traves de su API para entrenar sus modelos.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">5. Tratamiento de datos por inteligencia artificial</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite utiliza modelos de inteligencia artificial de terceros (Anthropic Claude) para
            generar insights operativos, reportes y respuestas a consultas del usuario. Al respecto:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>Los datos operativos se envian al modelo de IA unicamente durante la sesion de consulta</li>
            <li>Anthropic no almacena los prompts ni las respuestas de forma permanente cuando se utiliza su API comercial</li>
            <li>Las respuestas generadas por IA son sugerencias y no constituyen asesoría profesional (financiera, legal, fiscal o de otro tipo)</li>
            <li>El usuario es responsable de validar y decidir sobre cualquier recomendacion generada por la IA</li>
            <li>Fullsite no garantiza la exactitud, completitud o idoneidad de las respuestas generadas por IA</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">6. Derechos ARCO</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Conforme a los artículos 28 y 29 de la LFPDPPP, usted tiene derecho a:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li><strong>Acceder</strong> a sus datos personales en posesion de Fullsite</li>
            <li><strong>Rectificar</strong> datos inexactos o incompletos</li>
            <li><strong>Cancelar</strong> el tratamiento de sus datos</li>
            <li><strong>Oponerse</strong> al tratamiento para finalidades especificas</li>
          </ul>
          <p className="text-sm text-text-soft leading-relaxed mt-3">
            Para ejercer sus derechos ARCO, envie solicitud a{' '}
            <a href="mailto:privacidad@fullsite.mx" className="text-accent hover:underline">privacidad@fullsite.mx</a> incluyendo:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside mt-2">
            <li>Nombre completo y correo asociado a la cuenta</li>
            <li>Descripcion clara del derecho que desea ejercer</li>
            <li>Copia de identificacion oficial vigente</li>
            <li>Cualquier documento que facilite la localizacion de los datos</li>
          </ul>
          <p className="text-sm text-text-soft leading-relaxed mt-3">
            <strong>Plazos:</strong> Responderemos en un plazo maximo de 20 dias habiles contados desde la
            recepcion de la solicitud. La respuesta indicara si la solicitud es procedente y, en su
            caso, se hara efectiva dentro de los 15 dias habiles siguientes. Estos plazos podran
            ampliarse una sola vez por un periodo igual, conforme al artículo 32 de la LFPDPPP.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">7. Revocación del consentimiento</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Usted puede revocar su consentimiento para el tratamiento de sus datos personales en
            cualquier momento, sin efectos retroactivos, enviando solicitud a{' '}
            <a href="mailto:privacidad@fullsite.mx" className="text-accent hover:underline">privacidad@fullsite.mx</a>.
            Tenga en cuenta que la revocación del consentimiento para finalidades primarias podra
            implicar la imposibilidad de continuar prestando el servicio.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">8. Cookies y tecnologias de rastreo</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite utiliza cookies de sesion y localStorage del navegador para mantener su sesion
            activa y preferencias de uso. No utilizamos cookies de terceros con fines publicitarios.
            No utilizamos pixel de seguimiento ni tecnologias de tracking de terceros.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">9. Medidas de seguridad</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Implementamos medidas de seguridad administrativas, tecnicas y fisicas para proteger sus
            datos contra dano, perdida, alteracion, destruccion o acceso no autorizado. Para detalles
            especificos, consulte nuestra{' '}
            <a href="/seguridad" className="text-accent hover:underline">pagina de seguridad</a>.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">10. Modificaciones al aviso</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Nos reservamos el derecho de modificar este aviso de privacidad. Cualquier cambio sera
            notificado a traves de la plataforma y/o por correo electronico con al menos 15 dias de
            anticipacion. La version vigente estara siempre disponible en esta pagina.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">11. Autoridad competente</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Si considera que su derecho a la proteccion de datos ha sido vulnerado, puede presentar
            una queja ante el Instituto Nacional de Transparencia, Acceso a la Información y
            Proteccion de Datos Personales (INAI):{' '}
            <span className="text-accent">www.inai.org.mx</span>
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">12. Contacto</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Oficial de privacidad:{' '}
            <a href="mailto:privacidad@fullsite.mx" className="text-accent hover:underline">privacidad@fullsite.mx</a>
          </p>
          <p className="text-sm text-text-soft leading-relaxed mt-1">
            Domicilio: Monterrey, Nuevo Leon, Mexico
          </p>
        </section>

        {/* Footer */}
        <div className="text-center pt-4">
          <div className="flex justify-center gap-4 text-xs text-text-muted">
            <a href="/seguridad" className="hover:text-accent transition-colors">Seguridad</a>
            <span>|</span>
            <a href="/terminos" className="hover:text-accent transition-colors">Terminos</a>
          </div>
        </div>
      </div>
    </div>
  )
}
