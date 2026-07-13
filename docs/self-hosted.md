# 自托管部署

live-support 是一个开源、自托管的在线客服平台。部署者使用自己的 Cloudflare 账户、Telegram Bot、KV Namespace、R2 Bucket 和 Durable Object，不依赖项目维护者的在线服务。

## 1. 部署前提

- Node.js 20.19 或更高版本。
- pnpm 11 或更高版本。
- 一个 Cloudflare 账户。
- 一个 Telegram Bot。
- 一个用于管理员客服的 Telegram Supergroup，并开启 Forum Topics。
- GitHub 仓库（如果需要 GitHub Actions 自动部署）。

## 2. 快速部署

在仓库根目录执行：

```bash
pnpm install
pnpm doctor
pnpm setup
pnpm deploy
```

脚本职责：

| 命令          | 作用                                             |
| ------------- | ------------------------------------------------ |
| `pnpm doctor` | 检查本地工具、Wrangler 登录、配置和绑定          |
| `pnpm setup`  | 创建缺失的配置示例并提示人工配置项               |
| `pnpm deploy` | 构建 Widget、构建 Worker、部署 production Worker |

脚本不会覆盖现有 `.env`、`.dev.vars` 或 Wrangler 配置，也不会自动删除 Cloudflare 资源。

## 3. 配置文件和 Secrets

Widget 本地配置示例：

```text
apps/widget/.env.example
```

跨域部署时设置：

```text
VITE_WORKER_BASE_URL=https://your-worker.workers.dev
```

Worker 本地配置示例：

```text
apps/worker/.dev.vars.example
```

需要填写：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_IDS`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_URL`

生产环境使用 Wrangler Secret 配置这些值，不要提交到 Git。

## 4. Cloudflare Worker

Worker 配置文件：

```text
apps/worker/wrangler.jsonc
```

该配置包含：

- production 和 development 环境；
- ChatRoom Durable Object；
- `CHAT_CONFIG` KV；
- `CHAT_IMAGES` R2；
- Durable Object migration；
- `SESSION_IDLE_TIMEOUT`。

部署前可以执行：

```bash
pnpm --filter @live-support/worker exec wrangler deploy --dry-run --env production
```

## 5. Telegram 配置

1. 使用 BotFather 创建 Bot。
2. 让管理员向 Bot 发送 `/start`。
3. 获取管理员 Supergroup Chat ID。
4. 将 Chat ID 写入 `TELEGRAM_ADMIN_CHAT_IDS`，多个 ID 使用英文逗号分隔。
5. 开启 Supergroup Forum Topics。
6. 授予 Bot 创建、发送和关闭 Topic 的权限。
7. 设置 Webhook Secret 和 Webhook URL。

每个 Session 会绑定一个 Telegram Topic。浏览器刷新、WebSocket 重连或 Worker 重启不会重新创建 Topic；Session 超时后会关闭 Topic。

## 6. Cloudflare Pages

Widget 可以独立部署到 Cloudflare Pages。Pages 不会自动代理 Worker 的 `/ws`，因此跨域部署时必须配置构建环境变量：

```text
VITE_WORKER_BASE_URL=https://your-worker.workers.dev
```

Pages 项目中应同时配置 Production 和 Preview 环境变量，然后重新构建部署 Widget。

本地或手动部署：

```bash
pnpm deploy:pages
```

## 7. GitHub Actions

GitHub Actions 需要配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`main` 分支 Push 时，Worker Workflow 会：

1. 安装依赖；
2. 执行 TypeScript 检查；
3. 执行测试；
4. 构建 Worker；
5. 部署 production Worker。

Pages 继续使用 Cloudflare Pages 的 GitHub 集成部署。其它分支只执行 CI，不部署 Worker。

## 8. 升级流程

```bash
git pull
pnpm install
pnpm doctor
pnpm check
pnpm deploy
```

升级前应先执行 Worker dry-run，确认绑定和 Durable Object migration 没有异常。

## 9. 回滚流程

优先使用 Cloudflare Dashboard 的 Worker Versions 回滚到上一个稳定版本。

如果代码版本也需要回退：

```bash
git checkout <known-good-commit>
pnpm install
pnpm deploy
```

不要删除 Durable Object、KV 或 R2 资源来进行回滚，否则可能丢失 Topic 映射和图片对象。

## 10. 迁移流程

迁移到新的 Cloudflare 账户时：

1. 在新账户创建 KV Namespace。
2. 创建 R2 Bucket。
3. 使用新的资源 ID 更新 Wrangler 配置。
4. 部署 Worker 并执行 migration。
5. 配置新的 Worker Secrets。
6. 配置 Pages 的 `VITE_WORKER_BASE_URL`。
7. 更新 Telegram Webhook URL。

如果需要保留旧会话和旧图片，应先规划 KV/R2 数据迁移，再切换 DNS 或 Pages 配置。

## 11. 常见问题

### `pnpm doctor` 提示未登录

执行：

```bash
pnpm exec wrangler login
```

CI 环境不使用交互式登录，而是配置 GitHub Secrets。

### Widget 仍连接 Pages 域名

确认 Pages 的 Production 和 Preview 都配置了 `VITE_WORKER_BASE_URL`，并重新触发构建。该变量在 Vite 构建时注入。

### Telegram 没有收到 Topic 消息

确认管理员聊天是 Supergroup、Forum Topics 已开启、Bot 拥有 Topic 权限，并且 `TELEGRAM_ADMIN_CHAT_IDS` 使用了正确的 Chat ID。

### 图片上传失败

确认 `CHAT_IMAGES` R2 绑定存在、文件类型受支持且大小不超过 10 MB。

### GitHub Actions 无法读取 Secrets

脚本无法读取 GitHub 仓库 Secrets。请在仓库 Settings → Secrets and variables → Actions 中手动配置 Cloudflare Secrets。
