'use client'

export type TenantOnboardingCredentialsProps = {
  tenantId: string; email: string; initialPassword: string; ownerCredentialCreated: boolean
  staffSetupRequired: boolean; staffPins: Array<{ role: string; pin: string }>
  localServer: { email: string; password: string } | null; existingServiceCredential: boolean
  onDone: () => void; onNotice: (kind: 'success' | 'error', text: string) => void
}
export function TenantOnboardingCredentials(props: TenantOnboardingCredentialsProps) {
  const { tenantId, email, initialPassword, ownerCredentialCreated, staffSetupRequired, staffPins, localServer } = props
  async function copy() {
    const lines = [
      `Restaurante: ${tenantId}`,
      ownerCredentialCreated ? `Dueño: ${email} / ${initialPassword}` : `Dueño: ${email} — conserva su contraseña anterior`,
      ...staffPins.map(sp => `Plantilla INACTIVA ${sp.role}: ${sp.pin}`),
      ...(localServer ? [`Caja: ${localServer.email} / ${localServer.password}`] : []),
    ]
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(lines.join('\n'))
      props.onNotice('success', 'Credenciales copiadas')
    } catch { props.onNotice('error', 'No se pudieron copiar las credenciales') }
  }
  return <div className="p-5 space-y-4">
    <p className="text-sm font-semibold text-[var(--text-1)]">Acceso del dueño confirmado</p>
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
      <p className="font-mono break-all">{email}</p>
      {ownerCredentialCreated ? <><p className="font-mono break-all">{initialPassword}</p><p className="text-xs text-[var(--text-3)]">Guarda la contraseña nueva antes de cerrar.</p></> : <p>Esta cuenta ya existía y conserva su contraseña anterior.</p>}
    </div>
    {staffSetupRequired && <p role="status" className="rounded-xl border border-amber-500/30 p-3 text-sm">Falta configurar personal real antes de operar el POS. Las plantillas están inactivas.</p>}
    {staffPins.length > 0 && <div className="rounded-xl border border-[var(--line)] p-3 text-sm">
      <p className="mb-2">Plantillas inactivas — no permiten operar</p>
      {staffPins.map(sp => <p key={sp.role} className="flex justify-between gap-2"><span>{sp.role}</span><span className="font-mono">{sp.pin}</span></p>)}
    </div>}
    {localServer && <div className="rounded-xl border border-[var(--line)] p-3 text-sm">
      <p>Credencial nueva de Caja: guárdala antes de cerrar.</p>
      <p className="font-mono break-all">{localServer.email}</p><p className="font-mono break-all">{localServer.password}</p>
    </div>}
    {props.existingServiceCredential && <p className="text-sm">Caja ya tenía una credencial y conserva la anterior. Si no la tienes, hace falta recuperarla o rotarla antes de configurar la terminal.</p>}
    <p className="text-sm">Asigna cada POS y KDS a su sucursal en <a className="underline" href="/platform/terminales">Terminales</a>.</p>
    <button onClick={copy} className="w-full py-2.5 rounded-xl border border-[var(--line)] text-sm font-semibold">Copiar credenciales</button>
    <button onClick={props.onDone} className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#04120c] font-bold">Cerrar</button>
  </div>
}
