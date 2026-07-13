import type { TelegramChatId, VisitorId } from '@live-support/types';

import type { Env } from '../../types/env';
import type { VisitorInfo } from '../../types';
import { logger as defaultLogger, type Logger } from '../../utils/logger';
import { TelegramApiClient } from './client';
import type { TelegramApiClientOptions } from './client';

const TOPIC_INDEX_PREFIX = 'telegram-topic:';
const TOPIC_INDEX_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface TelegramTopic {
  readonly chatId: TelegramChatId;
  readonly messageThreadId: number;
  readonly visitorId: VisitorId;
  readonly createdAt: number;
}

interface TopicIndexStore {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
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

  public sendPhoto(chatId: TelegramChatId, photo: string | Blob, caption?: string) {
    return this.client.sendPhoto(chatId, photo, caption);
  }

  public sendTyping(chatId: TelegramChatId) {
    return this.client.sendTyping(chatId);
  }

  public async createVisitorTopics(
    visitorId: VisitorId,
    visitorInfo: VisitorInfo,
  ): Promise<TelegramTopic[]> {
    if (!this.enabled) {
      return [];
    }

    const topicName = `访客 ${formatVisitorLabel(visitorId)}`;
    const deliveries = await Promise.allSettled(
      this.adminChatIds.map(async (chatId): Promise<TelegramTopic> => {
        const topicMessage = await this.client.createForumTopic(chatId, topicName);
        const messageThreadId = topicMessage.message_thread_id;

        if (messageThreadId === undefined) {
          throw new Error('Telegram did not return a forum topic id.');
        }

        const topic: TelegramTopic = {
          chatId,
          messageThreadId,
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

  public async lookupVisitorByTopic(
    chatId: TelegramChatId,
    messageThreadId: number,
  ): Promise<VisitorId | undefined> {
    if (this.topicIndex === undefined) {
      return undefined;
    }

    try {
      const visitorId = await this.topicIndex.get(
        this.topicIndexKey(chatId, messageThreadId),
        'text',
      );
      return visitorId === null || visitorId.length === 0 ? undefined : (visitorId as VisitorId);
    } catch (cause) {
      this.logger.error('Telegram topic lookup failed.', cause);
      return undefined;
    }
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

  public async notifyCustomerMessage(
    visitorId: VisitorId,
    message: string,
    visitorInfo?: VisitorInfo,
    topics?: readonly TelegramTopic[],
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (topics !== undefined && topics.length > 0) {
      await this.deliverTopics(topics, (topic) =>
        this.client.sendMessage(topic.chatId, `用户：${message}`, {
          messageThreadId: topic.messageThreadId,
        }),
      );
      return;
    }

    await this.deliverAdmins((chatId) =>
      this.client.sendMessage(chatId, formatCustomerMessage(visitorId, message, visitorInfo)),
    );
  }

  public async notifyCustomerImage(
    visitorId: VisitorId,
    url: string,
    caption?: string,
    visitorInfo?: VisitorInfo,
    topics?: readonly TelegramTopic[],
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (topics !== undefined && topics.length > 0) {
      await this.deliverTopics(topics, (topic) =>
        this.client.sendPhoto(topic.chatId, url, `访客 ${formatVisitorLabel(visitorId)}\n图片`, {
          messageThreadId: topic.messageThreadId,
        }),
      );
      return;
    }

    await this.deliverAdmins((chatId) =>
      this.client.sendPhoto(
        chatId,
        url,
        formatCustomerImageCaption(visitorId, caption, visitorInfo),
      ),
    );
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
        topic.visitorId,
        { expirationTtl: TOPIC_INDEX_TTL_SECONDS },
      );
    } catch (cause) {
      this.logger.error('Telegram topic mapping could not be stored.', cause);
    }
  }

  private topicIndexKey(chatId: TelegramChatId, messageThreadId: number): string {
    return `${TOPIC_INDEX_PREFIX}${chatId}:${messageThreadId}`;
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
