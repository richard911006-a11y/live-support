# live-support

> A lightweight, realtime customer support platform designed for the Cloudflare ecosystem.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

`live-support` is an open source foundation for building customer support experiences with an embeddable web widget, realtime conversations, and Telegram-based service workflows. The project is intentionally optimized for a small operational footprint, edge deployment, and a modular codebase that can grow without coupling product surfaces together.

## Project status

The repository includes the production MVP runtime: a Cloudflare Worker, in-memory Durable Object sessions, WebSocket transport, React widget, Telegram administrator notification/reply flow, R2 image delivery, request metadata collection, and KV keyword auto-replies. D1 persistence, authentication, and a dashboard remain deliberately outside MVP scope.

## Architecture overview

The planned architecture separates deployable applications from reusable packages:

```text
Customer browser                           Support team
       |                                       |
Embeddable widget                        Telegram bot
       |                                       |
       +---------- Cloudflare Worker ----------+
                          |
                  Durable Objects
                  (realtime sessions)
                     /          \
                   KV            R2
             (configuration) (image objects)
```

The Worker owns HTTP routing and Telegram webhook handling. A single named Durable Object coordinates in-memory visitor sessions and WebSockets. KV stores auto-reply configuration, while R2 stores image objects without database records.

## Technology stack

| Area             | Technology                           | Planned responsibility                        |
| ---------------- | ------------------------------------ | --------------------------------------------- |
| Runtime          | Cloudflare Workers                   | Edge-hosted backend application               |
| Realtime         | Durable Objects and WebSocket        | Stateful conversation coordination            |
| Database         | None in MVP                          | Intentionally no persistent chat history      |
| Configuration    | Cloudflare KV                        | Keyword auto-reply JSON                       |
| Storage          | Cloudflare R2                        | Customer and administrator image objects      |
| HTTP framework   | Hono                                 | Typed Worker routing and middleware           |
| Customer service | Telegram Bot                         | Support agent conversation interface          |
| Frontend         | React, TypeScript, CSS               | Customer-facing chat experience               |
| Tooling          | pnpm, Turborepo, Wrangler v4         | Workspace, task orchestration, and deployment |
| Quality          | TypeScript, ESLint, Prettier, Vitest | Static analysis, formatting, and testing      |

## Repository structure

```text
live-support/
├── apps/
│   ├── telegram-bot/    # Future Telegram customer service application
│   ├── widget/          # Embeddable React chat widget and transport
│   └── worker/          # Cloudflare Worker, realtime, and Telegram routes
├── packages/
│   ├── shared/          # Future cross-application primitives
│   ├── types/           # Shared TypeScript contracts
│   └── utils/           # Reusable transport utilities
├── docs/                # Product and engineering documentation
├── scripts/             # Future repository automation
├── .github/             # Future GitHub project configuration
├── eslint.config.js     # Shared ESLint flat configuration
├── pnpm-workspace.yaml  # Workspace package discovery and dependency catalog
├── tsconfig.base.json   # Strict shared TypeScript settings
└── turbo.json           # Monorepo task graph
```

Each application and package remains independently deployable or reusable; source files are added only to the package that owns each capability.

## Development guide

### Prerequisites

- Node.js 20.19 or newer
- Corepack or pnpm 11 or newer

### Installation

```bash
git clone https://github.com/your-org/live-support.git
cd live-support
corepack enable
pnpm install
```

### Repository checks

```bash
pnpm check
```

The individual commands are also available:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Run the Worker locally with:

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @live-support/worker dev
```

Build and development tasks are orchestrated through Turborepo. The Worker build validates the production Wrangler configuration and produces a dry-run bundle, while the widget build performs a strict TypeScript check.

### Required environment variables

Set these as Wrangler secrets for both environments:

| Variable                  | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | Telegram Bot API token                        |
| `TELEGRAM_ADMIN_CHAT_IDS` | Comma-separated administrator chat IDs        |
| `TELEGRAM_WEBHOOK_SECRET` | Secret header used to verify webhook requests |

`TELEGRAM_WEBHOOK_URL` is used by the deployment hook and should point to the public `/webhook/telegram` endpoint. It is not stored in the Worker bundle.

### Cloudflare deployment

Wrangler environments are defined in [apps/worker/wrangler.jsonc](apps/worker/wrangler.jsonc):

- `development` uses local Durable Objects, KV, and R2 emulation.
- `production` uses separately named Cloudflare resources. Missing resource IDs are intentionally left for Wrangler to provision on the first authenticated deploy.

Set production secrets, then deploy the Worker:

```bash
pnpm --filter @live-support/worker exec wrangler secret put TELEGRAM_BOT_TOKEN --env production
pnpm --filter @live-support/worker exec wrangler secret put TELEGRAM_ADMIN_CHAT_IDS --env production
pnpm --filter @live-support/worker exec wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
TELEGRAM_BOT_TOKEN=<bot-token> TELEGRAM_WEBHOOK_SECRET=<webhook-secret> TELEGRAM_WEBHOOK_URL=https://<worker-domain>/webhook/telegram pnpm deploy
```

`pnpm deploy` runs the production Worker deploy and automatically registers the Telegram webhook when `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_WEBHOOK_URL` are available.

### KV configuration

The auto-reply service reads the `auto-replies` key as JSON from `CHAT_CONFIG`:

```json
{ "充值": "您好，请联系客服处理充值问题。", "提现": "您好，请联系客服处理提现问题。" }
```

Upload the configuration with Wrangler:

```bash
pnpm --filter @live-support/worker exec wrangler kv key put auto-replies '{"充值":"您好，请联系客服处理充值问题。"}' --binding CHAT_CONFIG --env production
```

The Worker caches the configuration in memory for 60 seconds and forwards unmatched messages to Telegram.

### R2 image storage

`CHAT_IMAGES` is provisioned by Wrangler per environment. The Worker validates JPEG, PNG, GIF, and WebP uploads up to 10 MB, retries an R2 write once, and serves successful objects at `/images/<key>` with immutable caching headers. No database record is created.

### Pages deployment

The widget package includes a Vite build, Pages configuration, and a generated deployment surface under `apps/widget/public`. Deploy it after authenticating Wrangler and creating the `live-support-widget` Pages project:

```bash
pnpm deploy:pages
```

Cloudflare Pages and the Worker can be deployed independently. Same-origin deployments continue to use `/ws` and `/images` automatically. If Pages and the Worker use different domains, initialize the widget with the Worker origin so both WebSocket and image requests target the Worker:

```tsx
mountChatWidget(container, {
  connection: {
    baseUrl: 'https://your-worker.workers.dev',
  },
});
```

For the included demo, set `data-worker-base-url` in `apps/widget/index.html` to the Worker origin. The bootstrap page passes that value into `mountChatWidget()`; no Worker URL is hardcoded in the source. The React widget remains available as the reusable `@live-support/widget` package for embedding in an existing site.

For Cloudflare Pages, the recommended deployment-time configuration is the build environment variable `VITE_WORKER_BASE_URL`. Set it in the Pages project under Settings → Environment variables for the Production or Preview environment, for example:

```text
VITE_WORKER_BASE_URL=https://your-worker.workers.dev
```

The bootstrap priority is `VITE_WORKER_BASE_URL`, then `data-worker-base-url`, then same-origin defaults. Vite injects the value at build time; no `vite.config.ts` or additional Pages build configuration is required. Deploy again after changing the variable. `data-worker-base-url` remains available for embedding and manual testing.

### Telegram workflow

Customer text and image messages are delivered to every configured administrator. The first non-auto-replied message in a connected session includes website, visitor, Cloudflare location, timezone, language, device, browser, network, user agent, and connection time metadata. Telegram replies only forward when the administrator uses Telegram Reply; disconnected visitors are ignored safely.

## Coding standards

- Use strict TypeScript and modern ECMAScript modules.
- Do not introduce `any`; model boundaries explicitly and narrow unknown input safely.
- Keep deployable applications isolated under `apps/` and reusable code under `packages/`.
- Prefer small modules with a single responsibility and explicit public contracts.
- Format all supported files with Prettier and keep ESLint free of warnings.
- Add Vitest coverage with every behavior introduced in a future phase.
- Never commit secrets, local Wrangler variables, generated output, or Cloudflare credentials.
- Keep architecture and operational documentation synchronized with implementation changes.

## Roadmap

| Phase | Scope                                                              | Status   |
| ----- | ------------------------------------------------------------------ | -------- |
| 0     | Repository initialization and engineering standards                | Complete |
| 1     | Core domain contracts and Cloudflare Worker foundation             | Complete |
| 2     | Realtime conversations with Durable Objects and WebSocket          | Complete |
| 3     | D1 persistence and conversation lifecycle                          | Planned  |
| 4     | Embeddable customer widget                                         | Complete |
| 5     | Telegram customer service integration                              | Complete |
| 6     | Automation, media storage, observability, and production hardening | Complete |

See [docs/roadmap.md](docs/roadmap.md) for the roadmap document that will evolve with the project.

## Future features

- D1-backed conversation history
- Authentication and operator dashboard
- Typing indicators and richer read status
- Configurable welcome messages
- Multi-tenant account management
- Additional observability integrations

## Contributing

Contributions will be welcomed as implementation phases begin. Before opening a change, run `pnpm check`, keep the change within one architectural concern, and update relevant documentation. Contribution guidelines and governance documents will be added before the first functional release.

## License

This project is released under the [MIT License](LICENSE).
