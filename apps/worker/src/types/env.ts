/** Runtime bindings made available to the Worker. Types are generated from Wrangler config. */
export interface Env {
  CHAT_CONFIG: CloudflareBindings['CHAT_CONFIG'];
  CHAT_IMAGES: CloudflareBindings['CHAT_IMAGES'];
  CHAT_ROOM: CloudflareBindings['CHAT_ROOM'];
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ADMIN_CHAT_IDS: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  PUBLIC_WIDGET_ORIGINS?: string;
}
