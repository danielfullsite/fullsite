export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  CHAT_ID_DANIEL: string;
  CHAT_ID_MONICA: string;
  CHAT_ID_RAUL: string;
  // Per-client restaurant context — set in Cloudflare Worker env vars
  RESTAURANT_NAME: string;
  RESTAURANT_LOCATION: string;
  BUSINESS_CONTEXT: string;
  STAFF_CONTEXT?: string;
  EXCLUDE_FROM_RANKING?: string;
  // Legacy — no se usa pero no rompe nada
  GITHUB_TOKEN?: string;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}
