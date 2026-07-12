# Widget 使用说明

本文介绍可嵌入的 React 客服 Widget 及其连接配置。

`@live-support/widget` 导出 `ChatWidget`、`mountChatWidget`、`WebSocketClient` 和 `uploadImage`。Widget 会自动连接，在重连时保留临时访客标识，支持发送文字和受支持的图片，并显示连接状态与消息发送状态。组件卸载时会清理内存状态。

可以通过 `WebSocketClientOptions` 配置 Worker 地址。默认端点为嵌入页面同源的 `/ws`，以保持现有集成兼容性。当 Worker 单独部署时，将 Worker 源地址传入 `connection.baseUrl`；该地址同时用于 WebSocket 和图片上传。

```tsx
mountChatWidget(container, {
  connection: {
    baseUrl: 'https://your-worker.workers.dev',
  },
});
```

使用 Cloudflare Pages 部署时，建议在 Pages 项目设置中配置构建时环境变量 `VITE_WORKER_BASE_URL`。Bootstrap 会优先读取该变量，然后读取 `apps/widget/index.html` 中可选的 `data-worker-base-url` 属性，最后回退到同源 `/ws` 和 `/images`。

Vite 会在构建时注入 `VITE_*` 变量，因此修改 Worker 地址后必须重新部署 Pages。无需额外修改 `vite.config.ts` 或增加运行时配置。
