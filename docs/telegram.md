# Telegram 集成

本文说明 Telegram 管理员通知、Forum Topic、多媒体发送和 Webhook 回复流程。

访客消息会发送到 `TELEGRAM_ADMIN_CHAT_IDS` 中配置的管理员 Supergroup。请求由统一的 Bot API 客户端处理，失败时自动重试一次。Telegram Webhook 使用 `/webhook/telegram`（兼容 `/telegram/webhook`），并要求请求头 `X-Telegram-Bot-Api-Secret-Token` 与 `TELEGRAM_WEBHOOK_SECRET` 一致。

## Telegram Topics 多访客模式

每个访客会在每个管理员 Supergroup 中拥有独立的 Forum Topic，Topic 名称使用稳定的访客编号，例如 `#8223`。首次连接时发送一次完整访客资料，后续文字和图片只发送到该 Topic，不重复发送网站、设备和浏览器信息。

请先将管理员聊天升级为 Supergroup，开启 Forum Topics，并授予 Bot 创建、发送和关闭 Topic 以及读取群组消息的权限。客服在当前 Topic 内直接使用 Telegram“回复”即可转发文字或图片；`/info` 会在当前 Topic 中返回该访客的资料。

Topic 映射由 Durable Object 会话元数据和 `CHAT_CONFIG` KV 反向索引共同维护。浏览器刷新或 WebSocket 重连会复用原 Topic；`SESSION_IDLE_TIMEOUT` 到期后发送会话结束通知并关闭 Topic。

## Webhook 规则

系统只处理 `message` 和 `edited_message` 更新。管理员必须在授权 Supergroup 内回复 Topic 消息；命令和不支持的消息类型会被安全忽略。访客已经断开或 Topic 映射不存在时，Webhook 返回成功但不会发送给浏览器。
