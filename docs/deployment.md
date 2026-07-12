# 部署说明

本文介绍 Worker、Pages 及相关 Cloudflare 资源的部署方式。

生产部署使用 `apps/worker/wrangler.jsonc` 中定义的 Wrangler 环境。开发环境使用本地 Durable Object、KV 和 R2 模拟；生产环境使用独立资源，并通过 `pnpm deploy` 部署 Worker。部署前请配置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_ADMIN_CHAT_IDS` 和 `TELEGRAM_WEBHOOK_SECRET` 生产密钥；设置 `TELEGRAM_WEBHOOK_URL` 后，部署钩子会自动注册 Telegram Webhook。

Widget 的 Pages 项目配置位于 `apps/widget/wrangler.jsonc`，可通过 `pnpm deploy:pages` 部署。Pages 与 Worker 可以分开部署；分开部署时，在 Pages 构建环境设置 `VITE_WORKER_BASE_URL`。
