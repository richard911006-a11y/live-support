# live-support

> A lightweight, realtime customer support platform designed for the Cloudflare ecosystem.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

`live-support` is an open source foundation for building customer support experiences with an embeddable web widget, realtime conversations, and Telegram-based service workflows. The project is intentionally optimized for a small operational footprint, edge deployment, and a modular codebase that can grow without coupling product surfaces together.

## Project status

The repository is currently at **Phase 0: Repository Initialization**. It contains workspace, quality, and documentation scaffolding only. No application runtime, API, database schema, Worker, widget, Telegram bot, WebSocket implementation, authentication, or Cloudflare binding is included yet.

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
                   D1            R2
             (application data) (future media)
```

This diagram describes the target direction only. Phase 0 does not implement any component or integration shown above.

## Technology stack

| Area             | Technology                           | Planned responsibility                        |
| ---------------- | ------------------------------------ | --------------------------------------------- |
| Runtime          | Cloudflare Workers                   | Edge-hosted backend application               |
| Realtime         | Durable Objects and WebSocket        | Stateful conversation coordination            |
| Database         | Cloudflare D1                        | Relational application data                   |
| Storage          | Cloudflare R2                        | Future image and attachment storage           |
| HTTP framework   | Hono                                 | Typed Worker routing and middleware           |
| Customer service | Telegram Bot                         | Support agent conversation interface          |
| Frontend         | TypeScript embeddable widget         | Customer-facing chat experience               |
| Tooling          | pnpm, Turborepo, Wrangler v4         | Workspace, task orchestration, and deployment |
| Quality          | TypeScript, ESLint, Prettier, Vitest | Static analysis, formatting, and testing      |

## Repository structure

```text
live-support/
├── apps/
│   ├── telegram-bot/    # Future Telegram customer service application
│   ├── widget/          # Future embeddable customer widget
│   └── worker/          # Future Cloudflare Worker application
├── packages/
│   ├── shared/          # Future cross-application primitives
│   ├── types/           # Future shared TypeScript contracts
│   └── utils/           # Future reusable utilities
├── docs/                # Product and engineering documentation
├── scripts/             # Future repository automation
├── .github/             # Future GitHub project configuration
├── eslint.config.js     # Shared ESLint flat configuration
├── pnpm-workspace.yaml  # Workspace package discovery and dependency catalog
├── tsconfig.base.json   # Strict shared TypeScript settings
└── turbo.json           # Monorepo task graph
```

Each application and package directory currently contains metadata only. Source files will be introduced in the phase that owns the corresponding capability.

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

Build and development tasks are orchestrated through Turborepo. During Phase 0, workspace packages intentionally define no runtime tasks, so these commands complete without generating application artifacts.

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
| 1     | Core domain contracts and Cloudflare Worker foundation             | Planned  |
| 2     | Realtime conversations with Durable Objects and WebSocket          | Planned  |
| 3     | D1 persistence and conversation lifecycle                          | Planned  |
| 4     | Embeddable customer widget                                         | Planned  |
| 5     | Telegram customer service integration                              | Planned  |
| 6     | Automation, media storage, observability, and production hardening | Planned  |

See [docs/roadmap.md](docs/roadmap.md) for the roadmap document that will evolve with the project.

## Future features

- Realtime customer-to-agent chat
- Telegram-based customer service workflows
- Multiple customer service accounts
- Typing indicators and read status
- Configurable welcome messages
- Keyword-based automatic replies
- Image uploads backed by Cloudflare R2
- Repeatable Cloudflare deployment

## Contributing

Contributions will be welcomed as implementation phases begin. Before opening a change, run `pnpm check`, keep the change within one architectural concern, and update relevant documentation. Contribution guidelines and governance documents will be added before the first functional release.

## License

This project is released under the [MIT License](LICENSE).
