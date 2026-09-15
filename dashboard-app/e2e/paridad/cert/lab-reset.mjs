// lab:reset:g01 — deja el laboratorio en un estado conocido.
//
// ── NO IMPLEMENTADO EN PR1, A PROPÓSITO ─────────────────────────────────────
//
// Sembrar el laboratorio exige el tenant de certificación, que todavía no
// existe: lo crea el onboarding real de plataforma, ejecutado por el platform
// admin, no por este arnés. PR1 se detuvo aquí deliberadamente.
//
// Este archivo existe en vez de faltar porque un comando ausente falla con un
// «script not found» que no dice nada, y un comando que finge sembrar es peor:
// dejaría correr `certify:g01` creyendo que el laboratorio está listo.
//
// Lo que PR2 tiene que sembrar, y nada más que eso:
//   · 3 mesas CERT
//   · 1 categoría CERT-G01
//   · 2 productos (uno de ellos CERT-G01-PLATO)
//   · 1 grupo de modificadores CERT-G01-OPCION, REQUERIDO
//   · 2 opciones, una de ellas CERT-G01-ESTANDAR
//   · routing/KDS mínimo
//   · staff CERT (si el onboarding no lo creó) y turno CERT
//
// Todo por APIs normales del producto. Cero SQL manual, cero service_role en
// manos del arnés, AMALAY_WRITES = 0.

import { OBJETIVO, ENTORNO } from './objetivo-g01.mjs'

console.log('lab:reset:g01')
console.log('═'.repeat(66))
console.log('ESTADO: NO IMPLEMENTADO (PR2)\n')
console.log('Falta el tenant de certificación. Lo crea el onboarding real de')
console.log('plataforma; este arnés no crea tenants ni usa service_role.\n')
console.log('Objetivo que PR2 debe sembrar:')
console.log(`  categoría  ${OBJETIVO.categoria}`)
console.log(`  producto   ${OBJETIVO.producto}`)
console.log(`  grupo      ${OBJETIVO.grupo}  (REQUERIDO)`)
console.log(`  opción     ${OBJETIVO.opcion}`)
console.log(`  mesa       ${OBJETIVO.mesa}  (de 3 mesas CERT)`)
console.log(`  tenant     ${ENTORNO.tenant ?? '(CERT_CLIENT_ID sin definir)'}`)
console.log('\nMientras no exista, `certify:g01` termina en PRECONDITION_FAILURE')
console.log('con la compuerta que corresponda — no en FAIL y nunca en PASS.')

process.exit(2)
