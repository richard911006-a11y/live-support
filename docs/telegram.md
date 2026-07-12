# Telegram 集成

本文介绍 Telegram 管理员通知、图片发送和 Webhook 回复流程。

访客文字和图片会发送到 `TELEGRAM_ADMIN_CHAT_IDS` 中列出的所有管理员会话。请求由统一的 Bot API 客户端处理，失败时自动重试一次。Telegram Webhook 使用 `/webhook/telegram`（兼容路径 `/telegram/webhook`），并要求请求头 `X-Telegram-Bot-Api-Secret-Token` 与 `TELEGRAM_WEBHOOK_SECRET` 一致。

只有回复包含访客元数据的 Telegram 消息，才会转发给仍在线的访客。命令、未支持的更新、未授权管理员会话和已断开的访客都会被安全忽略。部署钩子会使用 `message` 和 `edited_message` 更新类型注册 Webhook。
