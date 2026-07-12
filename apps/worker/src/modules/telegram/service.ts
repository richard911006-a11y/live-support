import type { TelegramChatId, VisitorId } from '@live-support/types';

import type { Env } from '../../types/env';
import type { VisitorInfo } from '../../types';
import { logger as defaultLogger, type Logger } from '../../utils/logger';
import { TelegramApiClient } from './client';
import type { TelegramApiClientOptions } from './client';

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

  public constructor(env: Env, options: TelegramServiceOptions = {}) {
    const botToken =
      typeof env.TELEGRAM_BOT_TOKEN === 'string' ? env.TELEGRAM_BOT_TOKEN.trim() : '';
    this.client = options.client ?? new TelegramApiClient(botToken, options);
    this.logger = options.logger ?? defaultLogger;
    this.adminChatIds = parseAdminChatIds(env.TELEGRAM_ADMIN_CHAT_IDS);
    this.enabled = botToken.length > 0 && this.adminChatIds.length > 0;
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

  public async notifyCustomerMessage(
    visitorId: VisitorId,
    message: string,
    visitorInfo?: VisitorInfo,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const text = formatCustomerMessage(visitorId, message, visitorInfo);
    const deliveries = await Promise.allSettled(
      this.adminChatIds.map((chatId) => this.client.sendMessage(chatId, text)),
    );
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

  public async notifyCustomerImage(
    visitorId: VisitorId,
    url: string,
    caption?: string,
    visitorInfo?: VisitorInfo,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const imageCaption = formatCustomerImageCaption(visitorId, caption, visitorInfo);
    const deliveries = await Promise.allSettled(
      this.adminChatIds.map((chatId) => this.client.sendPhoto(chatId, url, imageCaption)),
    );
    const failures = deliveries.filter(
      (delivery): delivery is PromiseRejectedResult => delivery.status === 'rejected',
    );

    if (failures.length > 0) {
      this.logger.error(
        `Telegram image delivery failed for ${failures.length} administrator chat(s).`,
        failures[0]?.reason,
      );
    }
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
