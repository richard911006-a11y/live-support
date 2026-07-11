# Deployment

Production deployment uses Wrangler environments defined in `apps/worker/wrangler.jsonc`.

Development runs with local Durable Objects, KV, and R2 emulation. Production provisions separate resources and deploys the Worker with `pnpm deploy`. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_IDS`, and `TELEGRAM_WEBHOOK_SECRET` as production secrets before deploying. Set `TELEGRAM_WEBHOOK_URL` during deployment so the deploy hook registers Telegram automatically.

The widget Pages project is configured in `apps/widget/wrangler.jsonc` and deploys with `pnpm deploy:pages`.
