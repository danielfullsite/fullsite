import type { Env } from '../types';
import { sendMessage } from '../lib/telegram';
import {
  getDailyBriefing,
  getTopMeseros,
  getVentas,
  getLastSync,
  type MeseroEntry,
} from '../lib/supabase';

const HELP_TEXT = `Comandos disponibles:

/briefing - Resumen del dia (ventas, meseros, personas)
/top [hoy|semana|mes] - Top 5 meseros
/ventas [hoy|ayer|semana|mes] - Total de ventas
/sync - Estado del ultimo sync de Wansoft
/help - Esta lista de comandos`;

// Cajeros y cuentas internas — excluir de rankings
const EXCLUDE_FROM_RANKING = [
  'oscar ricardo',
  'hector enrique',
  'rodrigo chávez',
  'rodrigo chavez',
  'fany elizabeth',
  'aplicaciones',
  'mesero evento',
];

function isMesero(nombre: string): boolean {
  return !EXCLUDE_FROM_RANKING.some((ex) => nombre.toLowerCase().includes(ex));
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Handlers ──

async function briefingHandler(env: Env, chatId: string): Promise<void> {
  const data = await getDailyBriefing(env);
  if (!data) {
    await sendMessage(
      env,
      chatId,
      'Aún no llega el reporte de hoy. Espera el avance de las 3pm o el cierre de la noche.',
    );
    return;
  }

  const meseros = (data.meseros ?? [])
    .filter((m: MeseroEntry) => isMesero(m.nombre))
    .sort((a: MeseroEntry, b: MeseroEntry) => b.total - a.total)
    .slice(0, 3);

  const reportType = data.report_type ?? 'Reporte';
  const lines = [
    `📊 AMALAY · ${reportType} del ${data.fecha}`,
    '',
    `Ventas: ${fmtMoney(Number(data.ventas_dia))} MXN`,
    `Personas: ${data.personas_restaurant ?? 0}`,
    `Ticket promedio: ${fmtMoney(Number(data.ticket_promedio_restaurant ?? 0))} MXN`,
  ];

  if (meseros.length > 0) {
    lines.push('', 'Top 3 meseros:');
    meseros.forEach((m: MeseroEntry, i: number) => {
      lines.push(
        `${i + 1}. ${m.nombre} — ${fmtMoney(m.total)} (${m.personas}p · ${fmtMoney(m.promedio)})`,
      );
    });
  }

  await sendMessage(env, chatId, lines.join('\n'));
}

async function topMeserosHandler(env: Env, chatId: string, arg?: string): Promise<void> {
  const validPeriods = ['hoy', 'semana', 'mes'] as const;
  type Period = (typeof validPeriods)[number];

  // Mapear a lo que espera getTopMeseros
  const periodMap: Record<Period, 'dia' | 'semana' | 'mes'> = {
    hoy: 'dia',
    semana: 'semana',
    mes: 'mes',
  };

  let period: Period = 'hoy';
  let warning = '';

  if (arg) {
    const normalized = arg.toLowerCase();
    if (normalized === 'dia') {
      period = 'hoy';
    } else if (validPeriods.includes(normalized as Period)) {
      period = normalized as Period;
    } else {
      warning = 'Solo soporto: hoy, semana, mes. Mostrando hoy.\n\n';
    }
  }

  const top = await getTopMeseros(env, periodMap[period]);

  if (top.length === 0) {
    await sendMessage(env, chatId, `${warning}No hay data de meseros para este periodo.`);
    return;
  }

  const lines = [`🏆 Top meseros · ${period}`, ''];
  top.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.nombre}: ${fmtMoney(m.total)}`);
  });

  await sendMessage(env, chatId, warning + lines.join('\n'));
}

async function ventasHandler(env: Env, chatId: string, arg?: string): Promise<void> {
  const validPeriods = ['hoy', 'ayer', 'semana', 'mes'] as const;
  type Period = (typeof validPeriods)[number];

  let period: Period = 'hoy';
  if (arg && validPeriods.includes(arg.toLowerCase() as Period)) {
    period = arg.toLowerCase() as Period;
  }

  const result = await getVentas(env, period);

  if (!result || result.days === 0) {
    await sendMessage(env, chatId, `No hay data de ventas para: ${period}`);
    return;
  }

  const lines = [`💰 Ventas · ${period}`, '', `Total: ${fmtMoney(result.total)} MXN`];

  if (result.days > 1) {
    const avg = Math.round(result.total / result.days);
    lines.push(`Días con data: ${result.days}`, `Promedio diario: ${fmtMoney(avg)} MXN`);
  }

  await sendMessage(env, chatId, lines.join('\n'));
}

async function syncHandler(env: Env, chatId: string): Promise<void> {
  const sync = await getLastSync(env);

  if (!sync) {
    await sendMessage(env, chatId, '⚠️ No pude consultar el estado del sync.');
    return;
  }

  const hoursAgo = sync.hours_ago;
  let timeStr: string;
  if (hoursAgo < 1) {
    timeStr = `${Math.round(hoursAgo * 60)} minutos`;
  } else if (hoursAgo < 24) {
    timeStr = `${hoursAgo.toFixed(1)} horas`;
  } else {
    timeStr = `${Math.round(hoursAgo / 24)} días`;
  }

  const status = hoursAgo <= 24 ? '✅ OK' : '⚠️ Sync atrasada';

  const lines = [
    '🔄 Sync Wansoft',
    '',
    `Última sync: hace ${timeStr}`,
    `(${sync.updated_at})`,
    '',
    status,
  ];

  await sendMessage(env, chatId, lines.join('\n'));
}

// ── Router ──

export async function handleCommand(
  env: Env,
  chatId: string,
  text: string,
): Promise<void> {
  const [cmd, ...args] = text.slice(1).split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'briefing':
      await briefingHandler(env, chatId);
      break;
    case 'top':
      await topMeserosHandler(env, chatId, args[0]);
      break;
    case 'ventas':
      await ventasHandler(env, chatId, args[0]);
      break;
    case 'sync':
      await syncHandler(env, chatId);
      break;
    case 'help':
    case 'ayuda':
    case 'start':
      await sendMessage(env, chatId, HELP_TEXT);
      break;
    default:
      await sendMessage(env, chatId, HELP_TEXT);
      break;
  }
}
