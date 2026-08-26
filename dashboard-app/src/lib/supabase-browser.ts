import { supabase } from './supabase'

// Re-export the same singleton — no duplicate GoTrueClient.
//
// Devuelve el Proxy perezoso, NO getSupabase(). La diferencia importa en el build:
// los dos llamadores hacen `useMemo(() => createClient(), [])`, y el cuerpo de un
// useMemo SÍ corre durante el render del servidor. getSupabase() construye el cliente
// en el acto y lanza si faltan las variables, así que el prerender de las 262 páginas
// tronaba —AuthProvider vive en el layout raíz— cuando el build no tenía credenciales.
//
// El Proxy difiere la construcción hasta el primer acceso a una propiedad, y todos los
// accesos ocurren dentro de efectos o callbacks, o sea ya en el navegador. Mismo
// singleton, mismo comportamiento en tiempo de ejecución; sólo cambia CUÁNDO se crea.
export function createClient() {
  return supabase
}
