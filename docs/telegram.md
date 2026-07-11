# Telegram

Customer text and image notifications are sent to every chat ID listed in `TELEGRAM_ADMIN_CHAT_IDS`. Requests use the centralized Bot API client and retry once on failure. Telegram webhook updates are accepted at `/webhook/telegram` (and the compatibility alias `/telegram/webhook`) only when the `X-Telegram-Bot-Api-Secret-Token` header matches `TELEGRAM_WEBHOOK_SECRET`.

Only replies to a Telegram message containing visitor metadata are forwarded to a connected visitor. Commands, unsupported updates, unauthorized administrator chats, and disconnected visitors are ignored safely. The deployment hook calls `setWebhook` with `message` and `edited_message` updates enabled.
