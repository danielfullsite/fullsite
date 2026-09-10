#!/usr/bin/env node
'use strict'
// Creates and removes its own PostgreSQL cluster. Never accepts a database URL,
// host or password and never applies migrations to an existing server.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '../..')
const output = path.join(ROOT, 'output/closure/materializer')
fs.mkdirSync(output, { recursive: true })
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-materializer-pg-'))
const discovered = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' })
const bin = process.env.FULLSITE_TEST_PG_BIN || discovered.stdout?.trim()
if (!bin || !fs.existsSync(path.join(bin, 'initdb'))) throw new Error('Install PostgreSQL or set FULLSITE_TEST_PG_BIN to its binaries directory')
let started = false
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: ROOT, encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${path.basename(binary)} failed: ${result.stderr || result.error?.message || result.status}`)
  return result.stdout
}
async function main() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = String(server.address().port)
  await new Promise(resolve => server.close(resolve))
  run(path.join(bin, 'initdb'), ['-D', path.join(base, 'data'), '-A', 'trust', '-U', 'postgres'])
  run(path.join(bin, 'pg_ctl'), ['-D', path.join(base, 'data'), '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${base}`, 'start'])
  started = true
  const baseline = fs.readFileSync(path.join(ROOT, 'supabase/migrations/00000000000000_baseline_esquema.sql'), 'utf8')
  let schema = 'create role anon; create role authenticated; create role service_role;\n'
  for (const table of ['pos_orders', 'pos_turnos', 'pos_cash_movements']) {
    const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${table}"`)
    if (start < 0) throw new Error('Baseline table missing: ' + table)
    const end = baseline.indexOf('\n);', start)
    if (end < 0) throw new Error('Baseline table definition incomplete: ' + table)
    schema += baseline.slice(start, end + 3) + `\nalter table public.${table} add primary key(id);\n`
  }
  schema += "create table public.clients(id text primary key, timezone text, business_day_start_local time);\n"
  schema += fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260901180000_folio_por_dia_de_venta.sql'), 'utf8')
  schema += 'create trigger trg_pos_order_number before insert on public.pos_orders for each row execute function public.set_pos_order_number();\n'
  schema += "create sequence public.pos_cash_movements_id_seq; alter table public.pos_cash_movements alter column id set default nextval('public.pos_cash_movements_id_seq');\n"
  schema += fs.readFileSync(path.join(ROOT, 'supabase/migrations/PENDIENTE_20260904000000_cuentas_divididas_modelo_durable.sql'), 'utf8')
  schema += fs.readFileSync(path.join(ROOT, 'supabase/migrations/PENDIENTE_20260905010000_caja_business_materializer.sql'), 'utf8')
  schema += fs.readFileSync(path.join(ROOT, 'supabase/migrations/PENDIENTE_20260910080000_caja_folio_por_turno.sql'), 'utf8')
  fs.writeFileSync(path.join(output, 'schema-run.log'), run(path.join(bin, 'psql'), ['-X', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: schema }))
  const result = spawnSync(process.execPath, [path.join(__dirname, 'laboratorio-materializador-postgres.cjs'), port], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, FULLSITE_TEST_PSQL: path.join(bin, 'psql') },
  })
  fs.writeFileSync(path.join(output, 'runtime.log'), (result.stdout || '') + (result.stderr || ''))
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) throw new Error(result.stderr || 'Materializer lab failed')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => {
  if (started) {
    try { run(path.join(bin, 'pg_ctl'), ['-D', path.join(base, 'data'), '-m', 'immediate', 'stop']) }
    catch (error) { console.error(error.message); process.exitCode = 1; return }
  }
  if (fs.existsSync(path.join(base, 'postgres.log'))) fs.copyFileSync(path.join(base, 'postgres.log'), path.join(output, 'postgres.log'))
  fs.rmSync(base, { recursive: true, force: true })
})
