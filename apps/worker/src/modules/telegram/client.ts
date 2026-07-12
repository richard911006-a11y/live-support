import type { TelegramChatId } from '@live-support/types';

import type {
  SendChatActionParams,
  GetFileParams,
  SendMessageParams,
  SendPhotoParams,
  SetWebhookParams,
  TelegramApiResponse,
  TelegramFetch,
  TelegramFile,
  TelegramMessage,
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

/** Centralized, retrying client for Telegram Bot API requests. */
export class TelegramApiClient {
  private readonly fetchImplementation: TelegramFetch;
  private readonly apiBaseUrl: string;

  public constructor(
    private readonly botToken: string,
    options: TelegramApiClientOptions = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? TELEGRAM_API_URL).replace(/\/$/, '');
  }

  public sendMessage(chatId: TelegramChatId, text: string): Promise<TelegramMessage> {
    const body: SendMessageParams = { chat_id: chatId, text };
    return this.request<TelegramMessage>('sendMessage', body);
  }

  public sendPhoto(
    chatId: TelegramChatId,
    photo: string | Blob,
    caption?: string,
  ): Promise<TelegramMessage> {
    const form = new FormData();
    const body: SendPhotoParams = { chat_id: chatId, photo };
    form.append('chat_id', body.chat_id);
    form.append('photo', body.photo);

    if (caption !== undefined) {
      form.append('caption', caption);
    }

    return this.request<TelegramMessage>('sendPhoto', form);
  }

  public sendTyping(chatId: TelegramChatId): Promise<boolean> {
    const body: SendChatActionParams = { chat_id: chatId, action: 'typing' };
    return this.request<boolean>('sendChatAction', body);
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

        console.log('[Telegram Debug]', {
          event: 'api_response',
          method: 'downloadFile',
          httpStatus: response.status,
          ok: undefined,
          error_code: undefined,
          description: undefined,
        });

        if (!response.ok) {
          throw new TelegramApiError(
            `Telegram file download failed with status ${response.status}.`,
            response.status,
          );
        }

        return response;
      } catch (cause) {
        console.error(
          '[Telegram Debug] Telegram API exception',
          { method: 'downloadFile', attempt: attempt + 1 },
          cause,
        );
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

        if (method === 'sendMessage' && !isMultipart) {
          console.log('[Telegram Debug]', {
            event: 'send_message_request',
            targetChatId: (body as SendMessageParams).chat_id,
            attempt: attempt + 1,
          });
        }

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
          console.log('[Telegram Debug]', {
            event: 'api_response',
            method,
            httpStatus: response.status,
            ok: undefined,
            error_code: undefined,
            description: undefined,
          });
          throw new TelegramApiError(
            `Telegram returned an invalid response with status ${response.status}.`,
            response.status,
          );
        }

        console.log('[Telegram Debug]', {
          event: 'api_response',
          method,
          httpStatus: response.status,
          ok: payload.ok,
          error_code: payload.error_code,
          description: payload.description,
        });

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
        console.error(
          '[Telegram Debug] Telegram API exception',
          { method, attempt: attempt + 1 },
          cause,
        );
        lastError = cause;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new TelegramApiError('Telegram request failed after retrying.');
  }
}
