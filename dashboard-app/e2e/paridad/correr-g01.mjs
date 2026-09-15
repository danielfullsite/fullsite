// G01 DE PUNTA A PUNTA: dos corridas contra el sistema vivo y su comparación.
import { conducirV1, G01 } from './conductor-v1.mjs'
import { normalizar, comparar, MUTACIONES } from './manifiesto-de-efectos.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const SALIDA = '/private/tmp/claude-501/-Users-danielrg-fullsite/5da718bd-f5a0-4f70-b4bf-871021defe7a/scratchpad/validacion-amalay/g01'
mkdirSync(SALIDA, { recursive: true })

console.log(`G01 · ${G01.nombre}\n${'═'.repeat(70)}`)
console.log('\n── CORRIDA A ──')
const A = await conducirV1(G01)
for (const b of A.bitacora) console.log(`   ${b.ok === false ? '✗' : '·'} ${b.etiqueta}${b.rotulo ? `: «${b.rotulo.slice(0,44)}»` : ''}${b.exigido !== undefined ? ` exigido=${b.exigido} rotulo=«${b.rotulo}»` : ''}`)
console.log('   efectos por categoría:', Object.entries(A.manifiesto).filter(([,v])=>v.length).map(([k,v])=>`${k}=${v.length}`).join(' ') || '(ninguno)')

console.log('\n── CORRIDA B ──')
const B = await conducirV1(G01)
console.log('   efectos por categoría:', Object.entries(B.manifiesto).filter(([,v])=>v.length).map(([k,v])=>`${k}=${v.length}`).join(' ') || '(ninguno)')

writeFileSync(`${SALIDA}/A.json`, JSON.stringify(A, null, 2))
writeFileSync(`${SALIDA}/B.json`, JSON.stringify(B, null, 2))

// LA COMPUERTA: sin ejecución no hay veredicto. Dos corridas vacías son
// idénticas, y eso no dice nada del sistema.
if (!A.corrio || !B.corrio) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log('*** EL GUION NO SE EJECUTÓ. No se declara paridad.')
  for (const [n, r] of [['A', A], ['B', B]]) {
    if (r.corrio) continue
    console.log(`\n  corrida ${n} — pasos fallidos: ${r.manifiesto.__no_corrio.pasosFallidos.join(', ')}`)
    console.log(`  botones en pantalla al fallar: ${r.manifiesto.__no_corrio.enPantallaAlFallar.join(' | ').slice(0, 300)}`)
  }
  console.log('\nUn arnés que dice «idénticos» cuando no pasó nada da permiso de avanzar.')
  process.exit(1)
}

const nA = normalizar(A.manifiesto), nB = normalizar(B.manifiesto)
const d = comparar(nA, nB)
console.log(`\n${'═'.repeat(70)}\nV1 vs V1 → ${d.length} diferencias`)
for (const x of d) console.log(`   ✗ ${x.categoria}: ${x.motivo}`)
console.log(d.length === 0 ? '>>> ZERO DELTA sobre el sistema vivo' : '*** hay deriva entre dos corridas idénticas')

if (d.length === 0) {
  console.log('\nLAS CINCO MUTACIONES, sobre el manifiesto REAL:')
  let n = 0
  for (const m of MUTACIONES) {
    const mut = m.aplicar(B.manifiesto)
    if (!mut) { console.log(`   ?? ${m.id} no aplicable a este manifiesto`); continue }
    const diffs = comparar(nA, normalizar(mut))
    const cats = diffs.map(x => x.categoria)
    const ok = diffs.length > 0 && m.esperada.some(c => cats.includes(c))
    if (ok) n++
    console.log(`   ${ok ? '✓' : '✗'} ${m.id} · ${m.nombre} → ${cats.join(', ') || '(nada)'}`)
  }
  console.log(`\nDETECTADAS ${n}/${MUTACIONES.length}`)
}
