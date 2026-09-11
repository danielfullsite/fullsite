#!/usr/bin/env node
'use strict'
// Private disposable cluster only: no URL, TCP listener, or existing database.
const fs = require('node:fs'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '../..')
const output = path.join(ROOT, 'output/closure/inventory-movement')
fs.mkdirSync(output, { recursive: true })
const base = fs.mkdtempSync('/tmp/fullsite-inventory-pg-')
const discovered = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' })
const bin = process.env.FULLSITE_TEST_PG_BIN || discovered.stdout?.trim()
if (!bin || !fs.existsSync(path.join(bin, 'initdb'))) throw new Error('Install PostgreSQL or set FULLSITE_TEST_PG_BIN')
let started = false
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: ROOT, encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${path.basename(binary)} failed: ${result.stderr || result.error?.message || result.status}`)
  return result.stdout
}
try {
  run(path.join(bin, 'initdb'), ['-D', path.join(base, 'data'), '-A', 'trust', '-U', 'postgres'])
  run(path.join(bin, 'pg_ctl'), ['-D', path.join(base, 'data'), '-l', path.join(base, 'postgres.log'), '-o', `-h '' -k ${base}`, 'start'])
  started = true
  let schema = 'create role anon; create role authenticated; create role service_role;\n'
  const baseline = fs.readFileSync(path.join(ROOT, 'supabase/migrations/00000000000000_baseline_esquema.sql'), 'utf8')
  for (const table of ['pos_inventory','pos_inventory_movements','pos_ingredients']) {
    const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${table}"`)
    const end = baseline.indexOf('\n);', start)
    if (start < 0 || end < 0) throw new Error('Missing baseline table: ' + table)
    schema += baseline.slice(start,end+3) + `\nalter table public.${table} add primary key(id);\n`
  }
  for (const table of ['pos_inventory','pos_inventory_movements']) schema += `create sequence ${table}_id_seq; alter table ${table} alter column id set default nextval('${table}_id_seq');\n`
  schema += 'alter table pos_inventory add unique(client_id,ingredient_id);\n'
  schema += fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260910050000_inventory_movement_atomic.sql'), 'utf8')
  fs.writeFileSync(path.join(output, 'schema-run.log'), run(path.join(bin, 'psql'), ['-X', '-h', base, '-U', 'postgres', '-p', '5432', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: schema }))
  const result = spawnSync(process.execPath, [path.join(__dirname, 'laboratorio-inventory-movement-postgres.cjs'), base], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, FULLSITE_TEST_PSQL: path.join(bin, 'psql') },
  })
  fs.writeFileSync(path.join(output, 'runtime.log'), (result.stdout || '') + (result.stderr || ''))
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) throw new Error(result.stderr || 'Scoped upsert lab failed')
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally {
  if (started) {
    try { run(path.join(bin, 'pg_ctl'), ['-D', path.join(base, 'data'), '-m', 'immediate', 'stop']); started = false }
    catch (error) { console.error(error.message); process.exitCode = 1 }
  }
  if (fs.existsSync(path.join(base, 'postgres.log'))) fs.copyFileSync(path.join(base, 'postgres.log'), path.join(output, 'postgres.log'))
  if (!started) fs.rmSync(base, { recursive: true, force: true })
  else console.error('Preserved cluster directory after failed shutdown: ' + base)
}
