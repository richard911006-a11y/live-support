type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type VisitorId = Brand<string, 'VisitorId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type TelegramChatId = Brand<string, 'TelegramChatId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ImageId = Brand<string, 'ImageId'>;
