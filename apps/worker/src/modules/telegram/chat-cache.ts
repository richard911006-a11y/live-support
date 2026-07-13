import type { TelegramUpdate, TelegramUpdateChat, TelegramUpdateMessage } from './types';

const RECENT_CHATS_KEY = 'telegram:recent-chats';
const RECENT_CHATS_TTL_SECONDS = 24 * 60 * 60;
const MAX_RECENT_CHATS = 20;

export interface RecentTelegramChat {
  readonly chatId: number;
  readonly chatName: string;
  readonly chatType: string;
  readonly isForum: boolean;
  readonly lastSeenAt: number;
}

export interface TelegramChatCacheStore {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export async function cacheTelegramUpdate(
  store: TelegramChatCacheStore,
  update: TelegramUpdate,
): Promise<void> {
  const message = getUpdateMessage(update);
  if (message === undefined) {
    return;
  }

  const chat = message.chat;
  const current: RecentTelegramChat = {
    chatId: chat.id,
    chatName: getChatName(chat),
    chatType: chat.type,
    isForum: chat.is_forum === true || message.message_thread_id !== undefined,
    lastSeenAt: Date.now(),
  };
  const previous = await readRecentTelegramChats(store);
  const chats = [current, ...previous.filter((item) => item.chatId !== current.chatId)].slice(
    0,
    MAX_RECENT_CHATS,
  );

  await store.put(RECENT_CHATS_KEY, JSON.stringify(chats), {
    expirationTtl: RECENT_CHATS_TTL_SECONDS,
  });
}

export async function readRecentTelegramChats(
  store: TelegramChatCacheStore,
): Promise<RecentTelegramChat[]> {
  const value = await store.get(RECENT_CHATS_KEY, 'text');
  if (value === null || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRecentTelegramChat).slice(0, MAX_RECENT_CHATS);
  } catch {
    return [];
  }
}

function getUpdateMessage(update: TelegramUpdate): TelegramUpdateMessage | undefined {
  return update.message ?? update.edited_message;
}

function getChatName(chat: TelegramUpdateChat): string {
  if (chat.title !== undefined && chat.title.length > 0) {
    return chat.title;
  }

  const personalName = [chat.first_name, chat.last_name].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return personalName.length > 0 ? personalName.join(' ') : String(chat.id);
}

function isRecentTelegramChat(value: unknown): value is RecentTelegramChat {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.chatId === 'number' &&
    typeof candidate.chatName === 'string' &&
    typeof candidate.chatType === 'string' &&
    typeof candidate.isForum === 'boolean' &&
    typeof candidate.lastSeenAt === 'number'
  );
}
