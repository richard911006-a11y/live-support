# Widget

`@live-support/widget` exports `ChatWidget`, `mountChatWidget`, `WebSocketClient`, and `uploadImage`. The widget connects automatically, preserves its temporary visitor ID during reconnects, sends text or supported images, shows connection and delivery states, and clears in-memory state when unmounted.

Configure the Worker endpoint with `WebSocketClientOptions`. The default endpoint is `/ws` relative to the embedding page, preserving same-origin behavior for existing integrations. When the Worker is deployed separately, provide its origin through `connection.baseUrl`; the same value is used for both WebSocket connections and image uploads.

```tsx
mountChatWidget(container, {
  connection: {
    baseUrl: 'https://your-worker.workers.dev',
  },
});
```

For Cloudflare Pages deployments, set the build-time environment variable `VITE_WORKER_BASE_URL` to the Worker origin in the Pages project settings. The bootstrap reads that variable first, then falls back to the optional `data-worker-base-url` attribute from `apps/widget/index.html` for embedding and manual testing. If both are empty, same-origin `/ws` and `/images` behavior is preserved.

No `vite.config.ts` change or Pages-specific runtime configuration is required. Vite automatically exposes `VITE_*` variables through `import.meta.env` during the build, so changing the value requires a new Pages deployment.
