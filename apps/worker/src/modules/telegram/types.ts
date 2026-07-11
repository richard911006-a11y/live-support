import type { TelegramChatId } from '@live-support/types';

export interface TelegramApiResponse<Result> {
  ok: boolean;
  result?: Result;
  description?: string;
  error_code?: number;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path: string;
}

export interface GetFileParams {
  file_id: string;
}

export interface SetWebhookParams {
  url: string;
  secret_token?: string;
  allowed_updates?: string[];
}

export interface TelegramUpdateChat {
  id: number;
  type: string;
}

export interface TelegramUpdateMessage {
  message_id: number;
  chat: TelegramUpdateChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramUpdateMessage;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramUpdateMessage;
  edited_message?: TelegramUpdateMessage;
}

export interface SendMessageParams {
  chat_id: TelegramChatId;
  text: string;
}

export interface SendPhotoParams {
  chat_id: TelegramChatId;
  photo: string | Blob;
  caption?: string;
}

export interface SendChatActionParams {
  chat_id: TelegramChatId;
  action: 'typing';
}

export type TelegramFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
