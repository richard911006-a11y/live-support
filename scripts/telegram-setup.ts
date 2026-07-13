import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SetupResponse {
  readonly ok: boolean;
  readonly bot: { readonly id: number; readonly name: string; readonly username: string | null };
  readonly telegramChatId: string | null;
  readonly recentChats: readonly RecentChat[];
}

interface RecentChat {
  readonly chatId: number;
  readonly chatName: string;
  readonly chatType: string;
  readonly isForum: boolean;
  readonly lastSeenAt: number;
}

type EnvValues = Readonly<Record<string, string>>;

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workerVarsPath = resolve(rootDir, 'apps', 'worker', '.dev.vars');
const fetchImplementation = globalThis.fetch.bind(globalThis);

function loadEnvFile(path: string, values: Record<string, string>): void {
  if (!existsSync(path)) {
    return;
  }

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (match === null || line.startsWith('#')) {
      continue;
    }

    const rawValue = match[2].trim();
    values[match[1]] =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
  }
}

function loadLocalEnv(): EnvValues {
  const values: Record<string, string> = {};
  for (const path of [
    resolve(rootDir, '.env'),
    resolve(rootDir, '.env.local'),
    resolve(rootDir, 'apps', 'widget', '.env'),
    resolve(rootDir, 'apps', 'widget', '.env.local'),
    resolve(rootDir, 'apps', 'worker', '.dev.vars'),
  ]) {
    loadEnvFile(path, values);
  }
  return values;
}

function getValue(name: string, env: EnvValues): string | undefined {
  const processValue = process.env[name]?.trim();
  if (processValue !== undefined && processValue.length > 0) {
    return processValue;
  }

  const localValue = env[name]?.trim();
  return localValue === undefined || localValue.length === 0 ? undefined : localValue;
}

function getArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === undefined || value.startsWith('-') ? undefined : value;
}

function getWorkerUrl(env: EnvValues): string | undefined {
  return (
    getArgument('--url') ??
    getValue('LIVE_SUPPORT_WORKER_URL', env) ??
    getValue('WORKER_BASE_URL', env) ??
    getValue('VITE_WORKER_BASE_URL', env)
  );
}

function isSetupResponse(value: unknown): value is SetupResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.ok === true &&
    typeof candidate.bot === 'object' &&
    candidate.bot !== null &&
    Array.isArray(candidate.recentChats)
  );
}

function printChat(chat: RecentChat): void {
  console.log(`Chat Name: ${chat.chatName}`);
  console.log(`Chat ID: ${chat.chatId}`);
  console.log(`Chat Type: ${chat.chatType}`);
  console.log(`Forum Topics: ${chat.isForum ? 'Yes' : 'No'}`);
  console.log('');
}

function printNoAvailableChats(): void {
  console.log('没有发现支持 Forum Topics 的 Supergroup。');
  console.log('请：');
  console.log('1. 创建 Supergroup');
  console.log('2. 开启 Forum Topics');
  console.log('3. 将 Bot 加为管理员');
  console.log('4. 在群组发送任意消息');
  console.log('5. 重新运行：pnpm telegram:setup');
}

async function selectChat(chats: readonly RecentChat[]): Promise<RecentChat> {
  const firstChat = chats[0];
  if (firstChat === undefined) {
    throw new Error('没有可选择的 Telegram 聊天。');
  }
  if (chats.length === 1) {
    return firstChat;
  }

  console.log('------------------------------------------------');
  console.log('发现以下可用聊天：');
  console.log('');
  chats.forEach((chat, index) => {
    console.log(`[${index + 1}]`);
    printChat(chat);
  });
  console.log('------------------------------------------------');

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return firstChat;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await readline.question('请选择作为 Live Support 客服群组：');
      const trimmed = answer.trim();
      if (trimmed.length === 0) {
        return firstChat;
      }

      const selectedIndex = Number(trimmed);
      if (Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= chats.length) {
        return chats[selectedIndex - 1] ?? firstChat;
      }

      console.log('输入无效，请输入列表中的编号。');
    }
  } finally {
    readline.close();
  }
}

function updateEnvFile(path: string, chatId: string): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = existing.length === 0 ? [] : existing.split(/\r?\n/u);
  const keys = ['TELEGRAM_CHAT_ID', 'TELEGRAM_ADMIN_CHAT_IDS'];

  for (const key of keys) {
    const lineIndex = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`, 'u').test(line));
    if (lineIndex >= 0) {
      if (key === 'TELEGRAM_ADMIN_CHAT_IDS') {
        const currentValue = lines[lineIndex]?.split('=').slice(1).join('=').trim() ?? '';
        const currentIds = currentValue
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (!currentIds.includes(chatId)) {
          currentIds.push(chatId);
        }
        lines[lineIndex] = `${key}=${currentIds.join(',')}`;
      } else {
        lines[lineIndex] = `${key}=${chatId}`;
      }
    } else {
      lines.push(`${key}=${chatId}`);
    }
  }

  writeFileSync(
    path,
    `${lines.filter((line, index) => index < lines.length - 1 || line !== '').join('\n')}\n`,
    'utf8',
  );
}

async function askToWrite(chat: RecentChat): Promise<void> {
  const chatId = String(chat.chatId);
  console.log('');
  console.log('将使用：');
  console.log(`Chat Name: ${chat.chatName}`);
  console.log(`Chat ID: ${chatId}`);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`TELEGRAM_CHAT_ID=${chatId}`);
    return;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question('是否写入开发配置？ (Y/n) ');
    if (/^y$/iu.test(answer.trim())) {
      updateEnvFile(workerVarsPath, chatId);
      console.log(`已写入 ${workerVarsPath}`);
    } else {
      console.log(`TELEGRAM_CHAT_ID=${chatId}`);
    }
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  const env = loadLocalEnv();
  const workerUrl = getWorkerUrl(env)?.replace(/\/$/u, '');
  const secret = getValue('TELEGRAM_SETUP_SECRET', env) ?? getValue('TELEGRAM_WEBHOOK_SECRET', env);

  if (workerUrl === undefined) {
    console.error(
      '未找到 Worker 地址。请设置 WORKER_BASE_URL，或使用 --url https://your-worker.workers.dev。',
    );
    process.exitCode = 1;
    return;
  }
  if (secret === undefined) {
    console.error('未找到 TELEGRAM_WEBHOOK_SECRET（或 TELEGRAM_SETUP_SECRET）。');
    process.exitCode = 1;
    return;
  }

  let response: Response;
  try {
    response = await fetchImplementation(`${workerUrl}/admin/telegram/config`, {
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch (error) {
    console.error(`无法连接 Worker：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const payload = (await response.json()) as unknown;
  if (!response.ok || !isSetupResponse(payload)) {
    console.error(`Worker 配置接口返回 HTTP ${response.status}，请确认 Worker 地址和 Secret。`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Bot: ${payload.bot.name}${payload.bot.username === null ? '' : ` (@${payload.bot.username})`}`,
  );
  console.log(`Bot ID: ${payload.bot.id}`);
  console.log('');

  if (payload.recentChats.length === 0) {
    printNoAvailableChats();
    return;
  }

  const availableChats = payload.recentChats.filter(
    (chat) => chat.chatType === 'supergroup' && chat.isForum,
  );
  if (availableChats.length === 0) {
    printNoAvailableChats();
    return;
  }

  const selectedChat = await selectChat(availableChats);
  await askToWrite(selectedChat);
}

void main().catch((error: unknown) => {
  console.error(`Telegram 配置失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
