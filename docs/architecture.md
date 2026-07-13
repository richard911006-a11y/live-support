# 系统架构

本文介绍 live-support 的整体架构、模块边界和数据流向。

关于 Session、Message、Connection、渠道 Binding 和未来扩展边界，请参阅[Session 中心架构](architecture/session-architecture.md)。

Worker 提供系统状态、图片、WebSocket 和 Telegram Webhook 路由。命名为 `ChatRoom` 的 Durable Object 负责实时访客会话、连接状态和恢复所需的最小会话元数据，并在连接断开或心跳超时后清理运行时连接。浏览器保存临时访客标识，并在网络恢复后使用同一标识重新连接。

Telegram 发送由 `TelegramApiClient` 和 `TelegramService` 统一处理。KV 提供带缓存的关键词自动回复配置，R2 保存经过校验的图片对象。MVP 不持久化聊天记录，也不保存认证状态。
