// Corre las pruebas de ocm_daily en un PostgreSQL REAL y aislado (embedded-postgres, directorio
// temporal, puerto local). No toca ninguna base remota ni lee credenciales.
//
//   mkdir /tmp/pgreal && cd /tmp/pgreal && npm init -y && npm i embedded-postgres pg
//   cd /tmp/pgreal && node <repo>/supabase/tests/aislado/correr.mjs <repo>
//
// Fases: (1) estructura representativa; (2) foto de la vista anterior; (3) migración x2
// (idempotencia); (4) pruebas de datos y de acceso; (5) control negativo con la lógica anterior;
// (6) reversa: se ejecuta el bloque comentado y se compara con la foto de (2).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(process.argv[2] ?? '.');
const base = path.join(process.cwd(), 'x');
const req = createRequire(base);
const EP = (await import(pathToFileURL(req.resolve('embedded-postgres')).href)).default;
const T = (f) => fs.readFileSync(path.join(repo, 'supabase', f), 'utf8');
const mig = T('migrations/PENDIENTE_20261001000000_ocm_daily_desglose_pagos.sql');
const setup = T('tests/aislado/00_estructura_representativa.sql');
const tData = T('tests/ocm_daily_desglose_pagos_test.sql');
const tAcc = T('tests/ocm_daily_acceso_test.sql');

const dir = fs.mkdtempSync('/tmp/pgreal-data-');
const pg = new EP({ databaseDir: dir, user: 'postgres', password: 'x', port: 54330, persistent: false });
await pg.initialise(); await pg.start();

let fallos = 0;
const nuevaBase = async (nombre) => {
  await pg.createDatabase(nombre);
  const c = pg.getPgClient(nombre); await c.connect(); return c;
};
const mostrar = (titulo, res) => {
  const lista = Array.isArray(res) ? res : [res];
  const filas = lista.filter(r => r.fields?.some(f => f.name === 'caso')).flatMap(r => r.rows);
  console.log(`\n== ${titulo}`);
  for (const w of filas) console.log(`${String(w.ok).padEnd(5)} | ${w.caso} | esperado ${w.esperado} | resultado ${w.resultado}`);
  const resumen = filas.find(w => w.caso === 'RESUMEN');
  if (!resumen || resumen.ok !== true) fallos++;
  return filas;
};
const foto = async (c) => (await c.query(`select pg_get_viewdef('public.ocm_daily'::regclass) def, relacl::text acl, reloptions::text opts,
  (select string_agg(attname||':'||format_type(atttypid,atttypmod), ',' order by attnum) from pg_attribute where attrelid='public.ocm_daily'::regclass and attnum>0 and not attisdropped) cols
  from pg_class where oid='public.ocm_daily'::regclass`)).rows[0];

const ver = (await (async () => { const c = pg.getPgClient(); await c.connect(); const v = (await c.query('select version()')).rows[0].version; await c.end(); return v; })());
console.log('Motor:', ver);

// ── (1)-(4) ──
const c = await nuevaBase('prueba');
await c.query(setup);
const antes = await foto(c);
await c.query(mig); await c.query(mig);            // idempotencia: dos aplicaciones seguidas
const despues = await foto(c);
console.log('\n== Contrato de la vista');
const colsAnt = antes.cols.split(','), colsDes = despues.cols.split(',');
const prefijo = colsDes.slice(0, colsAnt.length).join(',') === antes.cols;
console.log(`columnas existentes intactas y en el mismo orden: ${prefijo} (antes ${colsAnt.length}, después ${colsDes.length}; nuevas: ${colsDes.slice(colsAnt.length).map(x => x.split(':')[0]).join(', ')})`);
console.log(`ACL igual: ${antes.acl === despues.acl}\nopciones iguales: ${antes.opts === despues.opts} (${despues.opts})`);
if (!prefijo || antes.acl !== despues.acl || antes.opts !== despues.opts) fallos++;
mostrar('Datos (ocm_daily_desglose_pagos_test.sql)', await c.query(tData));
mostrar('Acceso y aislamiento (ocm_daily_acceso_test.sql)', await c.query(tAcc));

// ── (6) reversa sobre la misma base ──
const marca = mig.indexOf('-- DEFINICIÓN ANTERIOR');
const rev = mig.slice(marca).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- ──') && !l.startsWith('-- DEFINICIÓN') && !l.startsWith('-- Difieren') && !l.startsWith('-- columnas') && !l.startsWith('-- medido')).map(l => l.slice(3)).join('\n');
await c.query(rev);
const trasReversa = await foto(c);
const fn = (await c.query(`select count(*)::int n from pg_proc where proname='fs_desglose_pago'`)).rows[0].n;
console.log('\n== Reversa');
console.log(`definición igual a la anterior: ${trasReversa.def === antes.def}\ncolumnas iguales: ${trasReversa.cols === antes.cols}\nACL igual: ${trasReversa.acl === antes.acl}\nopciones iguales: ${trasReversa.opts === antes.opts}\nfunción eliminada: ${fn === 0}`);
if (trasReversa.def !== antes.def || trasReversa.cols !== antes.cols || trasReversa.acl !== antes.acl || trasReversa.opts !== antes.opts || fn !== 0) fallos++;
await c.end();

// ── (5) control negativo: misma prueba de datos con la lógica ANTERIOR (primera forma x total) ──
const n = await nuevaBase('negativo');
await n.query(setup);
await n.query(`CREATE FUNCTION public.fs_desglose_pago(t numeric, p numeric, g jsonb, m text)
  RETURNS TABLE(efectivo numeric, tarjeta numeric, otros_medios numeric, no_determinado numeric, excedente_pagos numeric)
  LANGUAGE sql IMMUTABLE AS $$ select case when m ~* 'efec' and m !~* 'tarj' then coalesce(t,0) else 0::numeric end,
     case when m ~* 'tarj' and m !~* 'efec' then coalesce(t,0) else 0::numeric end, 0::numeric, 0::numeric, 0::numeric $$`);
const m2 = mig.slice(mig.indexOf('\nCREATE OR REPLACE VIEW public.ocm_daily AS'), mig.indexOf('\nALTER VIEW public.ocm_daily SET'));
await n.query(m2.replace(/^/, ''));
const neg = await n.query(tData);
const filasNeg = neg.filter(r => r.fields?.some(f => f.name === 'caso')).flatMap(r => r.rows);
const malas = filasNeg.filter(w => w.ok === false && w.caso !== 'RESUMEN').length;
console.log(`\n== Control negativo (lógica anterior): ${malas} filas fallan de ${filasNeg.length - 1} (debe ser > 0)`);
if (malas === 0) fallos++;
await n.end();

await pg.stop();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nRESULTADO GLOBAL: ${fallos === 0 ? 'OK' : fallos + ' fase(s) con fallos'}`);
process.exit(fallos === 0 ? 0 : 1);
