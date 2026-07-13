import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface TelegramUser {
  readonly id: number;
  readonly first_name: string;
  readonly username?: string;
}

interface TelegramChat {
  readonly id: number;
  readonly type: string;
  readonly title?: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly is_forum?: boolean;
}

interface TelegramMessage {
  readonly chat: TelegramChat;
  readonly message_thread_id?: number;
}

interface TelegramUpdate {
  readonly message?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
  readonly channel_post?: TelegramMessage;
  readonly edited_channel_post?: TelegramMessage;
}

interface ChatSummary {
  readonly chat: TelegramChat;
  readonly hasForumTopic: boolean;
}

type EnvValues = Readonly<Record<string, string>>;

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fetchImplementation = globalThis.fetch.bind(globalThis);

function readLocalEnvFile(path: string, values: Record<string, string>): void {
  if (!existsSync(path)) {
    return;
  }

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2].trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    values[key] ??= value;
  }
}

function loadLocalEnv(): EnvValues {
  const values: Record<string, string> = {};
  readLocalEnvFile(resolve(rootDir, '.env'), values);
  readLocalEnvFile(resolve(rootDir, '.env.local'), values);
  readLocalEnvFile(resolve(rootDir, 'apps', 'worker', '.dev.vars'), values);
  return values;
}

function getConfiguration(name: string, localEnv: EnvValues): string | undefined {
  const processValue = process.env[name]?.trim();
  if (processValue !== undefined && processValue.length > 0) {
    return processValue;
  }

  const localValue = localEnv[name]?.trim();
  return localValue === undefined || localValue.length === 0 ? undefined : localValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function telegramRequest<T>(token: string, method: string): Promise<T> {
  const endpoint = `https://api.telegram.org/bot${token}/${method}`;
  let lastError: unknown = new Error('Telegram API 请求失败');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImplementation(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(method === 'getUpdates' ? { timeout: 0 } : {}),
      });
      const responseText = await response.text();
      let payload: unknown;

      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        throw new Error(`Telegram API 返回了无效 JSON（HTTP ${response.status}）`);
      }

      if (!response.ok) {
        const description =
          isRecord(payload) && typeof payload.description === 'string'
            ? payload.description
            : response.statusText;
        throw new Error(`Telegram API HTTP ${response.status}: ${description}`);
      }

      if (!isRecord(payload) || payload.ok !== true) {
        const description =
          isRecord(payload) && typeof payload.description === 'string'
            ? payload.description
            : '未知错误';
        const errorCode =
          isRecord(payload) && typeof payload.error_code === 'number'
            ? ` (${payload.error_code})`
            : '';
        throw new Error(`Telegram API 错误${errorCode}: ${description}`);
      }

      if (!('result' in payload)) {
        throw new Error('Telegram API 响应缺少 result 字段');
      }

      return payload.result as T;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await wait(500);
      }
    }
  }

  throw new Error(describeUnknownError(lastError));
}

function chatName(chat: TelegramChat): string {
  if (chat.title !== undefined && chat.title.length > 0) {
    return chat.title;
  }

  const personalName = [chat.first_name, chat.last_name].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return personalName.length > 0 ? personalName.join(' ') : '(未命名)';
}

function collectChats(updates: readonly TelegramUpdate[]): ChatSummary[] {
  const summaries = new Map<number, ChatSummary>();
  for (const update of updates) {
    const messages = [
      update.message,
      update.edited_message,
      update.channel_post,
      update.edited_channel_post,
    ].filter((message): message is TelegramMessage => message !== undefined);

    for (const message of messages) {
      const hasForumTopic =
        message.chat.is_forum === true || message.message_thread_id !== undefined;
      const previous = summaries.get(message.chat.id);
      summaries.set(message.chat.id, {
        chat: message.chat,
        hasForumTopic: previous?.hasForumTopic === true || hasForumTopic,
      });
    }
  }

  return [...summaries.values()];
}

function printChatSummary(summary: ChatSummary): void {
  console.log(`Chat Name: ${chatName(summary.chat)}`);
  console.log(`Chat ID: ${summary.chat.id}`);
  console.log(`Type: ${summary.chat.type}`);
  console.log(`Forum Topics: ${summary.hasForumTopic ? '是' : '否/未返回相关字段'}`);

  if (summary.chat.type === 'private') {
    console.log(
      '提示：当前 Bot 正在与私人聊天。Telegram Forum Topic 必须使用 Supergroup + Topics。',
    );
  } else if (summary.chat.type === 'group') {
    console.log('提示：建议将当前群组升级为 Supergroup，并开启 Forum Topics。');
  } else if (summary.chat.type === 'supergroup') {
    console.log('建议把下面 Chat ID 配置到 TELEGRAM_CHAT_ID：');
    console.log(`TELEGRAM_CHAT_ID=${summary.chat.id}`);
    console.log(
      '本项目 Worker 使用 TELEGRAM_ADMIN_CHAT_IDS；多个管理员 Chat ID 可用英文逗号分隔。',
    );
  }

  console.log('');
}

async function main(): Promise<void> {
  const localEnv = loadLocalEnv();
  const token = getConfiguration('TELEGRAM_BOT_TOKEN', localEnv);

  if (token === undefined) {
    console.error(
      '未找到 TELEGRAM_BOT_TOKEN。请设置环境变量，或填写 apps/worker/.dev.vars 后重试。',
    );
    process.exitCode = 1;
    return;
  }

  let bot: TelegramUser;
  try {
    bot = await telegramRequest<TelegramUser>(token, 'getMe');
  } catch (error) {
    console.error(`调用 Telegram getMe 失败：${describeUnknownError(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log('Telegram Bot 配置检查');
  console.log(`Bot 名称: ${bot.first_name}`);
  console.log(`Username: ${bot.username === undefined ? '(未设置)' : `@${bot.username}`}`);
  console.log(`Bot ID: ${bot.id}`);
  console.log('');

  let updates: TelegramUpdate[];
  try {
    updates = await telegramRequest<TelegramUpdate[]>(token, 'getUpdates');
  } catch (error) {
    console.error(`调用 Telegram getUpdates 失败：${describeUnknownError(error)}`);
    console.error(
      '如果当前 Bot 已配置 Webhook，Telegram 可能返回 409；请检查 Webhook 配置后再运行此命令。',
    );
    process.exitCode = 1;
    return;
  }

  const chats = collectChats(updates);
  if (chats.length === 0) {
    console.log('未检测到任何聊天。请先：');
    console.log('- 创建 Telegram 群组');
    console.log('- 将 Bot 拉入群组');
    console.log('- 给 Bot 管理员权限');
    console.log('- 在群组发送一条消息');
    console.log('然后重新运行：pnpm telegram:doctor');
    return;
  }

  console.log(`最近检测到 ${chats.length} 个聊天：`);
  console.log('');
  chats.forEach(printChatSummary);
}

void main().catch((error: unknown) => {
  console.error(`Telegram 配置检查失败：${describeUnknownError(error)}`);
  process.exitCode = 1;
});
