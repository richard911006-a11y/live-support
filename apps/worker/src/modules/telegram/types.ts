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
  title?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  message_thread_id?: number;
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
  title?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TelegramUpdateMessage {
  message_id: number;
  chat: TelegramUpdateChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  message_thread_id?: number;
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
  message_thread_id?: number;
}

export interface SendPhotoParams {
  chat_id: TelegramChatId;
  photo: string | Blob;
  caption?: string;
  message_thread_id?: number;
}

export interface SendChatActionParams {
  chat_id: TelegramChatId;
  action: 'typing';
  message_thread_id?: number;
}

export interface CreateForumTopicParams {
  chat_id: TelegramChatId;
  name: string;
}

export interface CloseForumTopicParams {
  chat_id: TelegramChatId;
  message_thread_id: number;
}

export type TelegramFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
