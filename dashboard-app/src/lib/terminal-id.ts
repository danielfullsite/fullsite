/** device_id aceptable para amarrar un token a una terminal. Mismo formato que pos_terminals. */
export function terminalIdValido(v: unknown): v is string {
  return typeof v === 'string' && /^[\w-]{1,64}$/.test(v)
}
