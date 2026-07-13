import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommand } from './cli.mjs';

interface CheckResult {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workerDir = resolve(rootDir, 'apps', 'worker');
const checks: CheckResult[] = [];

function addCheck(label: string, ok: boolean, detail: string): void {
  checks.push({ label, ok, detail });
}

function hasBinding(config: string, binding: string): boolean {
  return new RegExp(`(?:"binding"|"name")\\s*:\\s*"${binding}"`, 'u').test(config);
}

function runWrangler(args: string[], timeoutMs = 30_000) {
  const localWrangler = resolve(
    rootDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  );
  const direct = existsSync(localWrangler)
    ? runCommand(localWrangler, args, { cwd: workerDir, timeoutMs })
    : runCommand('wrangler', args, { cwd: workerDir, timeoutMs });

  if (existsSync(localWrangler) || direct.ok) {
    return direct;
  }

  return runCommand('pnpm', ['exec', 'wrangler', ...args], { cwd: workerDir, timeoutMs });
}

const nodeMajor = Number(process.versions.node.split('.', 1)[0]);
addCheck(
  'Node.js',
  Number.isFinite(nodeMajor) && nodeMajor >= 20,
  `当前版本 ${process.versions.node}，要求 Node.js 20 或更高版本`,
);

const pnpm = runCommand('pnpm', ['--version'], { cwd: rootDir, timeoutMs: 10_000 });
addCheck(
  'pnpm',
  pnpm.ok,
  pnpm.ok
    ? `版本 ${pnpm.stdout.trim()}`
    : `执行失败：${pnpm.stderr.trim() || pnpm.error?.message || '未找到可用的 pnpm'}`,
);

const wranglerVersion = runWrangler(['--version'], 10_000);
addCheck(
  'Wrangler',
  wranglerVersion.ok,
  wranglerVersion.ok
    ? (wranglerVersion.stdout.trim().split('\n', 1)[0] ?? '可用')
    : '未找到可用的 Wrangler',
);

const git = runCommand('git', ['--version'], { cwd: rootDir, timeoutMs: 10_000 });
addCheck('Git', git.ok, git.ok ? git.stdout.trim() : '未找到 Git');

const whoami = runWrangler(['whoami']);
addCheck(
  'Cloudflare 登录状态',
  whoami.ok,
  whoami.ok ? 'Wrangler 已登录' : '请执行 pnpm exec wrangler login，或配置 API Token',
);

const configPath = resolve(workerDir, 'wrangler.jsonc');
const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
addCheck(
  'Wrangler 配置',
  config.length > 0,
  config.length > 0 ? configPath : '缺少 apps/worker/wrangler.jsonc',
);
addCheck('KV 绑定', hasBinding(config, 'CHAT_CONFIG'), '检查 CHAT_CONFIG 声明');
addCheck('R2 绑定', hasBinding(config, 'CHAT_IMAGES'), '检查 CHAT_IMAGES 声明');
addCheck('Durable Object 绑定', hasBinding(config, 'CHAT_ROOM'), '检查 CHAT_ROOM 声明');

const workflowPath = resolve(rootDir, '.github', 'workflows', 'worker-deploy.yml');
addCheck(
  'GitHub Actions',
  existsSync(workflowPath),
  existsSync(workflowPath) ? 'Worker 自动部署 Workflow 已存在' : '缺少 Worker 自动部署 Workflow',
);

if (whoami.ok) {
  const kv = runWrangler(['kv', 'namespace', 'list']);
  addCheck('Cloudflare KV 资源', kv.ok, kv.ok ? '可以访问 KV 命名空间' : '无法读取 KV 命名空间');

  const r2 = runWrangler(['r2', 'bucket', 'list']);
  addCheck('Cloudflare R2 资源', r2.ok, r2.ok ? '可以访问 R2 Bucket' : '无法读取 R2 Bucket');
}

console.log('\nLive Support 环境检查\n');
for (const check of checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.label}：${check.detail}`);
}

console.log('\nGitHub Actions 无法读取仓库 Secrets，请在 GitHub 中确认：');
console.log('- CLOUDFLARE_API_TOKEN');
console.log('- CLOUDFLARE_ACCOUNT_ID');

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\n发现 ${failures.length} 项需要处理的问题。`);
  process.exitCode = 1;
} else {
  console.log('\n所有本地和 Cloudflare 检查均通过。');
}
