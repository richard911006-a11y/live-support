import { describe, expect, it } from 'vitest';

import { SessionManager, type SessionSocket } from '../src/modules/durable-objects/session-manager';
import type { VisitorId } from '../src/types';

interface MockSocket extends SessionSocket {
  closed: boolean;
}

function createSocket(): MockSocket {
  return {
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

describe('SessionManager', () => {
  it('keeps multiple visitors in independent sessions', () => {
    const manager = new SessionManager<MockSocket>(() => 1_000);
    const first = manager.createSession('visitor-a' as VisitorId, createSocket());
    const second = manager.createSession('visitor-b' as VisitorId, createSocket());

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(manager.hasSession(first.sessionId)).toBe(true);
    expect(manager.hasSession(second.sessionId)).toBe(true);
    expect(manager.getSession(first.sessionId)?.connectedAt).toBe(1_000);
    expect(manager.getSession(first.sessionId)?.lastHeartbeat).toBe(1_000);
  });

  it('rejoins an existing session for the same visitor', () => {
    const manager = new SessionManager<MockSocket>();
    const firstSocket = createSocket();
    const first = manager.createSession('visitor-a' as VisitorId, firstSocket);
    const second = manager.createSession('visitor-a' as VisitorId, createSocket());

    expect(firstSocket.closed).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(manager.hasSession(first.sessionId)).toBe(true);
    expect(manager.hasSession(second.sessionId)).toBe(true);
    expect(manager.getSession(second.sessionId)?.websocket).not.toBe(firstSocket);
  });

  it('removes a disconnected session', () => {
    const manager = new SessionManager<MockSocket>();
    const session = manager.createSession('visitor-a' as VisitorId, createSocket());

    expect(manager.removeSession(session.sessionId)).toBe(true);
    expect(manager.getSession(session.sessionId)).toBeUndefined();
    expect(manager.hasSession(session.sessionId)).toBe(false);
    expect(manager.removeSession(session.sessionId)).toBe(false);
  });
});
