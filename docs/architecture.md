# Architecture

The Worker exposes system, image, WebSocket, and Telegram webhook routes. A named `ChatRoom` Durable Object owns in-memory visitor sessions and closes them on disconnect or heartbeat timeout. The browser keeps a temporary visitor ID and reconnects using the same ID.

Telegram delivery is centralized in `TelegramApiClient` and `TelegramService`. KV supplies cached keyword auto-replies, and R2 stores validated images. No chat history or authentication state is persisted.
