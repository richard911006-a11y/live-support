# API

Public routes are `GET /`, `GET /health`, `GET /version`, `GET /ws`, `POST /images`, `GET /images/<key>`, and `POST /webhook/telegram`. WebSocket payloads are JSON-only and are defined in `packages/types/src/websocket.ts`.

The Durable Object internal route `/internal/telegram/reply` is only used by the Worker webhook handler and is not a public API.
