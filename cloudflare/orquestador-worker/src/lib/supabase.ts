import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types';

// ── Supabase client (one per request, no global state in Workers) ──

export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

// ── Types ──

export interface DailyRow {
  fecha: string;
  ventas_brutas: number;
  ventas_dia: number;
  descuentos: number;
  devoluciones: number;
  efectivo: number;
  tarjeta: number;
  tickets_count: number;
  mesas_atendidas: number;
  ordenes_llevar: number;
  personas_restaurant: number;
  cuentas_restaurant: number;
  ticket_promedio_restaurant: number;
  propinas_total: number;
  chilaquiles_total: number;
  half_half_total: number;
  meseros: MeseroEntry[];
  platillos_top: { nombre: string; total: number }[];
  ventas_por_grupo: { nombre: string; total: number }[];
  pago_metodos: { nombre: string; total: number }[];
  client_slug: string;
  report_type: string;
  updated_at: string;
}

export interface MeseroEntry {
  nombre: string;
  total: number;
  personas: number;
  promedio: number;
}

// Cajeros, market y cuentas internas — excluir de rankings de meseros
const EXCLUDE_FROM_RANKING = [
  'oscar ricardo',
  'rodrigo chávez',
  'rodrigo chavez',
  'fany elizabeth',
  'ericka tamara',
  'frida vianney',
  'jorge antonio',
  'aplicaciones',
  'mesero evento',
];

function isMesero(nombre: string): boolean {
  return !EXCLUDE_FROM_RANKING.some((ex) => nombre.toLowerCase().includes(ex));
}

// ── 1. Briefing del día actual ──

export async function getDailyBriefing(env: Env): Promise<DailyRow | null> {
  const sb = getSupabase(env);
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb
    .from('wansoft_daily')
    .select('*')
    .eq('fecha', today)
    .maybeSingle();

  if (error) {
    console.error('[supabase] getDailyBriefing error:', error.message);
    return null;
  }
  return data as DailyRow | null;
}

// ── 2. Top meseros (filtrando cajeros) ──

export async function getTopMeseros(
  env: Env,
  period: 'dia' | 'semana' | 'mes',
): Promise<{ nombre: string; total: number }[]> {
  const sb = getSupabase(env);
  const now = new Date();
  let since: string;

  if (period === 'dia') {
    since = now.toISOString().split('T')[0];
  } else if (period === 'semana') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    since = d.toISOString().split('T')[0];
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    since = d.toISOString().split('T')[0];
  }

  const { data, error } = await sb
    .from('wansoft_daily')
    .select('meseros')
    .gte('fecha', since);

  if (error || !data) {
    console.error('[supabase] getTopMeseros error:', error?.message);
    return [];
  }

  // Agregar ventas por mesero a través de múltiples días
  const totals = new Map<string, number>();
  for (const row of data) {
    const meseros = row.meseros as MeseroEntry[] | null;
    if (!meseros) continue;
    for (const m of meseros) {
      if (!isMesero(m.nombre)) continue;
      totals.set(m.nombre, (totals.get(m.nombre) ?? 0) + m.total);
    }
  }

  return Array.from(totals.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

// ── 3. Ventas por periodo ──

export async function getVentas(
  env: Env,
  period: 'hoy' | 'ayer' | 'semana' | 'mes',
): Promise<{ total: number; days: number } | null> {
  const sb = getSupabase(env);
  const now = new Date();
  let since: string;
  let until: string | null = null;

  if (period === 'hoy') {
    since = now.toISOString().split('T')[0];
  } else if (period === 'ayer') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    since = d.toISOString().split('T')[0];
    until = since; // solo ese día
  } else if (period === 'semana') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    since = d.toISOString().split('T')[0];
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    since = d.toISOString().split('T')[0];
  }

  let query = sb.from('wansoft_daily').select('ventas_dia').gte('fecha', since);
  if (until) {
    query = query.lte('fecha', until);
  }

  const { data, error } = await query;

  if (error || !data) {
    console.error('[supabase] getVentas error:', error?.message);
    return null;
  }

  const total = data.reduce((sum, row) => sum + Number(row.ventas_dia ?? 0), 0);
  return { total, days: data.length };
}

// ── 4. Último sync ──

export async function getLastSync(
  env: Env,
): Promise<{ updated_at: string; hours_ago: number } | null> {
  const sb = getSupabase(env);
  const { data, error } = await sb
    .from('wansoft_daily')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error('[supabase] getLastSync error:', error?.message);
    return null;
  }

  const syncedAt = new Date(data.updated_at);
  const hoursAgo = (Date.now() - syncedAt.getTime()) / (1000 * 60 * 60);
  return { updated_at: data.updated_at, hours_ago: Math.round(hoursAgo * 10) / 10 };
}

// ── 5. Context para chat libre — últimos 7 días resumidos ──

export async function getRecentContext(env: Env): Promise<string> {
  const sb = getSupabase(env);
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data, error } = await sb
    .from('wansoft_daily')
    .select('fecha,ventas_dia,personas_restaurant,ticket_promedio_restaurant,meseros,propinas_total')
    .gte('fecha', since.toISOString().split('T')[0])
    .order('fecha', { ascending: false });

  if (error || !data || data.length === 0) {
    return 'Sin data de los últimos 7 días.';
  }

  const lines: string[] = ['Cierres últimos 7 días:'];

  for (const row of data) {
    const meseros = (row.meseros as MeseroEntry[] | null) ?? [];
    const topMesero = meseros
      .filter((m) => isMesero(m.nombre))
      .sort((a, b) => b.total - a.total)[0];

    lines.push(
      `${row.fecha}: $${Number(row.ventas_dia).toLocaleString('en-US', { minimumFractionDigits: 0 })} ventas, ${row.personas_restaurant ?? '?'} personas, ticket $${Number(row.ticket_promedio_restaurant ?? 0).toFixed(0)}${topMesero ? `, top: ${topMesero.nombre} ($${topMesero.total.toLocaleString('en-US')})` : ''}`,
    );
  }

  // Agregados
  const totalVentas = data.reduce((s, r) => s + Number(r.ventas_dia ?? 0), 0);
  const totalPersonas = data.reduce((s, r) => s + Number(r.personas_restaurant ?? 0), 0);
  const avgTicket =
    data.reduce((s, r) => s + Number(r.ticket_promedio_restaurant ?? 0), 0) / data.length;

  lines.push('');
  lines.push(
    `Totales 7d: $${totalVentas.toLocaleString('en-US', { minimumFractionDigits: 0 })} ventas, ${totalPersonas} personas, ticket promedio $${avgTicket.toFixed(0)}`,
  );

  return lines.join('\n');
}
