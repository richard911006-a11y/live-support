# Widget

`@live-support/widget` exports `ChatWidget`, `mountChatWidget`, `WebSocketClient`, and `uploadImage`. The widget connects automatically, preserves its temporary visitor ID during reconnects, sends text or supported images, shows connection and delivery states, and clears in-memory state when unmounted.

Configure the WebSocket endpoint with `WebSocketClientOptions`. The default endpoint is `/ws` relative to the embedding page.
