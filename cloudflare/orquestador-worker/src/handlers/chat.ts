import { sendMessage, sendChatAction } from '../lib/telegram';
import { generateReply } from '../lib/claude-api';
import { getRecentContext } from '../lib/supabase';
import type { Env } from '../types';

export async function handleChat(env: Env, chatId: string, userText: string): Promise<void> {
  // 1. Mostrar "typing..."
  await sendChatAction(env, chatId, 'typing');

  try {
    // 2. Cargar context: últimos 7 días resumidos
    const context = await getRecentContext(env);

    // 3. Llamar a Claude (generateReply wrappea context en <data> tags)
    const reply = await generateReply(env, userText, context);

    // 4. Enviar respuesta
    await sendMessage(env, chatId, reply);
  } catch (error) {
    console.error('[chat handler] error:', error);
    await sendMessage(
      env,
      chatId,
      'Tuve un problema procesando tu pregunta. Intenta de nuevo en un momento.',
    );
  }
}
