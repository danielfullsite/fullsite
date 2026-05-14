import { sendMessage, sendChatAction } from '../lib/telegram';
import type { Env } from '../types';

const REPO = 'ramonfaurdaniel-png/fullsite';

async function dispatchWansoftQuery(env: Env, chatId: string, message: string): Promise<boolean> {
  if (!env.GITHUB_TOKEN) {
    console.error('[chat] No GITHUB_TOKEN — cannot dispatch workflow');
    return false;
  }

  const resp = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/wansoft-query.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'warroom-worker/1.0',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          message: message.slice(0, 500),
          chat_id: chatId,
        },
      }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[chat] GitHub dispatch failed: ${resp.status} ${body.slice(0, 200)}`);
    return false;
  }

  return true;
}

export async function handleChat(env: Env, chatId: string, userText: string): Promise<void> {
  await sendChatAction(env, chatId, 'typing');

  try {
    // Dispatch to wansoft-query workflow for full data access
    const ok = await dispatchWansoftQuery(env, chatId, userText);

    if (ok) {
      await sendMessage(env, chatId, `Consultando Wansoft... respondo en ~15 seg.`);
    } else {
      await sendMessage(
        env,
        chatId,
        'No pude procesar tu pregunta. Intenta de nuevo en un momento.',
      );
    }
  } catch (error) {
    console.error('[chat handler] error:', error);
    await sendMessage(
      env,
      chatId,
      'Tuve un problema procesando tu pregunta. Intenta de nuevo en un momento.',
    );
  }
}
