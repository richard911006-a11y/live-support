import type { Message } from './domain';
import type { MessageId, SessionId } from './identifiers';

export interface MessageQuery {
  readonly sessionId: SessionId;
  readonly before?: number;
  readonly after?: number;
  readonly limit?: number;
}

/**
 * Future persistence boundary for chat messages.
 *
 * The current Worker does not install a database implementation. Keeping this
 * interface separate lets a later D1 or SQLite adapter evolve without changing
 * Session application services.
 */
export interface MessageRepository {
  save(message: Message): Promise<void>;
  getById(sessionId: SessionId, messageId: MessageId): Promise<Message | undefined>;
  list(query: MessageQuery): Promise<readonly Message[]>;
}
