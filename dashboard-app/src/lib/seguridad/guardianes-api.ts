// Contrato de autenticación de las rutas de API.
//
// Regla: todo handler exportado bajo `src/app/api/**/route.ts` pasa por un guardián
// registrado aquí, o está declarado como público con su razón. La prueba
// `src/__tests__/rutas-con-guardian.test.ts` lee ESTE archivo — no una lista propia.
//
// Por qué una sola fuente: el modo de fallo real no es sólo "falta guardián", también
// es "guardián que el barrido no reconoce". Ya pasó dos veces en este repo — un barrido
// no vio `requireTenant` y estuvo a punto de poner un segundo guardián encima, y otro
// marcó `/api/backup` como abierta cuando su guardián se llama `isAuthorized`. Si el
// que audita mantiene su propia lista, la lista se desincroniza y el barrido miente.
//
// Si inventas un guardián nuevo y no lo registras aquí, la prueba truena. Es a propósito.

/**
 * Guardianes que resuelven el TENANT desde la sesión (cookie `fs-at` o Bearer) y lo
 * contrastan contra `client_users` del lado del servidor.
 *
 * Estos son los únicos válidos para rutas que tocan datos de un restaurante: el
 * `client_id` nunca puede venir del query string ni del cuerpo de la petición.
 */
export const GUARDIANES_DE_SESION = [
  'requireTenant',
  'withPOSAuth',
  'requireAuth',
  'getSessionUserId',
  'verifyShiftToken',
  // Estar en esta lista significa que la ruta LLAMA a un guardián. No significa que el
  // guardián pueda negar. `verifyKitchenToken` estuvo aquí meses mientras devolvía `true`
  // por falta de secreto, y el barrido daba verde con `/api/pos/kitchen` sirviendo la
  // operación de cualquier restaurante a quien adivinara el slug (reproducido en
  // producción el 2026-08-26). Se arregló invirtiendo el default a fallar cerrado.
  // Al agregar un guardián aquí, prueba también que DENIEGA sin credencial.
  'verifyKitchenToken',
  'isPlatformAdmin',
  'requirePlatformAdmin',
  'isAuthorized', // /api/backup — Bearer contra Supabase Auth + allowlist de correos
] as const

/**
 * Guardianes de secreto compartido o firma. Válidos para máquina-a-máquina (webhooks,
 * CI, cron). NO resuelven tenant: si la ruta además toca datos de un restaurante,
 * necesita resolver el tenant por otro lado (ej. el mapping tienda→tenant del webhook).
 */
export const GUARDIANES_DE_SECRETO = [
  'checkAdminAuth', // @/lib/integrations/admin-auth — INTEGRATION_ADMIN_SECRET, tiempo constante
  'INTEGRATION_ADMIN_SECRET',
  'ONBOARDING_SECRET',
  'CRON_SECRET',
  'verifyRappiSignature',
  'verifyRappiOnboardingSignature',
  'RAPPI_ONBOARDING_REGISTRATION_TOKEN',
  // El webhook de Uber verifica con un ayudante local (`verifySignature`). Registramos
  // el nombre del secreto y no el de la función: `verifySignature` es un nombre genérico
  // y cualquiera podría declarar uno que no verifique nada y pasar el barrido. El
  // secreto es evidencia más difícil de falsificar por accidente.
  'UBER_WEBHOOK_SECRET',
] as const

export const GUARDIANES = [...GUARDIANES_DE_SESION, ...GUARDIANES_DE_SECRETO] as const

/**
 * Rutas públicas por diseño. La llave es `MÉTODO /ruta` relativa a `/api`.
 *
 * Cada entrada necesita una razón que explique por qué NO puede tener sesión. "Todavía
 * no lo arreglamos" no es una razón — eso va en HUECOS_CONOCIDOS.
 *
 * La prueba también verifica al revés: si una ruta listada aquí ya tiene guardián, o
 * dejó de existir, truena. Así la lista no se llena de excepciones muertas.
 */
export const RUTAS_PUBLICAS: Record<string, string> = {
  // Endpoints que SON la autenticación — no pueden exigir sesión previa.
  'POST /internal-auth': 'Es el propio endpoint de contraseña del panel interno.',
  'POST /pos/pin': 'Es el login del POS: PIN → shift token. Sin sesión previa por definición.',
  'POST /platform/terminal-claim':
    'La terminal canjea su código de enrolamiento de un solo uso. El código ES la ' +
    'autenticación (no hay sesión previa). Falla cerrado: código inexistente/vencido/usado → 400.',

  // El navegador de un tercero llega aquí sin sesión nuestra.
  'GET /integrations/uber-eats/auth/initiate':
    'Uber redirige el navegador. Protegida con CSRF contra cookie httpOnly `uber_oauth_state`.',
  'GET /integrations/uber-eats/auth/callback':
    'Retorno del OAuth de Uber. Misma protección CSRF por cookie.',
  'POST /factura':
    'El comensal captura sus datos fiscales tras pagar; llega por QR o liga, sin cuenta. Valida order_id.',

  // Sondas y captura de leads.
  'GET /health': 'Sonda de salud. No devuelve datos de ningún restaurante.',
  'GET /integrations/rappi/health': 'Ping de disponibilidad. Devuelve una constante.',
  'POST /integrations/rappi/health': 'Ping de disponibilidad. Devuelve una constante.',
  'POST /prospect': 'Captura de prospectos desde la landing pública.',
  'GET /integrations/rappi/webhook': 'Ping del webhook: devuelve una constante. El POST sí verifica firma.',
  'GET /integrations/rappi/onboarding/callback':
    'Sonda del callback de self-onboarding de Rappi. Devuelve una constante; el POST exige firma HMAC.',
  'GET /integrations/uber-eats/webhook': 'Ping del webhook: devuelve una constante. El POST sí verifica firma.',
  'GET /webhook/ubereats': 'Ping del webhook: devuelve una constante. El POST sí verifica firma.',

  // Demos de venta. Ver HUECOS_CONOCIDOS: no filtran datos, pero sí queman cuota.
  'POST /demo-chat': 'Demo pública de venta. No lee datos de ningún restaurante real.',
  'POST /demo-chat-atope': 'Demo pública de venta con datos de muestra de Atope. Ningún restaurante real.',
  'POST /demo-chat-noreste': 'Demo pública de venta con datos de muestra. Ningún restaurante real.',
  'GET /voice-tts': 'Sonda de configuración de ElevenLabs. No devuelve datos.',
  'POST /voice-tts': 'TTS para la demo pública de voz.',
}

/**
 * Huecos aceptados a sabiendas, con su riesgo. NO son "públicas por diseño": son deuda.
 *
 * Existen aparte de RUTAS_PUBLICAS para que se puedan contar y reportar. Una excepción
 * escondida entre las justificadas deja de verse; aquí se ve.
 */
export const HUECOS_CONOCIDOS: Record<string, string> = {
  'POST /voice-tts':
    'Sin límite de tasa: cualquiera puede quemar la cuota de ElevenLabs. Costo, no fuga de datos.',
  'POST /demo-chat':
    'Sin límite de tasa: cualquiera puede quemar la cuota de Groq. Costo, no fuga de datos.',
  'POST /internal-auth':
    'Compara con === y sin límite de intentos: la contraseña es fuerza-bruteable.',
}
