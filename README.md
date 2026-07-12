# live-support

> 面向 Cloudflare 的轻量级实时在线客服平台，提供可嵌入的 React 聊天窗口和 Telegram 客服工作流。

[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

## 项目简介

`live-support` 是一个开源的实时客服系统。访客通过嵌入式聊天窗口发送文字或图片，Cloudflare Worker 负责路由和边缘请求，Durable Object 维护浏览器在线期间的临时会话，Telegram Bot 将消息转发给客服人员。项目不保存聊天历史，也不包含认证、后台管理或 AI 功能。

## 功能介绍

- React 响应式客服窗口，支持文字、图片、连接状态和自动重连。
- Durable Object + WebSocket 实时传输，多访客并发，断开后清理内存会话。
- Telegram 多管理员通知及 Reply 回复转发。
- R2 图片对象存储，支持 JPEG、PNG、GIF、WebP，单文件最大 10 MB。
- KV 精确关键词自动回复，配置缓存 60 秒。
- 使用 `request.cf` 收集可用的访客地区和设备信息，并在新会话通知中展示。

## 技术架构

```text
访客浏览器 ── WebSocket/HTTP ── Cloudflare Worker ── Durable Object（临时会话）
                                      ├─ KV（自动回复配置）
                                      ├─ R2（图片对象）
                                      └─ Telegram Bot（客服通知与回复）
```

Worker 负责 HTTP 路由、图片接口和 Telegram Webhook；名为 `ChatRoom` 的 Durable Object 负责内存中的会话与 WebSocket；KV 和 R2 不承担聊天历史或身份认证。

## 技术栈

| 领域       | 技术                                        |
| ---------- | ------------------------------------------- |
| 运行时     | Cloudflare Workers、Node.js 20+             |
| 实时通信   | Durable Objects、WebSocket                  |
| 前端       | React、TypeScript、Vite                     |
| HTTP       | Hono                                        |
| 配置与存储 | Cloudflare KV、Cloudflare R2                |
| 工程化     | pnpm Workspace、Turborepo、Wrangler v4      |
| 质量保障   | TypeScript strict、ESLint、Prettier、Vitest |

## 项目目录

```text
live-support/
├─ apps/
│  ├─ worker/             # Cloudflare Worker、路由、Durable Object、Telegram 集成
│  ├─ widget/             # 可嵌入的 React 客服窗口
│  └─ telegram-bot/       # 预留的 Telegram 应用目录
├─ packages/
│  ├─ shared/             # 预留的跨应用模块
│  ├─ types/              # 共享 TypeScript 类型
│  └─ utils/              # 可复用工具（含图片上传）
├─ docs/                  # 架构、部署和集成说明
├─ scripts/               # 构建与部署脚本
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
└─ eslint.config.js
```

## 安装与开发

环境要求：Node.js 20.19+、pnpm 11+（可通过 Corepack 启用）。

```bash
git clone https://github.com/your-org/live-support.git
cd live-support
corepack enable
pnpm install
pnpm check
```

常用检查命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

本地运行 Worker：

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @live-support/worker dev
```

Widget 使用 Vite 构建：

```bash
pnpm --filter @live-support/widget dev
pnpm --filter @live-support/widget build
```

## 环境变量

以下变量应作为 Wrangler secret 配置在对应环境中：

| 变量                      | 说明                                 |
| ------------------------- | ------------------------------------ |
| `TELEGRAM_BOT_TOKEN`      | Telegram Bot API 令牌                |
| `TELEGRAM_ADMIN_CHAT_IDS` | 管理员 Chat ID，多个值用英文逗号分隔 |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook 请求校验密钥                 |

部署脚本另外读取 `TELEGRAM_WEBHOOK_URL`，它应指向公开的 `/webhook/telegram` 地址，不会写入 Worker 构建产物。

## Cloudflare Worker 部署

Worker 配置位于 `apps/worker/wrangler.jsonc`，包含 `development` 和 `production` 环境、Durable Object、KV、R2 绑定及迁移配置。先完成 Cloudflare 登录和资源准备，再写入 secret：

```bash
pnpm --filter @live-support/worker exec wrangler secret put TELEGRAM_BOT_TOKEN --env production
pnpm --filter @live-support/worker exec wrangler secret put TELEGRAM_ADMIN_CHAT_IDS --env production
pnpm --filter @live-support/worker exec wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
```

部署 Worker：

```bash
pnpm deploy
```

设置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET` 和 `TELEGRAM_WEBHOOK_URL=https://<worker-domain>/webhook/telegram` 后，部署脚本会自动注册 Telegram Webhook。也可以先执行 `pnpm exec wrangler deploy --dry-run --env production` 检查构建。

## Cloudflare Pages 部署

Widget 可以独立托管在 Cloudflare Pages，Worker 可以部署在另一个 `workers.dev` 或自定义域名。Pages 不会自动代理 Worker 的 `/ws`，因此跨域部署时必须在 Pages 项目中设置构建环境变量：

```text
VITE_WORKER_BASE_URL=https://your-worker.workers.dev
```

变量名必须是 `VITE_WORKER_BASE_URL`，并分别配置 Production 和 Preview。Vite 会在构建时注入该变量，不需要修改 `vite.config.ts` 或额外的 Pages 构建配置。变量优先级为：`VITE_WORKER_BASE_URL` → `data-worker-base-url` → 同源默认地址。嵌入现有网站或手动测试时，仍可使用：

```html
<main id="live-support-widget" data-worker-base-url=""></main>
```

或在代码中传入：

```tsx
mountChatWidget(container, {
  connection: { baseUrl: 'https://your-worker.workers.dev' },
});
```

构建并发布 Pages：

```bash
pnpm deploy:pages
```

## Telegram Bot 配置

1. 在 BotFather 创建 Bot，取得 `TELEGRAM_BOT_TOKEN`。
2. 管理员向 Bot 发送 `/start`，从 `getUpdates` 获取 Chat ID。
3. 将一个或多个 Chat ID 写入 `TELEGRAM_ADMIN_CHAT_IDS`。
4. 设置 `TELEGRAM_WEBHOOK_SECRET` 和公开的 `TELEGRAM_WEBHOOK_URL`。
5. 执行 `pnpm deploy` 注册 Webhook。

访客消息会发送给所有管理员；管理员必须使用 Telegram 的“回复”功能，系统才能将文字或图片回复转发给对应访客。访客断开后，回复会被安全忽略。

## Webhook、KV 与 R2

Telegram Webhook 地址为 `/webhook/telegram`，请求必须携带正确的 secret。自动回复配置存放在 KV 绑定 `CHAT_CONFIG` 的 `auto-replies` 键中，值为 JSON 对象，键名采用大小写敏感的精确匹配：

```json
{ "充值": "您好，请联系客服处理充值问题。", "提现": "您好，请联系客服处理提现问题。" }
```

```bash
pnpm --filter @live-support/worker exec wrangler kv key put auto-replies '{"充值":"您好，请联系客服处理充值问题。"}' --binding CHAT_CONFIG --env production
```

图片写入 `CHAT_IMAGES` R2，Worker 不创建数据库记录；成功后通过 `/images/<key>` 提供带缓存头的读取接口。

## 常见问题

**Pages 上连接到了错误的 `/ws`？** 确认 Pages 的 Production/Preview 都设置了 `VITE_WORKER_BASE_URL`，修改变量后重新构建部署。

**Telegram 没有收到通知？** 检查管理员是否先向 Bot 发送 `/start`、Chat ID 是否用逗号分隔、三个 secret 是否配置在同一 Wrangler 环境，并查看 Worker 日志。

**自动回复没有触发？** 确认 KV 键名为 `auto-replies`，值是合法 JSON，且访客消息与关键词完全一致；KV 缓存最多 60 秒刷新一次。

**图片上传失败？** 仅支持 JPEG、PNG、GIF、WebP，文件大小不能超过 10 MB，并确认 R2 绑定可用。

## 开发规范与打包

代码使用严格 TypeScript、现代 ES Modules，禁止 `any`，通过 ESLint 和 Prettier 保持一致风格。应用代码放在 `apps/`，可复用代码放在 `packages/`；不要提交 secret、`.dev.vars`、生成目录或 Cloudflare 凭据。修改后请运行 `pnpm check`，并同步更新相关文档。

生产构建与部署：

```bash
pnpm build
pnpm deploy
pnpm deploy:pages
```

## 路线图

- 已完成：Worker 基础、WebSocket 会话、React Widget、Telegram 通知与回复、R2 图片、KV 自动回复和生产部署基础。
- 计划中：D1 聊天历史、认证、客服后台、多租户、Typing Indicator 和更丰富的可观测性。

详细说明见 [docs/roadmap.md](docs/roadmap.md) 及其他 `docs/` 文档。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
