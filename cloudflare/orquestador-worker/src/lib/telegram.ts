import type { Env } from '../types';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function sendMessage(
  env: Env,
  chatId: string,
  text: string,
): Promise<void> {
  const url = `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[telegram] sendMessage failed: ${resp.status} ${body}`);
  }
}

export async function sendChatAction(
  env: Env,
  chatId: string,
  action: string = 'typing',
): Promise<void> {
  const url = `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendChatAction`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[telegram] sendChatAction failed: ${resp.status} ${body}`);
  }
}
