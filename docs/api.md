# API 说明

本文列出当前 Worker 的公开 HTTP 路由和 WebSocket 协议入口。

公开路由包括：`GET /`、`GET /health`、`GET /version`、`GET /ws`、`POST /images`、`GET /images/<key>` 和 `POST /webhook/telegram`。WebSocket 只接受 JSON 消息，协议定义位于 `packages/types/src/websocket.ts`。

Durable Object 内部路由 `/internal/telegram/reply` 仅供 Worker 的 Telegram Webhook 处理器调用，不属于公开 API。
