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

安装体验原则：任何需要用户手动查找、复制或猜测配置的步骤，都视为安装体验缺陷，应由工具或系统自动发现并提供可直接使用的结果。

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
- 可选：`TELEGRAM_SETUP_SECRET`（管理接口密钥；未设置时复用 `TELEGRAM_WEBHOOK_SECRET`）

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

## Telegram 快速配置

首次部署时，请按以下步骤准备 Telegram 客服群组：

1. 在 BotFather 创建 Bot，并保存 `TELEGRAM_BOT_TOKEN`。
2. 创建 Telegram 群组并升级为 **Supergroup**。
3. 在群组设置中开启 **Forum Topics**。
4. 将 Bot 加入群组，授予发送消息、读取消息以及创建、管理和关闭 Topic 所需的管理员权限。
5. 在群组中发送一条消息。
6. 确认本地环境中可读取 `TELEGRAM_WEBHOOK_SECRET`（也可为管理接口单独设置可选的 `TELEGRAM_SETUP_SECRET`），并设置 Worker 地址（`WORKER_BASE_URL`、`VITE_WORKER_BASE_URL`，或命令行 `--url`）。
7. 在仓库根目录运行：

   ```bash
   pnpm telegram:setup
   ```

8. 在群组发送消息后，Worker 会缓存聊天信息。工具只显示 `supergroup + Forum Topics`；如果存在多个可用群组，会列出编号供选择，直接回车默认选择第一个。选择后会询问是否写入 `apps/worker/.dev.vars`，只有输入 `Y` 才会写入；其它输入只输出 `TELEGRAM_CHAT_ID`。

该命令使用受 `TELEGRAM_SETUP_SECRET` 或 `TELEGRAM_WEBHOOK_SECRET` 保护的 Worker 管理接口，不调用 `getUpdates`，也不要求用户查看 Cloudflare 日志。

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

## GitHub Actions Secrets

如果希望 GitHub Push 后自动部署 Cloudflare Worker，需要在 GitHub Repository 中配置以下 Repository Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

配置位置：GitHub Repository → Settings → Secrets and variables → Actions → New repository secret。

### `CLOUDFLARE_API_TOKEN`

用途：GitHub Actions 使用 Wrangler 自动部署 Worker。

获取方式：Cloudflare Dashboard → My Profile → API Tokens → Create Token。

推荐权限（最小权限原则）：

- Account → Workers Scripts → Edit
- 如果需要部署 Worker Route，可增加 Zone → Workers Routes → Edit

不要使用 Global API Key。API Token 不应提交到 Git、写入 Workflow 或出现在构建日志中。

### `CLOUDFLARE_ACCOUNT_ID`

用途：指定部署到哪个 Cloudflare Account。

获取方式：Cloudflare Dashboard 首页右侧的 Account ID。

Secrets 不会进入 Git 仓库。Fork 项目后，每位开发者都应配置自己的 Secrets。项目保持完全 Self-hosted，Cloudflare 资源和凭据均由使用者自行管理。

### 常见问题

**Q：GitHub Actions 报错：`In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN...`**

**A：** 说明 Repository Secrets 未配置或名称错误。请按以下步骤排查：

1. 确认当前 Repository 的 Settings → Secrets and variables → Actions 中存在 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。
2. 确认名称大小写和下划线完全一致，没有多余空格。
3. 确认 Secret 配置在当前 Repository，而不是个人账户、其它 Repository 或未被 Workflow 使用的 Environment 中。
4. 确认 API Token 未过期或撤销，并包含 Account → Workers Scripts → Edit 权限。
5. 修正后重新运行 Workflow；不要将 Token 直接写入 YAML、代码或日志。

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
