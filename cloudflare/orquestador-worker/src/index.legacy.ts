/**
 * War Room Orquestador — Cloudflare Worker
 *
 * Recibe webhooks de Telegram, extrae el mensaje y dispara
 * el workflow orquestador.yml en GitHub Actions.
 * Responde 200 inmediato a Telegram sin esperar el workflow.
 */

interface Env {
  GITHUB_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;   // Telegram setWebhook secret_token (opcional pero recomendado)
}

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

const GITHUB_REPO     = "ramonfaurdaniel-png/fullsite";
const GITHUB_WORKFLOW = "orquestador.yml";
const GITHUB_REF      = "main";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    // GET health check
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ status: "ok", worker: "telegram-orquestador-warroom" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validar secret token de Telegram (si está configurado)
    if (env.WEBHOOK_SECRET) {
      const tokenHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (tokenHeader !== env.WEBHOOK_SECRET) {
        console.error("Webhook secret mismatch — request rejected");
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // Parsear cuerpo del webhook
    let update: TelegramUpdate;
    try {
      update = await request.json() as TelegramUpdate;
    } catch {
      console.error("Failed to parse request body");
      return new Response("Bad Request", { status: 400 });
    }

    // Ignorar updates que no sean mensajes de texto
    const message = update.message ?? update.edited_message;
    if (!message || !message.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId    = String(message.chat.id);
    const text      = message.text.trim();
    const fromName  = message.from?.first_name ?? message.from?.username ?? "unknown";
    const fromId    = message.from?.id ?? 0;

    console.log(`[orquestador] inbound from=${fromName}(${fromId}) chat=${chatId} text="${text.slice(0, 80)}"`);

    // Disparar workflow en GitHub Actions (fire and forget)
    const dispatchResult = await dispatchGitHubWorkflow(
      env.GITHUB_TOKEN,
      GITHUB_REPO,
      GITHUB_WORKFLOW,
      GITHUB_REF,
      { message: text, chat_id: chatId }
    );

    if (!dispatchResult.ok) {
      console.error(`[orquestador] GitHub dispatch failed: ${dispatchResult.status} ${dispatchResult.error}`);
      // Aun así respondemos 200 a Telegram para que no reintente
    } else {
      console.log(`[orquestador] Dispatched ${GITHUB_WORKFLOW} OK`);
    }

    // Respuesta inmediata a Telegram — no esperamos el workflow
    return new Response("OK", { status: 200 });
  },
};

async function dispatchGitHubWorkflow(
  token: string,
  repo: string,
  workflow: string,
  ref: string,
  inputs: Record<string, string>
): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "warroom-orquestador/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, status: resp.status, error: body };
    }
    return { ok: true, status: resp.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}
