import { redirect } from 'next/navigation'

// OP-41 — Página retirada. Escribía un blob cosmético a wansoft_data.portal_users,
// desconectado de auth real: los "usuarios" creados aquí NO existían en auth.users
// ni en client_users, y no podían iniciar sesión (teatro vacío).
//
// La gestión REAL de equipo vive en /equipo (A2, commit a117121f):
//   · Personal (POS): crea pos_staff + PIN vía /api/owner/staff
//   · Accesos al dashboard: crea auth.users + client_users vía /api/owner/users
//
// Redirigimos aquí para no dejar la trampa viva y mandar a quien tenga la URL vieja
// al flujo que sí funciona.
export default function AdminUsuariosRetired() {
  redirect('/equipo')
}
