import type { Env, TelegramUpdate } from './types';
import { handleCommand } from './handlers/commands';
import { handleChat } from './handlers/chat';
import { sendMessage } from './lib/telegram';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // GET health check
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ status: 'ok', worker: 'telegram-orquestador-warroom' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Validar secret token de Telegram
    if (env.WEBHOOK_SECRET) {
      const tokenHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (tokenHeader !== env.WEBHOOK_SECRET) {
        console.error('[warroom] Webhook secret mismatch');
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // Parsear cuerpo del webhook
    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      console.error('[warroom] Failed to parse request body');
      return new Response('Bad Request', { status: 400 });
    }

    // Ignorar updates sin mensaje
    const message = update.message ?? update.edited_message;
    if (!message) {
      return new Response('OK', { status: 200 });
    }

    const chatId = String(message.chat.id);
    const text = message.text?.trim();
    const fromName = message.from?.first_name ?? message.from?.username ?? 'unknown';
    const fromId = message.from?.id ?? 0;

    console.log(`[warroom] from=${fromName}(${fromId}) chat=${chatId} text="${(text ?? '').slice(0, 80)}"`);

    // Autorización: solo Daniel y Mónica
    const allowedChats = [env.CHAT_ID_DANIEL, env.CHAT_ID_MONICA];
    if (!allowedChats.includes(chatId)) {
      await sendMessage(env, chatId, 'No tengo permiso para responder en este chat.');
      return new Response('OK', { status: 200 });
    }

    // Sin texto (stickers, fotos, etc.)
    if (!text) {
      await sendMessage(env, chatId, 'Por ahora solo proceso mensajes de texto.');
      return new Response('OK', { status: 200 });
    }

    // Router
    if (text.startsWith('/')) {
      await handleCommand(env, chatId, text);
    } else {
      await handleChat(env, chatId, text);
    }

    return new Response('OK', { status: 200 });
  },
};
