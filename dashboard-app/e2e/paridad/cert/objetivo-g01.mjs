// EL BLANCO DE G01 — parametrizado, nunca hardcodeado.
//
// La primera versión del guion traía `HUMMUS` y `Appetizers`: datos del menú de
// AMALAY. Un arnés que depende del menú de un cliente no certifica el producto,
// certifica ese menú — y se cae el día que alguien renombra un platillo.
//
// Los nombres canónicos del laboratorio de certificación son los de abajo. El
// tenant de certificación los siembra con esos nombres exactos; cualquier otro
// entorno los pisa por variable de ambiente sin tocar este archivo.

export const OBJETIVO = Object.freeze({
  categoria: process.env.CERT_CATEGORY            || 'CERT-G01',
  producto:  process.env.CERT_PRODUCT             || 'CERT-G01-PLATO',
  grupo:     process.env.CERT_REQUIRED_MOD_GROUP  || 'CERT-G01-OPCION',
  opcion:    process.env.CERT_MODIFIER_OPTION     || 'CERT-G01-ESTANDAR',
  mesa:      Number(process.env.CERT_MESA || 1),
})

/** Dónde vive el sistema bajo prueba. Nada de rutas ni puertos fijos. */
export const ENTORNO = Object.freeze({
  baseUrl:  process.env.CERT_BASE_URL || 'https://app.fullsite.mx',
  cdp:      process.env.FULLSITE_CDP  || 'http://127.0.0.1:9222',
  bridge:   process.env.CERT_BRIDGE   || 'http://127.0.0.1:7717',
  pin:      process.env.FULLSITE_PIN  || '',
  tenant:   process.env.CERT_CLIENT_ID || null,
  // Tenant que JAMÁS puede ser el blanco: la regla del blanco de prueba.
  prohibido: (process.env.CERT_TENANT_PROHIBIDO || 'amalay').toLowerCase(),
})

/* ═══════════════════════════════════════════════════════════════════════════
   EL GUION — seis pasos explícitos
   ───────────────────────────────────────────────────────────────────────────
   La versión anterior tenía cuatro: el PIN vivía escondido dentro de «abrir
   mesa» y «elegir categoría» venía fusionado con «agregar producto». Contar
   6/6 exige que cada paso exista por separado y pueda fallar por separado —
   si el PIN no es un paso, un PIN roto se reporta como «no abrió la mesa».
   ═══════════════════════════════════════════════════════════════════════════ */
export const G01 = Object.freeze({
  id: 'G01',
  nombre: 'PIN → mesa → categoría → producto → modificador obligatorio → cocina',
  pasos: Object.freeze([
    { n: 1, accion: 'ingresar',            etiqueta: 'PIN / login' },
    { n: 2, accion: 'abrirMesa',           etiqueta: `abrir mesa ${OBJETIVO.mesa}` },
    { n: 3, accion: 'elegirCategoria',     etiqueta: `categoría ${OBJETIVO.categoria}` },
    { n: 4, accion: 'agregarProducto',     etiqueta: `producto ${OBJETIVO.producto}` },
    { n: 5, accion: 'completarModificador', etiqueta: `modificador ${OBJETIVO.grupo} → ${OBJETIVO.opcion}` },
    { n: 6, accion: 'enviar',              etiqueta: 'enviar a cocina' },
  ]),
})

export const TOTAL_PASOS = G01.pasos.length
