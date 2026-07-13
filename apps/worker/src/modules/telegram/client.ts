import type { TelegramChatId } from '@live-support/types';

import type {
  SendChatActionParams,
  CloseForumTopicParams,
  CreateForumTopicParams,
  GetFileParams,
  SendMessageParams,
  SendPhotoParams,
  SetWebhookParams,
  TelegramApiResponse,
  TelegramFetch,
  TelegramFile,
  TelegramMessage,
  TelegramUser,
} from './types';

const TELEGRAM_API_URL = 'https://api.telegram.org';
const MAX_ATTEMPTS = 2;

export class TelegramApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    public readonly errorCode?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export interface TelegramApiClientOptions {
  fetchImplementation?: TelegramFetch;
  apiBaseUrl?: string;
}

export interface TelegramTopicOptions {
  messageThreadId?: number;
}

/** Centralized, retrying client for Telegram Bot API requests. */
export class TelegramApiClient {
  private readonly fetchImplementation: TelegramFetch;
  private readonly apiBaseUrl: string;

  public constructor(
    private readonly botToken: string,
    options: TelegramApiClientOptions = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.apiBaseUrl = (options.apiBaseUrl ?? TELEGRAM_API_URL).replace(/\/$/, '');
  }

  public sendMessage(
    chatId: TelegramChatId,
    text: string,
    options: TelegramTopicOptions = {},
  ): Promise<TelegramMessage> {
    const body: SendMessageParams = {
      chat_id: chatId,
      text,
      ...(options.messageThreadId === undefined
        ? {}
        : { message_thread_id: options.messageThreadId }),
    };
    return this.request<TelegramMessage>('sendMessage', body);
  }

  public getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>('getMe', {});
  }

  public sendPhoto(
    chatId: TelegramChatId,
    photo: string | Blob,
    caption?: string,
    options: TelegramTopicOptions = {},
  ): Promise<TelegramMessage> {
    const form = new FormData();
    const body: SendPhotoParams = {
      chat_id: chatId,
      photo,
      ...(caption === undefined ? {} : { caption }),
      ...(options.messageThreadId === undefined
        ? {}
        : { message_thread_id: options.messageThreadId }),
    };
    form.append('chat_id', body.chat_id);
    form.append('photo', body.photo);

    if (body.caption !== undefined) {
      form.append('caption', body.caption);
    }

    if (body.message_thread_id !== undefined) {
      form.append('message_thread_id', String(body.message_thread_id));
    }

    return this.request<TelegramMessage>('sendPhoto', form);
  }

  public sendTyping(chatId: TelegramChatId, options: TelegramTopicOptions = {}): Promise<boolean> {
    const body: SendChatActionParams = {
      chat_id: chatId,
      action: 'typing',
      ...(options.messageThreadId === undefined
        ? {}
        : { message_thread_id: options.messageThreadId }),
    };
    return this.request<boolean>('sendChatAction', body);
  }

  public createForumTopic(chatId: TelegramChatId, name: string): Promise<TelegramMessage> {
    const body: CreateForumTopicParams = { chat_id: chatId, name };
    return this.request<TelegramMessage>('createForumTopic', body);
  }

  public closeForumTopic(chatId: TelegramChatId, messageThreadId: number): Promise<boolean> {
    const body: CloseForumTopicParams = {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    };
    return this.request<boolean>('closeForumTopic', body);
  }

  public getFile(fileId: string): Promise<TelegramFile> {
    const body: GetFileParams = { file_id: fileId };
    return this.request<TelegramFile>('getFile', body);
  }

  public setWebhook(url: string, secretToken?: string): Promise<boolean> {
    const body: SetWebhookParams = {
      url,
      allowed_updates: ['message', 'edited_message'],
      ...(secretToken === undefined ? {} : { secret_token: secretToken }),
    };

    return this.request<boolean>('setWebhook', body);
  }

  public async downloadFile(filePath: string): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetchImplementation(
          `${this.apiBaseUrl}/file/bot${this.botToken}/${filePath}`,
        );

        if (!response.ok) {
          throw new TelegramApiError(
            `Telegram file download failed with status ${response.status}.`,
            response.status,
          );
        }

        return response;
      } catch (cause) {
        lastError = cause;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new TelegramApiError('Telegram file download failed after retrying.');
  }

  private async request<Result>(method: string, body: object | FormData): Promise<Result> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const isMultipart = body instanceof FormData;
        const requestInit: RequestInit = {
          method: 'POST',
          body: isMultipart ? body : JSON.stringify(body),
        };

        if (!isMultipart) {
          requestInit.headers = { 'content-type': 'application/json' };
        }

        const response = await this.fetchImplementation(
          `${this.apiBaseUrl}/bot${this.botToken}/${method}`,
          requestInit,
        );
        const responseText = await response.text();
        let payload: TelegramApiResponse<Result>;

        try {
          payload = JSON.parse(responseText) as TelegramApiResponse<Result>;
        } catch {
          throw new TelegramApiError(
            `Telegram returned an invalid response with status ${response.status}.`,
            response.status,
          );
        }

        if (!response.ok || !payload.ok) {
          throw new TelegramApiError(
            payload.description ?? `Telegram request failed with status ${response.status}.`,
            response.status,
            payload.error_code,
          );
        }

        if (payload.result === undefined) {
          throw new TelegramApiError(
            'Telegram response did not include a result.',
            response.status,
          );
        }

        return payload.result;
      } catch (cause) {
        lastError = cause;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new TelegramApiError('Telegram request failed after retrying.');
  }
}
