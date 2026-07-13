import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { printCommandOutput, runCommand } from './cli.mjs';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const widgetDir = resolve(rootDir, 'apps', 'widget');
const workerDir = resolve(rootDir, 'apps', 'worker');

function ensureExample(path: string, content: string): void {
  if (existsSync(path)) {
    console.log(`保留已有配置示例：${path}`);
    return;
  }

  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`已生成配置示例：${path}`);
}

console.log('开始检查 Live Support 部署环境...\n');
const doctor = runCommand(process.execPath, ['scripts/run-ts.mjs', 'scripts/doctor.ts'], {
  cwd: rootDir,
  timeoutMs: 120_000,
});
printCommandOutput(doctor);

ensureExample(
  resolve(widgetDir, '.env.example'),
  '# Widget build-time configuration\nVITE_WORKER_BASE_URL=\n',
);

ensureExample(
  resolve(workerDir, '.dev.vars.example'),
  [
    'TELEGRAM_BOT_TOKEN=replace-with-a-local-development-token',
    'TELEGRAM_ADMIN_CHAT_IDS=replace-with-admin-chat-id',
    'TELEGRAM_WEBHOOK_SECRET=replace-with-a-local-development-secret',
    'TELEGRAM_WEBHOOK_URL=https://your-worker.workers.dev/webhook/telegram',
    '',
  ].join('\n'),
);

const configPath = resolve(workerDir, 'wrangler.jsonc');
const configExists = existsSync(configPath);
const configText = configExists ? readFileSync(configPath, 'utf8') : '';

console.log('\nSetup 检查结果：');
console.log(`- wrangler.jsonc：${configExists ? '已找到' : '缺失'}`);
console.log(`- CHAT_CONFIG KV：${/CHAT_CONFIG/u.test(configText) ? '已声明' : '未声明'}`);
console.log(`- CHAT_IMAGES R2：${/CHAT_IMAGES/u.test(configText) ? '已声明' : '未声明'}`);
console.log(`- CHAT_ROOM Durable Object：${/CHAT_ROOM/u.test(configText) ? '已声明' : '未声明'}`);

console.log('\n请填写：');
console.log(`- ${resolve(workerDir, '.dev.vars')}：Telegram Token、管理员 Chat ID、Webhook Secret`);
console.log(`- ${resolve(widgetDir, '.env')}：VITE_WORKER_BASE_URL（跨域部署时填写 Worker 地址）`);
console.log('- GitHub Secrets：CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID');
console.log('\nSetup 完成。已有配置不会被覆盖。');
