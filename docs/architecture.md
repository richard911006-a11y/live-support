# 系统架构

本文介绍 live-support 的整体架构、模块边界和数据流向。

Worker 提供系统状态、图片、WebSocket 和 Telegram Webhook 路由。命名为 `ChatRoom` 的 Durable Object 负责维护内存中的访客会话，并在连接断开或心跳超时后清理会话。浏览器保存临时访客标识，并在网络恢复后使用同一标识重新连接。

Telegram 发送由 `TelegramApiClient` 和 `TelegramService` 统一处理。KV 提供带缓存的关键词自动回复配置，R2 保存经过校验的图片对象。MVP 不持久化聊天记录，也不保存认证状态。
