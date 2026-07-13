import type { SessionId, TelegramChatId, VisitorId } from '@live-support/types';

import type { Env } from '../../types/env';
import type { VisitorInfo } from '../../types';
import { logger as defaultLogger, type Logger } from '../../utils/logger';
import { TelegramApiClient } from './client';
import { TelegramApiError } from './client';
import type { TelegramApiClientOptions } from './client';
import type { TelegramUser } from './types';

const TOPIC_INDEX_PREFIX = 'telegram-topic:';
const SESSION_INDEX_PREFIX = 'telegram-session:';
const TOPIC_INDEX_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface TelegramTopic {
  readonly chatId: TelegramChatId;
  readonly messageThreadId: number;
  readonly sessionId: SessionId;
  readonly visitorId: VisitorId;
  readonly createdAt: number;
}

export interface TelegramTopicBinding {
  readonly sessionId: SessionId;
  readonly visitorId: VisitorId;
}

/** Resolves the forward Session/Visitor-to-Topic binding kept by ChatRoom. */
export function findTopicForVisitor(
  topics: readonly TelegramTopic[],
  visitorId: VisitorId,
  chatId?: TelegramChatId,
): TelegramTopic | undefined {
  return topics.find(
    (topic) => topic.visitorId === visitorId && (chatId === undefined || topic.chatId === chatId),
  );
}

export function findTopicForSession(
  topics: readonly TelegramTopic[],
  sessionId: SessionId,
  chatId?: TelegramChatId,
): TelegramTopic | undefined {
  return topics.find(
    (topic) => topic.sessionId === sessionId && (chatId === undefined || topic.chatId === chatId),
  );
}

interface TopicIndexStore {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface TelegramServiceOptions extends TelegramApiClientOptions {
  client?: TelegramApiClient;
  logger?: Logger;
}

export function parseAdminChatIds(value: string | undefined): TelegramChatId[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((chatId) => chatId.trim())
        .filter((chatId) => chatId.length > 0),
    ),
  ] as TelegramChatId[];
}

export function isConfiguredAdminChat(chatId: number, value: string | undefined): boolean {
  return parseAdminChatIds(value).includes(String(chatId) as TelegramChatId);
}

export function formatVisitorLabel(visitorId: VisitorId): string {
  let hash = 0;

  for (const character of visitorId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return `#${1000 + (hash % 9000)}`;
}

/** Builds a stable, privacy-safe Telegram topic title for one Session. */
export function formatTopicName(visitorInfo: VisitorInfo): string {
  const website = sanitizeTopicPart(visitorInfo.website) ?? 'live-support';
  const nickname =
    sanitizeTopicPart(visitorInfo.nickname) ??
    `visitor-${formatVisitorLabel(visitorInfo.visitorId).slice(1)}`;

  return `${website}｜${nickname}`.slice(0, 128);
}

export function formatCustomerMessage(
  visitorId: VisitorId,
  message: string,
  visitorInfo?: VisitorInfo,
): string {
  if (visitorInfo !== undefined) {
    return [
      ...formatVisitorInfo(visitorInfo),
      '',
      '访客消息',
      '',
      message,
      '--------------------------------',
    ].join('\n');
  }

  return [
    '--------------------------------',
    '网站',
    '',
    'live-support',
    '',
    '访客',
    '',
    visitorId,
    '',
    '访客消息',
    '',
    message,
    '--------------------------------',
  ].join('\n');
}

export function formatCustomerImageCaption(
  visitorId: VisitorId,
  caption?: string,
  visitorInfo?: VisitorInfo,
): string {
  if (visitorInfo !== undefined) {
    return [
      ...formatVisitorInfo(visitorInfo),
      '',
      '图片',
      '',
      caption ?? '访客图片',
      '--------------------------------',
    ].join('\n');
  }

  return [
    '--------------------------------',
    '网站',
    '',
    'live-support',
    '',
    '访客',
    '',
    visitorId,
    '',
    '图片',
    '',
    caption ?? '访客图片',
    '--------------------------------',
  ].join('\n');
}

/** Sends customer updates to every configured administrator chat. */
export class TelegramService {
  private readonly client: TelegramApiClient;
  private readonly logger: Logger;
  private readonly adminChatIds: readonly TelegramChatId[];
  private readonly enabled: boolean;
  private readonly topicIndex: TopicIndexStore | undefined;

  public constructor(env: Env, options: TelegramServiceOptions = {}) {
    const botToken =
      typeof env.TELEGRAM_BOT_TOKEN === 'string' ? env.TELEGRAM_BOT_TOKEN.trim() : '';
    this.client = options.client ?? new TelegramApiClient(botToken, options);
    this.logger = options.logger ?? defaultLogger;
    this.adminChatIds = parseAdminChatIds(env.TELEGRAM_ADMIN_CHAT_IDS);
    this.enabled = botToken.length > 0 && this.adminChatIds.length > 0;
    this.topicIndex = env.CHAT_CONFIG as unknown as TopicIndexStore | undefined;
  }

  public sendMessage(chatId: TelegramChatId, text: string) {
    return this.client.sendMessage(chatId, text);
  }

  public getBotInfo(): Promise<TelegramUser> {
    return this.client.getMe();
  }

  public sendPhoto(chatId: TelegramChatId, photo: string | Blob, caption?: string) {
    return this.client.sendPhoto(chatId, photo, caption);
  }

  public sendTyping(chatId: TelegramChatId) {
    return this.client.sendTyping(chatId);
  }

  public async createVisitorTopics(
    visitorId: VisitorId,
    visitorInfo: VisitorInfo,
    sessionId: SessionId = visitorId as unknown as SessionId,
  ): Promise<TelegramTopic[]> {
    return this.createTopicsForChats(visitorId, visitorInfo, sessionId, this.adminChatIds);
  }

  public async createMissingVisitorTopics(
    visitorId: VisitorId,
    visitorInfo: VisitorInfo,
    sessionId: SessionId,
    existingTopics: readonly TelegramTopic[],
  ): Promise<TelegramTopic[]> {
    const existingChats = new Set(existingTopics.map((topic) => topic.chatId));
    const missingChats = this.adminChatIds.filter((chatId) => !existingChats.has(chatId));
    const additions = await this.createTopicsForChats(
      visitorId,
      visitorInfo,
      sessionId,
      missingChats,
    );
    return [...existingTopics, ...additions];
  }

  public get configuredAdminChatCount(): number {
    return this.adminChatIds.length;
  }

  private async createTopicsForChats(
    visitorId: VisitorId,
    visitorInfo: VisitorInfo,
    sessionId: SessionId,
    chatIds: readonly TelegramChatId[],
  ): Promise<TelegramTopic[]> {
    if (!this.enabled || chatIds.length === 0) {
      return [];
    }

    const topicName = formatTopicName(visitorInfo);
    const deliveries = await Promise.allSettled(
      chatIds.map(async (chatId): Promise<TelegramTopic> => {
        const topicMessage = await this.client.createForumTopic(chatId, topicName);
        const messageThreadId = topicMessage.message_thread_id;

        if (messageThreadId === undefined) {
          throw new Error('Telegram did not return a forum topic id.');
        }

        const topic: TelegramTopic = {
          chatId,
          messageThreadId,
          sessionId,
          visitorId,
          createdAt: Date.now(),
        };
        await this.saveTopicMapping(topic);

        try {
          await this.client.sendMessage(chatId, formatNewVisitorMessage(visitorInfo), {
            messageThreadId,
          });
        } catch (cause) {
          this.logger.error('Telegram visitor introduction failed.', cause);
        }

        return topic;
      }),
    );

    return deliveries.flatMap((delivery) => {
      if (delivery.status === 'fulfilled') {
        return [delivery.value];
      }

      this.logger.error('Telegram forum topic creation failed.', delivery.reason);
      return [];
    });
  }

  public async lookupTopicBinding(
    chatId: TelegramChatId,
    messageThreadId: number,
  ): Promise<TelegramTopicBinding | undefined> {
    if (this.topicIndex === undefined) {
      return undefined;
    }

    try {
      const value = await this.topicIndex.get(this.topicIndexKey(chatId, messageThreadId), 'text');
      if (value === null || value.length === 0) {
        return undefined;
      }

      try {
        const binding = JSON.parse(value) as Partial<TelegramTopicBinding>;
        if (typeof binding.sessionId === 'string' && binding.sessionId.length > 0) {
          const visitorId =
            typeof binding.visitorId === 'string' && binding.visitorId.length > 0
              ? binding.visitorId
              : await this.topicIndex.get(
                  this.sessionIndexKey(binding.sessionId as SessionId),
                  'text',
                );
          if (visitorId !== null && visitorId !== undefined && visitorId.length > 0) {
            return { sessionId: binding.sessionId as SessionId, visitorId: visitorId as VisitorId };
          }
        }
      } catch {
        // Legacy indexes stored only visitorId; keep them readable while they migrate.
      }

      return {
        sessionId: value as unknown as SessionId,
        visitorId: value as VisitorId,
      };
    } catch (cause) {
      this.logger.error('Telegram topic lookup failed.', cause);
      return undefined;
    }
  }

  public async lookupVisitorByTopic(
    chatId: TelegramChatId,
    messageThreadId: number,
  ): Promise<VisitorId | undefined> {
    return (await this.lookupTopicBinding(chatId, messageThreadId))?.visitorId;
  }

  public async sendTopicInfo(
    chatId: TelegramChatId,
    messageThreadId: number,
    visitorInfo: VisitorInfo,
  ): Promise<void> {
    await this.client.sendMessage(chatId, formatTopicInfo(visitorInfo), { messageThreadId });
  }

  public async notifyTopicSystem(topics: readonly TelegramTopic[], message: string): Promise<void> {
    await this.deliverTopics(topics, (topic) =>
      this.client.sendMessage(topic.chatId, message, { messageThreadId: topic.messageThreadId }),
    );
  }

  public async closeTopics(topics: readonly TelegramTopic[]): Promise<void> {
    await this.deliverTopics(topics, (topic) =>
      this.client.closeForumTopic(topic.chatId, topic.messageThreadId),
    );
  }

  public async persistTopicMappings(topics: readonly TelegramTopic[]): Promise<void> {
    await Promise.all(topics.map((topic) => this.saveTopicMapping(topic)));
  }

  public async notifyCustomerMessage(
    visitorId: VisitorId,
    message: string,
    visitorInfo?: VisitorInfo,
    topics?: readonly TelegramTopic[],
  ): Promise<void> {
    await this.deliverCustomerMessage(visitorId, message, visitorInfo, topics, visitorInfo);
  }

  public async deliverCustomerMessage(
    visitorId: VisitorId,
    message: string,
    visitorInfo?: VisitorInfo,
    topics?: readonly TelegramTopic[],
    fallbackVisitorInfo?: VisitorInfo,
  ): Promise<readonly TelegramTopic[]> {
    if (!this.enabled) {
      return topics ?? [];
    }

    if (topics !== undefined && topics.length > 0) {
      return this.deliverTopicMessageWithRecovery(topics, visitorInfo, (topic) =>
        this.client.sendMessage(topic.chatId, `用户：${message}`, {
          messageThreadId: topic.messageThreadId,
        }),
      );
    }

    await this.deliverAdmins((chatId) =>
      this.client.sendMessage(
        chatId,
        formatCustomerMessage(visitorId, message, fallbackVisitorInfo ?? visitorInfo),
      ),
    );
    return [];
  }

  public async notifyCustomerImage(
    visitorId: VisitorId,
    url: string,
    caption?: string,
    visitorInfo?: VisitorInfo,
    topics?: readonly TelegramTopic[],
  ): Promise<void> {
    await this.deliverCustomerImage(visitorId, url, caption, visitorInfo, topics, visitorInfo);
  }

  public async deliverCustomerImage(
    visitorId: VisitorId,
    url: string,
    caption?: string,
    visitorInfo?: VisitorInfo,
    topics?: readonly TelegramTopic[],
    fallbackVisitorInfo?: VisitorInfo,
  ): Promise<readonly TelegramTopic[]> {
    if (!this.enabled) {
      return topics ?? [];
    }

    if (topics !== undefined && topics.length > 0) {
      return this.deliverTopicMessageWithRecovery(topics, visitorInfo, (topic) =>
        this.client.sendPhoto(topic.chatId, url, `访客 ${formatVisitorLabel(visitorId)}\n图片`, {
          messageThreadId: topic.messageThreadId,
        }),
      );
    }

    await this.deliverAdmins((chatId) =>
      this.client.sendPhoto(
        chatId,
        url,
        formatCustomerImageCaption(visitorId, caption, fallbackVisitorInfo ?? visitorInfo),
      ),
    );
    return [];
  }

  public async downloadImage(fileId: string): Promise<{ blob: Blob; contentType: string }> {
    const file = await this.client.getFile(fileId);
    const response = await this.client.downloadFile(file.file_path);
    const blob = await response.blob();
    const responseContentType = response.headers.get('content-type')?.split(';', 1)[0];
    const contentType =
      [responseContentType, blob.type, inferImageContentType(file.file_path)].find((value) =>
        value?.startsWith('image/'),
      ) ?? '';

    return { blob, contentType };
  }

  private async saveTopicMapping(topic: TelegramTopic): Promise<void> {
    if (this.topicIndex === undefined) {
      return;
    }

    try {
      await this.topicIndex.put(
        this.topicIndexKey(topic.chatId, topic.messageThreadId),
        JSON.stringify({ sessionId: topic.sessionId }),
        { expirationTtl: TOPIC_INDEX_TTL_SECONDS },
      );
      await this.topicIndex.put(this.sessionIndexKey(topic.sessionId), topic.visitorId, {
        expirationTtl: TOPIC_INDEX_TTL_SECONDS,
      });
    } catch (cause) {
      this.logger.error('Telegram topic mapping could not be stored.', cause);
    }
  }

  private topicIndexKey(chatId: TelegramChatId, messageThreadId: number): string {
    return `${TOPIC_INDEX_PREFIX}${chatId}:${messageThreadId}`;
  }

  private sessionIndexKey(sessionId: SessionId): string {
    return `${SESSION_INDEX_PREFIX}${sessionId}`;
  }

  private async deleteTopicMapping(topic: TelegramTopic): Promise<void> {
    if (this.topicIndex?.delete === undefined) {
      return;
    }

    try {
      await this.topicIndex.delete(this.topicIndexKey(topic.chatId, topic.messageThreadId));
    } catch (cause) {
      this.logger.error('Telegram stale topic mapping could not be removed.', cause);
    }
  }

  private async deliverAdmins(send: (chatId: TelegramChatId) => Promise<unknown>): Promise<void> {
    const deliveries = await Promise.allSettled(this.adminChatIds.map(send));
    const failures = deliveries.filter(
      (delivery): delivery is PromiseRejectedResult => delivery.status === 'rejected',
    );

    if (failures.length > 0) {
      this.logger.error(
        `Telegram delivery failed for ${failures.length} administrator chat(s).`,
        failures[0]?.reason,
      );
    }
  }

  private async deliverTopics(
    topics: readonly TelegramTopic[],
    send: (topic: TelegramTopic) => Promise<unknown>,
  ): Promise<void> {
    const deliveries = await Promise.allSettled(topics.map(send));
    const failures = deliveries.filter(
      (delivery): delivery is PromiseRejectedResult => delivery.status === 'rejected',
    );

    if (failures.length > 0) {
      this.logger.error(
        `Telegram topic delivery failed for ${failures.length} topic(s).`,
        failures[0]?.reason,
      );
    }
  }

  private async deliverTopicMessageWithRecovery(
    topics: readonly TelegramTopic[],
    visitorInfo: VisitorInfo | undefined,
    send: (topic: TelegramTopic) => Promise<unknown>,
  ): Promise<readonly TelegramTopic[]> {
    return Promise.all(
      topics.map(async (topic) => {
        try {
          await send(topic);
          return topic;
        } catch (cause) {
          if (!isInvalidTopicError(cause) || visitorInfo === undefined) {
            this.logger.error('Telegram topic delivery failed.', cause);
            return topic;
          }

          const replacement = await this.recreateTopic(topic, visitorInfo);
          if (replacement === undefined) {
            return topic;
          }

          try {
            await send(replacement);
          } catch (replacementCause) {
            this.logger.error('Telegram replacement topic delivery failed.', replacementCause);
          }
          return replacement;
        }
      }),
    );
  }

  private async recreateTopic(
    previousTopic: TelegramTopic,
    visitorInfo: VisitorInfo,
  ): Promise<TelegramTopic | undefined> {
    try {
      const topicMessage = await this.client.createForumTopic(
        previousTopic.chatId,
        formatTopicName(visitorInfo),
      );
      const messageThreadId = topicMessage.message_thread_id;
      if (messageThreadId === undefined) {
        throw new Error('Telegram did not return a replacement forum topic id.');
      }

      const replacement: TelegramTopic = {
        ...previousTopic,
        messageThreadId,
        createdAt: Date.now(),
      };
      await this.deleteTopicMapping(previousTopic);
      await this.saveTopicMapping(replacement);
      await this.client.sendMessage(
        replacement.chatId,
        `🟡 会话已恢复\n访客 ${formatVisitorLabel(visitorInfo.visitorId)}`,
        { messageThreadId },
      );
      this.logger.warn('Telegram topic was recreated after an invalid thread.', {
        chatId: replacement.chatId,
        previousThreadId: previousTopic.messageThreadId,
        messageThreadId,
      });
      return replacement;
    } catch (cause) {
      this.logger.error('Telegram topic recreation failed.', cause);
      return undefined;
    }
  }
}

function isInvalidTopicError(cause: unknown): boolean {
  if (!(cause instanceof TelegramApiError)) {
    return false;
  }

  if (cause.errorCode === 400 || cause.status === 400) {
    return true;
  }

  return /thread|topic|message to be replied|not found/iu.test(cause.message);
}

function formatNewVisitorMessage(info: VisitorInfo): string {
  return [
    '━━━━━━━━━━━━━━',
    '🟢 新访客',
    '',
    '编号：',
    formatVisitorLabel(info.visitorId),
    '',
    ...formatTopicVisitorInfo(info).slice(1),
  ].join('\n');
}

function formatTopicInfo(info: VisitorInfo): string {
  return ['━━━━━━━━━━━━━━', '访客资料', '', ...formatTopicVisitorInfo(info).slice(1)].join('\n');
}

function formatTopicVisitorInfo(info: VisitorInfo): string[] {
  const lines = [...formatVisitorInfo(info)];
  const visitorLabelIndex = lines.indexOf('访客');

  if (visitorLabelIndex >= 0 && visitorLabelIndex + 1 < lines.length) {
    lines[visitorLabelIndex + 1] = formatVisitorLabel(info.visitorId);
  }

  return lines;
}

function formatVisitorInfo(info: VisitorInfo): string[] {
  const location = [info.city, info.region, info.country].filter(Boolean).join(', ');
  const network = [info.isp, info.asn === undefined ? undefined : `ASN ${info.asn}`]
    .filter(Boolean)
    .join(' · ');

  return [
    '━━━━━━━━━━━━━━━━━━━━',
    '网站',
    info.website ?? '未知',
    '',
    '访客',
    info.visitorId,
    '',
    '所在地区',
    location || '未知',
    '',
    '时区',
    info.timezone ?? '未知',
    '',
    '连接时间',
    formatConnectionTime(info.connectionTime),
    '',
    '浏览器语言',
    info.language ?? '未知',
    '',
    '设备',
    [info.deviceType, info.operatingSystem].filter(Boolean).join(' · ') || '未知',
    '',
    '浏览器',
    info.browser ?? '未知',
    '',
    '网络运营商',
    network || '未知',
    '',
    '用户代理',
    info.userAgent ?? '未知',
    '━━━━━━━━━━━━━━━━━━━━',
  ];
}

function formatConnectionTime(timestamp: number): string {
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return '未知';
  }
}

function inferImageContentType(filePath: string): string | undefined {
  const extension = filePath.toLowerCase().split('.').pop();

  return extension === 'jpg' || extension === 'jpeg'
    ? 'image/jpeg'
    : extension === 'png'
      ? 'image/png'
      : extension === 'gif'
        ? 'image/gif'
        : extension === 'webp'
          ? 'image/webp'
          : undefined;
}

function sanitizeTopicPart(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/[\r\n｜|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
