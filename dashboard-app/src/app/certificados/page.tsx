'use client'

import { useState } from 'react'
import { FileText, Download, Shield, CreditCard, Lock, CheckCircle2 } from 'lucide-react'

const TODAY = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
const YEAR = new Date().getFullYear()

interface CertDoc {
  id: string
  title: string
  subtitle: string
  icon: typeof Shield
  color: string
  status: 'active' | 'compliant'
}

const CERTS: CertDoc[] = [
  { id: 'pci', title: 'PCI-DSS SAQ-A', subtitle: 'Certificado de Cumplimiento', icon: CreditCard, color: 'text-violet-500', status: 'compliant' },
  { id: 'lfpdppp', title: 'LFPDPPP', subtitle: 'Constancia de Cumplimiento', icon: Shield, color: 'text-emerald-500', status: 'compliant' },
  { id: 'security', title: 'Seguridad de la Información', subtitle: 'Carta para clientes', icon: Lock, color: 'text-blue-500', status: 'active' },
]

function CertPCI() {
  return (
    <div className="cert-doc">
      <div className="cert-header">
        <div className="cert-logo">fullsite<span className="cert-dot"></span></div>
        <h1>Certificado de Cumplimiento</h1>
        <h2>PCI-DSS SAQ-A — Cuestionario de Auto-Evaluación</h2>
        <p className="cert-date">Fecha de emisión: {TODAY}</p>
      </div>
      <div className="cert-body">
        <p><strong>Fullsite Technologies</strong>, con domicilio en Monterrey, Nuevo León, México, certifica mediante el presente documento que cumple con los requisitos del estándar PCI-DSS (Payment Card Industry Data Security Standard) bajo la modalidad SAQ-A (Self-Assessment Questionnaire A) para comerciantes que no almacenan, procesan ni transmiten datos de tarjetahabiente.</p>

        <h3>Alcance</h3>
        <p>Fullsite es una plataforma SaaS de punto de venta (POS) con inteligencia artificial para restaurantes. Todos los pagos con tarjeta se procesan exclusivamente a través de proveedores de pago certificados PCI-DSS Level 1:</p>
        <ul>
          <li><strong>Stripe</strong> — PCI-DSS Level 1 Service Provider</li>
          <li><strong>Clip</strong> — PCI-DSS Level 1 certified</li>
          <li><strong>MercadoPago</strong> — PCI-DSS Level 1 certified</li>
        </ul>

        <h3>Declaración de Cumplimiento</h3>
        <p>Confirmamos que:</p>
        <ol>
          <li>Fullsite <strong>nunca almacena</strong> números de tarjeta, CVV, fechas de expiración ni datos de banda magnética en ningún sistema, base de datos, log o respaldo.</li>
          <li>Fullsite <strong>nunca procesa</strong> datos de tarjeta directamente. Toda transacción se realiza a través de terminales tokenizadas (Clip, MercadoPago) o redirección segura (Stripe).</li>
          <li>Fullsite <strong>nunca transmite</strong> datos de tarjeta. Los datos del tarjetahabiente son capturados exclusivamente por los dispositivos y SDKs de los proveedores certificados.</li>
          <li>Toda la comunicación entre Fullsite y los proveedores de pago se realiza mediante <strong>TLS 1.3</strong>.</li>
          <li>Mantenemos un <strong>audit trail completo</strong> de todas las transacciones, sin incluir datos sensibles del tarjetahabiente.</li>
        </ol>

        <h3>Infraestructura de Seguridad</h3>
        <ul>
          <li>Encriptación en reposo: AES-256 (Supabase)</li>
          <li>Encriptación en tránsito: TLS 1.3</li>
          <li>Row Level Security en 55+ tablas</li>
          <li>WAF (Cloudflare) contra OWASP Top 10</li>
          <li>Backups automáticos diarios con retención de 30 días</li>
        </ul>

        <div className="cert-signature">
          <p><strong>Daniel Ramonfaur</strong></p>
          <p>Fundador y CEO</p>
          <p>Fullsite Technologies</p>
          <p>Monterrey, N.L., México</p>
          <p>{TODAY}</p>
        </div>

        <div className="cert-footer-note">
          <p>Este documento constituye una auto-evaluación conforme al estándar PCI-DSS SAQ-A v4.0. Para verificar la información contenida, contactar a seguridad@fullsite.mx.</p>
          <p>Documento ID: PCI-SAQ-A-{YEAR}-001</p>
        </div>
      </div>
    </div>
  )
}

function CertLFPDPPP() {
  return (
    <div className="cert-doc">
      <div className="cert-header">
        <div className="cert-logo">fullsite<span className="cert-dot"></span></div>
        <h1>Constancia de Cumplimiento</h1>
        <h2>Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP)</h2>
        <p className="cert-date">Fecha de emisión: {TODAY}</p>
      </div>
      <div className="cert-body">
        <p><strong>Fullsite Technologies</strong> certifica que cumple con las disposiciones de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), publicada en el Diario Oficial de la Federación el 5 de julio de 2010, y su Reglamento.</p>

        <h3>Datos Personales que Recopilamos</h3>
        <ul>
          <li>Datos de identificación: nombre, correo electrónico, teléfono</li>
          <li>Datos de operación: ventas, inventario, transacciones del restaurante</li>
          <li>Datos fiscales: RFC, razón social (únicamente para facturación CFDI)</li>
        </ul>

        <h3>Medidas de Protección Implementadas</h3>
        <ol>
          <li><strong>Aviso de Privacidad:</strong> Publicado y accesible en app.fullsite.mx/privacidad conforme al artículo 15 de la LFPDPPP.</li>
          <li><strong>Derechos ARCO:</strong> Los titulares pueden ejercer sus derechos de Acceso, Rectificación, Cancelación y Oposición mediante solicitud a privacidad@fullsite.mx.</li>
          <li><strong>Consentimiento:</strong> Se obtiene consentimiento expreso al registrarse en la plataforma.</li>
          <li><strong>Encriptación:</strong> AES-256 en reposo y TLS 1.3 en tránsito para todos los datos personales.</li>
          <li><strong>Aislamiento:</strong> Row Level Security garantiza que los datos de cada cliente son inaccesibles para otros.</li>
          <li><strong>Retención:</strong> Los datos se conservan durante la vigencia del servicio. Al cancelar, se exportan y eliminan en 60 días.</li>
          <li><strong>Transferencias:</strong> No compartimos datos personales con terceros, salvo los proveedores de infraestructura necesarios (Supabase, Vercel), todos con SOC 2 Type II.</li>
          <li><strong>Datos sensibles:</strong> No recopilamos datos sensibles (salud, origen étnico, orientación sexual, creencias religiosas).</li>
        </ol>

        <h3>Responsable</h3>
        <p>El responsable del tratamiento de datos personales es Fullsite Technologies, con domicilio en Monterrey, Nuevo León, México. Para cualquier solicitud relacionada con datos personales: privacidad@fullsite.mx.</p>

        <div className="cert-signature">
          <p><strong>Daniel Ramonfaur</strong></p>
          <p>Responsable de Protección de Datos</p>
          <p>Fullsite Technologies</p>
          <p>{TODAY}</p>
        </div>

        <div className="cert-footer-note">
          <p>Documento ID: LFPDPPP-{YEAR}-001</p>
        </div>
      </div>
    </div>
  )
}

function CertSecurity() {
  return (
    <div className="cert-doc">
      <div className="cert-header">
        <div className="cert-logo">fullsite<span className="cert-dot"></span></div>
        <h1>Carta de Seguridad de la Información</h1>
        <h2>Para clientes y prospectos</h2>
        <p className="cert-date">{TODAY}</p>
      </div>
      <div className="cert-body">
        <p>Estimado cliente,</p>
        <p>En Fullsite, la seguridad de sus datos operativos y financieros es nuestra máxima prioridad. El presente documento describe las medidas de seguridad implementadas en nuestra plataforma de punto de venta con inteligencia artificial.</p>

        <h3>Encriptación</h3>
        <ul>
          <li>En tránsito: TLS 1.3 en todas las conexiones (HTTPS forzado)</li>
          <li>En reposo: AES-256 en nuestra base de datos PostgreSQL (Supabase)</li>
          <li>Tokens y credenciales encriptados, nunca expuestos en logs</li>
        </ul>

        <h3>Control de Acceso</h3>
        <ul>
          <li>5 roles con permisos específicos: dueño, gerente, capitán, cajero, mesero</li>
          <li>PIN individual por empleado para acciones en POS</li>
          <li>PIN de gerente requerido para cancelaciones, descuentos y cortes</li>
          <li>Row Level Security: datos aislados entre clientes a nivel de base de datos</li>
        </ul>

        <h3>Monitoreo y Detección</h3>
        <ul>
          <li>30 agentes de IA monitorean la operación 24/7</li>
          <li>Anti-fraude automático: detecta cancelaciones y descuentos sospechosos</li>
          <li>Auto-86: alerta cuando ingredientes llegan a nivel crítico</li>
          <li>Audit trail inmutable de cada acción en el POS</li>
        </ul>

        <h3>Cumplimiento</h3>
        <ul>
          <li>PCI-DSS SAQ-A: nunca almacenamos datos de tarjeta</li>
          <li>CFDI 4.0: facturación electrónica conforme al SAT</li>
          <li>LFPDPPP: protección de datos personales con derechos ARCO</li>
          <li>SOC 2: 10 políticas implementadas, auditoría en proceso</li>
        </ul>

        <h3>Infraestructura</h3>
        <p>Todos nuestros proveedores de infraestructura cuentan con certificación SOC 2 Type II:</p>
        <ul>
          <li>Supabase (base de datos)</li>
          <li>Vercel (hosting + CDN)</li>
          <li>Cloudflare (DNS + WAF + DDoS)</li>
          <li>GitHub (código fuente + CI/CD)</li>
          <li>Anthropic (IA)</li>
        </ul>

        <p>Para cualquier pregunta sobre seguridad, no dude en contactarnos.</p>

        <div className="cert-signature">
          <p><strong>Daniel Ramonfaur</strong></p>
          <p>Fundador y CEO</p>
          <p>Fullsite Technologies</p>
          <p>seguridad@fullsite.mx</p>
          <p>{TODAY}</p>
        </div>

        <div className="cert-footer-note">
          <p>Documento ID: SEC-LETTER-{YEAR}-001</p>
          <p>Trust Center: app.fullsite.mx/seguridad</p>
        </div>
      </div>
    </div>
  )
}

export default function CertificadosPage() {
  const [viewing, setViewing] = useState<string | null>(null)

  const handlePrint = () => window.print()

  if (viewing) {
    return (
      <>
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .cert-doc, .cert-doc * { visibility: visible; }
            .cert-doc { position: absolute; left: 0; top: 0; width: 100%; }
            .no-print { display: none !important; }
          }
          .cert-doc { max-width: 800px; margin: 0 auto; padding: 40px; font-family: 'Georgia', serif; color: #111; }
          .cert-header { text-align: center; border-bottom: 2px solid #10b981; padding-bottom: 24px; margin-bottom: 32px; }
          .cert-logo { font-family: system-ui; font-size: 28px; font-weight: 900; color: #111; letter-spacing: -0.03em; margin-bottom: 16px; }
          .cert-dot { display: inline-block; width: 8px; height: 8px; background: #10b981; margin-left: 2px; margin-bottom: 2px; }
          .cert-header h1 { font-size: 22px; font-weight: 700; margin: 8px 0 4px; }
          .cert-header h2 { font-size: 14px; font-weight: 400; color: #666; }
          .cert-date { font-size: 12px; color: #999; margin-top: 8px; }
          .cert-body { font-size: 13px; line-height: 1.8; }
          .cert-body h3 { font-size: 15px; font-weight: 700; margin: 24px 0 8px; color: #111; border-left: 3px solid #10b981; padding-left: 12px; }
          .cert-body ul, .cert-body ol { margin: 8px 0 16px 20px; }
          .cert-body li { margin-bottom: 4px; }
          .cert-signature { margin-top: 40px; padding-top: 24px; border-top: 1px solid #ddd; }
          .cert-signature p { margin: 2px 0; font-size: 13px; }
          .cert-footer-note { margin-top: 32px; padding: 12px; background: #f9fafb; border-radius: 8px; font-size: 11px; color: #999; }
        `}</style>
        <div className="no-print" style={{ padding: '16px', display: 'flex', gap: '12px', justifyContent: 'center', background: '#f3f4f6' }}>
          <button onClick={() => setViewing(null)} style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid #ddd', background: 'white', cursor: 'pointer', fontSize: '13px' }}>← Volver</button>
          <button onClick={handlePrint} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: '#10b981', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Descargar PDF ↓</button>
        </div>
        {viewing === 'pci' && <CertPCI />}
        {viewing === 'lfpdppp' && <CertLFPDPPP />}
        {viewing === 'security' && <CertSecurity />}
      </>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-[var(--text-1)]">Certificados y Documentos</h2>
        <p className="text-sm text-[var(--text-3)]">Documentos de cumplimiento descargables en PDF</p>
      </div>

      <div className="grid gap-4">
        {CERTS.map(cert => {
          const Icon = cert.icon
          return (
            <div key={cert.id} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl bg-[var(--surface-2)] flex items-center justify-center`}>
                  <Icon size={22} className={cert.color} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">{cert.title}</h3>
                  <p className="text-xs text-[var(--text-3)]">{cert.subtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 size={10} /> {cert.status === 'active' ? 'Activo' : 'Compliant'}
                </span>
                <button
                  onClick={() => setViewing(cert.id)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] text-xs font-medium transition-colors"
                >
                  <FileText size={12} /> Ver / PDF
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6 p-4 bg-[var(--surface-2)] rounded-lg">
        <p className="text-xs text-[var(--text-3)] leading-relaxed">
          Estos documentos son auto-evaluaciones y constancias internas de cumplimiento. Para generar el PDF, haz clic en "Ver / PDF" y luego "Descargar PDF" (usa Cmd+P → Guardar como PDF). Los documentos incluyen identificador único y fecha de emisión.
        </p>
      </div>
    </div>
  )
}
