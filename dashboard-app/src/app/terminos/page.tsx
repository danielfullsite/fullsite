export default function TerminosPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-[var(--surface)] border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <a href="/login" className="inline-block mb-6">
            <span className="text-[#1a1a1a] font-black text-2xl tracking-tight">
              fullsite
              <span className="inline-block w-2 h-2 bg-emerald-500/100 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </a>
          <h1 className="text-2xl font-bold text-text mb-2">Terminos y Condiciones de Servicio</h1>
          <p className="text-xs text-text-muted">Ultima actualizacion: 24 de mayo de 2026</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">1. Definiciones</h2>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside">
            <li><strong>&quot;Fullsite&quot;</strong> o <strong>&quot;el Servicio&quot;</strong>: la plataforma de punto de venta con inteligencia artificial operada por Fullsite</li>
            <li><strong>&quot;Cliente&quot;</strong> o <strong>&quot;Usuario&quot;</strong>: persona fisica o moral que contrata y utiliza el Servicio</li>
            <li><strong>&quot;Datos del Cliente&quot;</strong>: toda la información que el Cliente ingresa, genera o almacena en la plataforma</li>
            <li><strong>&quot;Contenido IA&quot;</strong>: cualquier texto, analisis, recomendacion o insight generado por los modelos de inteligencia artificial del Servicio</li>
            <li><strong>&quot;Plataforma&quot;</strong>: la aplicacion web accesible en app.fullsite.mx y sus subdominios</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">2. Descripcion del servicio</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite es una plataforma de punto de venta (POS) con inteligencia artificial para
            restaurantes. El Servicio incluye, segun el plan contratado:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside mt-2">
            <li>Punto de venta digital accesible desde cualquier navegador</li>
            <li>Pantallas de cocina y barra en tiempo real</li>
            <li>Dashboard de analytics y reportes operativos</li>
            <li>Asistente de IA para consultas operativas via WhatsApp y dashboard</li>
            <li>Gestion de inventario con deduccion automatica por receta</li>
            <li>Alertas proactivas y reportes automatizados</li>
            <li>Sistema de agentes de IA (Coach, anomalias, predicciónes)</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">3. Aceptacion de los terminos</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Al crear una cuenta, acceder o utilizar el Servicio, el Cliente acepta estos Terminos en su
            totalidad. Si el Cliente no esta de acuerdo, debe abstenerse de utilizar el Servicio.
            El uso continuado despues de modificaciones constituye aceptacion de los terminos actualizados.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">4. Cuenta y acceso</h2>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside">
            <li>Las cuentas se crean unicamente por invitacion o solicitud directa al equipo de Fullsite</li>
            <li>El Cliente es responsable de mantener la confidencialidad de sus credenciales</li>
            <li>El Cliente debe notificar inmediatamente cualquier uso no autorizado de su cuenta</li>
            <li>Fullsite se reserva el derecho de suspender cuentas que violen estos terminos</li>
            <li>El acceso al POS requiere autenticacion por PIN individual del personal autorizado</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">5. Uso aceptable</h2>
          <p className="text-sm text-text-soft leading-relaxed">El Cliente se compromete a:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside mt-2">
            <li>Utilizar la plataforma unicamente para la gestion de su establecimiento</li>
            <li>No compartir credenciales con personas no autorizadas</li>
            <li>No intentar acceder a datos de otros clientes</li>
            <li>No realizar ingenieria inversa, descompilar o modificar el software</li>
            <li>No utilizar la plataforma para actividades ilegales</li>
            <li>No sobrecargar intencionalmente los servidores o la infraestructura</li>
            <li>Cumplir con la LFPDPPP respecto a los datos personales de sus propios empleados y clientes que ingrese en la plataforma</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">6. Propiedad de los datos</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            <strong>El Cliente es y sera en todo momento el único propietario de sus Datos del Cliente.</strong>{' '}
            Fullsite actua como encargado del tratamiento (procesador) conforme al artículo 50 de la LFPDPPP.
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>El Cliente puede solicitar la exportacion completa de sus datos en formato CSV en cualquier momento</li>
            <li>Fullsite no adquiere ningun derecho de propiedad sobre los Datos del Cliente</li>
            <li>Fullsite no utilizara los Datos del Cliente para fines distintos a la prestacion del Servicio</li>
            <li>Los datos agregados y anonimizados podran utilizarse para mejorar el producto, sin identificar al Cliente</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">7. Propiedad intelectual</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            La plataforma Fullsite, incluyendo su codigo fuente, diseno, algoritmos, modelos de datos,
            logotipos, marcas y todo el contenido generado por el sistema (excluyendo los Datos del
            Cliente), es propiedad exclusiva de Fullsite. El acceso al Servicio otorga una licencia
            de uso limitada, no exclusiva, no transferible y revocable.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">8. Disclaimer de inteligencia artificial</h2>
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg mb-3">
            <p className="text-xs text-amber-800 leading-relaxed font-medium">
              CLAUSULA IMPORTANTE — LEER CUIDADOSAMENTE
            </p>
          </div>
          <p className="text-sm text-text-soft leading-relaxed">
            El Servicio utiliza modelos de inteligencia artificial para generar analisis, predicciónes,
            recomendaciones e insights operativos (&quot;Contenido IA&quot;). Al respecto, el Cliente reconoce y acepta que:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>El Contenido IA se proporciona &quot;tal cual&quot; y tiene caracter <strong>informativo y sugerente, no vinculante</strong></li>
            <li>El Contenido IA <strong>no constituye asesoría profesional</strong> de ningun tipo (financiera, contable, fiscal, legal, laboral, de salud ni de seguridad alimentaria)</li>
            <li>Los modelos de IA pueden generar información inexacta, incompleta o desactualizada (&quot;alucinaciones&quot;)</li>
            <li>El Cliente es el <strong>único responsable</strong> de evaluar, validar y decidir sobre cualquier accion derivada del Contenido IA</li>
            <li>Fullsite <strong>no garantiza</strong> resultados comerciales, ahorros, incrementos de ventas ni ningun resultado economico especifico derivado del uso del Contenido IA</li>
            <li>Las predicciónes y proyecciónes son estimaciones basadas en datos históricos y no garantizan resultados futuros</li>
            <li>El Cliente debe consultar a profesionales calificados para decisiones financieras, legales, fiscales o de cualquier otra naturaleza especializada</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">9. Limitacion de responsabilidad</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY APLICABLE:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside mt-2">
            <li>Fullsite proporciona el Servicio &quot;tal cual&quot; (&quot;as is&quot;) y &quot;segun disponibilidad&quot; (&quot;as available&quot;)</li>
            <li>Fullsite <strong>no sera responsable</strong> por daños indirectos, incidentales, especiales, consecuentes o punitivos, incluyendo pero no limitado a: pérdida de ganancias, pérdida de datos, interrupcion del negocio o pérdida de oportunidades comerciales</li>
            <li>La responsabilidad total acumulada de Fullsite no excedera el monto pagado por el Cliente en los <strong>últimos 3 meses</strong> de servicio</li>
            <li>Fullsite no es responsable por la exactitud de los datos provenientes de sistemas de terceros (POS anteriores, proveedores, APIs externas)</li>
            <li>Fullsite no es responsable por decisiones tomadas por el Cliente basadas en el Contenido IA</li>
            <li>Fullsite no es responsable por interrupciones causadas por fallas en la conectividad a internet del Cliente, cortes de energia o fallas en dispositivos del Cliente</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">10. Disponibilidad del servicio (SLA)</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite se esfuerza por mantener una disponibilidad del 99.5% mensual, excluyendo:
          </p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside mt-2">
            <li>Mantenimiento programado (notificado con 24 horas de anticipacion)</li>
            <li>Fallas de proveedores de infraestructura (Vercel, Supabase, Cloudflare)</li>
            <li>Eventos de fuerza mayor</li>
            <li>Ataques de denegacion de servicio u otros ataques ciberneticos</li>
          </ul>
          <p className="text-sm text-text-soft leading-relaxed mt-2">
            Fullsite no garantiza que el Servicio sera ininterrumpido o libre de errores. En caso de
            interrupcion prolongada (&gt;24 horas continuas), el Cliente podra solicitar credito
            proporcional al tiempo de inactividad.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">11. Pagos y facturacion</h2>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside">
            <li>Los precios se acuerdan individualmente al momento de la contratacion</li>
            <li>La facturacion es mensual, pagadera dentro de los primeros 5 dias del mes</li>
            <li>Fullsite puede modificar precios con 30 dias de aviso previo</li>
            <li>Los montos no incluyen IVA salvo que se indique expresamente</li>
            <li>El incumplimiento de pago por mas de 15 dias podra resultar en la suspension del servicio</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">12. Cancelacion y terminacion</h2>
          <p className="text-sm font-medium text-text mt-1 mb-1">Por el Cliente:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>El Cliente puede cancelar en cualquier momento con 30 dias de aviso</li>
            <li>No hay penalizacion por cancelacion anticipada ni contratos anuales obligatorios</li>
            <li>El Cliente puede solicitar exportacion de todos sus datos antes de la cancelacion</li>
          </ul>
          <p className="text-sm font-medium text-text mt-3 mb-1">Por Fullsite:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>Fullsite puede suspender el servicio por incumplimiento de pago (&gt;15 dias)</li>
            <li>Fullsite puede terminar el servicio por violacion de estos terminos</li>
            <li>En caso de terminacion, Fullsite notificara con 15 dias de anticipacion</li>
          </ul>
          <p className="text-sm font-medium text-text mt-3 mb-1">Despues de la cancelacion:</p>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1 list-disc list-inside">
            <li>Los datos se mantendran disponibles para exportacion por 30 dias</li>
            <li>Despues de 30 dias, todos los datos seran eliminados permanentemente</li>
            <li>El proceso de eliminacion es irreversible</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">13. Indemnizacion</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            El Cliente acepta indemnizar y mantener indemne a Fullsite, sus directores, empleados y
            agentes, de cualquier reclamo, dano, perdida o gasto (incluyendo honorarios legales)
            derivado de: (a) el uso del Servicio por parte del Cliente; (b) la violacion de estos
            Terminos; (c) la violacion de derechos de terceros; o (d) los datos que el Cliente
            ingrese en la plataforma.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">14. Fuerza mayor</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Ninguna de las partes sera responsable por incumplimiento causado por eventos fuera de su
            control razonable, incluyendo pero no limitado a: desastres naturales, pandemias, guerras,
            actos terroristas, fallas de telecomunicaciones, acciones gubernamentales o cambios
            legislativos.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">15. Modificaciones a los terminos</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Fullsite se reserva el derecho de modificar estos terminos. Los cambios seran notificados
            por correo electronico y/o a traves de la plataforma con al menos 15 dias de anticipacion.
            Si el Cliente no esta de acuerdo con los cambios, podra cancelar el servicio sin
            penalizacion antes de que entren en vigor.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">16. Ley aplicable, jurisdiccion y resolucion de controversias</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Estos Terminos se rigen por las leyes de los Estados Unidos Mexicanos. Para la
            interpretacion y cumplimiento de estos Terminos, las partes se someten expresamente a la
            jurisdiccion de los tribunales competentes de la ciudad de Monterrey, Nuevo Leon, Mexico,
            renunciando a cualquier otro fuero que pudiera corresponderles por razon de su domicilio
            presente o futuro.
          </p>
          <p className="text-sm text-text-soft leading-relaxed mt-3">
            <strong>Mediacion previa obligatoria:</strong> Antes de iniciar cualquier procedimiento judicial,
            las partes se comprometen a intentar resolver la controversia mediante mediacion privada
            en Monterrey, Nuevo Leon, durante un periodo minimo de 30 dias naturales. Los costos de
            mediacion seran compartidos equitativamente entre las partes.
          </p>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">17. Disposiciones generales</h2>
          <ul className="text-sm text-text-soft leading-relaxed space-y-1.5 list-disc list-inside">
            <li><strong>Acuerdo completo:</strong> Estos Terminos, junto con el Aviso de Privacidad y la pagina de Seguridad, constituyen el acuerdo completo entre las partes</li>
            <li><strong>Divisibilidad:</strong> Si alguna disposicion se declara invalida, las demas permaneceran en vigor</li>
            <li><strong>No renuncia:</strong> La falta de ejercicio de un derecho no constituye renuncia al mismo</li>
            <li><strong>Cesion:</strong> El Cliente no podra ceder estos Terminos sin consentimiento previo de Fullsite</li>
          </ul>
        </section>

        <section className="bg-card rounded-xl border border-border card-shadow p-6">
          <h2 className="text-sm font-semibold text-text mb-3">18. Contacto</h2>
          <p className="text-sm text-text-soft leading-relaxed">
            Para cualquier duda sobre estos terminos:{' '}
            <a href="mailto:legal@fullsite.mx" className="text-accent hover:underline">legal@fullsite.mx</a>
          </p>
        </section>

        {/* Footer */}
        <div className="text-center pt-4">
          <div className="flex justify-center gap-4 text-xs text-text-muted">
            <a href="/privacidad" className="hover:text-accent transition-colors">Privacidad</a>
            <span>|</span>
            <a href="/seguridad" className="hover:text-accent transition-colors">Seguridad</a>
          </div>
        </div>
      </div>
    </div>
  )
}
