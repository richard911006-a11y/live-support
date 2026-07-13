import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { printCommandOutput, runCommand } from './cli.mjs';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

function runStep(label: string, args: string[]): string {
  console.log(`\n▶ ${label}`);
  const result = runCommand('pnpm', args, { cwd: rootDir, timeoutMs: 15 * 60 * 1000 });
  printCommandOutput(result);

  if (!result.ok) {
    throw new Error(`${label} 失败。`);
  }

  return `${result.stdout}\n${result.stderr}`;
}

const widgetOutput = runStep('构建 Widget', ['--filter', '@live-support/widget', 'build']);
runStep('构建 Worker', ['--filter', '@live-support/worker', 'build']);
const deployOutput = runStep('部署 production Worker', [
  '--filter',
  '@live-support/worker',
  'deploy',
]);

const config = readFileSync(resolve(rootDir, 'apps', 'worker', 'wrangler.jsonc'), 'utf8');
const productionName = /"production"[\s\S]*?"name"\s*:\s*"([^"]+)"/u.exec(config)?.[1];
const workerUrl =
  productionName === undefined ? undefined : `https://${productionName}.workers.dev`;
const detectedWorkerUrl = /(https:\/\/[^\s]+\.workers\.dev)/u.exec(deployOutput)?.[1] ?? workerUrl;

console.log('\n部署完成。');
console.log(`Widget 构建产物：${resolve(rootDir, 'apps', 'widget', 'public')}`);
console.log(`Pages 地址：${process.env.PAGES_URL ?? '由 Cloudflare Pages GitHub 集成提供'}`);
console.log(`Worker 地址：${detectedWorkerUrl ?? '请从 Wrangler 输出中查看'}`);
console.log(
  `Webhook：${
    process.env.TELEGRAM_WEBHOOK_URL ??
    `${detectedWorkerUrl ?? 'https://your-worker.workers.dev'}/webhook/telegram`
  }`,
);
console.log(
  '如果设置了 TELEGRAM_WEBHOOK_URL、TELEGRAM_BOT_TOKEN 和 TELEGRAM_WEBHOOK_SECRET，Worker 部署脚本会尝试自动注册 Webhook。',
);

void widgetOutput;
